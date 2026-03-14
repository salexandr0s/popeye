import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  type AppConfig,
  NormalizedEngineEventSchema,
  type EngineFailureClassification,
  type NormalizedEngineEvent,
  type UsageMetrics,
} from '@popeye/contracts';
import { z } from 'zod';

export type { EngineFailureClassification } from '@popeye/contracts';

const DEFAULT_PI_CLI_PATH = 'packages/coding-agent/dist/cli.js';
const MAX_STDERR_BYTES = 1_048_576;
const MAX_STDOUT_BUFFER_BYTES = 1_048_576;
const MAX_EVENTS = 10_000;
const CANCEL_GRACE_MS = 5_000;
const INTERNAL_IDS = {
  getState: 'popeye:get_state',
  prompt: 'popeye:prompt',
  abort: 'popeye:abort',
} as const;
const PASSIVE_EXTENSION_UI_METHODS = new Set(['notify', 'setStatus', 'setWidget', 'setTitle', 'set_editor_text']);

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
  failureMessage?: string | undefined;
  warnings?: string | undefined;
}

export interface EngineRunCompletion {
  engineSessionRef: string | null;
  usage: UsageMetrics;
  failureClassification: EngineFailureClassification | null;
  warnings?: string | undefined;
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

export interface PiCompatibilityResult {
  ok: boolean;
  eventTypes: string[];
  eventsObserved: number;
  engineSessionRef: string | null;
}

interface PrimitiveRecord {
  [key: string]: string | number | boolean | null;
}

interface RpcResponse {
  id?: string | undefined;
  type: 'response';
  command: string;
  success: boolean;
  data?: unknown;
  error?: string | undefined;
}

interface RpcStateData {
  sessionId: string;
  sessionFile?: string | undefined;
  isStreaming?: boolean;
}

interface PiMessage {
  role?: string;
  provider?: string;
  model?: string;
  stopReason?: string;
  errorMessage?: string;
  usage?: {
    input?: number;
    output?: number;
    cost?: {
      total?: number;
    };
  };
  content?: unknown;
}

interface AgentEventBase {
  type: string;
}

interface PromptState {
  requested: boolean;
  accepted: boolean;
  completed: boolean;
}

const PackageVersionSchema = z.object({
  version: z.string().optional(),
}).passthrough();

const RpcResponseSchema = z.object({
  id: z.string().optional(),
  type: z.literal('response'),
  command: z.string(),
  success: z.boolean(),
  data: z.unknown().optional(),
  error: z.string().optional(),
}).passthrough();

const RpcStateDataSchema = z.object({
  sessionId: z.string(),
  sessionFile: z.string().optional(),
  isStreaming: z.boolean().optional(),
}).passthrough();

const RpcExtensionUiRequestSchema = z.object({
  type: z.literal('extension_ui_request'),
  id: z.string(),
  method: z.string(),
}).passthrough();

const RpcExtensionErrorSchema = z.object({
  type: z.literal('extension_error'),
  error: z.string(),
  event: z.string().optional(),
  extensionPath: z.string().optional(),
}).passthrough();

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
      const pkg = PackageVersionSchema.parse(JSON.parse(readFileSync(packageJsonPath, 'utf8')));
      version = pkg.version ?? null;
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
    private readonly onCancel?: () => void | Promise<void>,
  ) {
    this.pid = child.pid ?? null;
  }

  async cancel(): Promise<void> {
    await this.onCancel?.();
    if (this.child.exitCode === null) {
      this.child.kill('SIGTERM');
    }
    await new Promise<void>((resolve) => {
      const graceTimer = setTimeout(() => {
        if (this.child.exitCode === null) {
          this.child.kill('SIGKILL');
        }
        resolve();
      }, CANCEL_GRACE_MS);
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
  if (events.length < MAX_EVENTS) {
    events.push(event);
  }
  onEvent?.(event);
}

function defaultUsage(provider: string, model: string): UsageMetrics {
  return {
    provider,
    model,
    tokensIn: 0,
    tokensOut: 0,
    estimatedCostUsd: 0,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function coercePrimitive(value: unknown): string | number | boolean | null {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  return JSON.stringify(value);
}

function primitivePayload(input: Record<string, unknown>): PrimitiveRecord {
  return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, coercePrimitive(value)]));
}

function normalizeStructuredEvent(type: NormalizedEngineEvent['type'], payload: Record<string, unknown>, raw?: string): NormalizedEngineEvent {
  return NormalizedEngineEventSchema.parse({
    type,
    payload: primitivePayload(payload),
    raw,
  });
}

function serializeRpcCommand(command: Record<string, unknown>): string {
  return `${JSON.stringify(command)}\n`;
}

function splitJsonlBuffer(buffer: string): { lines: string[]; remainder: string } {
  const lines: string[] = [];
  let remainder = buffer;
  while (true) {
    const newlineIndex = remainder.indexOf('\n');
    if (newlineIndex === -1) break;
    let line = remainder.slice(0, newlineIndex);
    remainder = remainder.slice(newlineIndex + 1);
    if (line.endsWith('\r')) {
      line = line.slice(0, -1);
    }
    if (line.trim().length > 0) {
      lines.push(line);
    }
  }
  return { lines, remainder };
}

function flattenTextContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const textParts: string[] = [];
  const toolCalls: string[] = [];
  for (const item of content) {
    if (!isRecord(item)) continue;
    if (typeof item.text === 'string') {
      textParts.push(item.text);
      continue;
    }
    if (item.type === 'toolCall' && typeof item.name === 'string') {
      toolCalls.push(item.name);
    }
  }
  if (textParts.length > 0) return textParts.join('');
  if (toolCalls.length > 0) return `[tool calls: ${toolCalls.join(', ')}]`;
  return '';
}

function parseUsageFromMessage(message: PiMessage | undefined): UsageMetrics | null {
  if (!message || message.role !== 'assistant' || !message.usage) return null;
  return {
    provider: typeof message.provider === 'string' && message.provider.length > 0 ? message.provider : 'pi',
    model: typeof message.model === 'string' && message.model.length > 0 ? message.model : 'unknown',
    tokensIn: Number.isFinite(message.usage.input) ? Math.max(0, Math.trunc(message.usage.input ?? 0)) : 0,
    tokensOut: Number.isFinite(message.usage.output) ? Math.max(0, Math.trunc(message.usage.output ?? 0)) : 0,
    estimatedCostUsd: Number.isFinite(message.usage.cost?.total) ? Math.max(0, Number(message.usage.cost?.total ?? 0)) : 0,
  };
}

function parseMessage(value: unknown): PiMessage | undefined {
  return isRecord(value) ? value as PiMessage : undefined;
}

function classifyFailure(message: string | undefined, started: boolean): EngineFailureClassification {
  const text = (message ?? '').toLowerCase();
  if (text.includes('api key') || text.includes('oauth') || text.includes('unauthorized') || text.includes('forbidden') || text.includes('authentication') || text.includes('invalid x-api-key')) {
    return 'auth_failure';
  }
  if (text.includes('policy') || text.includes('approval') || text.includes('protected path') || text.includes('not allowed') || text.includes('permission denied')) {
    return 'policy_failure';
  }
  if (text.includes('aborted') || text.includes('cancelled') || text.includes('canceled')) {
    return 'cancelled';
  }
  if (text.includes('rate limit') || text.includes('temporar') || text.includes('timeout') || text.includes('timed out') || text.includes('network')) {
    return 'transient_failure';
  }
  return started ? 'permanent_failure' : 'startup_failure';
}

function buildPiCommand(piPath: string, command: string, args: string[]): { command: string; args: string[] } {
  const baseArgs = stripModeArgs(resolveBaseArgs(piPath, command, args));
  return {
    command,
    args: [...baseArgs, '--mode', 'rpc'],
  };
}

function resolveBaseArgs(piPath: string, command: string, args: string[]): string[] {
  if (command !== 'node') {
    return args;
  }
  if (args.length === 0) {
    return inferDefaultNodePiArgs(piPath);
  }
  const firstArg = args[0];
  if (firstArg === undefined || firstArg.startsWith('-')) {
    return [...inferDefaultNodePiArgs(piPath), ...args];
  }
  return args;
}

function inferDefaultNodePiArgs(piPath: string): string[] {
  const defaultCliPath = resolve(piPath, DEFAULT_PI_CLI_PATH);
  if (!existsSync(defaultCliPath)) {
    throw new PiEngineAdapterNotConfiguredError(
      `Could not find built Pi CLI at ${defaultCliPath}. Build Pi or set engine.args explicitly.`,
    );
  }
  return [DEFAULT_PI_CLI_PATH];
}

function stripModeArgs(args: string[]): string[] {
  const sanitized: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) continue;
    if (arg === '--mode') {
      index += 1;
      continue;
    }
    sanitized.push(arg);
  }
  return sanitized;
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

    const runEvents = async (): Promise<void> => {
      const { mode } = this.config;

      await emitAsync({ type: 'started', payload: { input } });

      if (mode === 'timeout') {
        return;
      }

      if (mode === 'protocol_error') {
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
    const launch = buildPiCommand(this.piPath, this.command, this.args);
    const child = spawn(launch.command, launch.args, {
      cwd: this.piPath,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    const events: NormalizedEngineEvent[] = [];
    let stdoutBuffer = '';
    let stderr = '';
    let engineSessionRef: string | null = null;
    let usage = defaultUsage('pi', 'unknown');
    let failureClassification: EngineFailureClassification | null = null;
    let failureMessage: string | undefined;
    let lastAssistantText = '';
    let timedOut = false;
    let shutdownRequested = false;
    let closeResolved = false;
    let usageEmitted = false;
    let completedEmitted = false;
    let failedEmitted = false;
    let startedEmitted = false;
    let sessionEmitted = false;
    let cancelRequested = false;
    const promptState: PromptState = { requested: false, accepted: false, completed: false };

    const safeEmit = (event: NormalizedEngineEvent): void => {
      if (event.type === 'usage') usageEmitted = true;
      if (event.type === 'completed') completedEmitted = true;
      if (event.type === 'failed') failedEmitted = true;
      if (event.type === 'started') startedEmitted = true;
      if (event.type === 'session') sessionEmitted = true;
      emitEvent(events, event, options.onEvent);
    };

    const markFailure = (classification: EngineFailureClassification, message?: string, raw?: string): void => {
      if (failureClassification === null || failureClassification === 'cancelled') {
        failureClassification = classification;
      }
      if (message) failureMessage = message;
      if (!failedEmitted) {
        safeEmit(normalizeStructuredEvent('failed', { classification, message: message ?? '' }, raw));
      }
    };

    const synthesizeSession = (state: RpcStateData, raw?: string): void => {
      engineSessionRef = state.sessionId;
      if (!sessionEmitted) {
        safeEmit(normalizeStructuredEvent('session', {
          sessionRef: state.sessionId,
          sessionFile: state.sessionFile ?? null,
        }, raw));
      }
    };

    const captureUsage = (candidate: UsageMetrics | null): void => {
      if (!candidate) return;
      usage = candidate;
    };

    const requestShutdown = (signal: 'SIGTERM' | 'SIGKILL' = 'SIGTERM'): void => {
      if (shutdownRequested || child.exitCode !== null) return;
      shutdownRequested = true;
      child.kill(signal);
    };

    const sendCommand = (command: Record<string, unknown>): void => {
      if (child.stdin.destroyed) return;
      child.stdin.write(serializeRpcCommand(command));
    };

    const handleResponse = (response: RpcResponse, rawLine: string): void => {
      if (response.id === INTERNAL_IDS.getState && response.command === 'get_state') {
        if (!response.success) {
          const classification = classifyFailure(response.error, startedEmitted || promptState.accepted);
          markFailure(classification, response.error ?? 'get_state failed', rawLine);
          requestShutdown();
          return;
        }
        const state = RpcStateDataSchema.parse(response.data) as RpcStateData;
        synthesizeSession(state, rawLine);
        if (!promptState.requested) {
          promptState.requested = true;
          sendCommand({ id: INTERNAL_IDS.prompt, type: 'prompt', message: input });
        }
        return;
      }

      if (response.id === INTERNAL_IDS.prompt && response.command === 'prompt') {
        if (!response.success) {
          const classification = classifyFailure(response.error, startedEmitted || promptState.accepted);
          markFailure(classification, response.error ?? 'prompt failed', rawLine);
          requestShutdown();
          return;
        }
        promptState.accepted = true;
        if (!startedEmitted) {
          safeEmit(normalizeStructuredEvent('started', { mode: 'rpc' }, rawLine));
        }
        return;
      }

      if (response.id === INTERNAL_IDS.abort && response.command === 'abort') {
        return;
      }

      if (!response.success) {
        const classification = classifyFailure(response.error, startedEmitted || promptState.accepted);
        markFailure(classification, response.error ?? `RPC command ${response.command} failed`, rawLine);
        requestShutdown();
      }
    };

    const handleAgentEvent = (event: AgentEventBase, rawLine: string): void => {
      switch (event.type) {
        case 'message_end': {
          const message = parseMessage((event as unknown as Record<string, unknown>).message);
          if (!message) return;
          const text = flattenTextContent(message.content);
          if (message.role === 'assistant') {
            lastAssistantText = text;
            captureUsage(parseUsageFromMessage(message));
            if (message.stopReason === 'error' || message.stopReason === 'aborted') {
              const classification = classifyFailure(message.errorMessage ?? message.stopReason, true);
              failureClassification = classification;
              failureMessage = message.errorMessage ?? message.stopReason;
            }
          }
          safeEmit(normalizeStructuredEvent('message', {
            role: message.role ?? 'unknown',
            text,
            provider: message.provider ?? null,
            model: message.model ?? null,
            stopReason: message.stopReason ?? null,
            errorMessage: message.errorMessage ?? null,
          }, rawLine));
          return;
        }
        case 'tool_execution_start': {
          const record = event as unknown as Record<string, unknown>;
          safeEmit(normalizeStructuredEvent('tool_call', {
            toolCallId: record.toolCallId ?? null,
            toolName: record.toolName ?? null,
            args: record.args ?? null,
          }, rawLine));
          return;
        }
        case 'tool_execution_end': {
          const record = event as unknown as Record<string, unknown>;
          safeEmit(normalizeStructuredEvent('tool_result', {
            toolCallId: record.toolCallId ?? null,
            toolName: record.toolName ?? null,
            isError: record.isError ?? false,
            result: record.result ?? null,
          }, rawLine));
          return;
        }
        case 'auto_compaction_end': {
          const record = event as unknown as Record<string, unknown>;
          const result = isRecord(record.result) ? record.result : undefined;
          const summary = typeof result?.summary === 'string' ? result.summary : undefined;
          if (!summary) return;
          safeEmit(normalizeStructuredEvent('compaction', {
            content: summary,
            summary,
            tokensBefore: result?.tokensBefore ?? null,
            tokensAfter: result?.tokensAfter ?? null,
            aborted: record.aborted ?? false,
            willRetry: record.willRetry ?? false,
          }, rawLine));
          return;
        }
        case 'agent_end': {
          const record = event as unknown as Record<string, unknown>;
          const messages = Array.isArray(record.messages) ? record.messages : [];
          const lastAssistant = [...messages].reverse().map(parseMessage).find((message) => message?.role === 'assistant');
          if (lastAssistant) {
            lastAssistantText = flattenTextContent(lastAssistant.content);
            captureUsage(parseUsageFromMessage(lastAssistant));
            if ((lastAssistant.stopReason === 'error' || lastAssistant.stopReason === 'aborted') && failureClassification === null) {
              failureClassification = classifyFailure(lastAssistant.errorMessage ?? lastAssistant.stopReason, true);
              failureMessage = lastAssistant.errorMessage ?? lastAssistant.stopReason;
            }
          }
          promptState.completed = true;
          requestShutdown();
          return;
        }
        default:
          return;
      }
    };

    const handleProtocolFailure = (line: string, error: Error): void => {
      markFailure('protocol_error', error.message, line);
      requestShutdown('SIGKILL');
    };

    const processLine = (rawLine: string): void => {
      try {
        const parsed = JSON.parse(rawLine) as unknown;
        if (!isRecord(parsed) || typeof parsed.type !== 'string') {
          throw new Error('RPC output is not a typed JSON object');
        }

        if (parsed.type === 'response') {
          handleResponse(RpcResponseSchema.parse(parsed) as RpcResponse, rawLine);
          return;
        }

        if (parsed.type === 'extension_ui_request') {
          const request = RpcExtensionUiRequestSchema.parse(parsed);
          if (!PASSIVE_EXTENSION_UI_METHODS.has(request.method)) {
            throw new Error(`unsupported Pi RPC extension UI request: ${request.method}`);
          }
          return;
        }

        if (parsed.type === 'extension_error') {
          const extensionError = RpcExtensionErrorSchema.parse(parsed);
          throw new Error(`Pi extension error: ${extensionError.error}`);
        }

        handleAgentEvent(parsed as unknown as AgentEventBase, rawLine);
      } catch (error) {
        handleProtocolFailure(rawLine, error instanceof Error ? error : new Error(String(error)));
      }
    };

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdoutBuffer += chunk;
      if (Buffer.byteLength(stdoutBuffer) > MAX_STDOUT_BUFFER_BYTES) {
        markFailure('protocol_error', 'stdout buffer exceeded 1MB limit');
        requestShutdown('SIGKILL');
        return;
      }
      const split = splitJsonlBuffer(stdoutBuffer);
      stdoutBuffer = split.remainder;
      for (const line of split.lines) {
        processLine(line);
      }
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      if (Buffer.byteLength(stderr) < MAX_STDERR_BYTES) {
        stderr += chunk;
        if (Buffer.byteLength(stderr) > MAX_STDERR_BYTES) {
          stderr = stderr.slice(0, MAX_STDERR_BYTES);
        }
      }
    });

    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    let cancelEscalationTimer: ReturnType<typeof setTimeout> | undefined;

    if (this.timeoutMs != null) {
      timeoutTimer = setTimeout(() => {
        if (child.exitCode === null) {
          timedOut = true;
          failureClassification = 'transient_failure';
          failureMessage = 'engine timeout exceeded';
          requestShutdown();
          cancelEscalationTimer = setTimeout(() => {
            if (child.exitCode === null) {
              requestShutdown('SIGKILL');
            }
          }, CANCEL_GRACE_MS);
        }
      }, this.timeoutMs);
    }

    const finalizeBeforeResolve = (): void => {
      if (closeResolved) return;
      closeResolved = true;

      if (timedOut && failureClassification === null) {
        failureClassification = 'transient_failure';
        failureMessage = 'engine timeout exceeded';
      }

      if (cancelRequested && failureClassification === null) {
        failureClassification = 'cancelled';
        failureMessage = failureMessage ?? 'cancelled by operator';
      }

      if (failureClassification !== null) {
        if (!failedEmitted) {
          safeEmit(normalizeStructuredEvent('failed', {
            classification: failureClassification,
            message: failureMessage ?? '',
          }));
        }
      } else if (!completedEmitted) {
        safeEmit(normalizeStructuredEvent('completed', {
          output: lastAssistantText,
        }));
      }

      if (!usageEmitted) {
        safeEmit(normalizeStructuredEvent('usage', {
          provider: usage.provider,
          model: usage.model,
          tokensIn: usage.tokensIn,
          tokensOut: usage.tokensOut,
          estimatedCostUsd: usage.estimatedCostUsd,
        }));
      }
    };

    const completionPromise = new Promise<EngineRunCompletion>((resolveCompletion, rejectCompletion) => {
      child.on('error', rejectCompletion);
      child.on('close', (code) => {
        if (timeoutTimer != null) clearTimeout(timeoutTimer);
        if (cancelEscalationTimer != null) clearTimeout(cancelEscalationTimer);

        if (stdoutBuffer.trim().length > 0) {
          processLine(stdoutBuffer.trim());
          stdoutBuffer = '';
        }

        const exitCode = code ?? 0;
        if (!promptState.completed && failureClassification === null && exitCode !== 0) {
          failureClassification = promptState.accepted || startedEmitted ? 'permanent_failure' : 'startup_failure';
          failureMessage = stderr.trim() || `Pi RPC process failed with code ${exitCode}`;
        }

        if (!promptState.requested && failureClassification === null) {
          failureClassification = 'startup_failure';
          failureMessage = failureMessage ?? 'Pi RPC process exited before state handshake completed';
        }

        finalizeBeforeResolve();

        resolveCompletion({
          engineSessionRef,
          usage,
          failureClassification,
          warnings: stderr.trim() || undefined,
        });
      });
    });

    const handle = new ProcessHandle(child, completionPromise, async () => {
      cancelRequested = true;
      if (child.exitCode !== null) return;
      if (!child.stdin.destroyed) {
        sendCommand({ id: INTERNAL_IDS.abort, type: 'abort' });
      }
    });
    options.onHandle?.(handle);

    sendCommand({ id: INTERNAL_IDS.getState, type: 'get_state' });

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
    const sessionRef = sessionEvent?.payload.sessionRef;
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
    return new PiEngineAdapter({ piPath: config.engine.piPath, piVersion: config.engine.piVersion, command: config.engine.command, args: config.engine.args, timeoutMs: config.engine.timeoutMs });
  }
  return new FakeEngineAdapter();
}
