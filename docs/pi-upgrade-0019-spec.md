# Pi fork upgrade + per-run cache control — Implementation spec

**ADR:** 0019
**Scope:** Pi fork repo (`/Users/nationalbank/GitHub/pi`) + Popeye engine-pi adapter

---

## Part 1: Pi fork upgrade

### Goal

Rebase the fork onto latest upstream, re-apply the single custom commit (host-tool RPC
bridge), and validate.

### Steps

```bash
cd /Users/nationalbank/GitHub/pi

# 1. Save current state
git branch backup/pre-upgrade-$(date +%Y%m%d)

# 2. Fetch upstream
git fetch upstream

# 3. Check what we're rebasing onto
git log --oneline upstream/main -5

# 4. Rebase onto upstream (only 1 custom commit: b0dd89d8)
git rebase upstream/main

# 5. If conflicts in rpc-types.ts or rpc-mode.ts, resolve manually:
#    - Keep our HostToolDefinition types and register_host_tools command
#    - Accept upstream changes to other commands
#    - If upstream added new RPC commands, keep them

# 6. Build and verify
npm install  # or pnpm install
npm run build

# 7. Run Pi's own tests
npm test
```

### Validation

After rebase, verify these files still contain our custom code:

| File | What to check |
|------|---------------|
| `packages/coding-agent/src/modes/rpc/rpc-types.ts` | `register_host_tools` command, `HostToolDefinition`, `RpcHostToolRequest`, `RpcHostToolResponse` |
| `packages/coding-agent/src/modes/rpc/rpc-mode.ts` | `createHostToolShim()`, `case "register_host_tools"`, `case "host_tool_response"` |
| `packages/coding-agent/src/core/agent-session.ts` | `addHostTools()` method |

Then run Popeye's Pi smoke test:
```bash
cd /Users/nationalbank/GitHub/popeye
POPEYE_ENABLE_PI_SMOKE=1 pnpm test:pi-smoke
```

### Commit

```
chore(pi): rebase fork onto upstream vX.Y.Z

Upstream changes adopted:
- 1M context window support
- JSONL framing fix for Unicode separators (U+2028/U+2029)
- Bedrock prompt caching limits
- Tool result image support
- Extension before_provider_request hook
- WSL clipboard handling

Fork-specific code preserved:
- Native host-tool RPC bridge (register_host_tools / host_tool_request / host_tool_response)

Compatibility tests: pop pi smoke passed
```

---

## Part 2: Per-run cache control (Pi side)

### Goal

Add optional `cacheRetention` field to the RPC `prompt` command so Popeye can control
cache behavior per-run.

### Change 1: RPC types

**File:** `packages/coding-agent/src/modes/rpc/rpc-types.ts`

Current (line 20):
```typescript
| { id?: string; type: "prompt"; message: string; images?: ImageContent[]; streamingBehavior?: "steer" | "followUp" }
```

Change to:
```typescript
| { id?: string; type: "prompt"; message: string; images?: ImageContent[]; streamingBehavior?: "steer" | "followUp"; cacheRetention?: CacheRetention }
```

Add import at top:
```typescript
import type { CacheRetention } from "@mariozechner/pi-ai";
```

### Change 2: PromptOptions

**File:** `packages/coding-agent/src/core/agent-session.ts`

Current `PromptOptions` interface (line 161):
```typescript
export interface PromptOptions {
  expandPromptTemplates?: boolean;
  images?: ImageContent[];
  streamingBehavior?: "steer" | "followUp";
  source?: InputSource;
}
```

Add field:
```typescript
export interface PromptOptions {
  expandPromptTemplates?: boolean;
  images?: ImageContent[];
  streamingBehavior?: "steer" | "followUp";
  source?: InputSource;
  cacheRetention?: CacheRetention;
}
```

Add import:
```typescript
import type { CacheRetention } from "@mariozechner/pi-ai";
```

Then thread `cacheRetention` through the `prompt()` method to wherever the AI `stream()`
call happens. The exact path depends on how `AgentSession` invokes the AI layer — look
for where `StreamOptions` is constructed and add:
```typescript
cacheRetention: options?.cacheRetention,
```

### Change 3: RPC handler

**File:** `packages/coding-agent/src/modes/rpc/rpc-mode.ts`

In the `case "prompt":` handler (line ~404), forward the field:
```typescript
case "prompt": {
    session
        .prompt(command.message, {
            images: command.images,
            streamingBehavior: command.streamingBehavior,
            source: "rpc",
            cacheRetention: command.cacheRetention,  // ← ADD THIS
        })
        .catch((e) => output(error(id, "prompt", e.message)));
    return success(id, "prompt");
}
```

### Verification

The existing `PI_CACHE_RETENTION` env var behavior must be preserved as fallback.
`resolveCacheRetention()` in `anthropic.ts` already handles this:

```typescript
function resolveCacheRetention(cacheRetention?: CacheRetention): CacheRetention {
    if (cacheRetention) return cacheRetention;           // ← per-run wins
    if (process.env.PI_CACHE_RETENTION === "long") return "long";
    if (process.env.PI_CACHE_RETENTION === "none") return "none";
    return "short";                                      // ← default
}
```

No change needed in `anthropic.ts` — the field just needs to flow from RPC → PromptOptions → StreamOptions → provider.

### Test

Add to existing cache-retention tests or create new RPC test:
```typescript
// In rpc tests
it('forwards cacheRetention from prompt command to session', async () => {
  const command = { type: 'prompt', message: 'hello', cacheRetention: 'long' };
  // ... verify session.prompt() called with cacheRetention: 'long'
});

it('omitted cacheRetention falls back to env var', async () => {
  const command = { type: 'prompt', message: 'hello' };
  // ... verify session.prompt() called without cacheRetention
  // ... provider uses PI_CACHE_RETENTION or default "short"
});
```

### Commit

```
feat(rpc): add per-run cacheRetention to prompt command

Allows RPC hosts to control Anthropic prompt cache retention per-run
instead of relying solely on the PI_CACHE_RETENTION env var.

When omitted, the existing env var / default "short" behavior is
preserved. When provided, the value is forwarded through PromptOptions
to the AI provider's StreamOptions.

Valid values: "none" | "short" | "long"
```

---

## Part 3: Popeye engine-pi adapter (Popeye side)

### Goal

Forward `cacheRetention` from `EngineRunRequest` through the RPC prompt command.

### Change 1: EngineRunRequest

**File:** `packages/engine-pi/src/index.ts` (line ~123)

Add field:
```typescript
export interface EngineRunRequest {
  prompt: string;
  workspaceId?: string;
  projectId?: string | null;
  sessionPolicy?: EngineSessionPolicy;
  instructionSnapshotId?: string;
  cwd?: string;
  modelOverride?: string;
  cacheRetention?: 'none' | 'short' | 'long';  // ← ADD
  trigger?: EngineTriggerDescriptor;
  runtimeTools?: RuntimeToolDescriptor[];
}
```

### Change 2: RPC prompt command

**File:** `packages/engine-pi/src/index.ts` (line ~1306)

Current:
```typescript
sendCommand({ id: INTERNAL_IDS.prompt, type: 'prompt', message: request.prompt });
```

Change to:
```typescript
sendCommand({
  id: INTERNAL_IDS.prompt,
  type: 'prompt',
  message: request.prompt,
  ...(request.cacheRetention ? { cacheRetention: request.cacheRetention } : {}),
});
```

### Change 3: Engine config default

**File:** `packages/contracts/src/config.ts`

Add to `EngineConfigSchema`:
```typescript
defaultCacheRetention: z.enum(['none', 'short', 'long']).default('short'),
```

Update `DEFAULT_ENGINE_CONFIG`:
```typescript
defaultCacheRetention: 'short' as const,
```

### Change 4: Runtime service

**File:** `packages/runtime-core/src/runtime-service.ts`

When building the `EngineRunRequest`, apply the default:
```typescript
cacheRetention: envelope.cacheRetention ?? this.config.engine.defaultCacheRetention,
```

### Change 5: Update pi-fork-delta.md

Add under "Current child-process contract":
```
- `cacheRetention` is forwarded as an optional field in the RPC `prompt` command.
  When present, Pi's Anthropic provider uses it for prompt cache control.
  When absent, Pi falls back to `PI_CACHE_RETENTION` env var (default: "short").
```

Update "Structured request execution controls currently honored":
```
`cwd`, `modelOverride`, `cacheRetention`, and `runtimeTools`.
```

### Commit

```
feat(engine): forward per-run cacheRetention to Pi

Adds cacheRetention field to EngineRunRequest and forwards it in the
RPC prompt command. Default policy configurable via
engine.defaultCacheRetention (default: "short").

Requires Pi fork with ADR 0019 cache control support.
Closes ADR 0019.
```

---

## Summary: Total changes

| Repo | File | Lines changed (est.) |
|------|------|---------------------|
| Pi | `rpc-types.ts` | ~3 (import + field) |
| Pi | `agent-session.ts` | ~3 (import + field + threading) |
| Pi | `rpc-mode.ts` | ~1 (forward field) |
| Popeye | `engine-pi/src/index.ts` | ~5 (field + sendCommand) |
| Popeye | `contracts/src/config.ts` | ~3 (schema + default) |
| Popeye | `runtime-core/src/runtime-service.ts` | ~2 (apply default) |
| Popeye | `docs/pi-fork-delta.md` | ~5 (update docs) |

**Total: ~22 lines of code + docs.**
