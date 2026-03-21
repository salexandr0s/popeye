import { randomUUID } from 'node:crypto';

import BetterSqlite3 from 'better-sqlite3';
import type {
  AppConfig,
  CalendarAccountRecord,
  ConnectionCreateInput,
  ConnectionDiagnosticsResponse,
  ConnectionHealthSummary,
  ConnectionRecord,
  ConnectionRemediationAction,
  ConnectionResourceRule,
  ConnectionSyncSummary,
  ConnectionUpdateInput,
  DomainKind,
  EmailAccountRecord,
  GithubAccountRecord,
  SecretRefRecord,
  SecurityAuditEvent,
  TodoAccountRecord,
} from '@popeye/contracts';
import type { CapabilityContext } from '@popeye/contracts';
import {
  ConnectionHealthSummarySchema,
  ConnectionSyncSummarySchema,
  nowIso,
} from '@popeye/contracts';
import { type EmailProviderAdapter, createAdapter, EmailService, GmailAdapter } from '@popeye/cap-email';
import { CalendarService, GoogleCalendarAdapter } from '@popeye/cap-calendar';
import { GithubService, GithubApiAdapter } from '@popeye/cap-github';
import type { TodoService } from '@popeye/cap-todos';
import type { PopeyeLogger } from '@popeye/observability';

import type { SecretStore } from './secret-store.js';
import type { ActionPolicyEvaluator } from './action-policy-evaluator.js';
import type { OAuthTokenPayload } from './provider-oauth.js';
import {
  canRefreshStoredOAuthSecret,
  isExpiredIso,
  isProviderAllowedForDomain,
  mapConnectionRow,
  matchesConnectionResourceId,
  parseStoredOAuthSecret,
  providerRequiresSecret,
  serializeStoredOAuthSecret,
  type StoredOAuthSecret,
} from './row-mappers.js';
import { RuntimeNotFoundError, RuntimeValidationError } from './errors.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ConnectionServiceDb {
  prepare: (sql: string) => {
    get: (...params: unknown[]) => unknown;
    all: (...params: unknown[]) => unknown[];
    run: (...params: unknown[]) => { changes: number };
  };
}

interface AuditCallback {
  (event: SecurityAuditEvent): void;
}

export interface ConnectionServiceDeps {
  db: ConnectionServiceDb;
  secretStore: SecretStore;
  config: AppConfig;
  actionPolicyEvaluator: ActionPolicyEvaluator;
  capabilityStoresDir: string;
  log: PopeyeLogger;
  auditCallback: AuditCallback;
}

// ---------------------------------------------------------------------------
// ConnectionService
// ---------------------------------------------------------------------------

export class ConnectionService {
  private readonly db: ConnectionServiceDb;
  private readonly secretStore: SecretStore;
  private readonly config: AppConfig;
  private readonly capabilityStoresDir: string;
  private readonly log: PopeyeLogger;
  private readonly auditCallback: AuditCallback;

  constructor(deps: ConnectionServiceDeps) {
    this.db = deps.db;
    this.secretStore = deps.secretStore;
    this.config = deps.config;
    this.capabilityStoresDir = deps.capabilityStoresDir;
    this.log = deps.log;
    this.auditCallback = deps.auditCallback;
  }

  // -----------------------------------------------------------------------
  // Public CRUD
  // -----------------------------------------------------------------------

  listConnections(domain?: string): ConnectionRecord[] {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (domain) { conditions.push('domain = ?'); params.push(domain); }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = this.db.prepare(`SELECT * FROM connections ${where} ORDER BY created_at DESC`).all(...params) as Record<string, unknown>[];
    return rows.map((row) => this.withConnectionPolicy(mapConnectionRow(row)));
  }

  createConnection(input: ConnectionCreateInput): ConnectionRecord {
    this.validateConnectionMutation({
      domain: input.domain,
      providerKind: input.providerKind,
      secretRefId: input.secretRefId ?? null,
    });
    const id = randomUUID();
    const now = nowIso();
    const resourceRules = this.materializeConnectionResourceRules((input.resourceRules ?? []).map((r) => ({ ...r, writeAllowed: r.writeAllowed ?? false })), now);
    this.db
      .prepare(
        `INSERT INTO connections (
           id, domain, provider_kind, label, mode, secret_ref_id, enabled, sync_interval_seconds,
           allowed_scopes, allowed_resources, resource_rules_json, created_at, updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.domain,
        input.providerKind,
        input.label,
        input.mode,
        input.secretRefId ?? null,
        input.syncIntervalSeconds,
        JSON.stringify(input.allowedScopes),
        JSON.stringify(input.allowedResources),
        JSON.stringify(resourceRules),
        now,
        now,
      );
    return this.getConnection(id)!;
  }

  updateConnection(id: string, input: ConnectionUpdateInput): ConnectionRecord | null {
    const existing = this.getConnectionRow(id);
    if (!existing) return null;
    this.validateConnectionMutation({
      domain: existing.domain,
      providerKind: existing.providerKind,
      secretRefId: input.secretRefId !== undefined ? input.secretRefId : existing.secretRefId,
    });
    const sets: string[] = [];
    const params: unknown[] = [];
    if (input.label !== undefined) { sets.push('label = ?'); params.push(input.label); }
    if (input.mode !== undefined) { sets.push('mode = ?'); params.push(input.mode); }
    if (input.secretRefId !== undefined) { sets.push('secret_ref_id = ?'); params.push(input.secretRefId); }
    if (input.enabled !== undefined) { sets.push('enabled = ?'); params.push(input.enabled ? 1 : 0); }
    if (input.syncIntervalSeconds !== undefined) { sets.push('sync_interval_seconds = ?'); params.push(input.syncIntervalSeconds); }
    if (input.allowedScopes !== undefined) { sets.push('allowed_scopes = ?'); params.push(JSON.stringify(input.allowedScopes)); }
    if (input.allowedResources !== undefined) { sets.push('allowed_resources = ?'); params.push(JSON.stringify(input.allowedResources)); }
    if (input.resourceRules !== undefined) {
      sets.push('resource_rules_json = ?');
      params.push(JSON.stringify(this.materializeConnectionResourceRules(input.resourceRules.map((r) => ({ ...r, writeAllowed: r.writeAllowed ?? false })))));
    }
    if (sets.length === 0) return this.withConnectionPolicy(existing);
    sets.push('updated_at = ?');
    params.push(nowIso());
    params.push(id);
    this.db.prepare(`UPDATE connections SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    return this.getConnection(id);
  }

  deleteConnection(id: string): boolean {
    const result = this.db.prepare('DELETE FROM connections WHERE id = ?').run(id);
    return result.changes > 0;
  }

  // -----------------------------------------------------------------------
  // Connection resource-rule CRUD
  // -----------------------------------------------------------------------

  addConnectionResourceRule(connectionId: string, rule: { resourceType: string; resourceId: string; displayName: string; writeAllowed?: boolean }): ConnectionRecord | null {
    const existing = this.getConnectionRow(connectionId);
    if (!existing) return null;
    const now = nowIso();
    const rules = [...existing.resourceRules];
    const idx = rules.findIndex((r) => r.resourceType === rule.resourceType && r.resourceId === rule.resourceId);
    const newRule: ConnectionResourceRule = {
      resourceType: rule.resourceType as ConnectionResourceRule['resourceType'],
      resourceId: rule.resourceId,
      displayName: rule.displayName,
      writeAllowed: rule.writeAllowed ?? false,
      createdAt: idx >= 0 ? rules[idx]!.createdAt : now,
      updatedAt: now,
    };
    if (idx >= 0) { rules[idx] = newRule; } else { rules.push(newRule); }
    this.db.prepare('UPDATE connections SET resource_rules_json = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(rules), now, connectionId);
    return this.getConnection(connectionId);
  }

  removeConnectionResourceRule(connectionId: string, resourceType: string, resourceId: string): ConnectionRecord | null {
    const existing = this.getConnectionRow(connectionId);
    if (!existing) return null;
    const rules = existing.resourceRules.filter(
      (r) => !(r.resourceType === resourceType && r.resourceId === resourceId),
    );
    const now = nowIso();
    this.db.prepare('UPDATE connections SET resource_rules_json = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(rules), now, connectionId);
    return this.getConnection(connectionId);
  }

  listConnectionResourceRules(connectionId: string): ConnectionResourceRule[] {
    const connection = this.getConnectionRow(connectionId);
    return connection?.resourceRules ?? [];
  }

  // -----------------------------------------------------------------------
  // Connection diagnostics & reconnect
  // -----------------------------------------------------------------------

  getConnectionDiagnostics(connectionId: string): ConnectionDiagnosticsResponse | null {
    const connection = this.getConnection(connectionId);
    if (!connection) return null;

    const health = connection.health ?? { status: 'unknown', authState: 'not_required', checkedAt: null, lastError: null, diagnostics: [], remediation: null };
    const sync = connection.sync ?? { lastAttemptAt: null, lastSuccessAt: null, status: 'idle', cursorKind: 'none', cursorPresent: false, lagSummary: '' };
    const policy = connection.policy ?? { status: 'ready', secretStatus: 'not_required', mutatingRequiresApproval: false, diagnostics: [] };
    const remediation = health.remediation ?? null;

    const summaryParts: string[] = [];
    summaryParts.push(`${connection.label} (${connection.providerKind})`);
    summaryParts.push(`Health: ${health.status}`);
    if (sync.lastSuccessAt) summaryParts.push(`Last sync: ${sync.lastSuccessAt}`);
    else summaryParts.push('Never synced');
    if (health.lastError) summaryParts.push(`Error: ${health.lastError}`);
    if (remediation) summaryParts.push(`Remediation: ${remediation.action} — ${remediation.message}`);

    return {
      connectionId,
      label: connection.label,
      providerKind: connection.providerKind,
      domain: connection.domain,
      enabled: connection.enabled,
      health,
      sync,
      policy,
      remediation,
      humanSummary: summaryParts.join('. '),
    };
  }

  reconnectConnection(connectionId: string, action: ConnectionRemediationAction): ConnectionRecord | null {
    const connection = this.getConnectionRow(connectionId);
    if (!connection) return null;

    const now = nowIso();
    switch (action) {
      case 'reauthorize':
      case 'secret_fix':
        if (connection.secretRefId) {
          this.secretStore.deleteSecret(connection.secretRefId);
        }
        this.updateConnectionRollups({
          connectionId,
          health: {
            status: 'degraded',
            authState: 'missing',
            checkedAt: now,
            lastError: null,
            diagnostics: [{ code: `${action}_pending`, severity: 'warn', message: `${action} initiated — re-authenticate to restore` }],
            remediation: { action, message: `${action} initiated`, updatedAt: now },
          },
        });
        break;
      case 'reconnect':
        this.updateConnectionRollups({
          connectionId,
          health: {
            status: 'degraded',
            authState: 'missing',
            checkedAt: now,
            lastError: null,
            diagnostics: [{ code: 'reconnect_pending', severity: 'warn', message: 'Reconnect initiated — start new OAuth flow' }],
            remediation: { action: 'reconnect', message: 'Reconnect initiated', updatedAt: now },
          },
        });
        break;
      case 'scope_fix':
        this.updateConnectionRollups({
          connectionId,
          health: {
            status: 'degraded',
            authState: 'invalid_scopes',
            checkedAt: now,
            lastError: 'Scope mismatch flagged',
            diagnostics: [{ code: 'scope_fix_pending', severity: 'warn', message: 'Scope fix initiated — re-authorize with correct scopes' }],
            remediation: { action: 'scope_fix', message: 'Scope fix initiated', updatedAt: now },
          },
        });
        break;
    }
    return this.getConnection(connectionId);
  }

  // -----------------------------------------------------------------------
  // OAuth helpers (called from runtime-service OAuth completion flows)
  // -----------------------------------------------------------------------

  getOAuthRedirectUri(): string {
    return `http://${this.config.security.bindHost}:${this.config.security.bindPort}/v1/connections/oauth/callback`;
  }

  getConnectionOAuthSecret(connection: ConnectionRecord): StoredOAuthSecret | null {
    if (!connection.secretRefId) return null;
    return parseStoredOAuthSecret(this.secretStore.getSecretValue(connection.secretRefId));
  }

  storeOAuthSecret(connectionId: string | null, providerKind: ConnectionRecord['providerKind'], payload: OAuthTokenPayload, existingSecretRefId?: string | null): SecretRefRecord {
    const serialized = serializeStoredOAuthSecret(payload);
    if (existingSecretRefId) {
      const rotated = this.secretStore.rotateSecret(existingSecretRefId, serialized);
      if (rotated) {
        return rotated;
      }
    }
    return this.secretStore.setSecret({
      provider: 'keychain',
      key: `${providerKind}-oauth`,
      value: serialized,
      ...(connectionId ? { connectionId } : {}),
      description: `${providerKind} OAuth credentials`,
      ...(payload.expiresAt ? { expiresAt: payload.expiresAt } : {}),
    });
  }

  createOrUpdateConnectedConnection(input: {
    session: { connectionId: string | null; connectionMode: ConnectionRecord['mode']; syncIntervalSeconds: number };
    providerKind: ConnectionRecord['providerKind'];
    domain: DomainKind;
    label: string;
    allowedResources: string[];
    resourceRules: Array<Pick<ConnectionResourceRule, 'resourceType' | 'resourceId' | 'displayName' | 'writeAllowed'>>;
    scopes: string[];
  }): ConnectionRecord {
    if (input.session.connectionId) {
      const updated = this.updateConnection(input.session.connectionId, {
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

    return this.createConnection({
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

  // -----------------------------------------------------------------------
  // Rollup updates (health / sync state)
  // -----------------------------------------------------------------------

  updateConnectionRollups(input: {
    connectionId: string;
    health?: Partial<ConnectionHealthSummary> | undefined;
    sync?: Partial<ConnectionSyncSummary> | undefined;
  }): ConnectionRecord | null {
    const existing = this.getConnectionRow(input.connectionId);
    if (!existing) return null;

    const nextHealth = ConnectionHealthSummarySchema.parse({
      ...(existing.health ?? {}),
      ...(input.health ?? {}),
    });
    const nextSync = ConnectionSyncSummarySchema.parse({
      ...(existing.sync ?? {}),
      ...(input.sync ?? {}),
    });

    const lastSyncAt = nextSync.lastSuccessAt ?? existing.lastSyncAt;
    const lastSyncStatus = nextSync.status === 'idle' ? existing.lastSyncStatus : nextSync.status;

    this.db.prepare(
      `UPDATE connections
       SET health_json = ?, sync_json = ?, last_sync_at = ?, last_sync_status = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      JSON.stringify(nextHealth),
      JSON.stringify(nextSync),
      lastSyncAt,
      (lastSyncStatus as string) === 'idle' ? null : lastSyncStatus,
      nowIso(),
      input.connectionId,
    );
    return this.getConnection(input.connectionId);
  }

  // -----------------------------------------------------------------------
  // Adapter resolution (for capability facades)
  // -----------------------------------------------------------------------

  async resolveEmailAdapterForConnection(connectionId: string): Promise<{
    adapter: EmailProviderAdapter;
    account: { id: string; connectionId: string; emailAddress: string };
  } | null> {
    let connection: ConnectionRecord;
    try {
      connection = this.requireConnectionForOperation({
        connectionId,
        purpose: 'email_adapter_resolve',
        expectedDomain: 'email',
        allowedProviderKinds: ['gmail', 'proton'],
        requireSecret: false,
      });
    } catch {
      return null;
    }

    const dbPath = `${this.capabilityStoresDir}/email.db`;
    const readDb = new BetterSqlite3(dbPath, { readonly: true });
    try {
      const svc = new EmailService(readDb as unknown as CapabilityContext['appDb']);
      const account = svc.getAccountByConnection(connectionId);
      if (!account) return null;

      let adapter: EmailProviderAdapter;
      if (connection.providerKind === 'gmail') {
        const secret = this.getConnectionOAuthSecret(connection);
        if (!secret) return null;
        adapter = new GmailAdapter({
          accessToken: secret.accessToken,
          refreshToken: secret.refreshToken,
          clientId: this.config.providerAuth.google.clientId,
          clientSecret: this.config.providerAuth.google.clientSecret,
        });
      } else {
        if (this.requireConnectionForOperation({
          connectionId,
          purpose: 'email_adapter_resolve',
          expectedDomain: 'email',
          allowedProviderKinds: ['proton'],
          requireSecret: true,
        }).policy?.secretStatus !== 'configured') {
          return null;
        }
        const password = this.secretStore.getSecretValue(connection.secretRefId!);
        if (!password) return null;
        adapter = createAdapter('proton', { username: account.emailAddress, password });
      }

      return { adapter, account: { id: account.id, connectionId, emailAddress: account.emailAddress } };
    } finally {
      readDb.close();
    }
  }

  async resolveCalendarAdapterForConnection(connectionId: string): Promise<{
    adapter: GoogleCalendarAdapter;
    account: { id: string; connectionId: string; calendarEmail: string };
  } | null> {
    try {
      this.requireConnectionForOperation({
        connectionId,
        purpose: 'calendar_adapter_resolve',
        expectedDomain: 'calendar',
        allowedProviderKinds: ['google_calendar'],
        requireSecret: true,
      });
    } catch {
      return null;
    }

    const dbPath = `${this.capabilityStoresDir}/calendar.db`;
    const readDb = new BetterSqlite3(dbPath, { readonly: true });
    try {
      const svc = new CalendarService(readDb as unknown as CapabilityContext['appDb']);
      const account = svc.getAccountByConnection(connectionId);
      if (!account) return null;
      const connection = this.getConnection(connectionId);
      if (!connection) return null;
      const secret = this.getConnectionOAuthSecret(connection);
      if (!secret) return null;
      const adapter = new GoogleCalendarAdapter({
        accessToken: secret.accessToken,
        refreshToken: secret.refreshToken,
        clientId: this.config.providerAuth.google.clientId,
        clientSecret: this.config.providerAuth.google.clientSecret,
      });
      return { adapter, account: { id: account.id, connectionId, calendarEmail: account.calendarEmail } };
    } finally {
      readDb.close();
    }
  }

  async resolveGithubAdapterForConnection(connectionId: string): Promise<{
    adapter: GithubApiAdapter;
    account: { id: string; connectionId: string; githubUsername: string };
  } | null> {
    try {
      this.requireConnectionForOperation({
        connectionId,
        purpose: 'github_adapter_resolve',
        expectedDomain: 'github',
        allowedProviderKinds: ['github'],
        requireSecret: true,
      });
    } catch {
      return null;
    }

    const dbPath = `${this.capabilityStoresDir}/github.db`;
    const readDb = new BetterSqlite3(dbPath, { readonly: true });
    try {
      const svc = new GithubService(readDb as unknown as CapabilityContext['appDb']);
      const account = svc.getAccountByConnection(connectionId);
      if (!account) return null;
      const connection = this.getConnection(connectionId);
      if (!connection) return null;
      const secret = this.getConnectionOAuthSecret(connection);
      if (!secret) return null;
      const adapter = new GithubApiAdapter({ accessToken: secret.accessToken });
      return { adapter, account: { id: account.id, connectionId, githubUsername: account.githubUsername } };
    } finally {
      readDb.close();
    }
  }

  // -----------------------------------------------------------------------
  // Policy enforcement
  // -----------------------------------------------------------------------

  requireConnectionForOperation(input: {
    connectionId: string;
    purpose: string;
    expectedDomain: DomainKind;
    allowedProviderKinds?: Array<ConnectionRecord['providerKind']>;
    requireSecret?: boolean | undefined;
    runId?: string | undefined;
    jobId?: string | undefined;
    taskId?: string | undefined;
  }): ConnectionRecord {
    const connection = this.getConnection(input.connectionId);
    if (!connection) {
      return this.denyConnectionOperation({
        connectionId: input.connectionId,
        purpose: input.purpose,
        reasonCode: 'connection_not_found',
        message: `Connection ${input.connectionId} not found`,
        domain: input.expectedDomain,
        ...(input.runId !== undefined ? { runId: input.runId } : {}),
        ...(input.jobId !== undefined ? { jobId: input.jobId } : {}),
        ...(input.taskId !== undefined ? { taskId: input.taskId } : {}),
      });
    }
    if (connection.domain !== input.expectedDomain) {
      return this.denyConnectionOperation({
        connectionId: connection.id,
        purpose: input.purpose,
        reasonCode: 'wrong_domain',
        message: `Connection ${connection.id} is not a ${input.expectedDomain} connection`,
        domain: connection.domain,
        providerKind: connection.providerKind,
        ...(input.runId !== undefined ? { runId: input.runId } : {}),
        ...(input.jobId !== undefined ? { jobId: input.jobId } : {}),
        ...(input.taskId !== undefined ? { taskId: input.taskId } : {}),
      });
    }
    if (input.allowedProviderKinds && !input.allowedProviderKinds.includes(connection.providerKind)) {
      return this.denyConnectionOperation({
        connectionId: connection.id,
        purpose: input.purpose,
        reasonCode: 'wrong_provider',
        message: `Provider ${connection.providerKind} is not allowed for ${input.purpose}`,
        domain: connection.domain,
        providerKind: connection.providerKind,
        ...(input.runId !== undefined ? { runId: input.runId } : {}),
        ...(input.jobId !== undefined ? { jobId: input.jobId } : {}),
        ...(input.taskId !== undefined ? { taskId: input.taskId } : {}),
      });
    }
    if (connection.policy?.status === 'disabled') {
      return this.denyConnectionOperation({
        connectionId: connection.id,
        purpose: input.purpose,
        reasonCode: 'connection_disabled',
        message: `Connection ${connection.id} is disabled`,
        domain: connection.domain,
        providerKind: connection.providerKind,
        ...(input.runId !== undefined ? { runId: input.runId } : {}),
        ...(input.jobId !== undefined ? { jobId: input.jobId } : {}),
        ...(input.taskId !== undefined ? { taskId: input.taskId } : {}),
      });
    }
    const requiresSecret = input.requireSecret ?? providerRequiresSecret(connection.providerKind);
    if (requiresSecret && connection.policy?.secretStatus !== 'configured') {
      return this.denyConnectionOperation({
        connectionId: connection.id,
        purpose: input.purpose,
        reasonCode: connection.policy?.secretStatus === 'stale' ? 'secret_unavailable' : 'secret_required',
        message: `Connection ${connection.id} does not have a usable secret reference`,
        domain: connection.domain,
        providerKind: connection.providerKind,
        ...(input.runId !== undefined ? { runId: input.runId } : {}),
        ...(input.jobId !== undefined ? { jobId: input.jobId } : {}),
        ...(input.taskId !== undefined ? { taskId: input.taskId } : {}),
      });
    }
    if (['expired', 'revoked', 'invalid_scopes'].includes(connection.health?.authState ?? '')) {
      return this.denyConnectionOperation({
        connectionId: connection.id,
        purpose: input.purpose,
        reasonCode: 'reauth_required',
        message: `Connection ${connection.id} requires credential reauthorization`,
        domain: connection.domain,
        providerKind: connection.providerKind,
        ...(input.runId !== undefined ? { runId: input.runId } : {}),
        ...(input.jobId !== undefined ? { jobId: input.jobId } : {}),
        ...(input.taskId !== undefined ? { taskId: input.taskId } : {}),
      });
    }
    return connection;
  }

  requireEmailAccountForOperation(
    service: EmailService,
    accountId: string,
    purpose: string,
  ): { account: EmailAccountRecord; connection: ConnectionRecord } {
    const account = service.getAccount(accountId);
    if (!account) {
      throw new RuntimeValidationError(`Email account ${accountId} not found`);
    }
    const connection = this.requireConnectionForOperation({
      connectionId: account.connectionId,
      purpose,
      expectedDomain: 'email',
      allowedProviderKinds: ['gmail', 'proton'],
      requireSecret: false,
    });
    return { account, connection };
  }

  requireGithubAccountForOperation(
    service: GithubService,
    accountId: string,
    purpose: string,
  ): { account: GithubAccountRecord; connection: ConnectionRecord } {
    const account = service.getAccount(accountId);
    if (!account) {
      throw new RuntimeValidationError(`GitHub account ${accountId} not found`);
    }
    const connection = this.requireConnectionForOperation({
      connectionId: account.connectionId,
      purpose,
      expectedDomain: 'github',
      allowedProviderKinds: ['github'],
      requireSecret: false,
    });
    return { account, connection };
  }

  requireCalendarAccountForOperation(
    service: CalendarService,
    accountId: string,
    purpose: string,
  ): { account: CalendarAccountRecord; connection: ConnectionRecord } {
    const account = service.getAccount(accountId);
    if (!account) {
      throw new RuntimeValidationError(`Calendar account ${accountId} not found`);
    }
    const connection = this.requireConnectionForOperation({
      connectionId: account.connectionId,
      purpose,
      expectedDomain: 'calendar',
      allowedProviderKinds: ['google_calendar'],
      requireSecret: false,
    });
    return { account, connection };
  }

  requireTodoAccountForOperation(
    service: TodoService,
    accountId: string,
    purpose: string,
    options: { requireSecret?: boolean | undefined } = {},
  ): { account: TodoAccountRecord; connection: ConnectionRecord | null } {
    const account = service.getAccount(accountId);
    if (!account) {
      throw new RuntimeValidationError(`Todo account ${accountId} not found`);
    }
    if (!account.connectionId) {
      return { account, connection: null };
    }
    const allowedProviderKinds: Array<ConnectionRecord['providerKind']> =
      account.providerKind === 'todoist' ? ['todoist'] : ['local'];
    const connection = this.requireConnectionForOperation({
      connectionId: account.connectionId,
      purpose,
      expectedDomain: 'todos',
      allowedProviderKinds,
      requireSecret: options.requireSecret ?? account.providerKind === 'todoist',
    });
    return { account, connection };
  }

  classifyConnectionFailure(message: string): Pick<ConnectionHealthSummary, 'status' | 'authState'> {
    const lowered = message.toLowerCase();
    if (
      lowered.includes('invalid scope')
      || lowered.includes('insufficient')
      || lowered.includes('scope')
    ) {
      return { status: 'reauth_required', authState: 'invalid_scopes' };
    }
    if (lowered.includes('revoked')) {
      return { status: 'reauth_required', authState: 'revoked' };
    }
    if (
      lowered.includes('401')
      || lowered.includes('unauthorized')
      || lowered.includes('invalid_grant')
      || lowered.includes('expired')
      || lowered.includes('token refresh failed')
    ) {
      return { status: 'reauth_required', authState: 'expired' };
    }
    return { status: 'error', authState: 'configured' };
  }

  requireReadWriteConnection(connection: ConnectionRecord, purpose: string): void {
    if (connection.mode !== 'read_write') {
      this.denyConnectionOperation({
        connectionId: connection.id,
        purpose,
        reasonCode: 'connection_read_only',
        message: `Connection ${connection.id} is read-only and cannot perform ${purpose}`,
        domain: connection.domain,
        providerKind: connection.providerKind,
      });
    }
  }

  connectionAllowsResourceWrite(connection: ConnectionRecord, resourceType: string, resourceId: string): boolean {
    const typedRule = connection.resourceRules.find((rule) =>
      rule.writeAllowed
      && (rule.resourceType === resourceType || rule.resourceType === 'resource')
      && matchesConnectionResourceId(rule.resourceId, resourceId),
    );
    if (typedRule) {
      return true;
    }
    return connection.allowedResources.some((allowed) => matchesConnectionResourceId(allowed, resourceId));
  }

  requireAllowlistedConnectionResource(connection: ConnectionRecord, purpose: string, resourceType: string, resourceId: string): void {
    if (!this.connectionAllowsResourceWrite(connection, resourceType, resourceId)) {
      this.denyConnectionOperation({
        connectionId: connection.id,
        purpose,
        reasonCode: 'resource_not_allowlisted',
        message: `Connection ${connection.id} is not allowlisted for ${resourceType} ${resourceId}`,
        domain: connection.domain,
        providerKind: connection.providerKind,
      });
    }
  }

  // -----------------------------------------------------------------------
  // Internal: connection lookup + policy
  // -----------------------------------------------------------------------

  getConnection(id: string): ConnectionRecord | null {
    const connection = this.getConnectionRow(id);
    return connection ? this.withConnectionPolicy(connection) : null;
  }

  private getConnectionRow(id: string): ConnectionRecord | null {
    const row = this.db.prepare('SELECT * FROM connections WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? mapConnectionRow(row) : null;
  }

  private withConnectionPolicy(connection: ConnectionRecord): ConnectionRecord {
    const summary = this.buildConnectionPolicySummary(connection);
    return {
      ...connection,
      policy: summary.policy,
      health: summary.health,
      sync: summary.sync,
    };
  }

  private buildConnectionPolicySummary(connection: ConnectionRecord): {
    policy: NonNullable<ConnectionRecord['policy']>;
    health: ConnectionHealthSummary;
    sync: ConnectionSyncSummary;
  } {
    const diagnostics: NonNullable<ConnectionRecord['policy']>['diagnostics'] = [];
    const storedHealth = ConnectionHealthSummarySchema.parse(connection.health ?? {});
    const storedSync = ConnectionSyncSummarySchema.parse(connection.sync ?? {});

    if (!isProviderAllowedForDomain(connection.domain, connection.providerKind)) {
      diagnostics.push({
        code: 'provider_domain_mismatch',
        severity: 'error',
        message: `Provider ${connection.providerKind} is not allowed for ${connection.domain} connections.`,
      });
    }

    let secretStatus: NonNullable<ConnectionRecord['policy']>['secretStatus'] = 'not_required';
    if (providerRequiresSecret(connection.providerKind)) {
      if (!connection.secretRefId) {
        secretStatus = 'missing';
        diagnostics.push({
          code: 'secret_required',
          severity: 'error',
          message: `Provider ${connection.providerKind} requires a configured secret reference.`,
        });
      } else if (!this.secretStore.hasSecret(connection.secretRefId)) {
        secretStatus = 'stale';
        diagnostics.push({
          code: 'secret_unavailable',
          severity: 'error',
          message: `Referenced secret ${connection.secretRefId} is missing or unavailable.`,
        });
      } else {
        secretStatus = 'configured';
      }
    } else if (connection.secretRefId) {
      secretStatus = this.secretStore.hasSecret(connection.secretRefId) ? 'configured' : 'stale';
      if (secretStatus === 'stale') {
        diagnostics.push({
          code: 'secret_unavailable',
          severity: 'error',
          message: `Referenced secret ${connection.secretRefId} is missing or unavailable.`,
        });
      }
    }

    if (!connection.enabled) {
      diagnostics.push({
        code: 'connection_disabled',
        severity: 'warn',
        message: 'Connection is disabled and cannot be used until re-enabled.',
      });
    }

    let authState: ConnectionHealthSummary['authState'] = providerRequiresSecret(connection.providerKind) ? 'configured' : 'not_required';
    if (providerRequiresSecret(connection.providerKind)) {
      if (!connection.secretRefId) {
        authState = 'missing';
      } else if (!this.secretStore.hasSecret(connection.secretRefId)) {
        authState = 'stale';
      } else {
        const secret = parseStoredOAuthSecret(this.secretStore.getSecretValue(connection.secretRefId));
        if (secret?.expiresAt && isExpiredIso(secret.expiresAt) && !canRefreshStoredOAuthSecret(connection.providerKind, secret, this.config)) {
          authState = 'expired';
        } else if (storedHealth.authState === 'revoked') {
          authState = 'revoked';
        } else if (storedHealth.authState === 'invalid_scopes') {
          authState = 'invalid_scopes';
        }
      }
    }

    const mergedHealthDiagnostics = [...storedHealth.diagnostics, ...diagnostics];
    const healthStatus: ConnectionHealthSummary['status'] =
      ['expired', 'revoked', 'invalid_scopes'].includes(authState)
        ? 'reauth_required'
        : authState === 'missing' || authState === 'stale'
          ? 'error'
          : storedHealth.lastError
            ? 'degraded'
            : 'healthy';
    const remediation = this.buildConnectionRemediation(connection, {
      authState,
      healthStatus,
      secretStatus,
      diagnostics: mergedHealthDiagnostics,
    });

    return {
      policy: {
      status: !connection.enabled
        ? 'disabled'
        : diagnostics.some((diagnostic) => diagnostic.severity === 'error')
          ? 'incomplete'
          : 'ready',
      secretStatus,
      mutatingRequiresApproval: connection.mode === 'read_write',
      diagnostics,
      },
      health: {
        status: healthStatus,
        authState,
        checkedAt: storedHealth.checkedAt,
        lastError: storedHealth.lastError,
        diagnostics: mergedHealthDiagnostics,
        remediation,
      },
      sync: storedSync,
    };
  }

  private buildConnectionRemediation(connection: ConnectionRecord, input: {
    authState: ConnectionHealthSummary['authState'];
    healthStatus: ConnectionHealthSummary['status'];
    secretStatus: NonNullable<ConnectionRecord['policy']>['secretStatus'];
    diagnostics: NonNullable<ConnectionRecord['policy']>['diagnostics'];
  }): ConnectionHealthSummary['remediation'] {
    const now = nowIso();
    if (input.authState === 'invalid_scopes') {
      return {
        action: 'scope_fix',
        message: 'Reconnect this provider and approve the required scopes.',
        updatedAt: now,
      };
    }
    if (['expired', 'revoked', 'stale'].includes(input.authState)) {
      return {
        action: 'reauthorize',
        message: 'Reauthorize this provider to refresh credentials.',
        updatedAt: now,
      };
    }
    if (input.secretStatus === 'missing' || input.secretStatus === 'stale') {
      const oauthProvider = ['gmail', 'google_calendar', 'github'].includes(connection.providerKind);
      return {
        action: oauthProvider ? 'reconnect' : 'secret_fix',
        message: oauthProvider
          ? 'Reconnect this provider to restore a usable secret.'
          : 'Update the configured secret for this connection.',
        updatedAt: now,
      };
    }
    if (input.healthStatus === 'error' || input.healthStatus === 'degraded') {
      return {
        action: ['gmail', 'google_calendar', 'github'].includes(connection.providerKind) ? 'reconnect' : 'secret_fix',
        message: input.diagnostics[0]?.message ?? 'Connection needs operator remediation before it can recover.',
        updatedAt: now,
      };
    }
    return null;
  }

  // -----------------------------------------------------------------------
  // Internal: mutation validation
  // -----------------------------------------------------------------------

  private validateConnectionMutation(input: {
    domain: DomainKind;
    providerKind: ConnectionRecord['providerKind'];
    secretRefId: string | null;
  }): void {
    if (!isProviderAllowedForDomain(input.domain, input.providerKind)) {
      throw new RuntimeValidationError(`Provider ${input.providerKind} is not allowed for ${input.domain} connections`);
    }
    if (input.secretRefId && !this.secretStore.hasSecret(input.secretRefId)) {
      throw new RuntimeValidationError(`Secret reference ${input.secretRefId} is missing or unavailable`);
    }
  }

  private denyConnectionOperation(input: {
    reasonCode: string;
    message: string;
    connectionId: string;
    purpose: string;
    domain?: string | undefined;
    providerKind?: string | undefined;
    runId?: string | undefined;
    jobId?: string | undefined;
    taskId?: string | undefined;
  }): never {
    const details = {
      connectionId: input.connectionId,
      purpose: input.purpose,
      reasonCode: input.reasonCode,
      ...(input.domain !== undefined ? { domain: input.domain } : {}),
      ...(input.providerKind !== undefined ? { providerKind: input.providerKind } : {}),
      ...(input.runId !== undefined ? { runId: input.runId } : {}),
      ...(input.jobId !== undefined ? { jobId: input.jobId } : {}),
      ...(input.taskId !== undefined ? { taskId: input.taskId } : {}),
    };
    this.log.warn('connection policy denied', details);
    this.auditCallback({
      code: 'connection_policy_denied',
      severity: 'warn',
      message: input.message,
      component: 'runtime-core',
      timestamp: nowIso(),
      details: Object.fromEntries(Object.entries(details).map(([key, value]) => [key, String(value)])),
    });
    throw new RuntimeValidationError(input.message);
  }

  private materializeConnectionResourceRules(
    rules: Array<Pick<ConnectionResourceRule, 'resourceType' | 'resourceId' | 'displayName' | 'writeAllowed'>>,
    timestamp = nowIso(),
  ): ConnectionRecord['resourceRules'] {
    return rules.map((rule) => ({
      resourceType: rule.resourceType,
      resourceId: rule.resourceId,
      displayName: rule.displayName,
      writeAllowed: rule.writeAllowed ?? false,
      createdAt: timestamp,
      updatedAt: timestamp,
    }));
  }
}
