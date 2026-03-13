import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

import type { AppConfig, EngineFailureClassification, NormalizedEngineEvent, UsageMetrics } from '@popeye/contracts';

export type { EngineFailureClassification } from '@popeye/contracts';

const ENGINE_EVENT_TYPES = new Set<NormalizedEngineEvent['type']>(['started', 'session', 'message', 'tool_call', 'tool_result', 'completed', 'failed', 'usage', 'compaction']);

export interface EngineRunHandle {
  pid: number | null;
  cancel(): Promise<void>;
  wait(): Promise<EngineRunCompletion>;
  isAlive?(): boolean;
}

export interface EngineRunOptions {
  onEvent?: (event: NormalizedEngineEvent) => void;
  onHandle?: (handle: EngineRunHandle) => void;
}

export interface EngineRunResult {
  events: NormalizedEngineEvent[];
  engineSessionRef: string | null;
  usage: UsageMetrics;
  failureClassification: EngineFailureClassification | null;
  failureMessage?: string;
  warnings?: string;
}

export interface EngineRunCompletion {
  engineSessionRef: string | null;
  usage: UsageMetrics;
  failureClassification: EngineFailureClassification | null;
  warnings?: string;
}

export interface EngineExecution {
  pid: number | null;
  handle: EngineRunHandle;
  completed: Promise<EngineRunCompletion>;
}

export interface EngineAdapter {
  startRun(input: string, options?: EngineRunOptions): Promise<EngineRunHandle>;
  run(input: string, options?: EngineRunOptions): Promise<EngineRunResult>;
}

export interface PiAdapterConfig {
  piPath?: string;
  piVersion?: string;
  command?: string;
  args?: string[];
  timeoutMs?: number;
}

export interface PiCheckoutStatus {
  path: string;
  available: boolean;
  packageJsonPath: string;
  version: string | null;
}

export interface PiChildRequest {
  prompt: string;
}

export interface PiChildEvent {
  type: string;
  payload?: Record<string, unknown>;
}

export interface PiCompatibilityResult {
  ok: boolean;
  eventTypes: string[];
  eventsObserved: number;
  engineSessionRef: string | null;
}

export class PiEngineAdapterNotConfiguredError extends Error {
  constructor(message = 'Pi engine adapter is not configured in this repository yet') {
    super(message);
  }
}

export function resolvePiCheckoutPath(piPath?: string): string {
  return resolve(piPath ?? '../pi');
}

export function inspectPiCheckout(piPath?: string): PiCheckoutStatus {
  const path = resolvePiCheckoutPath(piPath);
  const packageJsonPath = resolve(path, 'package.json');
  const available = existsSync(path) && existsSync(packageJsonPath);
  let version: string | null = null;
  if (available) {
    try {
      const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as Record<string, unknown>;
      if (typeof pkg.version === 'string') {
        version = pkg.version;
      }
    } catch {
      // version stays null if package.json is unreadable
    }
  }
  return {
    path,
    available,
    packageJsonPath,
    version,
  };
}

export interface PiVersionCheckResult {
  ok: boolean;
  message: string;
  expected?: string;
  actual?: string | null;
}

export function checkPiVersion(expected?: string, piPath?: string): PiVersionCheckResult {
  if (!expected) {
    return { ok: true, message: 'No expected version specified — skipping version check' };
  }
  const status = inspectPiCheckout(piPath);
  if (!status.available) {
    return { ok: false, message: `Pi checkout not available at ${status.path}`, expected, actual: null };
  }
  if (status.version === expected) {
    return { ok: true, message: `Pi version matches: ${expected}`, expected, actual: status.version };
  }
  return {
    ok: false,
    message: `Pi version mismatch — expected ${expected}, found ${status.version ?? 'unknown'}`,
    expected,
    actual: status.version,
  };
}

export function assertPiCheckoutAvailable(piPath?: string): PiCheckoutStatus {
  const status = inspectPiCheckout(piPath);
  if (!status.available) {
    throw new PiEngineAdapterNotConfiguredError(
      `Expected Pi checkout at ${status.path} with package.json present at ${status.packageJsonPath}`,
    );
  }
  return status;
}

class ProcessHandle implements EngineRunHandle {
  readonly pid: number | null;

  constructor(
    private readonly child: ReturnType<typeof spawn>,
    private readonly completionPromise: Promise<EngineRunCompletion>,
  ) {
    this.pid = child.pid ?? null;
  }

  async cancel(): Promise<void> {
    this.child.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      const graceTimer = setTimeout(() => {
        if (this.child.exitCode === null) {
          this.child.kill('SIGKILL');
        }
        resolve();
      }, 5000);
      this.child.on('exit', () => {
        clearTimeout(graceTimer);
        resolve();
      });
    });
  }

  async wait(): Promise<EngineRunCompletion> {
    return this.completionPromise;
  }

  isAlive(): boolean {
    const pid = this.child.pid;
    if (!pid) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }
}

function emitEvent(events: NormalizedEngineEvent[], event: NormalizedEngineEvent, onEvent?: (event: NormalizedEngineEvent) => void): void {
  events.push(event);
  onEvent?.(event);
}

function parseEventLine(line: string): PiChildEvent {
  const parsed = JSON.parse(line) as PiChildEvent;
  if (!parsed || typeof parsed !== 'object' || typeof parsed.type !== 'string') {
    throw new Error('child event missing string type');
  }
  return parsed;
}

function normalizeEvent(line: string): NormalizedEngineEvent {
  const parsed = parseEventLine(line);
  if (!ENGINE_EVENT_TYPES.has(parsed.type as NormalizedEngineEvent['type'])) {
    throw new Error(`unsupported event type: ${parsed.type}`);
  }
  const payloadEntries = Object.entries(parsed.payload ?? {}).map(([key, value]) => {
    // Preserve primitive types (string, number, boolean, null).
    // Stringify objects/arrays since the schema only allows primitives.
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return [key, value];
    }
    return [key, JSON.stringify(value)];
  });
  return {
    type: parsed.type as NormalizedEngineEvent['type'],
    payload: Object.fromEntries(payloadEntries),
    raw: line,
  };
}

function defaultUsage(provider: string, model: string, _input: string): UsageMetrics {
  return {
    provider,
    model,
    // Fallback when engine doesn't emit usage — zero is honest since we
    // don't know the real token count. input.length is not a valid proxy.
    tokensIn: 0,
    tokensOut: 0,
    estimatedCostUsd: 0,
  };
}

export interface FakeEngineConfig {
  mode?: 'success' | 'transient_failure' | 'permanent_failure' | 'timeout' | 'protocol_error';
  delayMs?: number;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asyncTick(): Promise<void> {
  return new Promise((resolve) => queueMicrotask(resolve));
}

export class FakeEngineAdapter implements EngineAdapter {
  private readonly config: Required<FakeEngineConfig>;

  constructor(config: FakeEngineConfig = {}) {
    this.config = {
      mode: config.mode ?? 'success',
      delayMs: config.delayMs ?? 0,
    };
  }

  async startRun(input: string, options: EngineRunOptions = {}): Promise<EngineRunHandle> {
    const sessionRef = `fake:${randomUUID()}`;
    const usage: UsageMetrics = {
      provider: 'fake',
      model: 'fake-engine',
      tokensIn: input.length,
      tokensOut: input.length,
      estimatedCostUsd: 0,
    };

    let cancelled = false;
    let completionResolve: ((value: EngineRunCompletion) => void) | undefined;
    const completionPromise = new Promise<EngineRunCompletion>((resolve) => {
      completionResolve = resolve;
    });

    const emitAsync = async (event: NormalizedEngineEvent): Promise<void> => {
      await asyncTick();
      if (this.config.delayMs > 0) await delay(this.config.delayMs);
      options.onEvent?.(event);
    };

    const handle: EngineRunHandle = {
      pid: null,
      cancel: async () => {
        cancelled = true;
      },
      wait: () => completionPromise,
      isAlive: () => !cancelled && completionResolve !== undefined,
    };

    options.onHandle?.(handle);

    // Schedule async event emission
    const runEvents = async (): Promise<void> => {
      const { mode } = this.config;

      await emitAsync({ type: 'started', payload: { input } });

      if (mode === 'timeout') {
        // Never complete — for timeout testing. The promise stays pending.
        return;
      }

      if (mode === 'protocol_error') {
        // Emit a malformed event (type not in valid set)
        await asyncTick();
        if (this.config.delayMs > 0) await delay(this.config.delayMs);
        options.onEvent?.({ type: 'started' as NormalizedEngineEvent['type'], payload: { '': undefined as unknown as string } });
        completionResolve?.({
          engineSessionRef: sessionRef,
          usage,
          failureClassification: 'protocol_error',
        });
        return;
      }

      if (mode === 'transient_failure' || mode === 'permanent_failure') {
        const classification: EngineFailureClassification = mode;
        await emitAsync({ type: 'failed', payload: { classification } });
        await emitAsync({
          type: 'usage',
          payload: {
            provider: usage.provider,
            model: usage.model,
            tokensIn: usage.tokensIn,
            tokensOut: 0,
            estimatedCostUsd: usage.estimatedCostUsd,
          },
        });
        completionResolve?.({
          engineSessionRef: sessionRef,
          usage: { ...usage, tokensOut: 0 },
          failureClassification: classification,
        });
        return;
      }

      // success mode (default)
      await emitAsync({ type: 'session', payload: { sessionRef } });
      await emitAsync({ type: 'message', payload: { text: `echo:${input}` } });
      await emitAsync({ type: 'completed', payload: { output: `echo:${input}` } });
      await emitAsync({
        type: 'usage',
        payload: {
          provider: usage.provider,
          model: usage.model,
          tokensIn: usage.tokensIn,
          tokensOut: usage.tokensOut,
          estimatedCostUsd: usage.estimatedCostUsd,
        },
      });
      completionResolve?.({
        engineSessionRef: sessionRef,
        usage,
        failureClassification: null,
      });
    };

    // Fire event sequence asynchronously (don't await here — caller gets handle immediately)
    void runEvents();

    return handle;
  }

  async run(input: string, options: EngineRunOptions = {}): Promise<EngineRunResult> {
    const events: NormalizedEngineEvent[] = [];
    const handle = await this.startRun(input, {
      ...options,
      onEvent: (event) => {
        events.push(event);
        options.onEvent?.(event);
      },
    });
    const completion = await handle.wait();
    return {
      events,
      engineSessionRef: completion.engineSessionRef ?? events.find((event) => event.type === 'session')?.payload.sessionRef ?? null,
      usage: completion.usage,
      failureClassification: completion.failureClassification,
    };
  }
}


export class FailingFakeEngineAdapter implements EngineAdapter {
  private readonly failureClassification: EngineFailureClassification;

  constructor(failureClassification: EngineFailureClassification) {
    this.failureClassification = failureClassification;
  }

  async startRun(input: string, options: EngineRunOptions = {}): Promise<EngineRunHandle> {
    const completion: EngineRunCompletion = {
      engineSessionRef: `fake:${randomUUID()}`,
      usage: {
        provider: 'fake',
        model: 'fake-engine',
        tokensIn: input.length,
        tokensOut: 0,
        estimatedCostUsd: 0,
      },
      failureClassification: this.failureClassification,
    };
    const handle: EngineRunHandle = {
      pid: null,
      cancel: async () => Promise.resolve(),
      wait: async () => completion,
      isAlive: () => false,
    };
    options.onHandle?.(handle);
    options.onEvent?.({ type: 'started', payload: { input } });
    options.onEvent?.({ type: 'failed', payload: { classification: this.failureClassification } });
    options.onEvent?.({
      type: 'usage',
      payload: {
        provider: completion.usage.provider,
        model: completion.usage.model,
        tokensIn: completion.usage.tokensIn,
        tokensOut: completion.usage.tokensOut,
        estimatedCostUsd: completion.usage.estimatedCostUsd,
      },
    });
    return handle;
  }

  async run(input: string, options: EngineRunOptions = {}): Promise<EngineRunResult> {
    const events: NormalizedEngineEvent[] = [];
    const handle = await this.startRun(input, {
      ...options,
      onEvent: (event) => {
        events.push(event);
        options.onEvent?.(event);
      },
    });
    const completion = await handle.wait();
    return {
      events,
      engineSessionRef: completion.engineSessionRef ?? events.find((event) => event.type === 'session')?.payload.sessionRef ?? null,
      usage: completion.usage,
      failureClassification: completion.failureClassification,
    };
  }
}

export class PiEngineAdapter implements EngineAdapter {
  private readonly piPath: string;
  private readonly command: string;
  private readonly args: string[];
  private readonly timeoutMs: number | undefined;

  constructor(config: PiAdapterConfig = {}) {
    const status = assertPiCheckoutAvailable(config.piPath);
    this.piPath = status.path;
    this.command = config.command ?? 'node';
    this.args = config.args ?? [];
    this.timeoutMs = config.timeoutMs;
    if (config.piVersion) {
      const versionCheck = checkPiVersion(config.piVersion, config.piPath);
      if (!versionCheck.ok) {
        console.warn(`[engine-pi] ${versionCheck.message}`);
      }
    }
  }

  async startRun(input: string, options: EngineRunOptions = {}): Promise<EngineRunHandle> {
    // Security: this.command comes from operator-owned config, validated by Zod at startup,
    // stored in a 0o700 directory. Adding a safelist would break custom deployments.
    // Sanitize env to avoid leaking parent process secrets to the child.
    const child = spawn(this.command, this.args, {
      cwd: this.piPath,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        NODE_ENV: process.env.NODE_ENV,
        TERM: process.env.TERM,
      },
    });
    const events: NormalizedEngineEvent[] = [];
    let stdoutBuffer = '';
    let stderr = '';
    let engineSessionRef: string | null = null;
    let failureClassification: EngineFailureClassification | null = null;
    let failureMessage: string | undefined;
    let usage = defaultUsage('pi', 'external-pi', input);

    const safeEmit = (event: NormalizedEngineEvent) => emitEvent(events, event, options.onEvent);
    const failProtocol = (line: string, error: Error) => {
      failureClassification = 'protocol_error';
      failureMessage = error.message;
      safeEmit({ type: 'failed', payload: { classification: 'protocol_error', message: error.message }, raw: line });
    };

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() ?? '';
      for (const rawLine of lines.map((line) => line.trim()).filter(Boolean)) {
        try {
          const event = normalizeEvent(rawLine);
          if (event.type === 'session') {
            const ref = event.payload.engineSessionRef ?? event.payload.sessionId ?? event.payload.sessionRef;
            if (typeof ref === 'string') engineSessionRef = ref;
          }
          if (event.type === 'usage') {
            usage = {
              provider: String(event.payload.provider ?? usage.provider),
              model: String(event.payload.model ?? usage.model),
              tokensIn: Number(event.payload.tokensIn ?? usage.tokensIn),
              tokensOut: Number(event.payload.tokensOut ?? usage.tokensOut),
              estimatedCostUsd: Number(event.payload.estimatedCostUsd ?? usage.estimatedCostUsd),
            };
          }
          if (event.type === 'failed') {
            failureClassification = (event.payload.classification as EngineFailureClassification | undefined) ?? 'permanent_failure';
            if (typeof event.payload.message === 'string') failureMessage = event.payload.message;
          }
          safeEmit(event);
        } catch (error) {
          failProtocol(rawLine, error instanceof Error ? error : new Error(String(error)));
        }
      }
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });

    child.stdin.write(`${JSON.stringify({ prompt: input } satisfies PiChildRequest)}\n`);
    child.stdin.end();

    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    let graceTimer: ReturnType<typeof setTimeout> | undefined;

    if (this.timeoutMs != null) {
      const gracePeriodMs = 5_000;
      timeoutTimer = setTimeout(() => {
        if (child.exitCode === null) {
          failureClassification = 'transient_failure';
          failureMessage = 'engine timeout exceeded';
          safeEmit({ type: 'failed', payload: { classification: 'transient_failure', message: 'engine timeout exceeded' } });
          child.kill('SIGTERM');
          graceTimer = setTimeout(() => {
            if (child.exitCode === null) {
              child.kill('SIGKILL');
            }
          }, gracePeriodMs);
        }
      }, this.timeoutMs);
    }

    const completionPromise = new Promise<EngineRunCompletion>((resolveCompletion, rejectCompletion) => {
      child.on('error', rejectCompletion);
      child.on('close', (code) => {
        if (timeoutTimer != null) clearTimeout(timeoutTimer);
        if (graceTimer != null) clearTimeout(graceTimer);

        const exitCode = code ?? 0;

        if (stdoutBuffer.trim().length > 0) {
          try {
            const event = normalizeEvent(stdoutBuffer.trim());
            safeEmit(event);
          } catch (error) {
            failProtocol(stdoutBuffer.trim(), error instanceof Error ? error : new Error(String(error)));
          }
        }

        if (exitCode !== 0 && failureClassification === null) {
          failureClassification = events.some((event) => event.type === 'started') ? 'permanent_failure' : 'startup_failure';
          failureMessage = stderr || `Pi process failed with code ${exitCode}`;
          safeEmit({ type: 'failed', payload: { classification: failureClassification, message: failureMessage, exitCode } });
        }

        if (!events.some((event) => event.type === 'usage')) {
          safeEmit({ type: 'usage', payload: { provider: usage.provider, model: usage.model, tokensIn: usage.tokensIn, tokensOut: usage.tokensOut, estimatedCostUsd: usage.estimatedCostUsd } });
        }

        if (!events.some((event) => event.type === 'completed') && failureClassification === null) {
          safeEmit({ type: 'completed', payload: { output: '' } });
        }

        const warnings = stderr.trim() || undefined;

        resolveCompletion({
          engineSessionRef,
          usage,
          failureClassification,
          warnings,
        });
      });
    });

    const handle = new ProcessHandle(child, completionPromise);
    options.onHandle?.(handle);
    return handle;
  }

  async run(input: string, options: EngineRunOptions = {}): Promise<EngineRunResult> {
    const events: NormalizedEngineEvent[] = [];
    let failureMessage: string | undefined;
    const handle = await this.startRun(input, {
      ...options,
      onEvent: (event) => {
        events.push(event);
        if (event.type === 'failed' && typeof event.payload.message === 'string') {
          failureMessage = event.payload.message;
        }
        options.onEvent?.(event);
      },
    });
    const completion = await handle.wait();
    const sessionEvent = events.find((event) => event.type === 'session');
    const sessionRef = sessionEvent?.payload.engineSessionRef ?? sessionEvent?.payload.sessionId ?? sessionEvent?.payload.sessionRef;
    return {
      events,
      engineSessionRef: completion.engineSessionRef ?? (typeof sessionRef === 'string' ? sessionRef : null),
      usage: completion.usage,
      failureClassification: completion.failureClassification,
      failureMessage,
      warnings: completion.warnings,
    };
  }
}

export async function runPiCompatibilityCheck(adapterOrConfig: EngineAdapter | PiAdapterConfig, prompt = 'compatibility-check'): Promise<PiCompatibilityResult> {
  const adapter = 'startRun' in adapterOrConfig ? adapterOrConfig : new PiEngineAdapter(adapterOrConfig);
  const result = await adapter.run(prompt);
  return {
    ok: result.failureClassification === null && Boolean(result.engineSessionRef),
    eventTypes: result.events.map((event) => event.type),
    eventsObserved: result.events.length,
    engineSessionRef: result.engineSessionRef,
  };
}

export function createEngineAdapter(config: AppConfig): EngineAdapter {
  if (config.engine.kind === 'pi') {
    assertPiCheckoutAvailable(config.engine.piPath);
    return new PiEngineAdapter({ piPath: config.engine.piPath, piVersion: config.engine.piVersion, command: config.engine.command, args: config.engine.args });
  }
  return new FakeEngineAdapter();
}
