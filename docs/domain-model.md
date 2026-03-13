# Domain Model

Structured type reference for the Popeye runtime. Complements `architecture.md` with field-level detail.

## Entity Hierarchy

```
Task 1──* Job 1──* Run 1──1 Receipt
                    │
                    └──* RunEvent
```

- **Task** defines what to do (prompt, retry policy, coalesce key)
- **Job** tracks one execution attempt of a task (state machine, retry count)
- **Run** represents a single engine invocation (Pi session)
- **Receipt** is the immutable outcome record of a run

## Task

| Field | Type | Notes |
|---|---|---|
| id | string (UUID) | |
| workspaceId | string | |
| projectId | string \| null | |
| title | string | |
| prompt | string | |
| source | enum | `manual` \| `heartbeat` \| `schedule` \| `telegram` \| `api` |
| status | enum | `active` \| `paused` |
| retryPolicy | RetryPolicy | See below |
| sideEffectProfile | enum | `read_only` \| `external_side_effect` |
| coalesceKey | string \| null | Task-level dedup key |
| createdAt | string (ISO 8601) | |

## RetryPolicy

| Field | Default | Description |
|---|---|---|
| maxAttempts | 3 | Total attempts before `failed_final` |
| baseDelaySeconds | 5 | Initial backoff delay |
| multiplier | 2 | Exponential multiplier |
| maxDelaySeconds | 900 | Backoff cap |

**Formula:** `delay = min(baseDelaySeconds * multiplier^retryCount, maxDelaySeconds)`

**Exception:** Heartbeat tasks always requeue immediately on failure (no retry budget).

## Job

| Field | Type | Notes |
|---|---|---|
| id | string (UUID) | |
| taskId | string | FK to Task |
| workspaceId | string | |
| status | JobState | See state machine below |
| retryCount | number | Incremented on each retry |
| availableAt | string (ISO 8601) | When job becomes eligible for pickup |
| lastRunId | string \| null | Most recent run |
| createdAt | string (ISO 8601) | |
| updatedAt | string (ISO 8601) | |

### Job States

| State | Terminal | Description |
|---|---|---|
| queued | no | Awaiting scheduler pickup |
| leased | no | Claimed by scheduler, not yet running |
| running | no | Engine session active |
| waiting_retry | no | Failed, scheduled for retry after delay |
| paused | no | Manually paused by operator |
| blocked_operator | no | Needs operator intervention |
| succeeded | yes | Completed successfully |
| failed_final | yes | Retry budget exhausted or permanent failure |
| cancelled | yes | Cancelled by operator |

### Job State Transitions (Guarded)

| Operation | Valid Source States | Target |
|---|---|---|
| pauseJob | queued, waiting_retry, blocked_operator | paused |
| resumeJob | paused | queued |
| enqueueJob | paused, blocked_operator, failed_final, cancelled | queued |

All other source states return `null` (no-op).

## Run

| Field | Type | Notes |
|---|---|---|
| id | string (UUID) | |
| jobId | string | FK to Job |
| taskId | string | FK to Task |
| workspaceId | string | |
| sessionRootId | string | FK to SessionRoot |
| engineSessionRef | string \| null | Pi session reference |
| state | RunState | See below |
| startedAt | string (ISO 8601) | |
| finishedAt | string \| null | |
| error | string \| null | |

### Run States

| State | Terminal | Description |
|---|---|---|
| starting | no | Engine session initializing |
| running | no | Engine actively processing |
| succeeded | yes | Completed successfully |
| failed_retryable | yes | Failed, may be retried |
| failed_final | yes | Failed, no retry possible |
| cancelled | yes | Cancelled by operator or shutdown |
| abandoned | yes | Orphaned run found on startup |

**cancelRun guard:** If run is already terminal, returns the existing run unchanged.

## SessionRoot

| Field | Type | Notes |
|---|---|---|
| id | string | Deterministic: `{kind}:{scope}` |
| kind | SessionRootKind | See session-model.md |
| scope | string | Typically workspace ID |
| createdAt | string (ISO 8601) | |

## Receipt

| Field | Type | Notes |
|---|---|---|
| id | string (UUID) | |
| runId | string | |
| jobId | string | |
| taskId | string | |
| workspaceId | string | |
| status | enum | `succeeded` \| `failed` \| `cancelled` \| `abandoned` |
| summary | string | |
| details | string | |
| usage | UsageMetrics | Cost/usage data (required) |
| createdAt | string (ISO 8601) | |

Every run produces exactly one receipt, including failures and cancellations.

### UsageMetrics

| Field | Type |
|---|---|
| provider | string |
| model | string |
| tokensIn | number |
| tokensOut | number |
| estimatedCostUsd | number |

## Intervention

| Field | Type | Notes |
|---|---|---|
| id | string (UUID) | |
| code | InterventionCode | See below |
| runId | string \| null | |
| status | enum | `open` \| `resolved` |
| reason | string | |
| createdAt | string (ISO 8601) | |
| resolvedAt | string \| null | |

**Codes:** `needs_credentials`, `needs_policy_decision`, `needs_instruction_fix`, `needs_workspace_fix`, `needs_operator_input`, `retry_budget_exhausted`, `auth_failure`, `prompt_injection_quarantined`, `failed_final`

## JobLease

| Field | Type | Notes |
|---|---|---|
| jobId | string | PK, FK to Job |
| leaseOwner | string | Daemon instance ID |
| leaseExpiresAt | string (ISO 8601) | |
| updatedAt | string (ISO 8601) | |

Expired leases are swept by the scheduler: job reverts to `queued`, lease row deleted.

## Coalesce Keys

Task-level dedup mechanism. When `coalesceKey` is set on a task:
- `enqueueTask` checks for any active job (status in `queued`, `leased`, `running`, `waiting_retry`) linked to a task with the same coalesce key
- If found, enqueue returns `null` (duplicate suppressed)
- After all active jobs complete, subsequent enqueues succeed
- `null` coalesce key disables dedup (default behavior)
