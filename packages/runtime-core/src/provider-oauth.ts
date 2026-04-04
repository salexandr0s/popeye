import { createHash, randomBytes } from 'node:crypto';

import type {
  AppConfig,
  DomainKind,
  OAuthProviderAvailabilityRecord,
  OAuthProviderAvailabilityStatus,
  OAuthProviderKind,
  ProviderAuthConfigRecord,
  ProviderAuthProvider,
  ProviderAuthSecretAvailability,
} from '@popeye/contracts';

import { RuntimeConfigurationError } from './errors.js';

export interface OAuthTokenPayload {
  accessToken: string;
  refreshToken?: string | undefined;
  tokenType?: string | undefined;
  scopes: string[];
  expiresAt?: string | undefined;
}

export type ProviderSecretResolver = (secretRefId: string) => string | null;

export const OAUTH_PROVIDER_KINDS: OAuthProviderKind[] = ['gmail', 'google_calendar', 'google_tasks', 'github'];
export const PROVIDER_AUTH_PROVIDERS: ProviderAuthProvider[] = ['google', 'github'];

export function mapProviderToDomain(providerKind: OAuthProviderKind): DomainKind {
  switch (providerKind) {
    case 'gmail':
      return 'email';
    case 'google_calendar':
      return 'calendar';
    case 'google_tasks':
      return 'todos';
    case 'github':
      return 'github';
  }
}

export function mapOAuthProviderToProviderAuthProvider(providerKind: OAuthProviderKind): ProviderAuthProvider {
  switch (providerKind) {
    case 'gmail':
    case 'google_calendar':
    case 'google_tasks':
      return 'google';
    case 'github':
      return 'github';
  }
}

export function buildPkceVerifier(): string {
  return base64Url(randomBytes(32));
}

export function buildPkceChallenge(verifier: string): string {
  return base64Url(createHash('sha256').update(verifier).digest());
}

export function buildProviderAuthorizationUrl(input: {
  providerKind: OAuthProviderKind;
  config: AppConfig;
  getSecretValue: ProviderSecretResolver;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  mode: 'read_only' | 'read_write';
}): string {
  assertOAuthProviderReady(input.config, input.providerKind, input.getSecretValue);

  switch (input.providerKind) {
    case 'gmail':
      return buildGoogleAuthorizationUrl(input.config, input.redirectUri, input.state, input.codeChallenge, getProviderScopes('gmail', input.mode));
    case 'google_calendar':
      return buildGoogleAuthorizationUrl(input.config, input.redirectUri, input.state, input.codeChallenge, getProviderScopes('google_calendar', input.mode));
    case 'google_tasks':
      return buildGoogleAuthorizationUrl(input.config, input.redirectUri, input.state, input.codeChallenge, getProviderScopes('google_tasks', input.mode));
    case 'github': {
      const clientId = requireProviderClientId(input.config, 'github');
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: input.redirectUri,
        scope: getProviderScopes('github', input.mode).join(' '),
        state: input.state,
      });
      return `https://github.com/login/oauth/authorize?${params.toString()}`;
    }
  }
}

export async function exchangeProviderAuthorizationCode(input: {
  providerKind: OAuthProviderKind;
  config: AppConfig;
  getSecretValue: ProviderSecretResolver;
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<OAuthTokenPayload> {
  assertOAuthProviderReady(input.config, input.providerKind, input.getSecretValue);

  switch (input.providerKind) {
    case 'gmail':
    case 'google_calendar':
    case 'google_tasks':
      return exchangeGoogleAuthorizationCode(input);
    case 'github':
      return exchangeGithubAuthorizationCode(input);
  }
}

export function getProviderScopes(providerKind: OAuthProviderKind, mode: 'read_only' | 'read_write' = 'read_write'): string[] {
  switch (providerKind) {
    case 'gmail':
      return [
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/gmail.compose',
      ];
    case 'google_calendar':
      return [
        'https://www.googleapis.com/auth/calendar.readonly',
        'https://www.googleapis.com/auth/calendar.events',
      ];
    case 'google_tasks':
      return [
        mode === 'read_only'
          ? 'https://www.googleapis.com/auth/tasks.readonly'
          : 'https://www.googleapis.com/auth/tasks',
      ];
    case 'github':
      return ['read:user', 'notifications', 'repo'];
  }
}

export function listProviderAuthConfigRecords(
  config: AppConfig,
  getSecretValue: ProviderSecretResolver,
): ProviderAuthConfigRecord[] {
  return PROVIDER_AUTH_PROVIDERS.map((provider) => getProviderAuthConfigRecord(config, provider, getSecretValue));
}

export function getProviderAuthConfigRecord(
  config: AppConfig,
  provider: ProviderAuthProvider,
  getSecretValue: ProviderSecretResolver,
): ProviderAuthConfigRecord {
  const clientId = getProviderConfigEntry(config, provider).clientId;
  const clientSecretRefId = getProviderConfigEntry(config, provider).clientSecretRefId;
  const secretAvailability = resolveSecretAvailability(clientSecretRefId, getSecretValue);
  const status = getCredentialStatus(clientId, secretAvailability);

  return {
    provider,
    clientId: clientId ?? null,
    clientSecretRefId: clientSecretRefId ?? null,
    secretAvailability,
    status,
    details: availabilityMessage(provider, status),
  };
}

export function listOAuthProviderAvailability(
  config: AppConfig,
  getSecretValue: ProviderSecretResolver,
): OAuthProviderAvailabilityRecord[] {
  return OAUTH_PROVIDER_KINDS.map((providerKind) => getOAuthProviderAvailability(config, providerKind, getSecretValue));
}

export function getOAuthProviderAvailability(
  config: AppConfig,
  providerKind: OAuthProviderKind,
  getSecretValue: ProviderSecretResolver,
): OAuthProviderAvailabilityRecord {
  const provider = mapOAuthProviderToProviderAuthProvider(providerKind);
  const providerConfig = getProviderAuthConfigRecord(config, provider, getSecretValue);
  return {
    providerKind,
    domain: mapProviderToDomain(providerKind),
    status: providerConfig.status,
    details: providerConfig.details,
  };
}

export function assertOAuthProviderReady(
  config: AppConfig,
  providerKind: OAuthProviderKind,
  getSecretValue: ProviderSecretResolver,
): void {
  const availability = getOAuthProviderAvailability(config, providerKind, getSecretValue);
  if (availability.status !== 'ready') {
    throw new RuntimeConfigurationError(availability.details);
  }
}

export function resolveProviderClientCredentials(
  config: AppConfig,
  provider: ProviderAuthProvider,
  getSecretValue: ProviderSecretResolver,
): { clientId: string; clientSecret: string } {
  const providerConfig = getProviderAuthConfigRecord(config, provider, getSecretValue);
  if (providerConfig.status !== 'ready') {
    throw new RuntimeConfigurationError(providerConfig.details);
  }

  const clientId = requireProviderClientId(config, provider);
  const clientSecretRefId = getProviderConfigEntry(config, provider).clientSecretRefId;
  if (!clientSecretRefId) {
    throw new RuntimeConfigurationError(availabilityMessage(provider, 'missing_client_secret'));
  }
  const clientSecret = getSecretValue(clientSecretRefId);
  if (!clientSecret) {
    throw new RuntimeConfigurationError(availabilityMessage(provider, 'missing_client_secret'));
  }

  return { clientId, clientSecret };
}

function buildGoogleAuthorizationUrl(
  config: AppConfig,
  redirectUri: string,
  state: string,
  codeChallenge: string,
  scopes: string[],
): string {
  const clientId = requireProviderClientId(config, 'google');
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes.join(' '),
    access_type: 'offline',
    include_granted_scopes: 'true',
    prompt: 'consent',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

async function exchangeGoogleAuthorizationCode(input: {
  providerKind: OAuthProviderKind;
  config: AppConfig;
  getSecretValue: ProviderSecretResolver;
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<OAuthTokenPayload> {
  const { clientId, clientSecret } = resolveProviderClientCredentials(input.config, 'google', input.getSecretValue);

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: input.code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: input.redirectUri,
      code_verifier: input.codeVerifier,
    }),
  });
  if (!response.ok) {
    throw new Error(`Google OAuth token exchange failed: ${response.status} ${await response.text()}`);
  }
  const payload = await response.json() as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    token_type?: string;
  };
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    tokenType: payload.token_type,
    scopes: payload.scope ? payload.scope.split(/\s+/).filter(Boolean) : getProviderScopes(input.providerKind),
    expiresAt: payload.expires_in ? new Date(Date.now() + payload.expires_in * 1000).toISOString() : undefined,
  };
}

async function exchangeGithubAuthorizationCode(input: {
  providerKind: OAuthProviderKind;
  config: AppConfig;
  getSecretValue: ProviderSecretResolver;
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<OAuthTokenPayload> {
  const { clientId, clientSecret } = resolveProviderClientCredentials(input.config, 'github', input.getSecretValue);

  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code: input.code,
      redirect_uri: input.redirectUri,
    }),
  });
  if (!response.ok) {
    throw new Error(`GitHub OAuth token exchange failed: ${response.status} ${await response.text()}`);
  }
  const payload = await response.json() as {
    access_token?: string;
    scope?: string;
    token_type?: string;
    error?: string;
    error_description?: string;
  };
  if (!payload.access_token) {
    throw new Error(payload.error_description ?? payload.error ?? 'GitHub OAuth did not return an access token');
  }
  return {
    accessToken: payload.access_token,
    tokenType: payload.token_type,
    scopes: payload.scope ? payload.scope.split(',').map((scope) => scope.trim()).filter(Boolean) : getProviderScopes('github'),
  };
}

function base64Url(input: Buffer): string {
  return input
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function getProviderConfigEntry(config: AppConfig, provider: ProviderAuthProvider): { clientId?: string; clientSecretRefId?: string } {
  const source = provider === 'google' ? config.providerAuth?.google : config.providerAuth?.github;
  const entry: { clientId?: string; clientSecretRefId?: string } = {};
  if (source?.clientId) {
    entry.clientId = source.clientId;
  }
  if (source?.clientSecretRefId) {
    entry.clientSecretRefId = source.clientSecretRefId;
  }
  return entry;
}

function resolveSecretAvailability(
  clientSecretRefId: string | undefined,
  getSecretValue: ProviderSecretResolver,
): ProviderAuthSecretAvailability {
  if (!clientSecretRefId) {
    return 'not_configured';
  }
  return getSecretValue(clientSecretRefId) ? 'available' : 'missing';
}

function getCredentialStatus(
  clientId: string | undefined,
  secretAvailability: ProviderAuthSecretAvailability,
): OAuthProviderAvailabilityStatus {
  const hasClientId = Boolean(clientId);
  const hasSecret = secretAvailability === 'available';
  if (!hasClientId && !hasSecret) {
    return 'missing_client_credentials';
  }
  if (!hasClientId) {
    return 'missing_client_id';
  }
  if (!hasSecret) {
    return 'missing_client_secret';
  }
  return 'ready';
}

function availabilityMessage(provider: ProviderAuthProvider, status: OAuthProviderAvailabilityStatus): string {
  const name = provider === 'google' ? 'Google' : 'GitHub';
  const configPath = `providerAuth.${provider}.clientId`;
  const secretRefPath = `providerAuth.${provider}.clientSecretRefId`;

  switch (status) {
    case 'ready':
      return `${name} OAuth is configured.`;
    case 'missing_client_id':
      return `${name} OAuth is not configured. Add ${configPath} and save the ${name} OAuth client secret in Popeye so ${secretRefPath} points to an available secret.`;
    case 'missing_client_secret':
      return `${name} OAuth is not configured. Save the ${name} OAuth client secret in Popeye so ${secretRefPath} points to an available secret.`;
    case 'missing_client_credentials':
      return `${name} OAuth is not configured. Add ${configPath} and save the ${name} OAuth client secret in Popeye so ${secretRefPath} points to an available secret.`;
  }
}

function requireProviderClientId(config: AppConfig, provider: ProviderAuthProvider): string {
  const clientId = getProviderConfigEntry(config, provider).clientId;
  if (!clientId) {
    throw new RuntimeConfigurationError(availabilityMessage(provider, 'missing_client_id'));
  }
  return clientId;
}
