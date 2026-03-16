# Incident Response Runbook

Common failure modes and diagnostic procedures for the Popeye daemon.

## Diagnostic commands

| What | Command |
|------|---------|
| Daemon health | `curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3210/v1/health` |
| Full status | `curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3210/v1/status` |
| Daemon state | `curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3210/v1/daemon/state` |
| Scheduler status | `curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3210/v1/daemon/scheduler` |
| Open interventions | `curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3210/v1/interventions` |
| Recent runs | `curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3210/v1/runs` |
| Run events | `curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3210/v1/runs/{id}/events` |
| Security audit log | `curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3210/v1/security/audit` |
| Usage summary | `curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3210/v1/usage/summary` |
| Security audit scan | `pop security audit` |

## Common failure modes

### Daemon fails to start

**Symptoms:** Process exits immediately. No `/v1/health` response.

**Possible causes:**
- Config file missing or invalid. The config is validated with Zod at startup; check stderr for validation errors.
- Auth file missing. The runtime reads the auth store on startup.
- Database directory permissions. Directories must be mode `0700`.
- Port already in use. Default port is 3210, bound to `127.0.0.1`.

**Steps:**
1. Check the config file against `config/example.json`.
2. Verify the auth file exists and is valid JSON.
3. Check directory permissions: `ls -la ~/Library/Application\ Support/Popeye/`.
4. Check for port conflicts: `lsof -i :3210`.

### Jobs stuck in queued state

**Symptoms:** Jobs remain `queued` but no runs start.

**Possible causes:**
- Scheduler not running. Check `GET /v1/daemon/scheduler` for `running: true`.
- Workspace lock held. Another run in the same workspace may still be active.
- All jobs have `availableAt` in the future (waiting for retry delay).

**Steps:**
1. Check scheduler status.
2. Check for active leases: `GET /v1/jobs/{id}/lease`.
3. Check daemon state for `activeWorkers` count.
4. If a workspace lock is stuck, restart the daemon (reconciliation will clean up).

### Runs abandoned after restart

**Symptoms:** Runs show state `abandoned` after daemon restart.

**Explanation:** This is expected behavior. Startup reconciliation marks any in-flight runs as abandoned and creates receipts. Check the recovery decision applied to the parent job.

**Steps:**
1. Check `GET /v1/interventions` for any interventions created during reconciliation.
2. Re-enqueue affected jobs if appropriate: `POST /v1/jobs/{id}/enqueue`.

### Engine startup failure

**Symptoms:** Runs fail immediately with `startup_failure` classification.

**Possible causes:**
- Pi checkout not found at configured `engine.piPath`.
- Pi command not executable or Pi CLI not built.
- Engine kind set to `pi` but Pi is not available.

**Steps:**
1. Verify Pi checkout exists: `ls ../pi/package.json` (or the configured path).
2. Verify the Pi CLI is runnable. Default `node` launches expect `packages/coding-agent/dist/cli.js` inside the Pi checkout.
3. Test the engine command manually with RPC mode.
4. Check run events for error details.
5. If Pi is not needed, set `engine.kind` to `"fake"` in config.

### Telegram messages rejected

**Symptoms:** Telegram messages return non-200 responses.

**Check the decision code in the response:**

| Decision code | Cause | Fix |
|--------------|-------|-----|
| `telegram_disabled` | `telegram.enabled` is `false` | Enable in config |
| `telegram_private_chat_required` | Message from group chat | Use private/DM chat |
| `telegram_not_allowlisted` | Sender ID does not match config | Set `telegram.allowedUserId` |
| `telegram_rate_limited` | Too many messages in window | Wait for rate limit window to pass |
| `telegram_prompt_injection` | Message flagged by prompt scan | Review message content |
| `telegram_invalid_message` | Malformed payload | Check Telegram webhook format |

### Auth token issues

**Symptoms:** All requests return `401 unauthorized`.

**Steps:**
1. Verify the token matches the one in the auth file.
2. Check if a token rotation is in progress and the overlap window has expired.
3. Re-read the auth file: the current token is in `.current.token`.

### CSRF failures

**Symptoms:** Mutating requests return `403 csrf_invalid`.

**Steps:**
1. Fetch a fresh CSRF token: `GET /v1/security/csrf-token`.
2. Include it as `x-popeye-csrf` header on mutating requests.
3. If using a browser, ensure `Sec-Fetch-Site` is `same-origin` or `none`.

## Memory System Failures

### sqlite-vec load failure

**Symptoms:** Daemon starts but memory search returns errors. Log shows `Failed to load sqlite-vec extension` or similar.

**Possible causes:**
- `sqlite-vec` native module not built for the current platform/architecture.
- `better-sqlite3` version mismatch with the `sqlite-vec` extension.
- Missing or corrupted `memory.db` file.

**Steps:**
1. Check daemon logs for the exact error message.
2. Rebuild native modules: `pnpm rebuild better-sqlite3 sqlite-vec`.
3. Verify the memory database exists: `ls ~/Library/Application\ Support/Popeye/memory.db`.
4. If the database is corrupted, restore from backup (see [Backup & Restore](docs/runbooks/backup-restore.md)).
5. Restart the daemon after fixing.

### Embedding API down

**Symptoms:** Memory writes succeed but new memories have no embeddings. Semantic search (`vsearch`) returns no results for recent content. Logs show embedding API errors.

**Possible causes:**
- OpenAI API key missing or expired.
- OpenAI API rate limit exceeded.
- Network connectivity issues to the embedding endpoint.

**Steps:**
1. Check that the embedding API key is set in the environment or secrets provider.
2. Test the API key manually: `curl -H "Authorization: Bearer $OPENAI_API_KEY" https://api.openai.com/v1/models`.
3. Check daemon logs for rate-limit (429) or auth (401) responses.
4. If the API is temporarily down, the daemon will retry on the next memory maintenance cycle. Trigger manually with `pop memory maintenance`.
5. FTS5 (lexical) search continues to work even when embeddings are unavailable.

## Cross-references

- **Backup & Restore:** See `docs/runbooks/backup-restore.md` for backup creation, verification, and restore procedures.

## Escalation

If the issue cannot be resolved with the steps above:

1. Collect the security audit log.
2. Collect the daemon state and scheduler status.
3. Export recent run events for the affected runs.
4. Check the `security_audit` table in `app.db` for patterns.
