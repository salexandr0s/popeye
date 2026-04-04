import { describe, expect, it } from 'vitest';

import { readApiErrorMessage } from './provider';

describe('readApiErrorMessage', () => {
  it('prefers details from JSON error bodies', async () => {
    const response = new Response(
      JSON.stringify({
        error: 'oauth_provider_not_configured',
        details: 'Google OAuth is not configured. Add providerAuth.google.clientId and save the Google OAuth client secret in Popeye so providerAuth.google.clientSecretRefId points to an available secret.',
      }),
      {
        status: 409,
        statusText: 'Conflict',
        headers: { 'Content-Type': 'application/json' },
      },
    );

    await expect(readApiErrorMessage(response)).resolves.toBe(
      'Google OAuth is not configured. Add providerAuth.google.clientId and save the Google OAuth client secret in Popeye so providerAuth.google.clientSecretRefId points to an available secret.',
    );
  });

  it('falls back to status text for non-JSON bodies', async () => {
    const response = new Response('internal error', {
      status: 500,
      statusText: 'Internal Server Error',
      headers: { 'Content-Type': 'text/plain' },
    });

    await expect(readApiErrorMessage(response)).resolves.toBe('500 Internal Server Error');
  });
});
