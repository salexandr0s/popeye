# Telegram Smoke QA Harness

Use this harness to certify the macOS Setup → Telegram flow on a real clean machine before release.

## Scope

This is a **semi-automated** release gate for two daemon modes:

- `launchd`
- `manual`

The Mac app remains the source of truth for the actual operator actions. The harness captures control-plane state, mutation receipts, log scans, and a final pass/fail report.

## Commands

Start a run:

- `pnpm qa:telegram-smoke start --mode launchd`
- `pnpm qa:telegram-smoke start --mode manual`

Optional start flags:

- `--output-dir <dir>`
- `--workspace <id>`
- `--config <path>`
- `--base-url <url>`
- `--launchd-label <label>`
- `--allow-dirty-baseline`

Capture a checkpoint:

- `pnpm qa:telegram-smoke snapshot --run-dir <dir> --label after-save`
- `pnpm qa:telegram-smoke snapshot --run-dir <dir> --label after-apply`
- `pnpm qa:telegram-smoke snapshot --run-dir <dir> --label after-restart --wait-for-healthy`
- `pnpm qa:telegram-smoke snapshot --run-dir <dir> --label after-restart-request`
- `pnpm qa:telegram-smoke snapshot --run-dir <dir> --label after-manual-restart --wait-for-healthy`

Finish a run:

- `pnpm qa:telegram-smoke finish --run-dir <dir>`

## Clean baseline contract

`start` fails unless the harness sees a clean Telegram baseline or you explicitly pass `--allow-dirty-baseline`.

A clean baseline means:

- persisted Telegram config is disabled
- applied Telegram config is disabled
- no persisted `allowedUserId`
- no persisted `secretRefId`
- `secretAvailability == not_configured`
- no relay checkpoint exists for the selected workspace
- no uncertain Telegram deliveries exist for the selected workspace
- the control API management mode matches the requested mode

## Operator flow

### Launchd-managed daemon

1. Run `start --mode launchd`.
2. Open the generated `guide.md`.
3. In the Mac app, go to **Setup → Telegram**.
4. Store the bot token.
5. Save Telegram config.
6. Capture `after-save`.
7. Click **Apply Now**.
8. Capture `after-apply`.
9. If Telegram is still inactive, click **Restart Daemon**.
10. Wait for reconnect and capture `after-restart --wait-for-healthy`.
11. Run `finish` and review `result.md`.

### Manual/dev-run daemon

1. Run `start --mode manual`.
2. Open the generated `guide.md`.
3. In the Mac app, go to **Setup → Telegram**.
4. Store the bot token.
5. Save Telegram config.
6. Capture `after-save`.
7. Click **Apply Now**.
8. Capture `after-apply`.
9. Click **Restart Daemon** and confirm the app says manual restart is required.
10. Capture `after-restart-request`.
11. Restart the daemon manually outside the app.
12. Reconnect the app and capture `after-manual-restart --wait-for-healthy`.
13. Run `finish` and review `result.md`.

## Artifact layout

Each run directory contains:

- `run.json`
- `guide.md`
- `preflight.json`
- `before.json`
- checkpoint JSON files such as `after-save.json`
- `log-scan.json`
- `result.json`
- `result.md`

## What the harness verifies

Automated checks include:

- clean baseline or explicit dirty override
- expected management mode
- `telegram_config_update` receipt after save
- `telegram_apply` receipt after apply
- `daemon_restart` receipt when restart was needed/requested
- relay checkpoint or uncertain-delivery evidence before marking Telegram active
- no secret-like material in captured artifacts or scanned logs

The harness also scans:

- the run artifact directory
- runtime logs under the configured runtime data dir
- launchd stdout/stderr logs when a launchd plist is present

## Manual attestation still required

The harness cannot certify:

- screenshot cleanliness
- the exact visible copy tone/clarity in the app

Before sign-off, check the boxes in `result.md` for:

- no Telegram bot token visible in screenshots
- correct launchd/manual restart wording in Setup

## Failure interpretation

Ship blockers:

- any automated failure in `result.md`
- any token/secret leak finding in `log-scan.json` or `result.md`
- launchd/manual mismatch
- missing expected mutation receipts
- Telegram shown active without relay evidence

Warnings that still need review:

- scheduler not running during preflight
- missing optional launchd log files on a manual/dev-run machine
- dirty baseline when intentionally using `--allow-dirty-baseline`
