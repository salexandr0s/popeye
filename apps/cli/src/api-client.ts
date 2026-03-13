import { readFileSync } from 'node:fs';

import { PopeyeApiClient } from '@popeye/api-client';
import type { AppConfig, AuthRotationRecord } from '@popeye/contracts';

export async function tryConnectDaemon(
  config: AppConfig,
): Promise<PopeyeApiClient | null> {
  let authRecord: AuthRotationRecord;
  try {
    authRecord = JSON.parse(
      readFileSync(config.authFile, 'utf8'),
    ) as AuthRotationRecord;
  } catch {
    return null;
  }

  const baseUrl = `http://${config.security.bindHost}:${config.security.bindPort}`;
  const client = new PopeyeApiClient({
    baseUrl,
    token: authRecord.current.token,
  });

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const response = await fetch(`${baseUrl}/v1/health`, {
      headers: { authorization: `Bearer ${authRecord.current.token}` },
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
