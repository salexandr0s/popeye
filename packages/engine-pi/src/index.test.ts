import { chmodSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { NormalizedEngineEvent } from '@popeye/contracts';
import type { FakeEngineConfig, PiAdapterConfig } from './index.js';
import {
  FakeEngineAdapter,
  PiEngineAdapter,
  PiEngineAdapterNotConfiguredError,
  checkPiVersion,
  inspectPiCheckout,
  runPiCompatibilityCheck,
} from './index.js';

function createFakePiRepo(script: string, options: { defaultCli?: boolean } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'popeye-pi-'));
  chmodSync(dir, 0o700);
  const cliDir = options.defaultCli === false ? join(dir, 'bin') : join(dir, 'packages', 'coding-agent', 'dist');
  mkdirSync(cliDir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fake-pi', version: '0.1.0', private: true }, null, 2));
  writeFileSync(join(cliDir, options.defaultCli === false ? 'pi.js' : 'cli.js'), script, 'utf8');
  return dir;
}

function explicitConfig(piPath: string): PiAdapterConfig {
  return { piPath, command: 'node', args: ['bin/pi.js'] };
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

    expect(handleReceived).toBe(true);

    const result = await handle.wait();
    expect(result.engineSessionRef).toContain('fake:');
    expect(result.failureClassification).toBeNull();
    expect(receivedEvents.map((e) => e.type)).toEqual(['started', 'session', 'message', 'completed', 'usage']);
  });

  it('fake adapter run() collects all async events correctly', async () => {
    const adapter = new FakeEngineAdapter();
    const result = await adapter.run('run-test');
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
    expect(result.events[1]?.payload.classification).toBe('transient_failure');
    expect(result.usage.tokensOut).toBe(0);
  });

  it('fake adapter permanent_failure mode emits started then failed', async () => {
    const adapter = new FakeEngineAdapter({ mode: 'permanent_failure' });
    const result = await adapter.run('fail-permanent');
    expect(result.failureClassification).toBe('permanent_failure');
    expect(result.events.map((e) => e.type)).toEqual(['started', 'failed', 'usage']);
    expect(result.events[1]?.payload.classification).toBe('permanent_failure');
  });

  it('fake adapter timeout mode emits started but never completes', async () => {
    const adapter = new FakeEngineAdapter({ mode: 'timeout' });
    const receivedEvents: NormalizedEngineEvent[] = [];

    const handle = await adapter.startRun('hang', {
      onEvent: (event) => receivedEvents.push(event),
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0]?.type).toBe('started');

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
    expect(receivedEvents).toHaveLength(2);
    expect(receivedEvents[0]?.type).toBe('started');
  });

  it('fake adapter respects delayMs config', async () => {
    const adapter = new FakeEngineAdapter({ mode: 'success', delayMs: 10 });
    const start = Date.now();
    const result = await adapter.run('delayed');
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(40);
    expect(result.failureClassification).toBeNull();
    expect(result.events).toHaveLength(5);
  });

  it('reports pi checkout availability', () => {
    const status = inspectPiCheckout('/tmp/definitely-missing-pi');
    expect(status.available).toBe(false);
    expect(status.path).toContain('/tmp/definitely-missing-pi');
  });

  it('fails clearly when the configured pi repo is missing', () => {
    expect(() => new PiEngineAdapter({ piPath: '/tmp/definitely-missing-pi' })).toThrow(PiEngineAdapterNotConfiguredError);
  });

  it('inspectPiCheckout reads version from package.json', () => {
    const piPath = createFakePiRepo('', { defaultCli: false });
    const status = inspectPiCheckout(piPath);
    expect(status.available).toBe(true);
    expect(status.version).toBe('0.1.0');
  });

  it('checkPiVersion returns ok when versions match', () => {
    const piPath = createFakePiRepo('', { defaultCli: false });
    const result = checkPiVersion('0.1.0', piPath);
    expect(result.ok).toBe(true);
    expect(result.expected).toBe('0.1.0');
    expect(result.actual).toBe('0.1.0');
  });

  it('checkPiVersion returns not-ok on mismatch', () => {
    const piPath = createFakePiRepo('', { defaultCli: false });
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

  it('uses Pi RPC responses/events and compatibility checks', async () => {
    const piPath = createFakePiRepo(`
      let buffer = '';
      function write(line) { process.stdout.write(JSON.stringify(line) + '\\n'); }
      process.stdin.setEncoding('utf8');
      process.on('SIGTERM', () => process.exit(0));
      process.stdin.on('data', (chunk) => {
        buffer += chunk;
        const lines = buffer.split('\\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          const message = JSON.parse(line);
          if (message.type === 'get_state') {
            write({ id: message.id, type: 'response', command: 'get_state', success: true, data: { sessionId: 'pi:test-session', sessionFile: '/tmp/pi-test-session.jsonl', isStreaming: false } });
          }
          if (message.type === 'prompt') {
            write({ id: message.id, type: 'response', command: 'prompt', success: true });
            write({ type: 'tool_execution_start', toolCallId: 'tool-1', toolName: 'read', args: { path: 'README.md' } });
            write({ type: 'tool_execution_end', toolCallId: 'tool-1', toolName: 'read', result: { text: 'ok' }, isError: false });
            write({ type: 'auto_compaction_end', result: { summary: 'Compacted context', tokensBefore: 100, tokensAfter: 40 }, aborted: false, willRetry: false });
            write({ type: 'message_end', message: { role: 'assistant', provider: 'anthropic', model: 'claude-sonnet', stopReason: 'stop', usage: { input: 12, output: 34, cost: { total: 0.56 } }, content: [{ type: 'text', text: 'done:' + message.message }] } });
            write({ type: 'agent_end', messages: [{ role: 'assistant', provider: 'anthropic', model: 'claude-sonnet', stopReason: 'stop', usage: { input: 12, output: 34, cost: { total: 0.56 } }, content: [{ type: 'text', text: 'done:' + message.message }] }] });
          }
          if (message.type === 'abort') {
            write({ id: message.id, type: 'response', command: 'abort', success: true });
          }
        }
      });
    `);

    const adapter = new PiEngineAdapter({ piPath, command: 'node' });
    const result = await adapter.run('hello');

    expect(result.engineSessionRef).toBe('pi:test-session');
    expect(result.failureClassification).toBeNull();
    expect(result.usage).toEqual({
      provider: 'anthropic',
      model: 'claude-sonnet',
      tokensIn: 12,
      tokensOut: 34,
      estimatedCostUsd: 0.56,
    });
    expect(result.events.map((event) => event.type)).toEqual(['session', 'started', 'tool_call', 'tool_result', 'compaction', 'message', 'completed', 'usage']);
    expect(result.events.find((event) => event.type === 'session')?.payload.sessionRef).toBe('pi:test-session');
    expect(result.events.find((event) => event.type === 'compaction')?.payload.content).toBe('Compacted context');

    const compatibility = await runPiCompatibilityCheck({ piPath, command: 'node' }, 'hello');
    expect(compatibility.ok).toBe(true);
    expect(compatibility.eventsObserved).toBeGreaterThan(0);
  });

  it('captures stderr as warnings on successful runs', async () => {
    const piPath = createFakePiRepo(`
      let buffer = '';
      function write(line) { process.stdout.write(JSON.stringify(line) + '\\n'); }
      process.stdin.setEncoding('utf8');
      process.on('SIGTERM', () => process.exit(0));
      process.stdin.on('data', (chunk) => {
        buffer += chunk;
        const lines = buffer.split('\\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          const message = JSON.parse(line);
          if (message.type === 'get_state') {
            write({ id: message.id, type: 'response', command: 'get_state', success: true, data: { sessionId: 'pi:warn-session', isStreaming: false } });
          }
          if (message.type === 'prompt') {
            process.stderr.write('deprecation warning: old API');
            write({ id: message.id, type: 'response', command: 'prompt', success: true });
            write({ type: 'message_end', message: { role: 'assistant', provider: 'pi', model: 'stub', stopReason: 'stop', usage: { input: 1, output: 1, cost: { total: 0 } }, content: [{ type: 'text', text: 'ok' }] } });
            write({ type: 'agent_end', messages: [{ role: 'assistant', provider: 'pi', model: 'stub', stopReason: 'stop', usage: { input: 1, output: 1, cost: { total: 0 } }, content: [{ type: 'text', text: 'ok' }] }] });
          }
        }
      });
    `);

    const adapter = new PiEngineAdapter({ piPath, command: 'node' });
    const result = await adapter.run('warn');
    expect(result.failureClassification).toBeNull();
    expect(result.warnings).toBe('deprecation warning: old API');
  });

  it('does not set warnings when stderr is empty', async () => {
    const piPath = createFakePiRepo(`
      let buffer = '';
      function write(line) { process.stdout.write(JSON.stringify(line) + '\\n'); }
      process.stdin.setEncoding('utf8');
      process.on('SIGTERM', () => process.exit(0));
      process.stdin.on('data', (chunk) => {
        buffer += chunk;
        const lines = buffer.split('\\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          const message = JSON.parse(line);
          if (message.type === 'get_state') {
            write({ id: message.id, type: 'response', command: 'get_state', success: true, data: { sessionId: 'pi:clean-session', isStreaming: false } });
          }
          if (message.type === 'prompt') {
            write({ id: message.id, type: 'response', command: 'prompt', success: true });
            write({ type: 'message_end', message: { role: 'assistant', provider: 'pi', model: 'stub', stopReason: 'stop', usage: { input: 1, output: 1, cost: { total: 0 } }, content: [{ type: 'text', text: 'ok' }] } });
            write({ type: 'agent_end', messages: [{ role: 'assistant', provider: 'pi', model: 'stub', stopReason: 'stop', usage: { input: 1, output: 1, cost: { total: 0 } }, content: [{ type: 'text', text: 'ok' }] }] });
          }
        }
      });
    `);

    const adapter = new PiEngineAdapter({ piPath, command: 'node' });
    const result = await adapter.run('clean');
    expect(result.failureClassification).toBeNull();
    expect(result.warnings).toBeUndefined();
  });

  it('classifies prompt response auth failures without emitting started', async () => {
    const piPath = createFakePiRepo(`
      let buffer = '';
      function write(line) { process.stdout.write(JSON.stringify(line) + '\\n'); }
      process.stdin.setEncoding('utf8');
      process.on('SIGTERM', () => process.exit(0));
      process.stdin.on('data', (chunk) => {
        buffer += chunk;
        const lines = buffer.split('\\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          const message = JSON.parse(line);
          if (message.type === 'get_state') {
            write({ id: message.id, type: 'response', command: 'get_state', success: true, data: { sessionId: 'pi:auth-session', isStreaming: false } });
          }
          if (message.type === 'prompt') {
            write({ id: message.id, type: 'response', command: 'prompt', success: false, error: 'Unauthorized API key' });
          }
        }
      });
    `);

    const adapter = new PiEngineAdapter({ piPath, command: 'node' });
    const result = await adapter.run('auth');
    expect(result.failureClassification).toBe('auth_failure');
    expect(result.events.some((event) => event.type === 'started')).toBe(false);
    expect(result.events.find((event) => event.type === 'failed')?.payload.classification).toBe('auth_failure');
  });

  it('kills child process on engine timeout and emits transient_failure', async () => {
    const piPath = createFakePiRepo(`
      let buffer = '';
      function write(line) { process.stdout.write(JSON.stringify(line) + '\\n'); }
      process.stdin.setEncoding('utf8');
      process.on('SIGTERM', () => setTimeout(() => process.exit(0), 10_000));
      process.stdin.on('data', (chunk) => {
        buffer += chunk;
        const lines = buffer.split('\\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          const message = JSON.parse(line);
          if (message.type === 'get_state') {
            write({ id: message.id, type: 'response', command: 'get_state', success: true, data: { sessionId: 'pi:hang-session', isStreaming: false } });
          }
          if (message.type === 'prompt') {
            write({ id: message.id, type: 'response', command: 'prompt', success: true });
          }
        }
      });
    `);

    const adapter = new PiEngineAdapter({ piPath, command: 'node', timeoutMs: 200 });
    const result = await adapter.run('hang-forever');
    expect(result.failureClassification).toBe('transient_failure');
    expect(result.failureMessage).toBe('engine timeout exceeded');
    expect(result.events.some((event) => event.type === 'failed' && event.payload.message === 'engine timeout exceeded')).toBe(true);
  }, 15_000);

  it('cancels via RPC abort and reports cancelled', async () => {
    const piPath = createFakePiRepo(`
      let buffer = '';
      function write(line) { process.stdout.write(JSON.stringify(line) + '\\n'); }
      process.stdin.setEncoding('utf8');
      process.on('SIGTERM', () => process.exit(0));
      process.stdin.on('data', (chunk) => {
        buffer += chunk;
        const lines = buffer.split('\\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          const message = JSON.parse(line);
          if (message.type === 'get_state') {
            write({ id: message.id, type: 'response', command: 'get_state', success: true, data: { sessionId: 'pi:cancel-session', isStreaming: false } });
          }
          if (message.type === 'prompt') {
            write({ id: message.id, type: 'response', command: 'prompt', success: true });
          }
          if (message.type === 'abort') {
            write({ id: message.id, type: 'response', command: 'abort', success: true });
            write({ type: 'message_end', message: { role: 'assistant', provider: 'pi', model: 'stub', stopReason: 'aborted', errorMessage: 'cancelled by abort', usage: { input: 1, output: 0, cost: { total: 0 } }, content: [] } });
            write({ type: 'agent_end', messages: [{ role: 'assistant', provider: 'pi', model: 'stub', stopReason: 'aborted', errorMessage: 'cancelled by abort', usage: { input: 1, output: 0, cost: { total: 0 } }, content: [] }] });
          }
        }
      });
    `);

    const adapter = new PiEngineAdapter({ piPath, command: 'node' });
    const receivedEvents: NormalizedEngineEvent[] = [];
    const handle = await adapter.startRun('cancel-me', {
      onEvent: (event) => receivedEvents.push(event),
    });

    await new Promise((resolve) => setTimeout(resolve, 100));
    await handle.cancel();
    const completion = await handle.wait();

    expect(completion.failureClassification).toBe('cancelled');
    expect(receivedEvents.some((event) => event.type === 'failed' && event.payload.classification === 'cancelled')).toBe(true);
  }, 15_000);

  it('rejects unsupported extension UI output as protocol_error', async () => {
    const piPath = createFakePiRepo(`
      let buffer = '';
      function write(line) { process.stdout.write(JSON.stringify(line) + '\\n'); }
      process.stdin.setEncoding('utf8');
      process.on('SIGTERM', () => process.exit(0));
      process.stdin.on('data', (chunk) => {
        buffer += chunk;
        const lines = buffer.split('\\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          const message = JSON.parse(line);
          if (message.type === 'get_state') {
            write({ id: message.id, type: 'response', command: 'get_state', success: true, data: { sessionId: 'pi:ui-session', isStreaming: false } });
          }
          if (message.type === 'prompt') {
            write({ id: message.id, type: 'response', command: 'prompt', success: true });
            write({ type: 'extension_ui_request', id: 'ui-1', method: 'confirm', title: 'Need approval' });
          }
        }
      });
    `);

    const adapter = new PiEngineAdapter({ piPath, command: 'node' });
    const result = await adapter.run('ui');
    expect(result.failureClassification).toBe('protocol_error');
    expect(result.events.find((event) => event.type === 'failed')?.payload.classification).toBe('protocol_error');
  });

  it('rejects malformed stdout lines as protocol_error', async () => {
    const piPath = createFakePiRepo(`
      let buffer = '';
      process.stdin.setEncoding('utf8');
      process.on('SIGTERM', () => process.exit(0));
      process.stdin.on('data', (chunk) => {
        buffer += chunk;
        const lines = buffer.split('\\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          const message = JSON.parse(line);
          if (message.type === 'get_state') {
            process.stdout.write(JSON.stringify({ id: message.id, type: 'response', command: 'get_state', success: true, data: { sessionId: 'pi:bad-session', isStreaming: false } }) + '\\n');
          }
          if (message.type === 'prompt') {
            process.stdout.write(JSON.stringify({ id: message.id, type: 'response', command: 'prompt', success: true }) + '\\n');
            process.stdout.write('not-json\\n');
          }
        }
      });
    `);

    const adapter = new PiEngineAdapter({ piPath, command: 'node' });
    const result = await adapter.run('bad-json');
    expect(result.failureClassification).toBe('protocol_error');
    expect(result.events.find((event) => event.type === 'failed')?.payload.classification).toBe('protocol_error');
  });

  it('supports explicit Pi CLI args for non-default launchers', async () => {
    const piPath = createFakePiRepo(`
      let buffer = '';
      function write(line) { process.stdout.write(JSON.stringify(line) + '\\n'); }
      process.stdin.setEncoding('utf8');
      process.on('SIGTERM', () => process.exit(0));
      process.stdin.on('data', (chunk) => {
        buffer += chunk;
        const lines = buffer.split('\\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          const message = JSON.parse(line);
          if (message.type === 'get_state') {
            write({ id: message.id, type: 'response', command: 'get_state', success: true, data: { sessionId: 'pi:explicit-session', isStreaming: false } });
          }
          if (message.type === 'prompt') {
            write({ id: message.id, type: 'response', command: 'prompt', success: true });
            write({ type: 'message_end', message: { role: 'assistant', provider: 'pi', model: 'stub', stopReason: 'stop', usage: { input: 2, output: 3, cost: { total: 0.01 } }, content: [{ type: 'text', text: 'ok' }] } });
            write({ type: 'agent_end', messages: [{ role: 'assistant', provider: 'pi', model: 'stub', stopReason: 'stop', usage: { input: 2, output: 3, cost: { total: 0.01 } }, content: [{ type: 'text', text: 'ok' }] }] });
          }
        }
      });
    `, { defaultCli: false });

    const adapter = new PiEngineAdapter(explicitConfig(piPath));
    const result = await adapter.run('explicit');
    expect(result.failureClassification).toBeNull();
    expect(result.engineSessionRef).toBe('pi:explicit-session');
    expect(result.usage.tokensIn).toBe(2);
  });
});
