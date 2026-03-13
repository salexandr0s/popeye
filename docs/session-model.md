# Session Model

Sessions group related engine executions under a single logical root. The session system is defined in `@popeye/sessions` and integrated by the runtime service.

## Session root kinds

| Kind | When used | Scope |
|------|-----------|-------|
| `interactive_main` | Tasks from `manual` or `api` sources | Workspace ID |
| `system_heartbeat` | Tasks from `heartbeat` source | Workspace ID |
| `scheduled_task` | Tasks from `schedule` source | Workspace ID |
| `recovery` | Recovery sessions (reserved) | Workspace ID |
| `telegram_user` | Tasks from `telegram` source | Workspace ID |

## Session root selection

The `selectSessionRoot()` function takes a `kind` and `scope` and produces a `SessionRootRecord`:

```
id:    "{kind}:{scope}"   (e.g., "interactive_main:default")
kind:  the session root kind
scope: typically the workspace ID
```

The runtime maps task sources to session kinds:

| Task source | Session kind |
|-------------|-------------|
| `telegram` | `telegram_user` |
| `heartbeat` | `system_heartbeat` |
| `schedule` | `scheduled_task` |
| `manual`, `api` | `interactive_main` |

## Session root records

Session roots are persisted in the `session_roots` table with `INSERT OR IGNORE`, so the same logical root is reused across runs with the same kind and scope.

Each `RunRecord` references a `sessionRootId`, linking the run to its session root. The engine may also assign its own `engineSessionRef` during execution, which is captured from the engine's `session` event.

## Relationship to Pi sessions

Session roots are a Popeye runtime concept. The Pi engine manages its own session tree internally. The `engineSessionRef` stored on each run bridges the two: it records the Pi-assigned session identifier so the runtime can correlate runs with engine-level session state.
