import { randomUUID } from 'node:crypto';

import BetterSqlite3 from 'better-sqlite3';
import type {
  AppConfig,
  ConnectionCreateInput,
  ConnectionHealthSummary,
  ConnectionRecord,
  ConnectionResourceRule,
  ConnectionSyncSummary,
  ConnectionUpdateInput,
  DomainKind,
  OAuthConnectStartRequest,
  OAuthSessionRecord,
  SecretRefRecord,
} from '@popeye/contracts';
import type { CapabilityContext } from '@popeye/contracts';
import { nowIso } from '@popeye/contracts';
import { EmailService, GmailAdapter } from '@popeye/cap-email';
import { CalendarService, GoogleCalendarAdapter } from '@popeye/cap-calendar';
import { GithubService, GithubApiAdapter } from '@popeye/cap-github';
import type { PopeyeLogger } from '@popeye/observability';

import type { OAuthSessionService, OAuthSessionInternalRecord } from './oauth-session-service.js';
import {
  buildPkceChallenge,
  buildPkceVerifier,
  buildProviderAuthorizationUrl,
  exchangeProviderAuthorizationCode,
  getProviderScopes,
  mapProviderToDomain,
  type OAuthTokenPayload,
} from './provider-oauth.js';
import { connectionCursorKindForProvider } from './row-mappers.js';
import { RuntimeNotFoundError, RuntimeValidationError } from './errors.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OAuthConnectDeps {
  oauthSessionService: OAuthSessionService;
  connectionService: OAuthConnectConnectionOps;
  config: AppConfig;
  capabilityStoresDir: string;
  log: PopeyeLogger;
}

/** Narrow surface of ConnectionService consumed by OAuthConnectService. */
export interface OAuthConnectConnectionOps {
  getConnection(id: string): ConnectionRecord | null;
  createConnection(input: ConnectionCreateInput): ConnectionRecord;
  updateConnection(id: string, input: ConnectionUpdateInput): ConnectionRecord | null;
  updateConnectionRollups(input: {
    connectionId: string;
    health?: Partial<ConnectionHealthSummary> | undefined;
    sync?: Partial<ConnectionSyncSummary> | undefined;
  }): ConnectionRecord | null;
  getOAuthRedirectUri(): string;
  storeOAuthSecret(
    connectionId: string | null,
    providerKind: ConnectionRecord['providerKind'],
    payload: OAuthTokenPayload,
    existingSecretRefId?: string | null,
  ): SecretRefRecord;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class OAuthConnectService {
  constructor(private readonly deps: OAuthConnectDeps) {}

  startOAuthConnectSession(input: OAuthConnectStartRequest): OAuthSessionRecord {
    this.deps.oauthSessionService.expirePendingSessions();

    const domain = mapProviderToDomain(input.providerKind);
    if (input.connectionId) {
      const existing = this.deps.connectionService.getConnection(input.connectionId);
      if (!existing) {
        throw new RuntimeNotFoundError(`Connection ${input.connectionId} not found`);
      }
      if (existing.providerKind !== input.providerKind || existing.domain !== domain) {
        throw new RuntimeValidationError(`Connection ${input.connectionId} does not match ${input.providerKind}`);
      }
    }

    const id = randomUUID();
    const stateToken = `oauth_${id}_${buildPkceVerifier()}`;
    const pkceVerifier = buildPkceVerifier();
    const redirectUri = this.deps.connectionService.getOAuthRedirectUri();
    const authorizationUrl = buildProviderAuthorizationUrl({
      providerKind: input.providerKind,
      config: this.deps.config,
      redirectUri,
      state: stateToken,
      codeChallenge: buildPkceChallenge(pkceVerifier),
    });

    return this.deps.oauthSessionService.createSession({
      id,
      providerKind: input.providerKind,
      domain,
      connectionMode: input.mode,
      syncIntervalSeconds: input.syncIntervalSeconds,
      connectionId: input.connectionId ?? null,
      stateToken,
      pkceVerifier,
      redirectUri,
      authorizationUrl,
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    });
  }

  async completeOAuthConnectCallback(input: {
    code?: string | undefined;
    state?: string | undefined;
    error?: string | undefined;
    errorDescription?: string | undefined;
  }): Promise<OAuthSessionRecord> {
    this.deps.oauthSessionService.expirePendingSessions();

    if (!input.state) {
      throw new RuntimeValidationError('Missing OAuth state');
    }
    const session = this.deps.oauthSessionService.getByStateToken(input.state);
    if (!session) {
      throw new RuntimeNotFoundError('OAuth session not found');
    }
    if (session.status !== 'pending') {
      return this.deps.oauthSessionService.getSession(session.id)!;
    }
    if (Date.parse(session.expiresAt) <= Date.now()) {
      return this.deps.oauthSessionService.failSession(session.id, 'OAuth session expired', 'expired')!;
    }
    if (input.error) {
      return this.deps.oauthSessionService.failSession(
        session.id,
        input.errorDescription ? `${input.error}: ${input.errorDescription}` : input.error,
      )!;
    }
    if (!input.code) {
      return this.deps.oauthSessionService.failSession(session.id, 'OAuth callback did not include an authorization code')!;
    }

    try {
      const tokenPayload = await exchangeProviderAuthorizationCode({
        providerKind: session.providerKind,
        config: this.deps.config,
        code: input.code,
        redirectUri: session.redirectUri,
        codeVerifier: session.pkceVerifier,
      });
      const completed = await this.completeProviderSession(session, tokenPayload);
      return completed;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.deps.oauthSessionService.failSession(session.id, message);
      if (session.connectionId) {
        this.deps.connectionService.updateConnectionRollups({
          connectionId: session.connectionId,
          health: {
            status: 'reauth_required',
            authState: 'stale',
            checkedAt: nowIso(),
            lastError: message,
          },
        });
      }
      throw error;
    }
  }

  private async completeProviderSession(
    session: OAuthSessionInternalRecord,
    tokenPayload: OAuthTokenPayload,
  ): Promise<OAuthSessionRecord> {
    switch (session.providerKind) {
      case 'gmail':
        return this.completeGmailSession(session, tokenPayload);
      case 'google_calendar':
        return this.completeGoogleCalendarSession(session, tokenPayload);
      case 'github':
        return this.completeGithubSession(session, tokenPayload);
    }
  }

  private createOrUpdateConnectedConnection(input: {
    session: OAuthSessionInternalRecord;
    providerKind: ConnectionRecord['providerKind'];
    domain: DomainKind;
    label: string;
    allowedResources: string[];
    resourceRules: Array<Pick<ConnectionResourceRule, 'resourceType' | 'resourceId' | 'displayName' | 'writeAllowed'>>;
    scopes: string[];
  }): ConnectionRecord {
    if (input.session.connectionId) {
      const updated = this.deps.connectionService.updateConnection(input.session.connectionId, {
        label: input.label,
        mode: input.session.connectionMode,
        syncIntervalSeconds: input.session.syncIntervalSeconds,
        allowedScopes: input.scopes,
        allowedResources: input.allowedResources,
        resourceRules: input.resourceRules,
      });
      if (!updated) {
        throw new RuntimeNotFoundError(`Connection ${input.session.connectionId} not found`);
      }
      return updated;
    }

    return this.deps.connectionService.createConnection({
      domain: input.domain,
      providerKind: input.providerKind,
      label: input.label,
      mode: input.session.connectionMode,
      secretRefId: null,
      syncIntervalSeconds: input.session.syncIntervalSeconds,
      allowedScopes: input.scopes,
      allowedResources: input.allowedResources,
      resourceRules: input.resourceRules,
    });
  }

  private async completeGmailSession(
    session: OAuthSessionInternalRecord,
    tokenPayload: OAuthTokenPayload,
  ): Promise<OAuthSessionRecord> {
    const adapter = new GmailAdapter({
      accessToken: tokenPayload.accessToken,
      refreshToken: tokenPayload.refreshToken,
      clientId: this.deps.config.providerAuth.google.clientId,
      clientSecret: this.deps.config.providerAuth.google.clientSecret,
    });
    const profile = await adapter.getProfile();
    const connection = this.createOrUpdateConnectedConnection({
      session,
      providerKind: 'gmail',
      domain: 'email',
      label: `Gmail (${profile.emailAddress})`,
      allowedResources: [profile.emailAddress],
      resourceRules: [{
        resourceType: 'mailbox',
        resourceId: profile.emailAddress,
        displayName: profile.emailAddress,
        writeAllowed: true,
      }],
      scopes: tokenPayload.scopes.length > 0 ? tokenPayload.scopes : getProviderScopes('gmail'),
    });
    const secretRef = this.deps.connectionService.storeOAuthSecret(connection.id, 'gmail', tokenPayload, connection.secretRefId);
    const connected = this.deps.connectionService.updateConnection(connection.id, { secretRefId: secretRef.id }) ?? connection;

    const dbPath = `${this.deps.capabilityStoresDir}/email.db`;
    const writeDb = new BetterSqlite3(dbPath);
    let accountId: string;
    try {
      const svc = new EmailService(writeDb as unknown as CapabilityContext['appDb']);
      accountId = svc.getAccountByConnection(connection.id)?.id
        ?? svc.registerAccount({
          connectionId: connection.id,
          emailAddress: profile.emailAddress,
          displayName: profile.emailAddress.split('@')[0] ?? profile.emailAddress,
        }).id;
    } finally {
      writeDb.close();
    }

    this.deps.connectionService.updateConnectionRollups({
      connectionId: connected.id,
      health: {
        status: 'healthy',
        authState: 'configured',
        checkedAt: nowIso(),
        lastError: null,
        diagnostics: [],
      },
      sync: {
        status: 'idle',
        cursorKind: connectionCursorKindForProvider(connected.providerKind),
        cursorPresent: false,
        lagSummary: 'Awaiting first sync',
      },
    });

    return this.deps.oauthSessionService.completeSession(session.id, {
      connectionId: connected.id,
      accountId,
    })!;
  }

  private async completeGoogleCalendarSession(
    session: OAuthSessionInternalRecord,
    tokenPayload: OAuthTokenPayload,
  ): Promise<OAuthSessionRecord> {
    const adapter = new GoogleCalendarAdapter({
      accessToken: tokenPayload.accessToken,
      refreshToken: tokenPayload.refreshToken,
      clientId: this.deps.config.providerAuth.google.clientId,
      clientSecret: this.deps.config.providerAuth.google.clientSecret,
    });
    const profile = await adapter.getProfile();
    const connection = this.createOrUpdateConnectedConnection({
      session,
      providerKind: 'google_calendar',
      domain: 'calendar',
      label: `Google Calendar (${profile.email})`,
      allowedResources: [profile.email],
      resourceRules: [{
        resourceType: 'calendar',
        resourceId: profile.email,
        displayName: profile.email,
        writeAllowed: true,
      }],
      scopes: tokenPayload.scopes.length > 0 ? tokenPayload.scopes : getProviderScopes('google_calendar'),
    });
    const secretRef = this.deps.connectionService.storeOAuthSecret(connection.id, 'google_calendar', tokenPayload, connection.secretRefId);
    const connected = this.deps.connectionService.updateConnection(connection.id, { secretRefId: secretRef.id }) ?? connection;

    const dbPath = `${this.deps.capabilityStoresDir}/calendar.db`;
    const writeDb = new BetterSqlite3(dbPath);
    let accountId: string;
    try {
      const svc = new CalendarService(writeDb as unknown as CapabilityContext['appDb']);
      accountId = svc.getAccountByConnection(connection.id)?.id
        ?? svc.registerAccount({
          connectionId: connection.id,
          calendarEmail: profile.email,
          displayName: profile.email.split('@')[0] ?? profile.email,
          timeZone: profile.timeZone,
        }).id;
    } finally {
      writeDb.close();
    }

    this.deps.connectionService.updateConnectionRollups({
      connectionId: connected.id,
      health: {
        status: 'healthy',
        authState: 'configured',
        checkedAt: nowIso(),
        lastError: null,
        diagnostics: [],
      },
      sync: {
        status: 'idle',
        cursorKind: connectionCursorKindForProvider(connected.providerKind),
        cursorPresent: false,
        lagSummary: 'Awaiting first sync',
      },
    });

    return this.deps.oauthSessionService.completeSession(session.id, {
      connectionId: connected.id,
      accountId,
    })!;
  }

  private async completeGithubSession(
    session: OAuthSessionInternalRecord,
    tokenPayload: OAuthTokenPayload,
  ): Promise<OAuthSessionRecord> {
    const adapter = new GithubApiAdapter({ accessToken: tokenPayload.accessToken });
    const profile = await adapter.getProfile();
    const connection = this.createOrUpdateConnectedConnection({
      session,
      providerKind: 'github',
      domain: 'github',
      label: `GitHub (${profile.username})`,
      allowedResources: [],
      resourceRules: [],
      scopes: tokenPayload.scopes.length > 0 ? tokenPayload.scopes : getProviderScopes('github'),
    });
    const secretRef = this.deps.connectionService.storeOAuthSecret(connection.id, 'github', tokenPayload, connection.secretRefId);
    const connected = this.deps.connectionService.updateConnection(connection.id, { secretRefId: secretRef.id }) ?? connection;

    const dbPath = `${this.deps.capabilityStoresDir}/github.db`;
    const writeDb = new BetterSqlite3(dbPath);
    let accountId: string;
    try {
      const svc = new GithubService(writeDb as unknown as CapabilityContext['appDb']);
      accountId = svc.getAccountByConnection(connection.id)?.id
        ?? svc.registerAccount({
          connectionId: connection.id,
          githubUsername: profile.username,
          displayName: profile.name,
        }).id;
    } finally {
      writeDb.close();
    }

    this.deps.connectionService.updateConnectionRollups({
      connectionId: connected.id,
      health: {
        status: 'healthy',
        authState: 'configured',
        checkedAt: nowIso(),
        lastError: null,
        diagnostics: [],
      },
      sync: {
        status: 'idle',
        cursorKind: connectionCursorKindForProvider(connected.providerKind),
        cursorPresent: false,
        lagSummary: 'Awaiting first sync',
      },
    });

    return this.deps.oauthSessionService.completeSession(session.id, {
      connectionId: connected.id,
      accountId,
    })!;
  }
}
