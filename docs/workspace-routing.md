# Workspace Routing

How workspaces and projects are resolved during task creation and execution.

## Workspace resolution

Every task, job, and run is scoped to a workspace via `workspaceId`. Workspaces are defined in the application config and seeded into the database at startup.

When a task is created (via the control API or message ingress), the `workspaceId` field determines which workspace owns the task:

- **API/manual tasks** -- the caller specifies `workspaceId` in the `TaskCreateInput`. Defaults to `"default"` if omitted.
- **Telegram messages** -- the `workspaceId` is passed through from the ingress input. The Telegram adapter sets this to `"default"` unless overridden.
- **Heartbeat tasks** -- created automatically per workspace with ID `task:heartbeat:{workspaceId}`.
- **Scheduled tasks** -- linked to a workspace via the schedule's task.

## Project resolution

Projects are an optional sub-scope within a workspace. The `projectId` field on tasks is nullable. When present, it narrows the scope for instruction resolution and memory retrieval.

Projects are stored in the `projects` table with a `workspace_id` foreign key. They can be listed via `GET /v1/projects`.

## Execution routing

The scheduler picks due jobs in `availableAt` order. Before starting execution, it checks workspace isolation:

1. Is there an active workspace lock for `workspace:{workspaceId}`?
2. Are there any jobs in `leased` or `running` state for this workspace?

If either check is true, the job is skipped until the workspace is free. This ensures single-execution-per-workspace.

## Session routing

When a job starts execution, the runtime selects a session root based on the task source:

| Task source | Session root kind |
|-------------|------------------|
| `manual`, `api` | `interactive_main` |
| `heartbeat` | `system_heartbeat` |
| `schedule` | `scheduled_task` |
| `telegram` | `telegram_user` |

The session root scope is always the workspace ID, producing IDs like `interactive_main:default`.

## Data path layout

All runtime data is stored under the configured `runtimeDataDir`:

```
{runtimeDataDir}/
  config/           # Auth store and config files
  state/
    app.db          # Tasks, jobs, runs, receipts, interventions
    memory.db       # Memory records and embeddings
  logs/
    runs/           # Per-run log files
  receipts/
    by-run/         # Receipt JSON artifacts keyed by receipt ID
    by-day/         # (Reserved for daily receipt indexes)
  backups/          # Database backup snapshots
```

All directories are created with mode `0o700`. The default macOS data path is `~/Library/Application Support/Popeye/`.
