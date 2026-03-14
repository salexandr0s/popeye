import { chmodSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { NormalizedEngineEvent } from '@popeye/contracts';
import type { FakeEngineConfig, PiAdapterConfig } from './index.js';
import { FakeEngineAdapter, PiEngineAdapter, PiEngineAdapterNotConfiguredError, checkPiVersion, inspectPiCheckout, runPiCompatibilityCheck } from './index.js';

function createFakePiRepo(script: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'popeye-pi-'));
  chmodSync(dir, 0o700);
  mkdirSync(join(dir, 'bin'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fake-pi', version: '0.1.0', private: true }, null, 2));
  writeFileSync(join(dir, 'bin', 'pi.js'), script, 'utf8');
  return dir;
}

/**
 * Creates a temp directory with a valid package.json and returns a PiAdapterConfig
 * that points the adapter at the ndjson-child.mjs fixture script.
 */
function createFixturePiRepo(fixturePath: string): PiAdapterConfig {
  const dir = mkdtempSync(join(tmpdir(), 'popeye-pi-fixture-'));
  chmodSync(dir, 0o700);
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fake-pi', version: '0.1.0', private: true }, null, 2));
  return { piPath: dir, command: 'node', args: [fixturePath] };
}

describe('engine-pi', () => {
  it('runs fake adapter', async () => {
    const handle = await new FakeEngineAdapter().startRun('hello');
    const result = await handle.wait();
    expect(result.engineSessionRef).toContain('fake:');
    expect(result.failureClassification).toBeNull();
  });

  it('fake adapter emits events asynchronously', async () => {
    const receivedEvents: NormalizedEngineEvent[] = [];
    let handleReceived = false;

    const adapter = new FakeEngineAdapter();
    const handle = await adapter.startRun('async-test', {
      onHandle: () => {
        handleReceived = true;
      },
      onEvent: (event) => {
        receivedEvents.push(event);
      },
    });

    // onHandle fires synchronously during startRun, but events fire asynchronously
    expect(handleReceived).toBe(true);
    // Events have not yet been delivered synchronously after startRun returns
    // (they are queued via queueMicrotask). But once we await, they'll arrive.

    const result = await handle.wait();
    expect(result.engineSessionRef).toContain('fake:');
    expect(result.failureClassification).toBeNull();
    expect(receivedEvents.length).toBeGreaterThanOrEqual(4);
    expect(receivedEvents.map((e) => e.type)).toEqual(['started', 'session', 'message', 'completed', 'usage']);
  });

  it('fake adapter run() collects all async events correctly', async () => {
    const adapter = new FakeEngineAdapter();
    const result = await adapter.run('run-test');
    expect(result.events.length).toBe(5);
    expect(result.events.map((e) => e.type)).toEqual(['started', 'session', 'message', 'completed', 'usage']);
    expect(result.engineSessionRef).toContain('fake:');
    expect(result.failureClassification).toBeNull();
    expect(result.usage.provider).toBe('fake');
  });

  it('fake adapter transient_failure mode emits started then failed', async () => {
    const config: FakeEngineConfig = { mode: 'transient_failure' };
    const adapter = new FakeEngineAdapter(config);
    const result = await adapter.run('fail-transient');
    expect(result.failureClassification).toBe('transient_failure');
    expect(result.events.map((e) => e.type)).toEqual(['started', 'failed', 'usage']);
    expect(result.events[1].payload.classification).toBe('transient_failure');
    expect(result.usage.tokensOut).toBe(0);
  });

  it('fake adapter permanent_failure mode emits started then failed', async () => {
    const adapter = new FakeEngineAdapter({ mode: 'permanent_failure' });
    const result = await adapter.run('fail-permanent');
    expect(result.failureClassification).toBe('permanent_failure');
    expect(result.events.map((e) => e.type)).toEqual(['started', 'failed', 'usage']);
    expect(result.events[1].payload.classification).toBe('permanent_failure');
  });

  it('fake adapter timeout mode emits started but never completes', async () => {
    const adapter = new FakeEngineAdapter({ mode: 'timeout' });
    const receivedEvents: NormalizedEngineEvent[] = [];

    const handle = await adapter.startRun('hang', {
      onEvent: (event) => receivedEvents.push(event),
    });

    // Give microtasks time to flush
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Should have emitted started but wait() should not resolve
    expect(receivedEvents.length).toBe(1);
    expect(receivedEvents[0].type).toBe('started');

    // Verify wait() does not resolve within a short window
    const raceResult = await Promise.race([
      handle.wait().then(() => 'resolved' as const),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 100)),
    ]);
    expect(raceResult).toBe('timeout');
  });

  it('fake adapter protocol_error mode emits malformed event', async () => {
    const adapter = new FakeEngineAdapter({ mode: 'protocol_error' });
    const receivedEvents: NormalizedEngineEvent[] = [];

    const handle = await adapter.startRun('bad-protocol', {
      onEvent: (event) => receivedEvents.push(event),
    });

    const result = await handle.wait();
    expect(result.failureClassification).toBe('protocol_error');
    // Should have emitted started + the malformed event
    expect(receivedEvents.length).toBe(2);
    expect(receivedEvents[0].type).toBe('started');
  });

  it('fake adapter respects delayMs config', async () => {
    const adapter = new FakeEngineAdapter({ mode: 'success', delayMs: 10 });
    const start = Date.now();
    const result = await adapter.run('delayed');
    const elapsed = Date.now() - start;
    // With 5 events at 10ms each, should take at least ~50ms
    expect(elapsed).toBeGreaterThanOrEqual(40);
    expect(result.failureClassification).toBeNull();
    expect(result.events.length).toBe(5);
  });

  it('fake adapter default constructor is backward-compatible', async () => {
    // No-arg constructor should work exactly like before (success mode)
    const adapter = new FakeEngineAdapter();
    const handle = await adapter.startRun('hello');
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

  it('inspectPiCheckout reads version from package.json', () => {
    const piPath = createFakePiRepo('');
    const status = inspectPiCheckout(piPath);
    expect(status.available).toBe(true);
    expect(status.version).toBe('0.1.0');
  });

  it('checkPiVersion returns ok when versions match', () => {
    const piPath = createFakePiRepo('');
    const result = checkPiVersion('0.1.0', piPath);
    expect(result.ok).toBe(true);
    expect(result.expected).toBe('0.1.0');
    expect(result.actual).toBe('0.1.0');
  });

  it('checkPiVersion returns not-ok on mismatch', () => {
    const piPath = createFakePiRepo('');
    const result = checkPiVersion('9.9.9', piPath);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('mismatch');
    expect(result.expected).toBe('9.9.9');
    expect(result.actual).toBe('0.1.0');
  });

  it('checkPiVersion returns ok when no expected version', () => {
    const result = checkPiVersion(undefined);
    expect(result.ok).toBe(true);
  });

  it('checkPiVersion returns not-ok when checkout missing', () => {
    const result = checkPiVersion('0.1.0', '/tmp/definitely-missing-pi');
    expect(result.ok).toBe(false);
    expect(result.message).toContain('not available');
  });

  it('kills child process on engine timeout and emits transient_failure', async () => {
    const piPath = createFakePiRepo(`
      process.stdin.resume();
      process.stdin.on('end', () => {
        // Intentionally hang — never exit
        setInterval(() => {}, 60_000);
      });
    `);

    const adapter = new PiEngineAdapter({ piPath, command: 'node', args: ['bin/pi.js'], timeoutMs: 200 });
    const result = await adapter.run('hang-forever');
    expect(result.failureClassification).toBe('transient_failure');
    expect(result.failureMessage).toBe('engine timeout exceeded');
    expect(result.events.some((e) => e.type === 'failed' && e.payload.message === 'engine timeout exceeded')).toBe(true);
  }, 15_000);

  it('captures stderr as warnings on successful runs', async () => {
    const piPath = createFakePiRepo(`
      process.stdin.setEncoding('utf8');
      let body = '';
      process.stdin.on('data', (chunk) => body += chunk);
      process.stdin.on('end', () => {
        const request = JSON.parse(body.trim());
        process.stderr.write('deprecation warning: old API');
        for (const line of [
          JSON.stringify({ type: 'started', payload: {} }),
          JSON.stringify({ type: 'session', payload: { sessionRef: 'pi:warn-session' } }),
          JSON.stringify({ type: 'message', payload: { text: request.prompt } }),
          JSON.stringify({ type: 'completed', payload: { output: 'ok' } }),
          JSON.stringify({ type: 'usage', payload: { provider: 'pi', model: 'stub', tokensIn: 1, tokensOut: 1, estimatedCostUsd: 0 } }),
        ]) process.stdout.write(line + '\\n');
      });
    `);

    const adapter = new PiEngineAdapter({ piPath, command: 'node', args: ['bin/pi.js'] });
    const result = await adapter.run('test-warnings');
    expect(result.failureClassification).toBeNull();
    expect(result.warnings).toBe('deprecation warning: old API');
  });

  it('does not set warnings when stderr is empty', async () => {
    const piPath = createFakePiRepo(`
      process.stdin.setEncoding('utf8');
      let body = '';
      process.stdin.on('data', (chunk) => body += chunk);
      process.stdin.on('end', () => {
        for (const line of [
          JSON.stringify({ type: 'started', payload: {} }),
          JSON.stringify({ type: 'session', payload: { sessionRef: 'pi:clean-session' } }),
          JSON.stringify({ type: 'completed', payload: { output: 'ok' } }),
          JSON.stringify({ type: 'usage', payload: { provider: 'pi', model: 'stub', tokensIn: 1, tokensOut: 1, estimatedCostUsd: 0 } }),
        ]) process.stdout.write(line + '\\n');
      });
    `);

    const adapter = new PiEngineAdapter({ piPath, command: 'node', args: ['bin/pi.js'] });
    const result = await adapter.run('no-warnings');
    expect(result.failureClassification).toBeNull();
    expect(result.warnings).toBeUndefined();
  });

  it('uses __fixtures__/ndjson-child.mjs with correct prompt protocol', async () => {
    const fixturePath = join(__dirname, '__fixtures__');
    const dir = mkdtempSync(join(tmpdir(), 'popeye-pi-fixture-'));
    chmodSync(dir, 0o700);
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fake-pi', version: '0.1.0', private: true }, null, 2));

    const adapter = new PiEngineAdapter({ piPath: dir, command: 'node', args: [join(fixturePath, 'ndjson-child.mjs')] });
    const result = await adapter.run('hello-fixture');
    expect(result.failureClassification).toBeNull();
    expect(result.engineSessionRef).toBe('pi:test-session');
    expect(result.events.some((e) => e.type === 'message' && e.payload.text === 'processed:hello-fixture')).toBe(true);
  });

  // --- Fixture-based error-path tests (ndjson-child.mjs) ---

  describe('fixture error paths', () => {
    const fixturePath = join(__dirname, '__fixtures__', 'ndjson-child.mjs');

    it('malformed output yields protocol_error', async () => {
      const config = createFixturePiRepo(fixturePath);
      const adapter = new PiEngineAdapter(config);
      const result = await adapter.run('malformed');

      expect(result.failureClassification).toBe('protocol_error');
      expect(result.events.some((e) => e.type === 'failed' && e.payload.classification === 'protocol_error')).toBe(true);
    });

    it('startup failure yields startup_failure when no started event emitted', async () => {
      const config = createFixturePiRepo(fixturePath);
      const adapter = new PiEngineAdapter(config);
      const result = await adapter.run('startup-fail');

      expect(result.failureClassification).toBe('startup_failure');
      // No 'started' event should have been emitted before the failure
      const startedIndex = result.events.findIndex((e) => e.type === 'started');
      const failedEvent = result.events.find((e) => e.type === 'failed');
      expect(startedIndex).toBe(-1);
      expect(failedEvent).toBeDefined();
      expect(failedEvent!.payload.classification).toBe('startup_failure');
      // stderr content should appear in warnings
      expect(result.warnings).toBe('boot failure');
    });

    it('cancellation via handle.cancel() yields cancelled classification', async () => {
      const config = createFixturePiRepo(fixturePath);
      const adapter = new PiEngineAdapter(config);
      const receivedEvents: NormalizedEngineEvent[] = [];
      let capturedHandle: Awaited<ReturnType<typeof adapter.startRun>> | undefined;

      const handle = await adapter.startRun('cancel-me', {
        onEvent: (event) => receivedEvents.push(event),
        onHandle: (h) => {
          capturedHandle = h;
        },
      });

      // Give the child a moment to emit 'started' and 'session' then block
      await new Promise((resolve) => setTimeout(resolve, 200));

      // The fixture hangs after emitting started + session for 'cancel-me'.
      // Sending cancel (SIGTERM) triggers the fixture's SIGTERM handler which
      // emits a failed event with classification: 'cancelled'.
      expect(capturedHandle).toBeDefined();
      await handle.cancel();

      const completion = await handle.wait();
      expect(completion.failureClassification).toBe('cancelled');
      expect(receivedEvents.some((e) => e.type === 'failed' && e.payload.classification === 'cancelled')).toBe(true);
    }, 15_000);

    it('transient failure from fixture yields transient_failure', async () => {
      const config = createFixturePiRepo(fixturePath);
      const adapter = new PiEngineAdapter(config);
      const result = await adapter.run('retry-me');

      expect(result.failureClassification).toBe('transient_failure');
      expect(result.events.some((e) => e.type === 'failed' && e.payload.classification === 'transient_failure')).toBe(true);
      // The fixture emits started + session before the failure
      expect(result.events.some((e) => e.type === 'started')).toBe(true);
      expect(result.events.some((e) => e.type === 'session')).toBe(true);
    });

    it('timeout kills hanging fixture process via SIGTERM', async () => {
      const config: PiAdapterConfig = { ...createFixturePiRepo(fixturePath), timeoutMs: 500 };
      const adapter = new PiEngineAdapter(config);
      const result = await adapter.run('cancel-me');

      // The timeout fires first and determines the terminal classification.
      // The child may still emit its SIGTERM-driven 'cancelled' event, but that
      // must not overwrite the timeout failure classification.
      expect(result.events.some((e) => e.type === 'failed' && e.payload.message === 'engine timeout exceeded')).toBe(true);
      expect(result.failureClassification).toBe('transient_failure');
    }, 15_000);
  });

  // --- FakeEngineAdapter EngineRunResult shape verification ---

  describe('FakeEngineAdapter result shape', () => {
    it('success mode returns complete EngineRunResult with all required fields', async () => {
      const adapter = new FakeEngineAdapter();
      const result = await adapter.run('shape-check');

      // All top-level fields must be present
      expect(result).toHaveProperty('events');
      expect(result).toHaveProperty('engineSessionRef');
      expect(result).toHaveProperty('usage');
      expect(result).toHaveProperty('failureClassification');

      // Correct types
      expect(Array.isArray(result.events)).toBe(true);
      expect(typeof result.engineSessionRef).toBe('string');
      expect(result.engineSessionRef).toMatch(/^fake:/);
      expect(result.failureClassification).toBeNull();

      // Usage metrics shape
      expect(typeof result.usage.provider).toBe('string');
      expect(typeof result.usage.model).toBe('string');
      expect(typeof result.usage.tokensIn).toBe('number');
      expect(typeof result.usage.tokensOut).toBe('number');
      expect(typeof result.usage.estimatedCostUsd).toBe('number');

      // Events have correct shape
      for (const event of result.events) {
        expect(typeof event.type).toBe('string');
        expect(event.payload).toBeDefined();
        expect(typeof event.payload).toBe('object');
      }
    });

    it('transient_failure mode returns correct EngineRunResult shape', async () => {
      const adapter = new FakeEngineAdapter({ mode: 'transient_failure' });
      const result = await adapter.run('transient-shape');

      expect(result.failureClassification).toBe('transient_failure');
      expect(result.engineSessionRef).toMatch(/^fake:/);
      expect(result.usage.tokensOut).toBe(0);
      expect(result.events.length).toBeGreaterThan(0);
      expect(result.events[0]!.type).toBe('started');
    });

    it('permanent_failure mode returns correct EngineRunResult shape', async () => {
      const adapter = new FakeEngineAdapter({ mode: 'permanent_failure' });
      const result = await adapter.run('permanent-shape');

      expect(result.failureClassification).toBe('permanent_failure');
      expect(result.engineSessionRef).toMatch(/^fake:/);
      expect(result.usage.tokensOut).toBe(0);
      expect(result.events.length).toBeGreaterThan(0);
      expect(result.events[0]!.type).toBe('started');
    });
  });

  // --- Payload type preservation ---

  describe('payload type preservation', () => {
    it('numeric payload values remain numbers through normalizeEvent', async () => {
      // The inline script sends tokensIn: 5 and tokensOut: 7 as actual numbers
      const piPath = createFakePiRepo(`
        process.stdin.setEncoding('utf8');
        let body = '';
        process.stdin.on('data', (chunk) => body += chunk);
        process.stdin.on('end', () => {
          for (const line of [
            JSON.stringify({ type: 'started', payload: {} }),
            JSON.stringify({ type: 'usage', payload: { provider: 'pi', model: 'test', tokensIn: 42, tokensOut: 99, estimatedCostUsd: 0.05 } }),
            JSON.stringify({ type: 'completed', payload: { output: 'done' } }),
          ]) process.stdout.write(line + '\\n');
        });
      `);

      const adapter = new PiEngineAdapter({ piPath, command: 'node', args: ['bin/pi.js'] });
      const result = await adapter.run('numbers');

      const usageEvent = result.events.find((e) => e.type === 'usage');
      expect(usageEvent).toBeDefined();
      // Values sent as numbers must stay as numbers in the normalized payload
      expect(typeof usageEvent!.payload.tokensIn).toBe('number');
      expect(typeof usageEvent!.payload.tokensOut).toBe('number');
      expect(typeof usageEvent!.payload.estimatedCostUsd).toBe('number');
      expect(usageEvent!.payload.tokensIn).toBe(42);
      expect(usageEvent!.payload.tokensOut).toBe(99);
      expect(usageEvent!.payload.estimatedCostUsd).toBe(0.05);

      // Also verify the aggregated usage on the result preserves the numbers
      expect(result.usage.tokensIn).toBe(42);
      expect(result.usage.tokensOut).toBe(99);
      expect(result.usage.estimatedCostUsd).toBe(0.05);
    });

    it('string payload values sent by fixture remain strings in normalized events', async () => {
      // The ndjson-child.mjs fixture sends tokensIn/tokensOut as strings ('3', '5')
      const config = createFixturePiRepo(join(__dirname, '__fixtures__', 'ndjson-child.mjs'));
      const adapter = new PiEngineAdapter(config);
      const result = await adapter.run('hello-types');

      const usageEvent = result.events.find((e) => e.type === 'usage');
      expect(usageEvent).toBeDefined();
      // The fixture sends these as strings — normalizeEvent preserves primitive types as-is
      expect(typeof usageEvent!.payload.tokensIn).toBe('string');
      expect(usageEvent!.payload.tokensIn).toBe('3');
      expect(typeof usageEvent!.payload.tokensOut).toBe('string');
      expect(usageEvent!.payload.tokensOut).toBe('5');
    });
  });

  it('rejects child events whose payload is not an object', async () => {
    const piPath = createFakePiRepo(`
      process.stdin.setEncoding('utf8');
      let body = '';
      process.stdin.on('data', (chunk) => body += chunk);
      process.stdin.on('end', () => {
        process.stdout.write(JSON.stringify({ type: 'started', payload: {} }) + '\\n');
        process.stdout.write(JSON.stringify({ type: 'message', payload: 'not-an-object' }) + '\\n');
      });
    `);

    const adapter = new PiEngineAdapter({ piPath, command: 'node', args: ['bin/pi.js'] });
    const result = await adapter.run('bad-payload');

    expect(result.failureClassification).toBe('protocol_error');
    expect(result.events.some((event) => event.type === 'failed' && event.payload.classification === 'protocol_error')).toBe(true);
  });
});
