# macOS Hardening Checklist

This runbook closes the short hardening pass after the Setup + Brain + Automations + life-surface rollout.

## 1. Telegram smoke test

Run the harness on two clean machines:

- **launchd-managed daemon**
- **manual/dev-run daemon**

For each machine:

1. Start a run:
   - launchd:
     - `pnpm qa:telegram-smoke start --mode launchd`
   - manual/dev-run:
     - `pnpm qa:telegram-smoke start --mode manual`
2. Open the generated `guide.md` in the run directory and follow the in-app steps from **Setup → Telegram**.
3. Capture the required checkpoints with `snapshot` commands from the guide:
   - `after-save`
   - `after-apply`
   - `after-restart` for launchd when needed
   - `after-restart-request` and `after-manual-restart` for manual/dev-run
4. Finish the run:
   - `pnpm qa:telegram-smoke finish --run-dir <artifact-dir>`
5. Review the generated artifacts:
   - `preflight.json`
   - `before.json`
   - checkpoint JSON files
   - `log-scan.json`
   - `result.json`
   - `result.md`
6. Confirm `result.md` passes automated checks and complete the manual attestation items:
   - no token value appears in screenshots
   - launchd/manual restart wording matched the UI
7. Treat any automated failure or token-leak finding as a ship blocker.

See `docs/internal/dashboard/telegram_smoke_qa.md` for the full harness flow, artifact layout, and failure interpretation.

## 2. Workspace-switch regression sweep

With at least two workspaces, switch the toolbar workspace picker and verify:

- **Home** reloads summary cards, automations, calendar/todo snippets, and recent memory
- **Brain** reloads identities, default identity, and instruction preview
- **Memory** clears stale selection and reloads the selected mode
- **Instructions** adopts the workspace scope when still following the app-default scope
- **Automations** clears stale detail and reloads the current workspace
- **Files** reloads workspace-scoped roots/search and clears stale document detail
- **Setup** keeps Telegram labeled as runtime-global even when the selected workspace changes

## 3. Control-change visibility

Verify recent mutation receipts are visible in:

- **Setup → Telegram detail**
- **Usage & Security → Recent Control Changes**
- **Automations detail** after enable/disable, cadence edit, pause/resume, or run-now

For each surface, confirm:

- status is visible
- actor/workspace labeling is accurate
- details are redacted and never contain secrets
- drill-through/detail presentation is readable and native-feeling

## 4. Automation editing guardrails

Verify:

- enable/disable works for surfaced editable automations
- cadence editing is shown only for surfaced editable automations
- heartbeat automations now expose cadence editing and persist back to workspace heartbeat config
- unsupported automation kinds still do **not** expose cadence editing
- unsupported edits return clear inline errors without corrupting the UI state

## 5. Curated markdown editor sweep

Verify on both Instructions and curated Memory documents:

- editing feels native on macOS:
  - undo/redo
  - spellcheck
  - find
  - selection behavior
  - `⌘S`
- propose-save shows a readable review state before apply
- apply-save updates the document and surfaces the resulting receipt
- revision conflicts show a clear banner without discarding the local draft
- no document save bypasses the control API

## 6. Final release gate

Before shipping:

- `cd apps/macos/PopeyeMac && swift test`
- targeted Vitest for touched runtime/control-api files
- full `dev-verify`
