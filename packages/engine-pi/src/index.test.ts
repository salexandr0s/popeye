import { chmodSync, existsSync, mkdtempSync, mkdirSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { EngineConfigSchema, type NormalizedEngineEvent } from '@popeye/contracts';
import type { EngineRunRequest, FakeEngineConfig, PiAdapterConfig } from './index.ts';
import {
  FakeEngineAdapter,
  PiEngineAdapter,
  PiEngineAdapterNotConfiguredError,
  checkPiVersion,
  cleanStalePiTempDirs,
  inspectPiCheckout,
  runPiCompatibilityCheck,
} from './index.ts';

function createFakePiRepo(script: string, options: { defaultCli?: boolean } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'popeye-pi-'));
  chmodSync(dir, 0o700);
  const cliDir = options.defaultCli === false ? join(dir, 'bin') : join(dir, 'packages', 'coding-agent', 'dist');
  const codingAgentDir = join(dir, 'packages', 'coding-agent');
  mkdirSync(cliDir, { recursive: true });
  mkdirSync(codingAgentDir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fake-pi', version: '0.1.0', private: true }, null, 2));
  writeFileSync(join(codingAgentDir, 'package.json'), JSON.stringify({ name: '@fake/coding-agent', version: '0.1.0', private: true }, null, 2));
  writeFileSync(join(cliDir, options.defaultCli === false ? 'pi.js' : 'cli.js'), script, 'utf8');
  return dir;
}

function explicitConfig(piPath: string): PiAdapterConfig {
  return { piPath, command: 'node', args: ['bin/pi.js'] };
}

function runRequest(prompt: string, overrides: Omit<Partial<EngineRunRequest>, 'prompt'> = {}): EngineRunRequest {
  return { prompt, ...overrides };
}

describe('engine-pi', () => {
  it('runs fake adapter', async () => {
    const handle = await new FakeEngineAdapter().startRun(runRequest('hello'));
    const result = await handle.wait();
    expect(result.engineSessionRef).toContain('fake:');
    expect(result.failureClassification).toBeNull();
  });

  it('fake adapter emits events asynchronously', async () => {
    const receivedEvents: NormalizedEngineEvent[] = [];
    let handleReceived = false;

    const adapter = new FakeEngineAdapter();
    const handle = await adapter.startRun(runRequest('async-test'), {
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
    const result = await adapter.run(runRequest('run-test'));
    expect(result.events.map((e) => e.type)).toEqual(['started', 'session', 'message', 'completed', 'usage']);
    expect(result.engineSessionRef).toContain('fake:');
    expect(result.failureClassification).toBeNull();
    expect(result.usage.provider).toBe('fake');
  });

  it('fake adapter accepts structured run requests', async () => {
    const adapter = new FakeEngineAdapter();
    const cwd = mkdtempSync(join(tmpdir(), 'popeye-fake-engine-cwd-'));
    const result = await adapter.run({
      prompt: 'structured-run-test',
      workspaceId: 'default',
      projectId: 'proj-1',
      cwd,
      modelOverride: 'popeye/test-model',
      sessionPolicy: { type: 'dedicated', rootId: 'session-root-1' },
      instructionSnapshotId: 'bundle-1',
      trigger: { source: 'manual', timestamp: '2026-03-14T10:00:00.000Z' },
    });
    expect(result.events.map((e) => e.type)).toEqual(['started', 'session', 'message', 'completed', 'usage']);
    expect(result.events.find((event) => event.type === 'message')?.payload.text).toBe('echo:structured-run-test');
  });

  it('fake adapter transient_failure mode emits started then failed', async () => {
    const config: FakeEngineConfig = { mode: 'transient_failure' };
    const adapter = new FakeEngineAdapter(config);
    const result = await adapter.run(runRequest('fail-transient'));
    expect(result.failureClassification).toBe('transient_failure');
    expect(result.events.map((e) => e.type)).toEqual(['started', 'failed', 'usage']);
    expect(result.events[1]?.payload.classification).toBe('transient_failure');
    expect(result.usage.tokensOut).toBe(0);
  });

  it('fake adapter permanent_failure mode emits started then failed', async () => {
    const adapter = new FakeEngineAdapter({ mode: 'permanent_failure' });
    const result = await adapter.run(runRequest('fail-permanent'));
    expect(result.failureClassification).toBe('permanent_failure');
    expect(result.events.map((e) => e.type)).toEqual(['started', 'failed', 'usage']);
    expect(result.events[1]?.payload.classification).toBe('permanent_failure');
  });

  it('fake adapter timeout mode emits started but never completes', async () => {
    const adapter = new FakeEngineAdapter({ mode: 'timeout' });
    const receivedEvents: NormalizedEngineEvent[] = [];

    const handle = await adapter.startRun(runRequest('hang'), {
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

    const handle = await adapter.startRun(runRequest('bad-protocol'), {
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
    const result = await adapter.run(runRequest('delayed'));
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
    expect(status.repoVersion).toBe('0.1.0');
    expect(status.codingAgentVersion).toBe('0.1.0');
    expect(status.version).toBe('0.1.0');
  });

  it('prefers coding-agent version over repo-root version', () => {
    const piPath = createFakePiRepo('', { defaultCli: false });
    writeFileSync(join(piPath, 'package.json'), JSON.stringify({ name: 'fake-pi', version: '9.9.9', private: true }, null, 2));
    const status = inspectPiCheckout(piPath);
    expect(status.repoVersion).toBe('9.9.9');
    expect(status.codingAgentVersion).toBe('0.1.0');
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
    expect(result.message).toContain('coding-agent');
  });

  it('checkPiVersion returns not-ok when checkout missing', () => {
    const result = checkPiVersion('0.1.0', '/tmp/definitely-missing-pi');
    expect(result.ok).toBe(false);
    expect(result.message).toContain('not available');
  });

  it('defaults engine runtimeToolTimeoutMs to 30000', () => {
    const parsed = EngineConfigSchema.parse({ kind: 'pi' });
    expect(parsed.runtimeToolTimeoutMs).toBe(30_000);
  });

  it('defaults engine runtime-tool bridge fallback to enabled', () => {
    const parsed = EngineConfigSchema.parse({ kind: 'pi' });
    expect(parsed.allowRuntimeToolBridgeFallback).toBe(true);
  });

  it('reports host-tool capabilities as native_with_fallback or native based on config', () => {
    const piPath = createFakePiRepo('', { defaultCli: false });
    const compatAdapter = new PiEngineAdapter({ ...explicitConfig(piPath), allowRuntimeToolBridgeFallback: true });
    expect(compatAdapter.getCapabilities().hostToolMode).toBe('native_with_fallback');
    expect(compatAdapter.getCapabilities().warnings).toContain(
      'Pi runtime-tool bridge fallback is enabled for compatibility; disable it for higher-assurance deployments.',
    );

    const strictAdapter = new PiEngineAdapter({ ...explicitConfig(piPath), allowRuntimeToolBridgeFallback: false });
    expect(strictAdapter.getCapabilities().hostToolMode).toBe('native');
    expect(strictAdapter.getCapabilities().warnings).not.toContain(
      'Pi runtime-tool bridge fallback is enabled for compatibility; disable it for higher-assurance deployments.',
    );
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
    const result = await adapter.run(runRequest('hello'));

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
    const result = await adapter.run(runRequest('warn'));
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
    const result = await adapter.run(runRequest('clean'));
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
    const result = await adapter.run(runRequest('auth'));
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
    const result = await adapter.run(runRequest('hang-forever'));
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
    const handle = await adapter.startRun(runRequest('cancel-me'), {
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
    const result = await adapter.run(runRequest('ui'));
    expect(result.failureClassification).toBe('protocol_error');
    expect(result.events.find((event) => event.type === 'failed')?.payload.classification).toBe('protocol_error');
  });

  it('bridges host-owned runtime tools over Pi RPC editor requests', async () => {
    const piPath = createFakePiRepo(`
      let buffer = '';
      let sawExtensionFlag = process.argv.includes('--extension');
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
            write({ id: message.id, type: 'response', command: 'get_state', success: true, data: { sessionId: 'pi:tool-session', isStreaming: false } });
          }
          if (message.type === 'prompt') {
            write({ id: message.id, type: 'response', command: 'prompt', success: true });
            write({
              type: 'extension_ui_request',
              id: 'ui-1',
              method: 'editor',
              title: 'popeye.runtime_tool',
              prefill: JSON.stringify({
                op: 'runtime_tool_call',
                toolCallId: 'tc-1',
                tool: 'popeye_memory_search',
                params: { query: 'release notes' },
              }),
            });
          }
          if (message.type === 'extension_ui_response' && message.id === 'ui-1') {
            const response = JSON.parse(message.value);
            write({
              type: 'message_end',
              message: {
                role: 'assistant',
                provider: 'pi',
                model: 'stub',
                stopReason: 'stop',
                usage: { input: 2, output: 3, cost: { total: 0.01 } },
                content: [{ type: 'text', text: response.content[0].text + ' / extension=' + String(sawExtensionFlag) }],
              },
            });
            write({
              type: 'agent_end',
              messages: [{
                role: 'assistant',
                provider: 'pi',
                model: 'stub',
                stopReason: 'stop',
                usage: { input: 2, output: 3, cost: { total: 0.01 } },
                content: [{ type: 'text', text: response.content[0].text + ' / extension=' + String(sawExtensionFlag) }],
              }],
            });
          }
        }
      });
    `, { defaultCli: false });
    const adapter = new PiEngineAdapter(explicitConfig(piPath));
    const result = await adapter.run({
      prompt: 'tool-bridge',
      runtimeTools: [{
        name: 'popeye_memory_search',
        description: 'Search Popeye memory',
        inputSchema: {},
        async execute(params) {
          expect(params).toEqual({ query: 'release notes' });
          return {
            content: [{ type: 'text', text: 'memory result ready' }],
            details: { count: 1 },
          };
        },
      }],
    });

    expect(result.failureClassification).toBeNull();
    expect(result.warnings).toContain('Pi runtime-tool bridge fallback was used for this run.');
    expect(result.events.find((event) => event.type === 'message')?.payload.text).toContain('memory result ready');
    expect(result.events.find((event) => event.type === 'message')?.payload.text).toContain('extension=true');
    expect(result.events).toContainEqual(expect.objectContaining({
      type: 'tool_call',
      payload: expect.objectContaining({
        toolCallId: 'tc-1',
        toolName: 'popeye_memory_search',
        bridge: 'runtime_tool_bridge',
      }),
    }));
    expect(result.events).toContainEqual(expect.objectContaining({
      type: 'tool_result',
      payload: expect.objectContaining({
        toolCallId: 'tc-1',
        toolName: 'popeye_memory_search',
        bridge: 'runtime_tool_bridge',
        isError: false,
        contentItems: 1,
        detailsPresent: true,
      }),
    }));
  });

  it('fails fast when Pi native host-tool registration is unavailable and fallback is disabled', async () => {
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
            write({ id: message.id, type: 'response', command: 'get_state', success: true, data: { sessionId: 'pi:native-only', isStreaming: false } });
          }
          if (message.type === 'prompt') {
            write({ id: message.id, type: 'response', command: 'prompt', success: true });
            write({ type: 'agent_end', messages: [] });
          }
        }
      });
    `, { defaultCli: false });

    const adapter = new PiEngineAdapter({ ...explicitConfig(piPath), allowRuntimeToolBridgeFallback: false });
    const result = await adapter.run({
      prompt: 'native-only',
      runtimeTools: [{
        name: 'popeye_memory_search',
        description: 'Search Popeye memory',
        inputSchema: {},
        async execute() {
          return { content: [{ type: 'text', text: 'should not execute' }] };
        },
      }],
    });

    expect(result.failureClassification).toBe('policy_failure');
    expect(result.failureMessage).toBe('Pi native host-tool registration timed out and runtime-tool bridge fallback is disabled');
    expect(result.events.some((event) => event.type === 'started')).toBe(false);
    expect(result.events.find((event) => event.type === 'failed')?.payload.classification).toBe('policy_failure');
  });

  it('times out runtime-tool bridge calls and emits structured bridge diagnostics', async () => {
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
            write({ id: message.id, type: 'response', command: 'get_state', success: true, data: { sessionId: 'pi:tool-timeout', isStreaming: false } });
          }
          if (message.type === 'prompt') {
            write({ id: message.id, type: 'response', command: 'prompt', success: true });
            write({
              type: 'extension_ui_request',
              id: 'ui-1',
              method: 'editor',
              title: 'popeye.runtime_tool',
              prefill: JSON.stringify({
                op: 'runtime_tool_call',
                toolCallId: 'tc-timeout',
                tool: 'popeye_memory_search',
                params: { query: 'slow' },
              }),
            });
          }
          if (message.type === 'extension_ui_response' && message.id === 'ui-1') {
            const response = JSON.parse(message.value);
            write({
              type: 'agent_end',
              messages: [{
                role: 'assistant',
                provider: 'pi',
                model: 'stub',
                stopReason: 'stop',
                usage: { input: 1, output: 1, cost: { total: 0 } },
                content: [{ type: 'text', text: String(response.error) }],
              }],
            });
          }
        }
      });
    `, { defaultCli: false });

    const adapter = new PiEngineAdapter({ ...explicitConfig(piPath), runtimeToolTimeoutMs: 20 });
    const result = await adapter.run({
      prompt: 'tool-timeout',
      runtimeTools: [{
        name: 'popeye_memory_search',
        description: 'Search Popeye memory',
        inputSchema: {},
        async execute() {
          await new Promise((resolve) => setTimeout(resolve, 100));
          return { content: [{ type: 'text', text: 'late result' }] };
        },
      }],
    });

    expect(result.failureClassification).toBeNull();
    expect(result.events.find((event) => event.type === 'completed')?.payload.output).toContain(
      'Runtime tool popeye_memory_search timed out after 20ms',
    );
    expect(result.events).toContainEqual(expect.objectContaining({
      type: 'tool_call',
      payload: expect.objectContaining({
        toolCallId: 'tc-timeout',
        toolName: 'popeye_memory_search',
        bridge: 'runtime_tool_bridge',
      }),
    }));
    expect(result.events).toContainEqual(expect.objectContaining({
      type: 'tool_result',
      payload: expect.objectContaining({
        toolCallId: 'tc-timeout',
        toolName: 'popeye_memory_search',
        bridge: 'runtime_tool_bridge',
        isError: true,
        errorCode: 'timeout',
      }),
    }));
    expect(
      result.events.filter((event) => event.type === 'tool_result' && event.payload.toolCallId === 'tc-timeout'),
    ).toHaveLength(1);
    expect(result.warnings).toContain(
      'Runtime tool popeye_memory_search timed out after 20ms; underlying execution was not cancelled and any later settlement was suppressed.',
    );
  });

  it('captures late runtime-tool settlement warnings after a timeout when the run stays open', async () => {
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
            write({ id: message.id, type: 'response', command: 'get_state', success: true, data: { sessionId: 'pi:tool-timeout-late', isStreaming: false } });
          }
          if (message.type === 'prompt') {
            write({ id: message.id, type: 'response', command: 'prompt', success: true });
            write({
              type: 'extension_ui_request',
              id: 'ui-1',
              method: 'editor',
              title: 'popeye.runtime_tool',
              prefill: JSON.stringify({
                op: 'runtime_tool_call',
                toolCallId: 'tc-timeout-late',
                tool: 'popeye_memory_search',
                params: { query: 'slow-late' },
              }),
            });
          }
          if (message.type === 'extension_ui_response' && message.id === 'ui-1') {
            setTimeout(() => {
              const response = JSON.parse(message.value);
              write({
                type: 'agent_end',
                messages: [{
                  role: 'assistant',
                  provider: 'pi',
                  model: 'stub',
                  stopReason: 'stop',
                  usage: { input: 1, output: 1, cost: { total: 0 } },
                  content: [{ type: 'text', text: String(response.error) }],
                }],
              });
            }, 120);
          }
        }
      });
    `, { defaultCli: false });

    const adapter = new PiEngineAdapter({ ...explicitConfig(piPath), runtimeToolTimeoutMs: 20 });
    const result = await adapter.run({
      prompt: 'tool-timeout-late',
      runtimeTools: [{
        name: 'popeye_memory_search',
        description: 'Search Popeye memory',
        inputSchema: {},
        async execute() {
          await new Promise((resolve) => setTimeout(resolve, 60));
          return { content: [{ type: 'text', text: 'late result' }] };
        },
      }],
    });

    expect(result.failureClassification).toBeNull();
    expect(result.warnings).toContain(
      'Runtime tool popeye_memory_search timed out after 20ms; underlying execution was not cancelled and any later settlement was suppressed.',
    );
    expect(result.warnings).toContain(
      'Suppressed late runtime tool resolved after timeout: popeye_memory_search (tc-timeout-late)',
    );
  });

  it('returns structured bridge errors for malformed runtime-tool payloads', async () => {
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
            write({ id: message.id, type: 'response', command: 'get_state', success: true, data: { sessionId: 'pi:tool-malformed', isStreaming: false } });
          }
          if (message.type === 'prompt') {
            write({ id: message.id, type: 'response', command: 'prompt', success: true });
            write({ type: 'extension_ui_request', id: 'ui-1', method: 'editor', title: 'popeye.runtime_tool', prefill: '{"op":' });
          }
          if (message.type === 'extension_ui_response' && message.id === 'ui-1') {
            const response = JSON.parse(message.value);
            write({
              type: 'agent_end',
              messages: [{
                role: 'assistant',
                provider: 'pi',
                model: 'stub',
                stopReason: 'stop',
                usage: { input: 1, output: 1, cost: { total: 0 } },
                content: [{ type: 'text', text: String(response.error) }],
              }],
            });
          }
        }
      });
    `, { defaultCli: false });

    const adapter = new PiEngineAdapter(explicitConfig(piPath));
    const result = await adapter.run({
      prompt: 'tool-malformed',
      runtimeTools: [{
        name: 'popeye_memory_search',
        description: 'Search Popeye memory',
        inputSchema: {},
        async execute() {
          return { content: [{ type: 'text', text: 'should not run' }] };
        },
      }],
    });

    expect(result.failureClassification).toBeNull();
    expect(result.events.find((event) => event.type === 'completed')?.payload.output).toContain('Unexpected end of JSON input');
  });

  it('returns structured bridge errors when runtime tools throw', async () => {
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
            write({ id: message.id, type: 'response', command: 'get_state', success: true, data: { sessionId: 'pi:tool-throws', isStreaming: false } });
          }
          if (message.type === 'prompt') {
            write({ id: message.id, type: 'response', command: 'prompt', success: true });
            write({
              type: 'extension_ui_request',
              id: 'ui-1',
              method: 'editor',
              title: 'popeye.runtime_tool',
              prefill: JSON.stringify({ op: 'runtime_tool_call', toolCallId: 'tc-1', tool: 'popeye_memory_search', params: { query: 'boom' } }),
            });
          }
          if (message.type === 'extension_ui_response' && message.id === 'ui-1') {
            const response = JSON.parse(message.value);
            write({
              type: 'agent_end',
              messages: [{
                role: 'assistant',
                provider: 'pi',
                model: 'stub',
                stopReason: 'stop',
                usage: { input: 1, output: 1, cost: { total: 0 } },
                content: [{ type: 'text', text: String(response.error) }],
              }],
            });
          }
        }
      });
    `, { defaultCli: false });

    const adapter = new PiEngineAdapter(explicitConfig(piPath));
    const result = await adapter.run({
      prompt: 'tool-throws',
      runtimeTools: [{
        name: 'popeye_memory_search',
        description: 'Search Popeye memory',
        inputSchema: {},
        async execute() {
          throw new Error('runtime tool exploded');
        },
      }],
    });

    expect(result.failureClassification).toBeNull();
    expect(result.events.find((event) => event.type === 'completed')?.payload.output).toContain('runtime tool exploded');
  });

  it('supports multiple runtime-tool bridge calls in one run', async () => {
    const calls: unknown[] = [];
    const piPath = createFakePiRepo(`
      let buffer = '';
      let ui1Handled = false;
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
            write({ id: message.id, type: 'response', command: 'get_state', success: true, data: { sessionId: 'pi:tool-multi', isStreaming: false } });
          }
          if (message.type === 'prompt') {
            write({ id: message.id, type: 'response', command: 'prompt', success: true });
            write({
              type: 'extension_ui_request',
              id: 'ui-1',
              method: 'editor',
              title: 'popeye.runtime_tool',
              prefill: JSON.stringify({ op: 'runtime_tool_call', toolCallId: 'tc-1', tool: 'popeye_memory_search', params: { query: 'alpha' } }),
            });
          }
          if (message.type === 'extension_ui_response' && message.id === 'ui-1' && !ui1Handled) {
            ui1Handled = true;
            const response = JSON.parse(message.value);
            write({
              type: 'extension_ui_request',
              id: 'ui-2',
              method: 'editor',
              title: 'popeye.runtime_tool',
              prefill: JSON.stringify({ op: 'runtime_tool_call', toolCallId: 'tc-2', tool: 'popeye_memory_search', params: { query: response.content[0].text } }),
            });
          }
          if (message.type === 'extension_ui_response' && message.id === 'ui-2') {
            const response = JSON.parse(message.value);
            write({
              type: 'agent_end',
              messages: [{
                role: 'assistant',
                provider: 'pi',
                model: 'stub',
                stopReason: 'stop',
                usage: { input: 2, output: 2, cost: { total: 0 } },
                content: [{ type: 'text', text: response.content[0].text }],
              }],
            });
          }
        }
      });
    `, { defaultCli: false });

    const adapter = new PiEngineAdapter(explicitConfig(piPath));
    const result = await adapter.run({
      prompt: 'tool-multi',
      runtimeTools: [{
        name: 'popeye_memory_search',
        description: 'Search Popeye memory',
        inputSchema: {},
        async execute(params) {
          calls.push(params);
          const query = typeof (params as { query?: unknown }).query === 'string'
            ? (params as { query: string }).query
            : 'unknown';
          return { content: [{ type: 'text', text: `reply:${query}` }] };
        },
      }],
    });

    expect(result.failureClassification).toBeNull();
    expect(calls).toEqual([{ query: 'alpha' }, { query: 'reply:alpha' }]);
    expect(result.events.find((event) => event.type === 'completed')?.payload.output).toContain('reply:reply:alpha');
  });

  it('cancels cleanly while a runtime-tool bridge call is in flight', async () => {
    const piPath = createFakePiRepo(`
      let buffer = '';
      let aborted = false;
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
            write({ id: message.id, type: 'response', command: 'get_state', success: true, data: { sessionId: 'pi:tool-cancel', isStreaming: false } });
          }
          if (message.type === 'prompt') {
            write({ id: message.id, type: 'response', command: 'prompt', success: true });
            write({
              type: 'extension_ui_request',
              id: 'ui-1',
              method: 'editor',
              title: 'popeye.runtime_tool',
              prefill: JSON.stringify({ op: 'runtime_tool_call', toolCallId: 'tc-1', tool: 'popeye_memory_search', params: { query: 'slow' } }),
            });
          }
          if (message.type === 'abort' && !aborted) {
            aborted = true;
            write({ id: message.id, type: 'response', command: 'abort', success: true });
            write({
              type: 'message_end',
              message: {
                role: 'assistant',
                provider: 'pi',
                model: 'stub',
                stopReason: 'aborted',
                errorMessage: 'cancelled by abort',
                usage: { input: 1, output: 0, cost: { total: 0 } },
                content: [],
              },
            });
            write({
              type: 'agent_end',
              messages: [{
                role: 'assistant',
                provider: 'pi',
                model: 'stub',
                stopReason: 'aborted',
                errorMessage: 'cancelled by abort',
                usage: { input: 1, output: 0, cost: { total: 0 } },
                content: [],
              }],
            });
          }
        }
      });
    `, { defaultCli: false });

    const adapter = new PiEngineAdapter(explicitConfig(piPath));
    const handle = await adapter.startRun({
      prompt: 'tool-cancel',
      runtimeTools: [{
        name: 'popeye_memory_search',
        description: 'Search Popeye memory',
        inputSchema: {},
        async execute() {
          await new Promise((resolve) => setTimeout(resolve, 100));
          return { content: [{ type: 'text', text: 'late result' }] };
        },
      }],
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    await handle.cancel();
    const completion = await handle.wait();

    expect(completion.failureClassification).toBe('cancelled');
  });

  it('reports malformed runtime-tool payloads back through the workaround bridge', async () => {
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
            write({ id: message.id, type: 'response', command: 'get_state', success: true, data: { sessionId: 'pi:tool-malformed', isStreaming: false } });
          }
          if (message.type === 'prompt') {
            write({ id: message.id, type: 'response', command: 'prompt', success: true });
            write({
              type: 'extension_ui_request',
              id: 'ui-1',
              method: 'editor',
              title: 'popeye.runtime_tool',
              prefill: '{"tool":"broken"',
            });
          }
          if (message.type === 'extension_ui_response' && message.id === 'ui-1') {
            const response = JSON.parse(message.value);
            write({
              type: 'agent_end',
              messages: [{
                role: 'assistant',
                provider: 'pi',
                model: 'stub',
                stopReason: 'stop',
                usage: { input: 1, output: 1, cost: { total: 0 } },
                content: [{ type: 'text', text: 'bridge-error=' + String(typeof response.error === 'string') }],
              }],
            });
          }
        }
      });
    `, { defaultCli: false });

    const adapter = new PiEngineAdapter(explicitConfig(piPath));
    const result = await adapter.run({
      prompt: 'tool-malformed',
      runtimeTools: [{
        name: 'popeye_memory_search',
        description: 'Search Popeye memory',
        inputSchema: {},
        async execute() {
          return { content: [{ type: 'text', text: 'unused' }] };
        },
      }],
    });

    expect(result.failureClassification).toBeNull();
    expect(result.events.find((event) => event.type === 'completed')?.payload.output).toContain('bridge-error=true');
  });

  it('surfaces runtime-tool execution exceptions through the workaround bridge', async () => {
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
            write({ id: message.id, type: 'response', command: 'get_state', success: true, data: { sessionId: 'pi:tool-exception', isStreaming: false } });
          }
          if (message.type === 'prompt') {
            write({ id: message.id, type: 'response', command: 'prompt', success: true });
            write({
              type: 'extension_ui_request',
              id: 'ui-1',
              method: 'editor',
              title: 'popeye.runtime_tool',
              prefill: JSON.stringify({
                op: 'runtime_tool_call',
                toolCallId: 'tc-1',
                tool: 'popeye_memory_search',
                params: { query: 'release notes' },
              }),
            });
          }
          if (message.type === 'extension_ui_response' && message.id === 'ui-1') {
            const response = JSON.parse(message.value);
            write({
              type: 'agent_end',
              messages: [{
                role: 'assistant',
                provider: 'pi',
                model: 'stub',
                stopReason: 'stop',
                usage: { input: 1, output: 1, cost: { total: 0 } },
                content: [{ type: 'text', text: 'tool-error=' + response.error }],
              }],
            });
          }
        }
      });
    `, { defaultCli: false });

    const adapter = new PiEngineAdapter(explicitConfig(piPath));
    const result = await adapter.run({
      prompt: 'tool-exception',
      runtimeTools: [{
        name: 'popeye_memory_search',
        description: 'Search Popeye memory',
        inputSchema: {},
        async execute() {
          throw new Error('memory exploded');
        },
      }],
    });

    expect(result.failureClassification).toBeNull();
    expect(result.events.find((event) => event.type === 'completed')?.payload.output).toContain('tool-error=memory exploded');
  });

  it('marks the run cancelled when cancellation interrupts an in-flight runtime-tool bridge request', async () => {
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
            write({ id: message.id, type: 'response', command: 'get_state', success: true, data: { sessionId: 'pi:tool-cancel', isStreaming: false } });
          }
          if (message.type === 'prompt') {
            write({ id: message.id, type: 'response', command: 'prompt', success: true });
            write({
              type: 'extension_ui_request',
              id: 'ui-1',
              method: 'editor',
              title: 'popeye.runtime_tool',
              prefill: JSON.stringify({
                op: 'runtime_tool_call',
                toolCallId: 'tc-1',
                tool: 'popeye_memory_search',
                params: { query: 'release notes' },
              }),
            });
          }
          if (message.type === 'abort') {
            write({ id: message.id, type: 'response', command: 'abort', success: true });
            process.exit(0);
          }
        }
      });
    `, { defaultCli: false });

    const adapter = new PiEngineAdapter(explicitConfig(piPath));
    const events: NormalizedEngineEvent[] = [];
    let releaseTool: (() => void) | null = null;
    const executeStarted = new Promise<void>((resolve) => {
      releaseTool = resolve;
    });
    const handle = await adapter.startRun({
      prompt: 'tool-cancel',
      runtimeTools: [{
        name: 'popeye_memory_search',
        description: 'Search Popeye memory',
        inputSchema: {},
        async execute() {
          releaseTool?.();
          await new Promise((resolve) => setTimeout(resolve, 100));
          return { content: [{ type: 'text', text: 'late result' }] };
        },
      }],
    }, {
      onEvent: (event) => events.push(event),
    });

    await executeStarted;
    await handle.cancel();
    const completion = await handle.wait();

    expect(completion.failureClassification).toBe('cancelled');
    expect(events.find((event) => event.type === 'failed')?.payload.classification).toBe('cancelled');
  });

  it('supports multiple runtime-tool bridge calls in a single run', async () => {
    const piPath = createFakePiRepo(`
      let buffer = '';
      const toolResults = [];
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
            write({ id: message.id, type: 'response', command: 'get_state', success: true, data: { sessionId: 'pi:tool-multi', isStreaming: false } });
          }
          if (message.type === 'prompt') {
            write({ id: message.id, type: 'response', command: 'prompt', success: true });
            write({
              type: 'extension_ui_request',
              id: 'ui-1',
              method: 'editor',
              title: 'popeye.runtime_tool',
              prefill: JSON.stringify({
                op: 'runtime_tool_call',
                toolCallId: 'tc-1',
                tool: 'popeye_memory_search',
                params: { query: 'first' },
              }),
            });
          }
          if (message.type === 'extension_ui_response' && message.id === 'ui-1') {
            toolResults.push(JSON.parse(message.value).content[0].text);
            write({
              type: 'extension_ui_request',
              id: 'ui-2',
              method: 'editor',
              title: 'popeye.runtime_tool',
              prefill: JSON.stringify({
                op: 'runtime_tool_call',
                toolCallId: 'tc-2',
                tool: 'popeye_memory_search',
                params: { query: 'second' },
              }),
            });
          }
          if (message.type === 'extension_ui_response' && message.id === 'ui-2') {
            toolResults.push(JSON.parse(message.value).content[0].text);
            write({
              type: 'agent_end',
              messages: [{
                role: 'assistant',
                provider: 'pi',
                model: 'stub',
                stopReason: 'stop',
                usage: { input: 1, output: 1, cost: { total: 0 } },
                content: [{ type: 'text', text: toolResults.join('|') }],
              }],
            });
          }
        }
      });
    `, { defaultCli: false });
    const calls: string[] = [];
    const adapter = new PiEngineAdapter(explicitConfig(piPath));
    const result = await adapter.run({
      prompt: 'tool-multi',
      runtimeTools: [{
        name: 'popeye_memory_search',
        description: 'Search Popeye memory',
        inputSchema: {},
        async execute(params) {
          const query = typeof (params as { query?: unknown })?.query === 'string'
            ? (params as { query: string }).query
            : 'missing';
          calls.push(query);
          return { content: [{ type: 'text', text: query.toUpperCase() }] };
        },
      }],
    });

    expect(result.failureClassification).toBeNull();
    expect(calls).toEqual(['first', 'second']);
    expect(result.events.find((event) => event.type === 'completed')?.payload.output).toContain('FIRST|SECOND');
  });

  it('honors cwd and request modelOverride for Pi runs', async () => {
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
            write({ id: message.id, type: 'response', command: 'get_state', success: true, data: { sessionId: 'pi:cwd-model-session', isStreaming: false } });
          }
          if (message.type === 'prompt') {
            write({ id: message.id, type: 'response', command: 'prompt', success: true });
            const modelIndex = process.argv.findIndex((arg) => arg === '--model');
            const model = modelIndex >= 0 ? process.argv[modelIndex + 1] : 'missing';
            const payload = 'cwd=' + process.cwd() + ';model=' + model;
            write({
              type: 'agent_end',
              messages: [{
                role: 'assistant',
                provider: 'pi',
                model: 'stub',
                stopReason: 'stop',
                usage: { input: 1, output: 1, cost: { total: 0 } },
                content: [{ type: 'text', text: payload }],
              }],
            });
          }
        }
      });
    `, { defaultCli: false });
    const runCwd = mkdtempSync(join(tmpdir(), 'popeye-pi-run-cwd-'));
    const resolvedRunCwd = realpathSync(runCwd);
    const adapter = new PiEngineAdapter({
      piPath,
      command: 'node',
      args: ['bin/pi.js', '--model', 'config-model'],
    });
    const result = await adapter.run({
      prompt: 'cwd-model',
      cwd: runCwd,
      modelOverride: 'request-model',
    });

    expect(result.failureClassification).toBeNull();
    expect(result.events.find((event) => event.type === 'completed')?.payload.output).toContain(`cwd=${resolvedRunCwd}`);
    expect(result.events.find((event) => event.type === 'completed')?.payload.output).toContain('model=request-model');
  });

  it('rejects invalid structured cwd values before spawning Pi', async () => {
    const piPath = createFakePiRepo('', { defaultCli: false });
    const adapter = new PiEngineAdapter(explicitConfig(piPath));

    await expect(
      adapter.run({
        prompt: 'bad-cwd',
        cwd: 'relative/path',
      }),
    ).rejects.toThrow('absolute path');
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
    const result = await adapter.run(runRequest('bad-json'));
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
    const result = await adapter.run(runRequest('explicit'));
    expect(result.failureClassification).toBeNull();
    expect(result.engineSessionRef).toBe('pi:explicit-session');
    expect(result.usage.tokensIn).toBe(2);
  });

  describe('cleanStalePiTempDirs', () => {
    it('removes stale directories matching the prefix but preserves fresh ones', () => {
      // Create fake temp dirs and backdate their mtime to 2 hours ago
      const staleDir1 = mkdtempSync(join(tmpdir(), 'popeye-pi-extension-'));
      const staleDir2 = mkdtempSync(join(tmpdir(), 'popeye-pi-extension-'));
      const pastTime = new Date(Date.now() - 2 * 60 * 60 * 1000);
      utimesSync(staleDir1, pastTime, pastTime);
      utimesSync(staleDir2, pastTime, pastTime);

      // Create a fresh matching dir (should NOT be cleaned)
      const freshDir = mkdtempSync(join(tmpdir(), 'popeye-pi-extension-'));
      // Create a non-matching dir (should NOT be cleaned)
      const safeDir = mkdtempSync(join(tmpdir(), 'popeye-other-'));

      const cleaned = cleanStalePiTempDirs();
      expect(cleaned).toBeGreaterThanOrEqual(2);
      expect(existsSync(staleDir1)).toBe(false);
      expect(existsSync(staleDir2)).toBe(false);
      expect(existsSync(freshDir)).toBe(true);
      expect(existsSync(safeDir)).toBe(true);

      // Clean up
      rmSync(freshDir, { recursive: true, force: true });
      rmSync(safeDir, { recursive: true, force: true });
    });
  });
});
