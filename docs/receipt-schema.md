# Receipt schema

Receipts are the immutable audit record for every completed run. Every run produces
exactly one receipt, including failures and cancellations.

## Core fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique receipt ID |
| `runId` | string | The run that produced this receipt |
| `jobId` | string | Parent job |
| `taskId` | string | Parent task |
| `workspaceId` | string | Workspace scope |
| `status` | enum | `succeeded`, `failed`, `cancelled`, `abandoned` |
| `summary` | string | Human-readable outcome summary |
| `details` | string | Extended details (may be empty) |
| `usage` | UsageMetrics | Cost and token accounting (see below) |
| `runtime` | ReceiptRuntimeSummary | Execution policy, context releases, playbooks, timeline (optional, additive) |
| `createdAt` | string (ISO 8601) | When the receipt was created |

## Usage metrics

Every receipt carries cost/usage data (CLAUDE.md §2 rule 18: required field).

| Field | Type | Description |
|-------|------|-------------|
| `usage.provider` | string | Model provider name (e.g. `openai`, `anthropic`) |
| `usage.model` | string | Model identifier used for the run |
| `usage.tokensIn` | integer | Input tokens consumed |
| `usage.tokensOut` | integer | Output tokens produced |
| `usage.estimatedCostUsd` | number | Estimated cost in USD |

## Runtime summary (optional)

When present, the `runtime` section provides execution-policy context and a
chronological timeline of significant events during the run.

| Field | Type | Description |
|-------|------|-------------|
| `runtime.projectId` | string or null | Project scope |
| `runtime.profileId` | string or null | Execution profile used |
| `runtime.execution` | object or null | Execution policy snapshot (mode, memory/recall scope, filesystem policy, context release policy, session policy, warnings) |
| `runtime.contextReleases` | object or null | Aggregated context release summary (total releases, total token estimate, breakdown by domain) |
| `runtime.playbooks` | array | Applied playbook summaries (`id`, `title`, `scope`, `revisionHash`) for the active canonical playbooks that were actually compiled into the run |
| `runtime.timeline` | array | Chronological events (see Timeline events below), including additive policy/audit events such as playbook proposal creation or blocking |

## Timeline events

Each timeline event records a discrete occurrence during the run. For playbooks, `runtime.playbooks` remains the canonical list of compiled active playbooks, while proposal lifecycle events may appear in the timeline with codes such as `playbook_proposal_created`, `playbook_proposal_approved`, `playbook_proposal_applied`, or `playbook_proposal_quarantined`.

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Event ID |
| `at` | string (ISO 8601) | Timestamp |
| `kind` | enum | `run`, `policy`, `approval`, `context_release`, `warning` |
| `severity` | enum | `info`, `warn`, `error` |
| `code` | string | Machine-readable event code |
| `title` | string | Human-readable title |
| `detail` | string | Extended detail (may be empty) |
| `source` | enum | `run_event`, `security_audit`, `approval`, `context_release`, `receipt` |
| `metadata` | record | Key-value pairs for event-specific data |

## Persistence

Receipts are persisted in two locations:

1. **SQLite** — `app.db` → `receipts` table (queryable, indexed by `runId`, `jobId`, `taskId`, `workspaceId`)
2. **JSON files** — `receipts/by-run/<receiptId>.json` (human-readable, includes full runtime summary)

Receipts organized by day are also linked at `receipts/by-day/YYYY-MM-DD/`.

## Redaction

Sensitive data is redacted **before** receipt persistence (redact-on-write). The
`summary`, `details`, and timeline event fields all pass through the observability
redaction pipeline. Redacted values are replaced with `[REDACTED:<pattern>]`.

## Example receipt (JSON)

```json
{
  "id": "rcpt-20260320-abc123",
  "runId": "run-001",
  "jobId": "job-001",
  "taskId": "task-001",
  "workspaceId": "ws-default",
  "status": "succeeded",
  "summary": "Synced 42 email threads from Gmail",
  "details": "",
  "usage": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-20250514",
    "tokensIn": 1200,
    "tokensOut": 350,
    "estimatedCostUsd": 0.0045
  },
  "runtime": {
    "projectId": null,
    "profileId": "default",
    "execution": {
      "mode": "standard",
      "memoryScope": "workspace",
      "recallScope": "workspace",
      "filesystemPolicyClass": "read_only",
      "contextReleasePolicy": "summary",
      "sessionPolicy": "dedicated",
      "warnings": []
    },
    "contextReleases": null,
    "playbooks": [
      {
        "id": "workspace-triage",
        "title": "Workspace Triage",
        "scope": "workspace",
        "revisionHash": "sha256:example"
      }
    ],
    "timeline": [
      {
        "id": "evt-001",
        "at": "2026-03-20T10:30:00.000Z",
        "kind": "run",
        "severity": "info",
        "code": "run_started",
        "title": "Run started",
        "detail": "",
        "source": "run_event",
        "metadata": {}
      }
    ]
  },
  "createdAt": "2026-03-20T10:30:15.000Z"
}
```

## Querying receipts

```bash
pop receipt show <receipt-id>            # display a single receipt
pop receipt search --limit 10            # recent receipts
pop receipt search --json                # JSON output for tooling
```

Via API:
```
GET /v1/runs/:id/receipt                 # receipt for a specific run
GET /v1/receipts/:id                     # receipt by ID
```
