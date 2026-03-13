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
| Event streaming | Producing structured events on stdout (started, session, message, tool_call, tool_result, completed, failed, usage) |
| Coding agent capability | Generic coding-agent features (file editing, search, etc.) |

## Popeye wraps (via @popeye/engine-pi)

| Capability | What Popeye does | What Pi does |
|-----------|-----------------|-------------|
| Engine lifecycle | Spawns Pi as a child process, manages stdin/stdout/stderr | Runs as the child process |
| Event normalization | Parses Pi's newline-delimited JSON events into `NormalizedEngineEvent` | Emits raw events |
| Session reference capture | Extracts `engineSessionRef` from Pi's `session` events | Produces session events |
| Usage tracking | Extracts `UsageMetrics` from Pi's `usage` events, provides defaults when absent | Reports usage when available |
| Failure classification | Maps Pi exit codes and error events to `EngineFailureClassification` | Reports failures via events or exit codes |
| Cancellation | Sends `SIGTERM` to the Pi process | Handles signal gracefully |
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
  startRun(input: string, options?: EngineRunOptions): Promise<EngineRunHandle>;
  run(input: string, options?: EngineRunOptions): Promise<EngineRunResult>;
}
```

Two implementations exist:

- **FakeEngineAdapter** -- returns deterministic echo responses. Used in tests and when `config.engine.kind === "fake"`.
- **PiEngineAdapter** -- spawns a real Pi child process. Used when `config.engine.kind === "pi"` and a valid Pi checkout is available at `config.engine.piPath`.

The `createEngineAdapter()` factory selects the implementation based on config.
