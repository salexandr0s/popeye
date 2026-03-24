import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

import {
  type AppConfig,
  type EngineCapabilities,
  type ModelRoutingConfig,
  NormalizedEngineEventSchema,
  type EngineFailureClassification,
  type NormalizedEngineEvent,
  type UsageMetrics,
} from '@popeye/contracts';
import { z } from 'zod';

import { resolveModelForPrompt } from './classify-complexity.js';

export type { EngineFailureClassification } from '@popeye/contracts';

const DEFAULT_PI_CLI_PATH = 'packages/coding-agent/dist/cli.js';
const CODING_AGENT_PACKAGE_JSON_PATH = 'packages/coding-agent/package.json';
const MAX_STDERR_BYTES = 1_048_576;
const MAX_STDOUT_BUFFER_BYTES = 1_048_576;
const MAX_EVENTS = 10_000;
const CANCEL_GRACE_MS = 5_000;
const DEFAULT_RUNTIME_TOOL_TIMEOUT_MS = 30_000;
const INTERNAL_IDS = {
  getState: 'popeye:get_state',
  registerHostTools: 'popeye:register_host_tools',
  prompt: 'popeye:prompt',
  abort: 'popeye:abort',
} as const;
const PASSIVE_EXTENSION_UI_METHODS = new Set(['notify', 'setStatus', 'setWidget', 'setTitle', 'set_editor_text']);

export function cleanStalePiTempDirs(maxAgeMs = 60 * 60 * 1000): number {
  const prefix = 'popeye-pi-extension-';
  const base = tmpdir();
  let cleaned = 0;
  let entries: string[];
  try {
    entries = readdirSync(base);
  } catch {
    return 0;
  }
  const cutoff = Date.now() - maxAgeMs;
  for (const entry of entries) {
    if (!entry.startsWith(prefix)) continue;
    const fullPath = join(base, entry);
    try {
      const mtime = statSync(fullPath).mtimeMs;
      if (mtime > cutoff) continue; // still fresh — likely an active process
      rmSync(fullPath, { recursive: true, force: true });
      cleaned++;
    } catch {
      // best-effort cleanup
    }
  }
  return cleaned;
}

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
  iterationsUsed?: number | undefined;
}

export interface EngineRunCompletion {
  engineSessionRef: string | null;
  usage: UsageMetrics;
  failureClassification: EngineFailureClassification | null;
  warnings?: string | undefined;
  iterationsUsed?: number | undefined;
}

export interface EngineExecution {
  pid: number | null;
  handle: EngineRunHandle;
  completed: Promise<EngineRunCompletion>;
}

export type EngineSessionPolicy =
  | { type: 'dedicated'; rootId: string }
  | { type: 'ephemeral' }
  | { type: 'per_task'; taskId: string };

export interface EngineTriggerDescriptor {
  source: 'manual' | 'heartbeat' | 'schedule' | 'telegram' | 'api' | 'delegation';
  originId?: string;
  timestamp: string;
}

export interface RuntimeToolDescriptor {
  name: string;
  description: string;
  inputSchema: unknown;
  label?: string;
  execute?: (params: unknown) => Promise<RuntimeToolResult> | RuntimeToolResult;
}

export interface RuntimeToolResultContent {
  type: 'text';
  text: string;
}

export interface RuntimeToolResult {
  content: RuntimeToolResultContent[];
  details?: unknown;
}

export interface EngineRunRequest {
  prompt: string;
  workspaceId?: string;
  projectId?: string | null;
  sessionPolicy?: EngineSessionPolicy;
  instructionSnapshotId?: string;
  cwd?: string;
  modelOverride?: string;
  cacheRetention?: 'none' | 'short' | 'long';
  trigger?: EngineTriggerDescriptor;
  runtimeTools?: RuntimeToolDescriptor[];
  maxIterations?: number;
}

export interface EngineAdapter {
  startRun(input: EngineRunRequest, options?: EngineRunOptions): Promise<EngineRunHandle>;
  run(input: EngineRunRequest, options?: EngineRunOptions): Promise<EngineRunResult>;
  getCapabilities(): EngineCapabilities;
}

export interface PiAdapterConfig {
  piPath?: string;
  piVersion?: string;
  command?: string;
  args?: string[];
  timeoutMs?: number;
  runtimeToolTimeoutMs?: number;
  allowRuntimeToolBridgeFallback?: boolean;
  modelRouting?: ModelRoutingConfig;
  maxIterationsPerRun?: number;
  budgetWarningThreshold?: number;
}

export interface PiCheckoutStatus {
  path: string;
  available: boolean;
  packageJsonPath: string;
  codingAgentPackageJsonPath: string;
  repoVersion: string | null;
  codingAgentVersion: string | null;
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

interface PreparedRuntimeToolBridge {
  extensionPaths: string[];
  cleanup(): void;
  toolsByName: Map<string, RuntimeToolDescriptor>;
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

const RuntimeToolCallSchema = z.object({
  op: z.literal('runtime_tool_call'),
  toolCallId: z.string(),
  tool: z.string(),
  params: z.unknown().optional(),
});

class RuntimeToolBridgeTimeoutError extends Error {
  readonly code = 'timeout';

  constructor(toolName: string, timeoutMs: number) {
    super(`Runtime tool ${toolName} timed out after ${timeoutMs}ms`);
    this.name = 'RuntimeToolBridgeTimeoutError';
  }
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
  const codingAgentPackageJsonPath = resolve(path, CODING_AGENT_PACKAGE_JSON_PATH);
  const available = existsSync(path) && existsSync(packageJsonPath);
  let repoVersion: string | null = null;
  let codingAgentVersion: string | null = null;
  if (available) {
    try {
      const pkg = PackageVersionSchema.parse(JSON.parse(readFileSync(packageJsonPath, 'utf8')));
      repoVersion = pkg.version ?? null;
    } catch {
      // repoVersion stays null if package.json is unreadable
    }
    try {
      if (existsSync(codingAgentPackageJsonPath)) {
        const pkg = PackageVersionSchema.parse(JSON.parse(readFileSync(codingAgentPackageJsonPath, 'utf8')));
        codingAgentVersion = pkg.version ?? null;
      }
    } catch {
      // codingAgentVersion stays null if package.json is unreadable
    }
  }
  return {
    path,
    available,
    packageJsonPath,
    codingAgentPackageJsonPath,
    repoVersion,
    codingAgentVersion,
    version: codingAgentVersion,
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
    return { ok: true, message: 'No expected coding-agent version specified — skipping version check' };
  }
  const status = inspectPiCheckout(piPath);
  if (!status.available) {
    return { ok: false, message: `Pi checkout not available at ${status.path}`, expected, actual: null };
  }
  if (!status.codingAgentVersion) {
    return {
      ok: false,
      message: `Pi coding-agent version could not be read from ${status.codingAgentPackageJsonPath}`,
      expected,
      actual: null,
    };
  }
  if (status.codingAgentVersion === expected) {
    return {
      ok: true,
      message: `Pi coding-agent version matches: ${expected}`,
      expected,
      actual: status.codingAgentVersion,
    };
  }
  return {
    ok: false,
    message: `Pi coding-agent version mismatch — expected ${expected}, found ${status.codingAgentVersion}`,
    expected,
    actual: status.codingAgentVersion,
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

function buildPiCommand(
  piPath: string,
  command: string,
  args: string[],
  options: { extensionPaths?: string[]; modelOverride?: string } = {},
): { command: string; args: string[] } {
  const extensionPaths = options.extensionPaths ?? [];
  const baseArgs = applyModelOverride(
    stripOptionValueArgs(resolveBaseArgs(piPath, command, args), new Set(['--mode'])),
    options.modelOverride,
  );
  return {
    command,
    args: [...baseArgs, ...extensionPaths.flatMap((extensionPath) => ['--extension', extensionPath]), '--mode', 'rpc'],
  };
}

function createRuntimeToolExtensionSource(tools: RuntimeToolDescriptor[]): string {
  const registry = tools.map((tool) => ({
    name: tool.name,
    label: tool.label ?? tool.name,
    description: tool.description,
  }));

  return `import { Type } from "@mariozechner/pi-ai";

const registry = ${JSON.stringify(registry, null, 2)};

export default function (pi) {
  for (const tool of registry) {
    pi.registerTool({
      name: tool.name,
      label: tool.label,
      description: tool.description,
      parameters: Type.Object({}, { additionalProperties: true }),
      async execute(toolCallId, params, _signal, _onUpdate, ctx) {
        const request = JSON.stringify({
          op: "runtime_tool_call",
          toolCallId,
          tool: tool.name,
          params,
        });
        const response = await ctx.ui.editor("popeye.runtime_tool", request);
        if (typeof response !== "string" || response.length === 0) {
          return {
            content: [{ type: "text", text: "Popeye runtime tool bridge cancelled the request." }],
            details: { cancelled: true },
          };
        }
        const parsed = JSON.parse(response);
        if (!parsed?.ok) {
          throw new Error(typeof parsed?.error === "string" ? parsed.error : "Popeye runtime tool bridge failed");
        }
        return {
          content: Array.isArray(parsed.content) ? parsed.content : [{ type: "text", text: "OK" }],
          details: parsed.details,
        };
      },
    });
  }
}
`;
}

function prepareRuntimeToolBridge(tools: RuntimeToolDescriptor[]): PreparedRuntimeToolBridge {
  const toolsByName = new Map<string, RuntimeToolDescriptor>();
  if (tools.length === 0) {
    return {
      extensionPaths: [],
      cleanup() {},
      toolsByName,
    };
  }

  for (const tool of tools) {
    if (typeof tool.execute !== 'function') {
      throw new Error(`Runtime tool ${tool.name} is missing an execute callback`);
    }
    toolsByName.set(tool.name, tool);
  }

  const dir = mkdtempSync(join(tmpdir(), 'popeye-pi-extension-'));
  chmodSync(dir, 0o700);
  const extensionPath = join(dir, 'popeye-runtime-tools.mjs');
  writeFileSync(extensionPath, createRuntimeToolExtensionSource(tools), 'utf8');

  return {
    extensionPaths: [extensionPath],
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
    toolsByName,
  };
}

function resolveBaseArgs(piPath: string, command: string, args: string[]): string[] {
  const withResolvedScriptPath = (resolvedArgs: string[]): string[] => {
    if (command !== 'node') {
      return resolvedArgs;
    }
    const [firstArg, ...rest] = resolvedArgs;
    if (!firstArg || firstArg.startsWith('-') || isAbsolute(firstArg)) {
      return resolvedArgs;
    }
    return [resolve(piPath, firstArg), ...rest];
  };
  if (command !== 'node') {
    return args;
  }
  if (args.length === 0) {
    return withResolvedScriptPath(inferDefaultNodePiArgs(piPath));
  }
  const firstArg = args[0];
  if (firstArg === undefined || firstArg.startsWith('-')) {
    return withResolvedScriptPath([...inferDefaultNodePiArgs(piPath), ...args]);
  }
  return withResolvedScriptPath(args);
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

function stripOptionValueArgs(args: string[], optionNames: ReadonlySet<string>): string[] {
  const sanitized: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) continue;
    const matchingOption = Array.from(optionNames).find((optionName) => arg === optionName || arg.startsWith(`${optionName}=`));
    if (matchingOption) {
      if (arg === matchingOption) {
        index += 1;
      }
      continue;
    }
    sanitized.push(arg);
  }
  return sanitized;
}

function applyModelOverride(args: string[], modelOverride?: string): string[] {
  const normalizedModel = modelOverride?.trim();
  if (!normalizedModel) return args;
  return [...stripOptionValueArgs(args, new Set(['--model'])), '--model', normalizedModel];
}

function resolveSpawnCwd(piPath: string, cwd?: string): string {
  if (!cwd) return piPath;
  if (!isAbsolute(cwd)) {
    throw new Error(`Engine run cwd must be an absolute path: ${cwd}`);
  }
  if (!existsSync(cwd)) {
    throw new Error(`Engine run cwd does not exist: ${cwd}`);
  }
  const stats = statSync(cwd);
  if (!stats.isDirectory()) {
    throw new Error(`Engine run cwd must be a directory: ${cwd}`);
  }
  return cwd;
}

interface ExecuteWithTimeoutOptions {
  onTimeout?: () => void;
  onLateSettle?: (input: { status: 'resolved' | 'rejected' }) => void;
}

function executeWithTimeout<T>(
  operation: () => Promise<T> | T,
  timeoutMs: number,
  toolName: string,
  options: ExecuteWithTimeoutOptions = {},
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      options.onTimeout?.();
      reject(new RuntimeToolBridgeTimeoutError(toolName, timeoutMs));
    }, timeoutMs);

    Promise.resolve()
      .then(() => operation())
      .then(
        (result) => {
          if (timedOut) {
            options.onLateSettle?.({ status: 'resolved' });
            return;
          }
          clearTimeout(timer);
          resolve(result);
        },
        (error: unknown) => {
          if (timedOut) {
            options.onLateSettle?.({ status: 'rejected' });
            return;
          }
          clearTimeout(timer);
          reject(error);
        },
      );
  });
}

export interface FakeEngineConfig {
  mode?: 'success' | 'transient_failure' | 'permanent_failure' | 'timeout' | 'protocol_error' | 'iteration_budget';
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

  async startRun(request: EngineRunRequest, options: EngineRunOptions = {}): Promise<EngineRunHandle> {
    const prompt = request.prompt;
    const sessionRef = `fake:${randomUUID()}`;
    const usage: UsageMetrics = {
      provider: 'fake',
      model: 'fake-engine',
      tokensIn: prompt.length,
      tokensOut: prompt.length,
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

      await emitAsync({ type: 'started', payload: { input: prompt } });

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

      if (mode === 'iteration_budget') {
        await emitAsync({ type: 'session', payload: { sessionRef } });
        for (let i = 0; i < 5; i++) {
          await emitAsync({ type: 'tool_call', payload: { toolCallId: `call-${i}`, toolName: 'test_tool' } });
          await emitAsync({ type: 'tool_result', payload: { toolCallId: `call-${i}`, toolName: 'test_tool', isError: false } });
        }
        await emitAsync({ type: 'budget_exhausted', payload: { iterationsUsed: 5, maxIterations: 5 } });
        await emitAsync({ type: 'failed', payload: { classification: 'policy_failure' } });
        await emitAsync({ type: 'usage', payload: { provider: usage.provider, model: usage.model, tokensIn: usage.tokensIn, tokensOut: 0, estimatedCostUsd: 0 } });
        completionResolve?.({
          engineSessionRef: sessionRef,
          usage: { ...usage, tokensOut: 0 },
          failureClassification: 'policy_failure',
          iterationsUsed: 5,
        });
        return;
      }

      await emitAsync({ type: 'session', payload: { sessionRef } });
      await emitAsync({ type: 'message', payload: { text: `echo:${prompt}` } });
      await emitAsync({ type: 'completed', payload: { output: `echo:${prompt}` } });
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

  async run(input: EngineRunRequest, options: EngineRunOptions = {}): Promise<EngineRunResult> {
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
      engineSessionRef: completion.engineSessionRef ?? (() => {
        const sessionRef = events.find((event) => event.type === 'session')?.payload.sessionRef;
        return typeof sessionRef === 'string' ? sessionRef : null;
      })(),
      usage: completion.usage,
      failureClassification: completion.failureClassification,
      iterationsUsed: completion.iterationsUsed,
    };
  }

  getCapabilities(): EngineCapabilities {
    return {
      engineKind: 'fake',
      persistentSessionSupport: false,
      resumeBySessionRefSupport: false,
      hostToolMode: 'none',
      compactionEventSupport: false,
      cancellationMode: 'cooperative',
      acceptedRequestMetadata: ['prompt', 'workspaceId', 'projectId', 'sessionPolicy', 'instructionSnapshotId', 'trigger', 'cwd', 'modelOverride'],
      warnings: ['fake engine does not provide persistent sessions or host tools'],
    };
  }
}

export class FailingFakeEngineAdapter implements EngineAdapter {
  private readonly failureClassification: EngineFailureClassification;

  constructor(failureClassification: EngineFailureClassification) {
    this.failureClassification = failureClassification;
  }

  async startRun(request: EngineRunRequest, options: EngineRunOptions = {}): Promise<EngineRunHandle> {
    const completion: EngineRunCompletion = {
      engineSessionRef: `fake:${randomUUID()}`,
      usage: {
        provider: 'fake',
        model: 'fake-engine',
        tokensIn: request.prompt.length,
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
    options.onEvent?.({ type: 'started', payload: { input: request.prompt } });
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

  async run(input: EngineRunRequest, options: EngineRunOptions = {}): Promise<EngineRunResult> {
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
      engineSessionRef: completion.engineSessionRef ?? (() => {
        const sessionRef = events.find((event) => event.type === 'session')?.payload.sessionRef;
        return typeof sessionRef === 'string' ? sessionRef : null;
      })(),
      usage: completion.usage,
      failureClassification: completion.failureClassification,
      iterationsUsed: completion.iterationsUsed,
    };
  }

  getCapabilities(): EngineCapabilities {
    return {
      engineKind: 'fake',
      persistentSessionSupport: false,
      resumeBySessionRefSupport: false,
      hostToolMode: 'none',
      compactionEventSupport: false,
      cancellationMode: 'cooperative',
      acceptedRequestMetadata: ['prompt', 'workspaceId', 'projectId', 'sessionPolicy', 'instructionSnapshotId', 'trigger', 'cwd', 'modelOverride'],
      warnings: ['failing fake engine is a test adapter only'],
    };
  }
}

export class PiEngineAdapter implements EngineAdapter {
  private readonly piPath: string;
  private readonly command: string;
  private readonly args: string[];
  private readonly timeoutMs: number | undefined;
  private readonly runtimeToolTimeoutMs: number;
  private readonly expectedPiVersion: string | undefined;
  private readonly allowRuntimeToolBridgeFallback: boolean;
  private readonly modelRouting: ModelRoutingConfig | undefined;
  private readonly maxIterationsPerRun: number;
  private readonly budgetWarningThreshold: number;

  constructor(config: PiAdapterConfig = {}) {
    const status = assertPiCheckoutAvailable(config.piPath);
    this.piPath = status.path;
    this.command = config.command ?? 'node';
    this.args = config.args ?? [];
    this.timeoutMs = config.timeoutMs;
    this.runtimeToolTimeoutMs = config.runtimeToolTimeoutMs ?? DEFAULT_RUNTIME_TOOL_TIMEOUT_MS;
    this.expectedPiVersion = config.piVersion;
    this.allowRuntimeToolBridgeFallback = config.allowRuntimeToolBridgeFallback ?? true;
    this.modelRouting = config.modelRouting;
    this.maxIterationsPerRun = config.maxIterationsPerRun ?? 200;
    this.budgetWarningThreshold = config.budgetWarningThreshold ?? 0.8;
    if (config.piVersion) {
      const versionCheck = checkPiVersion(config.piVersion, config.piPath);
      if (!versionCheck.ok) {
        console.warn(`[engine-pi] ${versionCheck.message}`);
      }
    }
  }

  async startRun(request: EngineRunRequest, options: EngineRunOptions = {}): Promise<EngineRunHandle> {
    const runtimeTools = request.runtimeTools ?? [];
    const runtimeToolBridge = this.allowRuntimeToolBridgeFallback
      ? prepareRuntimeToolBridge(runtimeTools)
      : {
          extensionPaths: [],
          cleanup() {},
          toolsByName: new Map<string, RuntimeToolDescriptor>(),
        };
    const routingDecision = request.modelOverride === undefined
      ? resolveModelForPrompt(this.modelRouting, request.prompt)
      : undefined;
    const effectiveModelOverride = request.modelOverride ?? routingDecision?.model;
    const launch = buildPiCommand(
      this.piPath,
      this.command,
      this.args,
      effectiveModelOverride === undefined
        ? { extensionPaths: runtimeToolBridge.extensionPaths }
        : { extensionPaths: runtimeToolBridge.extensionPaths, modelOverride: effectiveModelOverride },
    );
    const child = spawn(launch.command, launch.args, {
      cwd: resolveSpawnCwd(this.piPath, request.cwd),
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
    let useNativeHostTools = false;
    let hostToolRegistrationAttempted = false;
    let bridgeFallbackUsed = false;
    let hostToolRegistrationTimeout: ReturnType<typeof setTimeout> | undefined;
    const promptState: PromptState = { requested: false, accepted: false, completed: false };
    const diagnosticWarnings: string[] = [];
    let iterationCount = 0;
    let budgetWarningEmitted = false;
    let budgetExhausted = false;
    const maxIterations = request.maxIterations ?? this.maxIterationsPerRun;
    const warningAt = Math.floor(maxIterations * this.budgetWarningThreshold);

    const appendWarning = (warning: string): void => {
      if (!diagnosticWarnings.includes(warning)) {
        diagnosticWarnings.push(warning);
      }
    };

    const collectWarnings = (): string | undefined => {
      const stderrWarning = stderr.trim();
      const warnings = stderrWarning.length > 0
        ? [stderrWarning, ...diagnosticWarnings]
        : [...diagnosticWarnings];
      return warnings.length > 0 ? warnings.join('\n') : undefined;
    };

    const markBridgeFallbackUsed = (): void => {
      if (bridgeFallbackUsed) return;
      bridgeFallbackUsed = true;
      appendWarning('Pi runtime-tool bridge fallback was used for this run.');
    };

    const safeEmit = (event: NormalizedEngineEvent): void => {
      if (event.type === 'usage') usageEmitted = true;
      if (event.type === 'completed') completedEmitted = true;
      if (event.type === 'failed') failedEmitted = true;
      if (event.type === 'started') startedEmitted = true;
      if (event.type === 'session') sessionEmitted = true;
      emitEvent(events, event, options.onEvent);
    };

    if (routingDecision) {
      safeEmit(normalizeStructuredEvent('model_routing', {
        classification: routingDecision.classification,
        score: routingDecision.score,
        signals: routingDecision.signals.join(','),
        selectedModel: routingDecision.model ?? 'default',
      }));
    }

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

    const checkBudget = (): boolean => {
      if (budgetExhausted) return true;
      if (!budgetWarningEmitted && iterationCount >= warningAt) {
        budgetWarningEmitted = true;
        safeEmit(normalizeStructuredEvent('budget_warning', {
          iterationsUsed: iterationCount,
          maxIterations,
          threshold: this.budgetWarningThreshold,
        }));
      }
      if (iterationCount >= maxIterations) {
        budgetExhausted = true;
        safeEmit(normalizeStructuredEvent('budget_exhausted', {
          iterationsUsed: iterationCount,
          maxIterations,
        }));
        markFailure('policy_failure', `Iteration budget exhausted: ${iterationCount}/${maxIterations} tool calls completed`);
        requestShutdown();
        return true;
      }
      return false;
    };

    const sendCommand = (command: Record<string, unknown>): void => {
      if (child.stdin.destroyed) return;
      child.stdin.write(serializeRpcCommand(command));
    };

    const emitBridgeToolCall = (
      payload: { toolCallId: string; toolName: string; params?: unknown },
      raw?: string,
    ): void => {
      safeEmit(normalizeStructuredEvent('tool_call', {
        toolCallId: payload.toolCallId,
        toolName: payload.toolName,
        args: payload.params ?? null,
        bridge: 'runtime_tool_bridge',
      }, raw));
    };

    const emitBridgeToolResult = (
      payload: {
        toolCallId: string | null;
        toolName: string | null;
        isError: boolean;
        durationMs: number;
        error?: string;
        errorCode?: string;
        contentItems?: number;
        detailsPresent?: boolean;
      },
      raw?: string,
    ): void => {
      safeEmit(normalizeStructuredEvent('tool_result', {
        toolCallId: payload.toolCallId,
        toolName: payload.toolName,
        isError: payload.isError,
        durationMs: payload.durationMs,
        bridge: 'runtime_tool_bridge',
        error: payload.error ?? null,
        errorCode: payload.errorCode ?? null,
        contentItems: payload.contentItems ?? null,
        detailsPresent: payload.detailsPresent ?? null,
      }, raw));
      if (!budgetExhausted) {
        iterationCount++;
        checkBudget();
      }
    };

    const respondToRuntimeToolRequest = async (
      uiRequest: z.infer<typeof RpcExtensionUiRequestSchema>,
    ): Promise<void> => {
      const rawRequest = JSON.stringify(uiRequest);
      const startedAt = Date.now();
      try {
        markBridgeFallbackUsed();
        if (uiRequest.method !== 'editor' || uiRequest.title !== 'popeye.runtime_tool') {
          throw new Error(`unsupported Pi RPC extension UI request: ${uiRequest.method}`);
        }
        const payload = RuntimeToolCallSchema.parse(JSON.parse(String(uiRequest.prefill ?? '')));
        const tool = runtimeToolBridge.toolsByName.get(payload.tool);
        if (!tool?.execute) {
          emitBridgeToolResult({
            toolCallId: payload.toolCallId,
            toolName: payload.tool,
            isError: true,
            durationMs: Date.now() - startedAt,
            error: `Unknown runtime tool: ${payload.tool}`,
            errorCode: 'unknown_tool',
          }, rawRequest);
          sendCommand({
            type: 'extension_ui_response',
            id: uiRequest.id,
            value: JSON.stringify({ ok: false, error: `Unknown runtime tool: ${payload.tool}` }),
          });
          return;
        }
        emitBridgeToolCall({
          toolCallId: payload.toolCallId,
          toolName: payload.tool,
          params: payload.params,
        }, rawRequest);
        const timeoutWarning = `Runtime tool ${payload.tool} timed out after ${this.runtimeToolTimeoutMs}ms; underlying execution was not cancelled and any later settlement was suppressed.`;
        const execute = tool.execute;
        const result = await executeWithTimeout(
          () => execute(payload.params),
          this.runtimeToolTimeoutMs,
          payload.tool,
          {
            onTimeout: () => {
              appendWarning(timeoutWarning);
            },
            onLateSettle: ({ status }) => {
              appendWarning(`Suppressed late runtime tool ${status} after timeout: ${payload.tool} (${payload.toolCallId})`);
            },
          },
        );
        emitBridgeToolResult({
          toolCallId: payload.toolCallId,
          toolName: payload.tool,
          isError: false,
          durationMs: Date.now() - startedAt,
          contentItems: result.content.length,
          detailsPresent: result.details !== undefined,
        }, rawRequest);
        sendCommand({
          type: 'extension_ui_response',
          id: uiRequest.id,
          value: JSON.stringify({
            ok: true,
            content: result.content,
            details: result.details,
          }),
        });
      } catch (error) {
        const durationMs = Date.now() - startedAt;
        const parsedPayload = (() => {
          try {
            return RuntimeToolCallSchema.parse(JSON.parse(String(uiRequest.prefill ?? '')));
          } catch {
            return null;
          }
        })();
        emitBridgeToolResult({
          toolCallId: parsedPayload?.toolCallId ?? null,
          toolName: parsedPayload?.tool ?? null,
          isError: true,
          durationMs,
          error: error instanceof Error ? error.message : String(error),
          errorCode: error instanceof RuntimeToolBridgeTimeoutError
            ? error.code
            : error instanceof SyntaxError || error instanceof z.ZodError
              ? 'malformed_payload'
              : error instanceof Error && error.message.startsWith('unsupported Pi RPC extension UI request:')
                ? 'unsupported_request'
              : 'execution_error',
        }, rawRequest);
        sendCommand({
          type: 'extension_ui_response',
          id: uiRequest.id,
          value: JSON.stringify({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          }),
        });
      }
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
        // Attempt to register native host tools, with fallback to extension-UI bridge
        const hasRuntimeTools = runtimeTools.length > 0;
        if (hasRuntimeTools && !useNativeHostTools && !hostToolRegistrationAttempted) {
          hostToolRegistrationAttempted = true;
          sendCommand({
            id: INTERNAL_IDS.registerHostTools,
            type: 'register_host_tools',
            tools: runtimeTools.map((t) => ({
              name: t.name,
              description: t.description,
              parameters: t.inputSchema,
            })),
          });
          // Set a short fallback timer — if Pi doesn't know this command, it may not respond
          hostToolRegistrationTimeout = setTimeout(() => {
            if (this.allowRuntimeToolBridgeFallback) {
              if (!promptState.requested) {
                promptState.requested = true;
                sendCommand({
                id: INTERNAL_IDS.prompt,
                type: 'prompt',
                message: request.prompt,
                ...(request.cacheRetention ? { cacheRetention: request.cacheRetention } : {}),
              });
              }
              return;
            }
            markFailure(
              'policy_failure',
              'Pi native host-tool registration timed out and runtime-tool bridge fallback is disabled',
              rawLine,
            );
            requestShutdown();
          }, 500);
          return;
        }
        if (!promptState.requested) {
          promptState.requested = true;
          sendCommand({
                id: INTERNAL_IDS.prompt,
                type: 'prompt',
                message: request.prompt,
                ...(request.cacheRetention ? { cacheRetention: request.cacheRetention } : {}),
              });
        }
        return;
      }

      if (response.id === INTERNAL_IDS.registerHostTools && response.command === 'register_host_tools') {
        if (hostToolRegistrationTimeout) {
          clearTimeout(hostToolRegistrationTimeout);
          hostToolRegistrationTimeout = undefined;
        }
        if (response.success) {
          useNativeHostTools = true;
        } else if (!this.allowRuntimeToolBridgeFallback) {
          markFailure(
            'policy_failure',
            response.error ?? 'Pi native host-tool registration failed and runtime-tool bridge fallback is disabled',
            rawLine,
          );
          requestShutdown();
          return;
        }
        // Proceed to prompt regardless of registration outcome (fallback to extension bridge)
        if (!promptState.requested) {
          promptState.requested = true;
          sendCommand({
                id: INTERNAL_IDS.prompt,
                type: 'prompt',
                message: request.prompt,
                ...(request.cacheRetention ? { cacheRetention: request.cacheRetention } : {}),
              });
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
          if (!budgetExhausted) {
            iterationCount++;
            if (checkBudget()) return;
          }
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

        if (parsed.type === 'host_tool_request' && useNativeHostTools) {
          const toolCallId = typeof parsed.toolCallId === 'string' ? parsed.toolCallId : '';
          const toolName = typeof parsed.tool === 'string' ? parsed.tool : '';
          const params = (parsed.params ?? {}) as Record<string, unknown>;
          const tool = runtimeToolBridge.toolsByName.get(toolName);
          if (!tool?.execute) {
            sendCommand({ type: 'host_tool_response', toolCallId, status: 'error', error: { code: 'unknown_tool', message: `Unknown runtime tool: ${toolName}` } });
            return;
          }
          emitBridgeToolCall({ toolCallId, toolName, params }, rawLine);
          const startedAt = Date.now();
          const timeoutWarning = `Runtime tool ${toolName} timed out after ${this.runtimeToolTimeoutMs}ms; underlying execution was not cancelled and any later settlement was suppressed.`;
          void executeWithTimeout(
            () => tool.execute!(params),
            this.runtimeToolTimeoutMs,
            toolName,
            {
              onTimeout: () => { appendWarning(timeoutWarning); },
              onLateSettle: ({ status }) => { appendWarning(`Suppressed late runtime tool ${status} after timeout: ${toolName} (${toolCallId})`); },
            },
          ).then((result) => {
            emitBridgeToolResult({
              toolCallId, toolName, isError: false, durationMs: Date.now() - startedAt,
              contentItems: result.content.length, detailsPresent: result.details !== undefined,
            }, rawLine);
            const text = result.content.map((c: { type: string; text?: string }) => c.type === 'text' ? c.text ?? '' : '').join('');
            sendCommand({ type: 'host_tool_response', toolCallId, status: 'success', result: text });
          }).catch((error: unknown) => {
            emitBridgeToolResult({
              toolCallId, toolName, isError: true, durationMs: Date.now() - startedAt,
              error: error instanceof Error ? error.message : String(error),
              errorCode: error instanceof RuntimeToolBridgeTimeoutError ? error.code : 'execution_error',
            }, rawLine);
            sendCommand({ type: 'host_tool_response', toolCallId, status: 'error', error: { code: 'execution_error', message: error instanceof Error ? error.message : String(error) } });
          });
          return;
        }

        if (parsed.type === 'extension_ui_request') {
          const uiRequest = RpcExtensionUiRequestSchema.parse(parsed);
          if (uiRequest.method === 'editor' && uiRequest.title === 'popeye.runtime_tool') {
            void respondToRuntimeToolRequest(uiRequest);
            return;
          }
          if (!PASSIVE_EXTENSION_UI_METHODS.has(uiRequest.method)) {
            throw new Error(`unsupported Pi RPC extension UI request: ${uiRequest.method}`);
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
        if (hostToolRegistrationTimeout) clearTimeout(hostToolRegistrationTimeout);
        runtimeToolBridge.cleanup();

        if (stdoutBuffer.trim().length > 0) {
          processLine(stdoutBuffer.trim());
          stdoutBuffer = '';
        }

        const exitCode = code ?? 0;
        if (cancelRequested && failureClassification === null) {
          failureClassification = 'cancelled';
          failureMessage = failureMessage ?? 'cancelled by operator';
        }

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
          warnings: collectWarnings(),
          iterationsUsed: iterationCount,
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

  async run(input: EngineRunRequest, options: EngineRunOptions = {}): Promise<EngineRunResult> {
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
      iterationsUsed: completion.iterationsUsed,
    };
  }

  getCapabilities(): EngineCapabilities {
    const warnings: string[] = [];
    const versionCheck = checkPiVersion(this.expectedPiVersion, this.piPath);
    if (!versionCheck.ok) {
      warnings.push(versionCheck.message);
    }
    if (this.allowRuntimeToolBridgeFallback) {
      warnings.push('Pi runtime-tool bridge fallback is enabled for compatibility; disable it for higher-assurance deployments.');
    }
    return {
      engineKind: 'pi',
      persistentSessionSupport: true,
      resumeBySessionRefSupport: false,
      hostToolMode: this.allowRuntimeToolBridgeFallback ? 'native_with_fallback' : 'native',
      compactionEventSupport: true,
      cancellationMode: 'rpc_abort_with_signal_fallback',
      acceptedRequestMetadata: [
        'prompt',
        'cwd',
        'modelOverride',
        'runtimeTools',
        'workspaceId',
        'projectId',
        'sessionPolicy',
        'instructionSnapshotId',
        'trigger',
      ],
      warnings,
    };
  }
}

export async function runPiCompatibilityCheck(adapterOrConfig: EngineAdapter | PiAdapterConfig, prompt = 'compatibility-check'): Promise<PiCompatibilityResult> {
  const adapter = 'startRun' in adapterOrConfig ? adapterOrConfig : new PiEngineAdapter(adapterOrConfig);
  const result = await adapter.run({ prompt });
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
    return new PiEngineAdapter({
      command: config.engine.command,
      args: config.engine.args,
      ...(config.engine.piPath === undefined ? {} : { piPath: config.engine.piPath }),
      ...(config.engine.piVersion === undefined ? {} : { piVersion: config.engine.piVersion }),
      ...(config.engine.timeoutMs === undefined ? {} : { timeoutMs: config.engine.timeoutMs }),
      ...(config.engine.runtimeToolTimeoutMs === undefined
        ? {}
        : { runtimeToolTimeoutMs: config.engine.runtimeToolTimeoutMs }),
      ...(config.engine.allowRuntimeToolBridgeFallback === undefined
        ? {}
        : { allowRuntimeToolBridgeFallback: config.engine.allowRuntimeToolBridgeFallback }),
      maxIterationsPerRun: config.engine.maxIterationsPerRun,
      budgetWarningThreshold: config.engine.budgetWarningThreshold,
      modelRouting: config.engine.modelRouting,
    });
  }
  return new FakeEngineAdapter();
}
