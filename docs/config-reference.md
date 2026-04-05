# Configuration Reference

Complete reference for the Popeye daemon configuration file (`AppConfig`). The config is validated with Zod at startup; invalid values cause immediate failure with descriptive errors.

Example config: `config/example.json`

---

## Top-level fields

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `runtimeDataDir` | `string` | No | `~/Library/Application Support/Popeye/` | Absolute path to the runtime data directory. Houses state, logs, receipts, backups, and memory databases. When omitted from the config file, Popeye now derives this macOS-first default before schema validation. |
| `authFile` | `string` | No | `<runtimeDataDir>/config/auth.json` | Absolute path to the auth store JSON file. Created by `initAuthStore` on first run. Stores rotating local bearer tokens for the configured roles. When omitted, Popeye derives it from `runtimeDataDir`. |

---

## `providerAuth`

OAuth client credentials for blessed browser connect flows. These values are
used only for provider connectors; they are not part of Popeye's operator auth
model.

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `providerAuth.google.clientId` | `string` | No | unset | Google OAuth client ID used by the Gmail, Google Calendar, and Google Tasks browser connect flows. Required to start blessed Google connect sessions. |
| `providerAuth.google.clientSecretRefId` | `string` | No | unset | Popeye secret-store reference for the Google OAuth client secret. Required for token exchange and refresh-token handling. |
| `providerAuth.github.clientId` | `string` | No | unset | GitHub OAuth client ID used by the direct GitHub browser connect flow. Required to start blessed GitHub connect sessions. |
| `providerAuth.github.clientSecretRefId` | `string` | No | unset | Popeye secret-store reference for the GitHub OAuth client secret. Required for token exchange. |

If the relevant client credentials are not configured, Popeye now reports that
truth explicitly:

- `GET /v1/connections/oauth/providers` marks the provider as not ready and
  includes actionable `details`
- `POST /v1/connections/oauth/start` fails closed with
  `409 { error: "oauth_provider_not_configured", details }`

Operators should manage provider OAuth credentials through the control plane
(`GET/POST /v1/config/provider-auth/:provider`) or the macOS Setup/Settings
editor. Client secrets belong in Popeye's secret store; the config file only
stores the resulting `clientSecretRefId`.

Popeye does not silently fall back to legacy CLI-backed adapters.

---

## `security`

Network and security configuration. All fields are validated at startup.

| Field | Type | Required | Default | Constraints | Description |
|---|---|---|---|---|---|
| `bindHost` | `"127.0.0.1"` | Yes | -- | Must be literal `"127.0.0.1"` | Loopback-only binding. No remote access in v1. |
| `bindPort` | `integer` | No | `3210` | 1--65535 | TCP port for the control API. |
| `redactionPatterns` | `string[]` | No | `[]` | Each must be a valid regex, not ReDoS-vulnerable | Regex patterns for redact-on-write. Matched content is replaced with `[REDACTED:...]` in receipts, logs, and memory. |
| `promptScanQuarantinePatterns` | `string[]` | No | `[]` | Each must be a valid regex, not ReDoS-vulnerable | Regex patterns that trigger quarantine on inbound messages. Matching messages are blocked and create an intervention. |
| `promptScanSanitizePatterns` | `{ pattern: string, replacement: string }[]` | No | `[]` | Each `pattern` must be a valid regex | Regex patterns for sanitize-on-ingest. Matched content is replaced with the specified replacement string. |
| `useSecureCookies` | `boolean` | No | `false` | -- | When true, Set-Cookie headers include the `Secure` flag. Enable in production with HTTPS. |
| `tokenRotationDays` | `integer` | No | `30` | Must be positive | Days between automatic auth token rotations. |

---

## `telegram`

Telegram adapter configuration. The adapter is a thin bridge to the control API.

| Field | Type | Required | Default | Constraints | Description |
|---|---|---|---|---|---|
| `enabled` | `boolean` | No | `false` | -- | Enable the Telegram adapter. When `true`, `allowedUserId` is required. |
| `allowedUserId` | `string` | Conditional | -- | Min length 1; required when `enabled` is `true` | Telegram user ID allowed to send messages. Allowlist-only DM policy. |
| `secretRefId` | `string` | No | -- | Min length 1 | Optional Popeye secret-store reference for the Telegram bot token. Used when `TELEGRAM_BOT_TOKEN` is not present in the daemon environment. Set it with `pop telegram configure` or `/v1/secrets`. |
| `maxMessagesPerMinute` | `integer` | No | `10` | Must be positive | Per-user rate limit within the rate limit window. |
| `globalMaxMessagesPerMinute` | `integer` | No | `30` | Must be positive | Global rate limit across all users within the rate limit window. |
| `rateLimitWindowSeconds` | `integer` | No | `60` | Must be positive | Duration of the sliding rate limit window in seconds. |
| `maxConcurrentPreparations` | `integer` | No | `4` | 1--16 | Maximum concurrent Telegram reply preparation tasks. |

---

## `embeddings`

Embedding provider configuration for vector-based memory search.

| Field | Type | Required | Default | Constraints | Description |
|---|---|---|---|---|---|
| `provider` | `"disabled" \| "openai"` | No | `"disabled"` | -- | Embedding provider. Set to `"openai"` to enable vector search with sqlite-vec. |
| `model` | `string` | No | `"text-embedding-3-small"` | -- | Embedding model identifier. |
| `dimensions` | `integer` | No | `1536` | Must be positive | Embedding vector dimensions. Must match the model's output dimensions. |
| `allowedClassifications` | `DataClassification[]` | No | `["embeddable"]` | Values: `"secret"`, `"sensitive"`, `"internal"`, `"embeddable"` | Only memories with these data classifications are eligible for embedding. |

---

## `knowledge`

Knowledge-base configuration. Controls LLM-backed wiki compilation independently
from the embeddings provider.

### `knowledge.wikiCompilation`

| Field | Type | Required | Default | Constraints | Description |
|---|---|---|---|---|---|
| `provider` | `"disabled" \| "openai"` | No | `"disabled"` | -- | Wiki-compilation provider. Set to `"openai"` to enable LLM-generated wiki/index drafts. |
| `model` | `string` | No | `"gpt-4o-mini"` | Min length 1 | Model identifier for knowledge wiki compilation calls. |
| `timeoutMs` | `integer` | No | `60000` | Must be positive | Timeout for one wiki compilation request in milliseconds. |

When `knowledge.wikiCompilation` is omitted, Popeye preserves the legacy
behavior of enabling wiki compilation automatically when
`embeddings.provider === "openai"`. Set `knowledge.wikiCompilation.provider`
explicitly to control compilation independently of embeddings.

---

## `engine`

Engine adapter configuration. Controls how Pi (or a fake engine) is invoked.

| Field | Type | Required | Default | Constraints | Description |
|---|---|---|---|---|---|
| `kind` | `"fake" \| "pi"` | No | `"fake"` | -- | Engine type. `"fake"` uses a built-in test engine; `"pi"` launches a real Pi process. |
| `piPath` | `string` | No | -- | -- | Path to the Pi checkout directory. Required when `kind` is `"pi"`. |
| `piVersion` | `string` | No | -- | -- | Expected Pi version string for compatibility checks. |
| `command` | `string` | No | `"node"` | -- | Command to execute for the engine process. |
| `args` | `string[]` | No | `[]` | -- | Arguments passed to the engine command. |
| `timeoutMs` | `integer` | No | `300000` (5 min) | Must be positive | Maximum run duration in milliseconds before timeout. |
| `runtimeToolTimeoutMs` | `integer` | No | `30000` (30 sec) | Must be positive | Timeout for runtime-provided tool executions during a run. |
| `allowRuntimeToolBridgeFallback` | `boolean` | No | `true` | -- | Allows the temporary Pi extension/UI runtime-tool bridge when native host-tool RPC is unavailable. Disable for stricter deployments. |
| `defaultModel` | `string` | No | unset | Min length 1 | Default Pi model identifier when no per-run `modelOverride` is supplied and complexity routing does not select a model. |
| `fallbackModels` | `string[]` | No | `[]` | Each item min length 1 | Ordered failover chain attempted after `defaultModel` when safe automatic failover is enabled. |
| `autoFailoverEnabled` | `boolean` | No | `false` | -- | Retries the run on the next configured model only for pre-side-effect `startup_failure`, `auth_failure`, or `transient_failure` attempts. Popeye stops failover after any tool call, tool result, or non-empty assistant output. |

---

## `memory`

Memory subsystem configuration. Controls confidence decay, consolidation, and maintenance.

| Field | Type | Required | Default | Constraints | Description |
|---|---|---|---|---|---|
| `confidenceHalfLifeDays` | `number` | No | `30` | Must be positive | Days for memory confidence to decay by half without reinforcement. |
| `archiveThreshold` | `number` | No | `0.1` | 0.0--1.0 | Memories with confidence below this threshold are archived during consolidation. |
| `consolidationEnabled` | `boolean` | No | `true` | -- | Enable automatic memory consolidation (merge, decay, archive). |
| `compactionFlushConfidence` | `number` | No | `0.7` | 0.0--1.0 | Default confidence assigned to memories extracted during Pi compaction flushes. |
| `dailySummaryHour` | `integer` | No | `2` | 0--23 | Hour of day (UTC) to generate daily activity summaries. |
| `docIndexEnabled` | `boolean` | No | `true` | -- | Enable periodic indexing of workspace documentation files into memory. |
| `docIndexIntervalHours` | `integer` | No | `6` | Must be positive | Hours between documentation re-index passes. |
| `budgetAllocation` | `object` | No | `{}` | See sub-fields | Budget allocation for memory operations. |
| `budgetAllocation.enabled` | `boolean` | No | `false` | -- | Enable budget-based memory allocation limits. |
| `budgetAllocation.minPerType` | `integer` | No | `1` | Non-negative | Minimum memories allocated per type. |
| `budgetAllocation.maxPerType` | `integer` | No | `10` | Must be positive | Maximum memories allocated per type. |
| `qualitySweepEnabled` | `boolean` | No | `false` | -- | Enable periodic quality sweep to remove low-quality memories. |

---

## `workspaces`

Array of workspace configurations. Defaults to a single `"default"` workspace.

Each workspace object:

| Field | Type | Required | Default | Constraints | Description |
|---|---|---|---|---|---|
| `id` | `string` | Yes | -- | Min length 1 | Unique workspace identifier. |
| `name` | `string` | Yes | -- | Min length 1 | Human-readable workspace name. |
| `rootPath` | `string \| null` | No | `null` | -- | Absolute path to the workspace root directory. Used as the default `cwd` for runs. When file-loaded config omits this for the built-in `default` workspace, Popeye defaults it to `~/popeye-assistant` and scaffolds a Popeye-owned assistant workspace there on first daemon start, including `WORKSPACE.md`, `AGENTS.md`, `SOUL.md`, `IDENTITY.md`, `identities/default.md`, and `.popeye/context/README.md`. |
| `projects` | `ProjectConfig[]` | No | `[]` | -- | Projects within this workspace. |
| `heartbeatEnabled` | `boolean` | No | `true` | -- | Enable scheduled heartbeat runs for this workspace. |
| `heartbeatIntervalSeconds` | `integer` | No | `3600` | Must be positive | Seconds between heartbeat runs. |

### Project sub-fields

Each project within a workspace:

| Field | Type | Required | Default | Constraints | Description |
|---|---|---|---|---|---|
| `id` | `string` | Yes | -- | Min length 1 | Unique project identifier. |
| `name` | `string` | Yes | -- | Min length 1 | Human-readable project name. |
| `path` | `string \| null` | No | `null` | -- | Absolute path to the project directory. Used as the `cwd` for runs scoped to this project. |
| `workspaceId` | `string` | No | -- | Min length 1 | Parent workspace ID. Optional; inferred from placement in the workspace config. |
