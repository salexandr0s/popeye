# Workspace Conventions

## Directory Layout

Runtime data lives under `~/Library/Application Support/Popeye/` (configurable via `runtimeDataDir`):

```
state/
  app.db              # Runtime database (tasks, jobs, runs, receipts, etc.)
  memory.db           # Memory database (memories, FTS5, embeddings, events)
config/
  auth.json           # Auth token store (600 permissions)
logs/
  runs/               # Per-run log files
receipts/
  by-run/             # Receipt artifacts by run ID
  by-day/             # Receipt artifacts by date
backups/              # Backup snapshots
memory/
  daily/              # Daily summary markdown files
    YYYY-MM-DD.md     # One file per day
```

## File Permissions

- Directories: `700` (owner read/write/execute only)
- Data files: `600` (owner read/write only)
- Auth files: `600` (owner read/write only)

## Scope Hierarchy

Memories and tasks are scoped:

- **global** — applies across all workspaces
- **workspace** — scoped to a specific workspace ID
- **project** — scoped to a specific project within a workspace

## Daily Summary Format

Generated at `memory/daily/YYYY-MM-DD.md`:

```markdown
# Daily Summary — YYYY-MM-DD

**Workspace:** workspace-id
**Runs completed:** N
**Runs failed:** N

## Discoveries
- Summary of successful runs...

## Errors
- Summary of failed runs...

## Follow-ups
- Items requiring attention...
```

## Memory Promotion

To promote a memory to a curated markdown file:

1. `pop memory show <id>` — inspect the memory
2. Propose promotion with target path
3. Review the diff
4. Approve and execute — creates a receipt

Promoted memories are marked with a `promoted` event in the audit trail.
