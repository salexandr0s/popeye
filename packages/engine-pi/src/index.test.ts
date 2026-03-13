import { chmodSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { FakeEngineAdapter, PiEngineAdapter, PiEngineAdapterNotConfiguredError, inspectPiCheckout, runPiCompatibilityCheck } from './index.js';

function createFakePiRepo(script: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'popeye-pi-'));
  chmodSync(dir, 0o700);
  mkdirSync(join(dir, 'bin'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fake-pi', private: true }, null, 2));
  writeFileSync(join(dir, 'bin', 'pi.js'), script, 'utf8');
  return dir;
}

describe('engine-pi', () => {
  it('runs fake adapter', async () => {
    const handle = await new FakeEngineAdapter().startRun('hello');
    const result = await handle.wait();
    expect(result.engineSessionRef).toContain('fake:');
    expect(result.failureClassification).toBeNull();
  });

  it('reports pi checkout availability', () => {
    const status = inspectPiCheckout('/tmp/definitely-missing-pi');
    expect(status.available).toBe(false);
    expect(status.path).toContain('/tmp/definitely-missing-pi');
  });

  it('fails clearly when the sibling pi repo is missing', () => {
    expect(() => new PiEngineAdapter({ piPath: '/tmp/definitely-missing-pi' })).toThrow(PiEngineAdapterNotConfiguredError);
  });

  it('parses ndjson child-process events and compatibility checks', async () => {
    const piPath = createFakePiRepo(`
      process.stdin.setEncoding('utf8');
      let body = '';
      process.stdin.on('data', (chunk) => body += chunk);
      process.stdin.on('end', () => {
        const request = JSON.parse(body.trim());
        for (const line of [
          JSON.stringify({ type: 'started', payload: { cwd: process.cwd() } }),
          JSON.stringify({ type: 'session', payload: { sessionRef: 'pi:test-session' } }),
          JSON.stringify({ type: 'message', payload: { echoed: request.prompt } }),
          JSON.stringify({ type: 'completed', payload: { output: 'done' } }),
          JSON.stringify({ type: 'usage', payload: { provider: 'pi', model: 'stub', tokensIn: 5, tokensOut: 7, estimatedCostUsd: 0.01 } }),
        ]) process.stdout.write(line + '\\n');
      });
    `);

    const adapter = new PiEngineAdapter({ piPath, command: 'node', args: ['bin/pi.js'] });
    const result = await adapter.run('hello');
    expect(result.engineSessionRef).toBe('pi:test-session');
    expect(result.failureClassification).toBeNull();
    expect(result.events.some((event) => event.type === 'message')).toBe(true);

    const compatibility = await runPiCompatibilityCheck({ piPath, command: 'node', args: ['bin/pi.js'] }, 'hello');
    expect(compatibility.ok).toBe(true);
    expect(compatibility.eventsObserved).toBeGreaterThan(0);
  });
});
