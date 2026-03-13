# Recovery Runbook

Procedures for recovering from daemon crashes, stale state, and operator interventions.

## Startup reconciliation

When the daemon starts, `PopeyeRuntimeService` runs `reconcileStartupState()` automatically. This handles state left behind by a previous unclean shutdown.

### Stale runs

Runs in `starting` or `running` state with no `finished_at` are considered stale. For each stale run:

1. An `abandoned` receipt is written (if one does not already exist for that run).
2. The run state is set to `abandoned` with an error message.
3. A recovery decision is applied to the parent job (see below).

### Stale leases

Jobs in `leased` state whose lease has expired (or has no lease record) are reset to `queued` and their lease records are deleted.

### Audit trail

If any reconciliation occurs, a `startup_reconciliation` security audit event is recorded with the counts of stale runs and stale leases.

## Recovery decisions

When a run is abandoned, `applyRecoveryDecision()` determines the next action for the parent job:

| Condition | Action |
|-----------|--------|
| Task source is `heartbeat` | Re-queue the job immediately |
| Reason mentions "auth" or "credential" | Block the job (`blocked_operator`), create `needs_credentials` intervention |
| Reason mentions "policy" | Block the job (`blocked_operator`), create `needs_policy_decision` intervention |
| Retry budget remaining | Schedule retry with exponential backoff (`waiting_retry`) |
| Retry budget exhausted | Mark job `failed_final`, create `retry_budget_exhausted` intervention |

## Intervention codes and resolution

| Code | Meaning | How to resolve |
|------|---------|---------------|
| `needs_credentials` | Engine or provider auth failed | Fix credentials, then resolve via `POST /v1/interventions/:id/resolve` |
| `needs_policy_decision` | A policy check blocked execution | Review and approve, then resolve |
| `needs_instruction_fix` | Instructions are broken or missing | Fix instruction files, then resolve |
| `needs_workspace_fix` | Workspace configuration issue | Fix workspace config, then resolve |
| `needs_operator_input` | General operator input needed | Provide input, then resolve |
| `retry_budget_exhausted` | All retry attempts failed | Investigate root cause. Manually re-enqueue via `POST /v1/jobs/:id/enqueue` or create a new task. |
| `auth_failure` | Authentication failure at runtime level | Rotate auth tokens, verify config |
| `prompt_injection_quarantined` | Inbound message failed prompt injection scan | Review the quarantined message. If safe, re-submit manually. |
| `failed_final` | Run failed with a permanent error | Investigate the run events via `GET /v1/runs/:id/events`, fix the root cause, then re-enqueue or create a new task. |

Resolving an intervention: `POST /v1/interventions/:id/resolve` sets the intervention status to `resolved` with a timestamp. The blocked job is not automatically re-queued; the operator must explicitly re-enqueue it.

## Retry mechanics

Retry delay uses exponential backoff:

```
delay = baseDelaySeconds * multiplier ^ (attempt - 1)
capped at maxDelaySeconds
```

Default policy: 3 attempts, 5s base, 2x multiplier, 900s max. Heartbeat tasks always retry immediately without budget limits.

## Manual recovery commands

| Action | API call |
|--------|----------|
| List open interventions | `GET /v1/interventions` |
| Resolve an intervention | `POST /v1/interventions/:id/resolve` |
| Re-enqueue a blocked job | `POST /v1/jobs/:id/enqueue` |
| Retry a failed run | `POST /v1/runs/:id/retry` |
| Cancel a stuck run | `POST /v1/runs/:id/cancel` |
| Check daemon state | `GET /v1/daemon/state` |
| Check scheduler status | `GET /v1/daemon/scheduler` |
