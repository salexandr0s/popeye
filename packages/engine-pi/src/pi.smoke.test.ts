import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import { inspectPiCheckout, PiEngineAdapter, runPiCompatibilityCheck } from './index.js';

const smokePath = process.env.POPEYE_PI_SMOKE_PATH;
const hasPiCheckout = inspectPiCheckout(smokePath).available;
const smokeEnabled = process.env.POPEYE_ENABLE_PI_SMOKE === '1';
const smokeCommand = process.env.POPEYE_PI_SMOKE_COMMAND ?? 'node';
const smokeArgs = process.env.POPEYE_PI_SMOKE_ARGS ? JSON.parse(process.env.POPEYE_PI_SMOKE_ARGS) as string[] : [];

function createSmokeProviderExtension(piPath: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'popeye-pi-smoke-extension-'));
  chmodSync(dir, 0o700);
  const extensionPath = join(dir, 'popeye-smoke-provider.mjs');
  const aiIndexUrl = pathToFileURL(join(piPath, 'packages', 'ai', 'dist', 'index.js')).href;
  writeFileSync(extensionPath, `
import { createAssistantMessageEventStream } from ${JSON.stringify(aiIndexUrl)};

export default function(pi) {
  pi.registerProvider('popeye-smoke', {
    baseUrl: 'http://localhost/popeye-smoke',
    apiKey: 'POPEYE_SMOKE_API_KEY',
    api: 'popeye-smoke-api',
    authHeader: false,
    models: [
      {
        id: 'smoke-model',
        name: 'Popeye Smoke Model',
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 8192,
        maxTokens: 1024
      }
    ],
    streamSimple(model) {
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => {
        const message = {
          role: 'assistant',
          api: 'popeye-smoke-api',
          provider: 'popeye-smoke',
          model: model.id,
          usage: {
            input: 1,
            output: 1,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 2,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
          },
          stopReason: 'stop',
          timestamp: Date.now(),
          content: [{ type: 'text', text: 'smoke ok' }]
        };
        stream.push({ type: 'done', reason: 'stop', message });
      });
      return stream;
    }
  });
}
`, 'utf8');
  return extensionPath;
}

describe('engine-pi smoke', () => {
  it.skipIf(!hasPiCheckout || !smokeEnabled)('runs against a configured pi checkout when smoke mode is enabled', async () => {
    const piPath = smokePath ?? join(process.cwd(), '..', 'pi');
    const effectiveArgs = smokeArgs.length > 0
      ? smokeArgs
      : ['--extension', createSmokeProviderExtension(piPath), '--model', 'popeye-smoke/smoke-model'];
    process.env.POPEYE_SMOKE_API_KEY = process.env.POPEYE_SMOKE_API_KEY ?? 'popeye-smoke-key';
    const adapter = new PiEngineAdapter({
      piPath,
      command: smokeCommand,
      args: effectiveArgs,
    });
    const result = await runPiCompatibilityCheck(adapter);
    expect(result.engineSessionRef).toBeTruthy();
    expect(result.ok).toBe(true);
  });
});
