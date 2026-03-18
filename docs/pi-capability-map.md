# Pi Engine Capability Map

What the Pi engine provides versus what the Popeye runtime wraps or owns. Pi is the engine; Popeye is the product.

## Pi provides (engine layer)

These capabilities are delegated to Pi through `@popeye/engine-pi`:

| Capability | Description |
|-----------|-------------|
| Model/provider integration | Connecting to LLM providers, managing API keys at the engine level |
| Agent loop | Core reasoning loop, tool selection, response generation |
| Tool calling infrastructure | Invoking tools, parsing results, feeding back into the loop |
| Session tree | Engine-level session management and context organization |
| Compaction | Context window management and compaction |
| RPC contract | JSONL command/response protocol in `--mode rpc` (`get_state`, `prompt`, `abort`, etc.) |
| Event streaming | Producing `AgentSessionEvent` objects on stdout during RPC execution |
| Coding agent capability | Generic coding-agent features (file editing, search, etc.) |
| Capability self-report | Reporting adapter-level `EngineCapabilities` to the runtime |

## Popeye wraps (via @popeye/engine-pi)

| Capability | What Popeye does | What Pi does |
|-----------|-----------------|-------------|
| Engine lifecycle | Spawns Pi as a child process, manages stdin/stdout/stderr | Runs as the child process |
| RPC handshake | Sends `get_state` then `prompt`, and `abort` on cancel | Responds with typed RPC `response` envelopes |
| Event normalization | Maps Pi RPC responses/session events into `NormalizedEngineEvent` | Emits raw `AgentSessionEvent` objects |
| Session reference capture | Synthesizes `engineSessionRef` from `get_state.sessionId` | Reports current session state |
| Usage tracking | Extracts `UsageMetrics` from the latest assistant message usage, provides defaults when absent | Reports usage on assistant messages |
| Failure classification | Maps Pi RPC failures, assistant stop reasons, and exit conditions to `EngineFailureClassification` | Reports command failures and terminal message state |
| Cancellation | Sends RPC `abort` then falls back to `SIGTERM`/`SIGKILL` | Handles abort/signal gracefully |
| Liveness checking | Polls process PID to check if Pi is still alive | N/A |

## Popeye owns (runtime layer, not in Pi)

| Capability | Package |
|-----------|---------|
| Daemon lifecycle and scheduler | `@popeye/runtime-core` |
| Task/Job/Run state machines | `@popeye/runtime-core`, `@popeye/contracts` |
| Workspace locks and execution isolation | `@popeye/runtime-core` |
| Job leases and lease sweeping | `@popeye/runtime-core` |
| Retry policy and exponential backoff | `@popeye/scheduler` |
| Session root selection and routing | `@popeye/sessions` |
| Instruction compilation and bundling | `@popeye/instructions` |
| Memory storage, retrieval, and lifecycle | `@popeye/memory`, `@popeye/runtime-core` |
| Receipt generation and rendering | `@popeye/receipts`, `@popeye/runtime-core` |
| Interventions and operator escalation | `@popeye/runtime-core` |
| Message ingress and Telegram integration | `@popeye/runtime-core`, `@popeye/telegram` |
| Auth token management and rotation | `@popeye/runtime-core` |
| CSRF protection | `@popeye/runtime-core`, `@popeye/control-api` |
| Secret redaction | `@popeye/observability` |
| Prompt injection detection | `@popeye/runtime-core` |
| Security audit logging | `@popeye/runtime-core` |
| Critical file write protection | `@popeye/runtime-core`, `@popeye/workspace` |
| Control API | `@popeye/control-api` |
| Backup and restore | `@popeye/runtime-core` |
| Database migrations | `@popeye/runtime-core` |

## Engine adapter pattern

The `EngineAdapter` interface abstracts the engine:

```typescript
interface EngineAdapter {
  getCapabilities(): EngineCapabilities;
  startRun(input: EngineRunRequest, options?: EngineRunOptions): Promise<EngineRunHandle>;
  run(input: EngineRunRequest, options?: EngineRunOptions): Promise<EngineRunResult>;
}
```

`EngineRunRequest` carries:

- execution controls already honored by `@popeye/engine-pi`: `prompt`, `cwd`,
  `modelOverride`, `runtimeTools`
- runtime metadata accepted by the adapter but not yet forwarded into Pi RPC
  semantics: `workspaceId`, `projectId`, `sessionPolicy`,
  `instructionSnapshotId`, `trigger`

At run start, Popeye resolves an `ExecutionEnvelope` first and then passes the
envelope-derived `cwd` plus the filtered runtime tool set into the engine
request. The adapter remains engine-focused; envelope enforcement lives in the
runtime layer.

Two implementations exist:

- **FakeEngineAdapter** -- returns deterministic echo responses. Used in tests and when `config.engine.kind === "fake"`.
- **PiEngineAdapter** -- spawns a real Pi child process in RPC mode. Used when `config.engine.kind === "pi"` and a valid Pi checkout is available at `config.engine.piPath`.

The `createEngineAdapter()` factory selects the implementation based on config.

## Runtime-visible engine capabilities

`EngineCapabilities` is now exposed end-to-end through:

- runtime: `PopeyeRuntimeService.getEngineCapabilities()`
- control API: `GET /v1/engine/capabilities`
- CLI: `pop daemon health`
- web inspector: dashboard engine capability cards

The current adapter contract makes degraded engine posture explicit, especially:

- host tool mode (`none`, `native`, `bridge`, `native_with_fallback`)
- persistent session support
- resume-by-session-ref support
- compaction event support
- cancellation semantics
- accepted request metadata and adapter warnings
