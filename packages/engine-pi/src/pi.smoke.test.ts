import { describe, expect, it } from 'vitest';

import { inspectPiCheckout, PiEngineAdapter, runPiCompatibilityCheck } from './index.js';

const smokePath = process.env.POPEYE_PI_SMOKE_PATH;
const hasPiCheckout = inspectPiCheckout(smokePath).available;
const smokeEnabled = process.env.POPEYE_ENABLE_PI_SMOKE === '1';
const smokeCommand = process.env.POPEYE_PI_SMOKE_COMMAND ?? 'node';
const smokeArgs = process.env.POPEYE_PI_SMOKE_ARGS ? JSON.parse(process.env.POPEYE_PI_SMOKE_ARGS) as string[] : [];

describe('engine-pi smoke', () => {
  it.skipIf(!hasPiCheckout || !smokeEnabled)('runs against a sibling pi checkout when smoke mode is enabled', async () => {
    const adapter = new PiEngineAdapter({ piPath: smokePath, command: smokeCommand, args: smokeArgs });
    const result = await runPiCompatibilityCheck(adapter);
    expect(result.engineSessionRef).toBeTruthy();
    expect(result.ok).toBe(true);
  });
});
