import { PopeyeApiClient } from '@popeye/api-client';
import type { AppConfig } from '@popeye/contracts';
import { readAuthStore } from '@popeye/runtime-core';

export async function tryConnectDaemon(
  config: AppConfig,
): Promise<PopeyeApiClient | null> {
  let authToken: string;
  try {
    authToken = readAuthStore(config.authFile, 'operator').current.token;
  } catch {
    return null;
  }

  const baseUrl = `http://${config.security.bindHost}:${config.security.bindPort}`;
  const client = new PopeyeApiClient({
    baseUrl,
    token: authToken,
  });

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const response = await fetch(`${baseUrl}/v1/health`, {
      headers: { authorization: `Bearer ${authToken}` },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (response.ok) {
      return client;
    }
    return null;
  } catch {
    return null;
  }
}
