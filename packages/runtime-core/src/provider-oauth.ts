import { createHash, randomBytes } from 'node:crypto';

import type {
  AppConfig,
  DomainKind,
  OAuthProviderKind,
} from '@popeye/contracts';

export interface OAuthTokenPayload {
  accessToken: string;
  refreshToken?: string | undefined;
  tokenType?: string | undefined;
  scopes: string[];
  expiresAt?: string | undefined;
}

export function mapProviderToDomain(providerKind: OAuthProviderKind): DomainKind {
  switch (providerKind) {
    case 'gmail':
      return 'email';
    case 'google_calendar':
      return 'calendar';
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
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  switch (input.providerKind) {
    case 'gmail':
      return buildGoogleAuthorizationUrl(input.config, input.redirectUri, input.state, input.codeChallenge, getProviderScopes('gmail'));
    case 'google_calendar':
      return buildGoogleAuthorizationUrl(input.config, input.redirectUri, input.state, input.codeChallenge, getProviderScopes('google_calendar'));
    case 'github': {
      const clientId = input.config.providerAuth.github.clientId;
      if (!clientId) {
        throw new Error('GitHub OAuth is not configured');
      }
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: input.redirectUri,
        scope: getProviderScopes('github').join(' '),
        state: input.state,
      });
      return `https://github.com/login/oauth/authorize?${params.toString()}`;
    }
  }
}

export async function exchangeProviderAuthorizationCode(input: {
  providerKind: OAuthProviderKind;
  config: AppConfig;
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<OAuthTokenPayload> {
  switch (input.providerKind) {
    case 'gmail':
    case 'google_calendar':
      return exchangeGoogleAuthorizationCode(input);
    case 'github':
      return exchangeGithubAuthorizationCode(input);
  }
}

export function getProviderScopes(providerKind: OAuthProviderKind): string[] {
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
    case 'github':
      return ['read:user', 'notifications', 'repo'];
  }
}

function buildGoogleAuthorizationUrl(
  config: AppConfig,
  redirectUri: string,
  state: string,
  codeChallenge: string,
  scopes: string[],
): string {
  const clientId = config.providerAuth.google.clientId;
  if (!clientId) {
    throw new Error('Google OAuth is not configured');
  }
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
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<OAuthTokenPayload> {
  const clientId = input.config.providerAuth.google.clientId;
  const clientSecret = input.config.providerAuth.google.clientSecret;
  if (!clientId || !clientSecret) {
    throw new Error('Google OAuth client credentials are missing');
  }

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
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<OAuthTokenPayload> {
  const clientId = input.config.providerAuth.github.clientId;
  const clientSecret = input.config.providerAuth.github.clientSecret;
  if (!clientId || !clientSecret) {
    throw new Error('GitHub OAuth client credentials are missing');
  }

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
