# Breaking changes

This file tracks all breaking changes across Popeye releases. It is manually
curated. The release notes generator (`scripts/generate-release-notes.sh`)
flags commits containing "BREAKING" or "breaking change" but does not update
this file automatically.

**Format:** Each version has a heading and a table listing the change, what
it affects, and the migration steps an operator must follow.

---

## v0.1.0

| Change | Description | Migration steps |
|--------|-------------|-----------------|
| Remote todo provider shift | The blessed remote todo path is now Google Tasks. `google_tasks` replaces Todoist in the active provider surface, `POST /v1/todos/connect` is removed, and browser OAuth via `POST /v1/connections/oauth/start` is the connect path. | Reconnect todos through Google Tasks OAuth, update any callers to use `providerKind: "google_tasks"` with the generic OAuth start route, and stop relying on Todoist-only semantics such as native priority, labels, or due times. |
