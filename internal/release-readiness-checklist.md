# Popeye Release Readiness — Operational Checklist

**Date:** 2026-03-30  
**Companion doc:** `internal/release-readiness.md`  
**Primary remote host:** `savorgserver`  
**Purpose:** copy-pasteable release-readiness execution checklist with exact commands

> This is the command companion to `internal/release-readiness.md`.
>
> Run it from a **separate clean release worktree** so your side memory work stays untouched.
>
> It is as autonomous as Popeye can honestly be. The intentionally non-autonomous parts are:
>
> 1. provider OAuth / browser consent,
> 2. Todoist token entry,
> 3. final human go/no-go judgment,
> 4. signing / notarization credentials.

---

## 0. Work from a clean release worktree

Run this from your existing repo checkout first:

```bash
git fetch origin --tags
mkdir -p ../popeye-release-worktrees
git worktree add -f ../popeye-release-worktrees/rc main
cd ../popeye-release-worktrees/rc
```

Everything below assumes you are now inside the clean release worktree.

---

## 1. Driver-session bootstrap

### 1.1 Required local variables

```bash
export HOST="${HOST:-savorgserver}"
export RC_BRANCH="${RC_BRANCH:-main}"
export RR_ID="${RR_ID:-$(date +%F)-popeye-rc}"
export LOCAL_EVIDENCE="${LOCAL_EVIDENCE:-$PWD/dist/release-readiness/$RR_ID}"
export POPEYE_PORT="${POPEYE_PORT:-3210}"
export POPEYE_REPO_URL="${POPEYE_REPO_URL:-$(git remote get-url origin)}"
export GITHUB_REPO="${GITHUB_REPO:-$(git remote get-url origin | sed -E 's#(git@github.com:|https://github.com/)##; s#\.git$##')}"
export LOCAL_PI_DIR="${LOCAL_PI_DIR:-$(if [ -d ../../pi/.git ]; then cd ../../pi && pwd; elif [ -d ../pi/.git ]; then cd ../pi && pwd; else echo ../pi; fi)}"
export PI_REPO_URL="${PI_REPO_URL:-$(if [ -d "$LOCAL_PI_DIR/.git" ]; then git -C "$LOCAL_PI_DIR" remote get-url origin; else echo git@github.com:<set-pi-repo>.git; fi)}"
export PI_REF="${PI_REF:-$(if [ -d "$LOCAL_PI_DIR/.git" ]; then git -C "$LOCAL_PI_DIR" rev-parse HEAD; else echo main; fi)}"
mkdir -p "$LOCAL_EVIDENCE"/{00-meta,01-local,02-remote,03-soak,04-release-artifacts,05-final}
```

### 1.2 Resolve the remote path model

```bash
export REMOTE_OS="$(ssh "$HOST" 'uname -s')"
if [ "$REMOTE_OS" = "Darwin" ]; then
  export REMOTE_RUNTIME_DIR='$HOME/Library/Application Support/Popeye'
else
  export REMOTE_RUNTIME_DIR='$HOME/.local/share/popeye-release/'"$RR_ID"
fi
export REMOTE_CONFIG_PATH="$REMOTE_RUNTIME_DIR/config.json"
export REMOTE_AUTH_FILE="$REMOTE_RUNTIME_DIR/config/auth.json"
export REMOTE_REPO_DIR='$HOME/src/popeye'
export REMOTE_PI_DIR='$HOME/src/pi'
export REMOTE_EVIDENCE_DIR='$HOME/popeye-release-evidence/'"$RR_ID"
```

### 1.3 Record the execution envelope

```bash
printf '%s\n' "$HOST" | tee "$LOCAL_EVIDENCE/00-meta/host.txt"
printf '%s\n' "$REMOTE_OS" | tee "$LOCAL_EVIDENCE/00-meta/remote-os.txt"
printf '%s\n' "$POPEYE_REPO_URL" | tee "$LOCAL_EVIDENCE/00-meta/popeye-repo-url.txt"
printf '%s\n' "$LOCAL_PI_DIR" | tee "$LOCAL_EVIDENCE/00-meta/local-pi-dir.txt"
printf '%s\n' "$PI_REPO_URL" | tee "$LOCAL_EVIDENCE/00-meta/pi-repo-url.txt"
printf '%s\n' "$PI_REF" | tee "$LOCAL_EVIDENCE/00-meta/pi-ref.txt"
```

---

## 2. Freeze the release candidate locally

### 2.1 Capture candidate SHA and version

```bash
git switch "$RC_BRANCH"
git pull --ff-only
git status --short --branch | tee "$LOCAL_EVIDENCE/00-meta/git-status.txt"
export CANDIDATE_SHA="$(git rev-parse HEAD)"
export CANDIDATE_VERSION="$(node -p "require('./package.json').version")"
printf '%s\n' "$CANDIDATE_SHA" | tee "$LOCAL_EVIDENCE/00-meta/candidate-sha.txt"
printf '%s\n' "$CANDIDATE_VERSION" | tee "$LOCAL_EVIDENCE/00-meta/candidate-version.txt"
git log --oneline -n 20 | tee "$LOCAL_EVIDENCE/00-meta/recent-commits.txt"
```

### 2.2 Full local quality gate

```bash
pnpm install --frozen-lockfile 2>&1 | tee "$LOCAL_EVIDENCE/01-local/install.log"
pnpm dev-verify 2>&1 | tee "$LOCAL_EVIDENCE/01-local/dev-verify.log"
pnpm exec playwright install chromium 2>&1 | tee "$LOCAL_EVIDENCE/01-local/playwright-install.log"
pnpm test:e2e 2>&1 | tee "$LOCAL_EVIDENCE/01-local/playwright-e2e.log"
pnpm verify:pi-checkout -- --pi-path "$LOCAL_PI_DIR" 2>&1 | tee "$LOCAL_EVIDENCE/01-local/pi-checkout.log"
```

### 2.3 GitHub green gate on the same SHA

Requires `gh auth login` locally.

```bash
gh auth status 2>&1 | tee "$LOCAL_EVIDENCE/01-local/gh-auth-status.log"
gh api "repos/$GITHUB_REPO/commits/$CANDIDATE_SHA/status" \
  | tee "$LOCAL_EVIDENCE/01-local/github-commit-status.json"
gh api "repos/$GITHUB_REPO/commits/$CANDIDATE_SHA/check-runs" \
  | tee "$LOCAL_EVIDENCE/01-local/github-check-runs.json"
gh api "repos/$GITHUB_REPO/commits/$CANDIDATE_SHA/check-runs" \
  --jq '.check_runs[] | "\(.name)\t\(.status)\t\(.conclusion)"' \
  | tee "$LOCAL_EVIDENCE/01-local/github-check-runs.txt"
```

Expected green checks on the frozen SHA:

- `ci / verify`
- `security / semgrep`
- `codeql / Analyze (javascript-typescript)`
- `pi-smoke` if the intended Pi ref is part of the release bar

**Do not continue unless the expected checks are green on this exact SHA.**

---

## 3. Prepare `savorgserver`

### 3.1 Host facts

```bash
ssh "$HOST" '
  set -e
  uname -a
  sw_vers || true
  node -v || true
  corepack --version || true
  pnpm -v || true
  npm -v || true
  python3 --version || true
  command -v tmux || true
  command -v jq || true
  command -v sqlite3 || true
  command -v xdg-open || true
  command -v open || true
' | tee "$LOCAL_EVIDENCE/02-remote/host-facts.log"
```

### 3.2 Create remote working directories

```bash
ssh "$HOST" "set -e; mkdir -p $REMOTE_REPO_DIR $REMOTE_PI_DIR $REMOTE_EVIDENCE_DIR/{00-meta,01-bootstrap,02-domains,03-autonomy,04-recovery,05-packaging}"
```

### 3.3 Clone or sync Popeye + Pi remotely

```bash
ssh "$HOST" "
  set -e
  mkdir -p \$HOME/src
  if [ ! -d $REMOTE_REPO_DIR/.git ]; then
    git clone '$POPEYE_REPO_URL' $REMOTE_REPO_DIR
  fi
  if [ ! -d $REMOTE_PI_DIR/.git ]; then
    git clone '$PI_REPO_URL' $REMOTE_PI_DIR
  fi
  cd $REMOTE_REPO_DIR
  git fetch origin --tags
  git checkout '$CANDIDATE_SHA'
  cd $REMOTE_PI_DIR
  git fetch origin --tags
  git checkout '$PI_REF'
" | tee "$LOCAL_EVIDENCE/02-remote/clone-and-checkout.log"
```

### 3.4 Install dependencies and build Pi remotely

```bash
ssh "$HOST" "
  set -e
  command -v node >/dev/null
  corepack enable || true
  corepack prepare pnpm@10.32.0 --activate || true
  cd $REMOTE_REPO_DIR
  pnpm install --frozen-lockfile
  cd $REMOTE_PI_DIR
  npm ci
  npm run build
" | tee "$LOCAL_EVIDENCE/02-remote/remote-install-and-pi-build.log"
```

---

## 4. Install and configure Popeye on `savorgserver`

### 4.1 Run the bundled/source installer

```bash
ssh "$HOST" "set -e; cd $REMOTE_REPO_DIR; bash scripts/install.sh --force" \
  | tee "$LOCAL_EVIDENCE/02-remote/install-script.log"
```

### 4.2 Create a reusable remote env file

```bash
ssh "$HOST" "cat > \$HOME/.popeye-rr-env.sh <<EOF
export POPEYE_PORT='$POPEYE_PORT'
export POPEYE_REPO_DIR=\"$REMOTE_REPO_DIR\"
export POPEYE_PI_DIR=\"$REMOTE_PI_DIR\"
export POPEYE_RUNTIME_DIR=\"$REMOTE_RUNTIME_DIR\"
export POPEYE_CONFIG_PATH=\"$REMOTE_CONFIG_PATH\"
export POPEYE_AUTH_FILE=\"$REMOTE_AUTH_FILE\"
export POPEYE_EVIDENCE_DIR=\"$REMOTE_EVIDENCE_DIR\"
EOF
chmod 600 \$HOME/.popeye-rr-env.sh"
```

### 4.3 Generate a remote config from `config/example.json`

```bash
ssh "$HOST" "
  set -e
  . \$HOME/.popeye-rr-env.sh
  cd \$POPEYE_REPO_DIR
  python3 - <<'PY'
import json, os, pathlib
repo_dir = pathlib.Path(os.path.expandvars(os.path.expanduser(os.environ['POPEYE_REPO_DIR'])))
config_path = pathlib.Path(os.path.expandvars(os.path.expanduser(os.environ['POPEYE_CONFIG_PATH'])))
runtime_dir = os.path.expandvars(os.path.expanduser(os.environ['POPEYE_RUNTIME_DIR']))
auth_file = os.path.expandvars(os.path.expanduser(os.environ['POPEYE_AUTH_FILE']))
pi_dir = os.path.expandvars(os.path.expanduser(os.environ['POPEYE_PI_DIR']))
port = int(os.environ['POPEYE_PORT'])
example = repo_dir / 'config' / 'example.json'
config_path.parent.mkdir(parents=True, exist_ok=True)
config = json.loads(example.read_text())
config['runtimeDataDir'] = runtime_dir
config['authFile'] = auth_file
config['security']['bindHost'] = '127.0.0.1'
config['security']['bindPort'] = port
config['engine']['kind'] = 'pi'
config['engine']['piPath'] = pi_dir
config['engine']['command'] = 'node'
config['engine']['args'] = []
config['logging']['level'] = 'info'
config_path.write_text(json.dumps(config, indent=2) + '\n')
os.chmod(config_path, 0o600)
PY
" | tee "$LOCAL_EVIDENCE/02-remote/config-generated.log"
```

If this is meant to be a **fresh staging install** and `config.json` was absent
before the pass, but the runtime directory already contains old `state/`,
`memory/`, `receipts/`, or `vaults/` data from an earlier dev snapshot, archive
`$POPEYE_RUNTIME_DIR` before continuing, then rerun **4.3** and **4.5** against
the fresh directory. Do **not** try to treat an unknown pre-release schema as a
release-candidate upgrade proof.

### 4.4 Fill in real provider credentials remotely

This part is intentionally manual because it involves secrets.

```bash
ssh -t "$HOST" "
  . \$HOME/.popeye-rr-env.sh
  printf '\nEdit providerAuth.google / providerAuth.github and any deployment-specific settings now.\n\n'
  \${EDITOR:-vi} \"\$POPEYE_CONFIG_PATH\"
"
```

Minimum fields to fill before connect testing:

- `providerAuth.google.clientId`
- `providerAuth.google.clientSecret`
- `providerAuth.github.clientId`
- `providerAuth.github.clientSecret`
- any deployment-specific redaction patterns you need

### 4.5 Initialize all auth roles

```bash
ssh "$HOST" "
  set -e
  . \$HOME/.popeye-rr-env.sh
  cd \$POPEYE_REPO_DIR
  rm -f \"\$POPEYE_AUTH_FILE\"
  pop auth init --role operator > /dev/null
  pop auth init --role service > /dev/null
  pop auth init --role readonly > /dev/null
  python3 - <<'PY'
import json, os
path = os.path.expandvars(os.path.expanduser(os.environ['POPEYE_AUTH_FILE']))
with open(path) as fh:
    data = json.load(fh)
for role in ('operator', 'service', 'readonly'):
    current = data['roles'][role]['current']
    print(json.dumps({
        'role': role,
        'token': '<redacted>',
        'createdAt': current['createdAt'],
        'expiresAt': current.get('expiresAt'),
    }))
PY
" | tee "$LOCAL_EVIDENCE/02-remote/auth-init.log"
```

### 4.6 Verify the Pi checkout remotely

```bash
ssh "$HOST" "
  set -e
  . \$HOME/.popeye-rr-env.sh
  cd \$POPEYE_REPO_DIR
  pnpm verify:pi-checkout -- --pi-path \$POPEYE_PI_DIR
" | tee "$LOCAL_EVIDENCE/02-remote/pi-checkout.log"
```

### 4.7 Start the daemon in persistent background mode

```bash
ssh "$HOST" "
  set -e
  . \$HOME/.popeye-rr-env.sh
  pkill -f 'popeyed.js|apps/daemon/src/index.ts' || true
  cd \$POPEYE_REPO_DIR
  nohup pnpm --filter @popeye/daemon start > \"\$POPEYE_EVIDENCE_DIR/01-bootstrap/daemon.log\" 2>&1 < /dev/null &
  echo \$! > \"\$POPEYE_EVIDENCE_DIR/01-bootstrap/daemon.pid\"
  sleep 8
  cat \"\$POPEYE_EVIDENCE_DIR/01-bootstrap/daemon.pid\"
  tail -n 80 \"\$POPEYE_EVIDENCE_DIR/01-bootstrap/daemon.log\"
" | tee "$LOCAL_EVIDENCE/02-remote/daemon-start.log"
```

### 4.8 Bootstrap health proof

```bash
ssh "$HOST" "
  set -e
  . \$HOME/.popeye-rr-env.sh
  cd \$POPEYE_REPO_DIR
  pop --version
  pop security audit
  pop daemon health
  pop daemon status
  pop pi smoke
" | tee "$LOCAL_EVIDENCE/02-remote/bootstrap-health.log"
```

### 4.9 LaunchAgent proof if the remote host is macOS

```bash
if [ "$REMOTE_OS" = "Darwin" ]; then
  ssh "$HOST" "
    set -e
    . \$HOME/.popeye-rr-env.sh
    pop daemon install
    pop daemon load
    sleep 5
    pop daemon status
    pop daemon health
  " | tee "$LOCAL_EVIDENCE/02-remote/launchagent-proof.log"
fi
```

---

## 5. Open a local tunnel and extract remote tokens

### 5.1 In a second local terminal, keep this tunnel alive

```bash
ssh -N -L "$POPEYE_PORT:127.0.0.1:$POPEYE_PORT" "$HOST"
```

### 5.2 In the main terminal, fetch the remote tokens

```bash
export OPERATOR_TOKEN="$(ssh "$HOST" "
  . \$HOME/.popeye-rr-env.sh
  python3 - <<'PY'
import json, os
with open(os.path.expandvars(os.path.expanduser(os.environ['POPEYE_AUTH_FILE']))) as fh:
    print(json.load(fh)['roles']['operator']['current']['token'])
PY
")"
export SERVICE_TOKEN="$(ssh "$HOST" "
  . \$HOME/.popeye-rr-env.sh
  python3 - <<'PY'
import json, os
with open(os.path.expandvars(os.path.expanduser(os.environ['POPEYE_AUTH_FILE']))) as fh:
    print(json.load(fh)['roles']['service']['current']['token'])
PY
")"
export READONLY_TOKEN="$(ssh "$HOST" "
  . \$HOME/.popeye-rr-env.sh
  python3 - <<'PY'
import json, os
with open(os.path.expandvars(os.path.expanduser(os.environ['POPEYE_AUTH_FILE']))) as fh:
    print(json.load(fh)['roles']['readonly']['current']['token'])
PY
")"
```

### 5.3 Fetch CSRF tokens for bearer-auth mutation probes

```bash
export OPERATOR_CSRF="$(curl -fsS -H "Authorization: Bearer $OPERATOR_TOKEN" "http://127.0.0.1:$POPEYE_PORT/v1/security/csrf-token" | python3 -c 'import sys,json; print(json.load(sys.stdin)["token"])')"
export SERVICE_CSRF="$(curl -fsS -H "Authorization: Bearer $SERVICE_TOKEN" "http://127.0.0.1:$POPEYE_PORT/v1/security/csrf-token" | python3 -c 'import sys,json; print(json.load(sys.stdin)["token"])')"
export READONLY_CSRF="$(curl -fsS -H "Authorization: Bearer $READONLY_TOKEN" "http://127.0.0.1:$POPEYE_PORT/v1/security/csrf-token" | python3 -c 'import sys,json; print(json.load(sys.stdin)["token"])')"
```

---

## 6. Core API + web inspector proof

### 6.1 Readonly API probes over the tunnel

```bash
curl -fsS -H "Authorization: Bearer $READONLY_TOKEN" "http://127.0.0.1:$POPEYE_PORT/v1/health" | tee "$LOCAL_EVIDENCE/02-remote/api-health.json"
curl -fsS -H "Authorization: Bearer $READONLY_TOKEN" "http://127.0.0.1:$POPEYE_PORT/v1/status" | tee "$LOCAL_EVIDENCE/02-remote/api-status.json"
curl -fsS -H "Authorization: Bearer $READONLY_TOKEN" "http://127.0.0.1:$POPEYE_PORT/v1/daemon/state" | tee "$LOCAL_EVIDENCE/02-remote/api-daemon-state.json"
curl -fsS -H "Authorization: Bearer $READONLY_TOKEN" "http://127.0.0.1:$POPEYE_PORT/v1/daemon/scheduler" | tee "$LOCAL_EVIDENCE/02-remote/api-daemon-scheduler.json"
curl -fsS -H "Authorization: Bearer $READONLY_TOKEN" "http://127.0.0.1:$POPEYE_PORT/v1/usage/summary" | tee "$LOCAL_EVIDENCE/02-remote/api-usage-summary.json"
curl -fsS -H "Authorization: Bearer $OPERATOR_TOKEN" "http://127.0.0.1:$POPEYE_PORT/v1/security/policy" | tee "$LOCAL_EVIDENCE/02-remote/api-security-policy.json"
curl -fsS -H "Authorization: Bearer $OPERATOR_TOKEN" "http://127.0.0.1:$POPEYE_PORT/v1/connections" | tee "$LOCAL_EVIDENCE/02-remote/api-connections.json"
```

### 6.2 Role model proof

Readonly must not be allowed to create a task.

```bash
curl -s -o "$LOCAL_EVIDENCE/02-remote/readonly-task-create-response.json" -w '%{http_code}\n' \
  -H "Authorization: Bearer $READONLY_TOKEN" \
  -H "x-popeye-csrf: $READONLY_CSRF" \
  -H 'Content-Type: application/json' \
  -d '{"workspaceId":"default","projectId":null,"profileId":"default","title":"readonly-should-fail","prompt":"deny this","source":"manual","autoEnqueue":true}' \
  "http://127.0.0.1:$POPEYE_PORT/v1/tasks" \
  | tee "$LOCAL_EVIDENCE/02-remote/readonly-task-create-status.txt"
```

Service must be allowed to create a task.

```bash
curl -fsS \
  -H "Authorization: Bearer $SERVICE_TOKEN" \
  -H "x-popeye-csrf: $SERVICE_CSRF" \
  -H 'Content-Type: application/json' \
  -d '{"workspaceId":"default","projectId":null,"profileId":"default","title":"service-token-smoke","prompt":"Reply with a short health acknowledgement.","source":"api","autoEnqueue":true}' \
  "http://127.0.0.1:$POPEYE_PORT/v1/tasks" \
  | tee "$LOCAL_EVIDENCE/02-remote/service-task-create.json"
```

### 6.3 Browser bootstrap + cookie-session proof

```bash
export WEB_BOOTSTRAP_NONCE="$(curl -fsS "http://127.0.0.1:$POPEYE_PORT/" | python3 -c 'import sys,re; html=sys.stdin.read(); m=re.search(r"name=\"popeye-bootstrap-nonce\" content=\"([^\"]+)\"", html); assert m, "missing bootstrap nonce"; print(m.group(1))')"
```

```bash
curl -fsS -c "$LOCAL_EVIDENCE/02-remote/web.cookies" \
  -H "Authorization: Bearer $OPERATOR_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"nonce\":\"$WEB_BOOTSTRAP_NONCE\"}" \
  "http://127.0.0.1:$POPEYE_PORT/v1/auth/exchange" \
  | tee "$LOCAL_EVIDENCE/02-remote/web-auth-exchange.json"
```

```bash
export BROWSER_CSRF="$(curl -fsS -b "$LOCAL_EVIDENCE/02-remote/web.cookies" "http://127.0.0.1:$POPEYE_PORT/v1/security/csrf-token" | python3 -c 'import sys,json; print(json.load(sys.stdin)["token"])')"
```

```bash
curl -fsS -b "$LOCAL_EVIDENCE/02-remote/web.cookies" "http://127.0.0.1:$POPEYE_PORT/v1/status" \
  | tee "$LOCAL_EVIDENCE/02-remote/web-status.json"
```

Use the browser session to create a task, proving nonce exchange + cookie auth + CSRF on a mutation.

```bash
curl -fsS -b "$LOCAL_EVIDENCE/02-remote/web.cookies" \
  -H "x-popeye-csrf: $BROWSER_CSRF" \
  -H 'sec-fetch-site: same-origin' \
  -H 'Content-Type: application/json' \
  -d '{"workspaceId":"default","projectId":null,"profileId":"default","title":"browser-session-smoke","prompt":"Reply with the phrase browser session ok.","source":"manual","autoEnqueue":true}' \
  "http://127.0.0.1:$POPEYE_PORT/v1/tasks" \
  | tee "$LOCAL_EVIDENCE/02-remote/web-task-create.json"
```

### 6.4 Manual web inspector smoke

With the tunnel still open, visit:

- `http://127.0.0.1:$POPEYE_PORT/`

Smoke these pages against the real remote daemon:

- dashboard
- runs
- playbooks
- playbook proposals
- approvals
- standing approvals
- automation grants
- connections
- people
- files
- finance
- medical
- security policy
- usage

Record any console/server errors in `05-final/manual-ui-notes.md`.

---

## 7. CLI surface proof on the real instance

```bash
ssh "$HOST" "
  set -e
  . \$HOME/.popeye-rr-env.sh
  cd \$POPEYE_REPO_DIR
  pop --version
  pop daemon status
  pop daemon health
  pop security audit
  pop security policy
  pop runs tail
  pop runs failures
  pop interventions list
  pop memory audit
  pop profile list
  pop playbook list
  pop playbook proposals
" | tee "$LOCAL_EVIDENCE/02-remote/cli-surface.log"
```

---

## 8. Create deterministic remote fixtures

### 8.1 Files fixture set

```bash
ssh "$HOST" "
  set -e
  mkdir -p \$HOME/popeye-release-fixtures/files
  cat > \$HOME/popeye-release-fixtures/files/release-readiness.md <<'DOC'
# Release readiness fixture

Popeye release readiness requires receipts, memory, and deterministic operations.
DOC
  cat > \$HOME/popeye-release-fixtures/files/operator-notes.txt <<'DOC'
The operator validates daemon health, provider sync, approvals, backups, and rollback.
DOC
"
```

### 8.2 Finance fixture set

```bash
ssh "$HOST" "
  set -e
  mkdir -p \$HOME/popeye-release-fixtures/finance
  cat > \$HOME/popeye-release-fixtures/finance/sample.csv <<'CSV'
date,description,amount,category
2026-03-01,Payroll,3200.00,income
2026-03-03,Groceries,-84.12,groceries
2026-03-05,Transit,-23.40,transport
CSV
"
```

### 8.3 Medical fixture set

```bash
ssh "$HOST" "
  set -e
  mkdir -p \$HOME/popeye-release-fixtures/medical
  printf 'Sample medical fixture for release readiness.\n' > \$HOME/popeye-release-fixtures/medical/sample.pdf
"
```

### 8.4 Playbook fixture set

```bash
ssh "$HOST" "
  set -e
  . \$HOME/.popeye-rr-env.sh
  mkdir -p \"\$POPEYE_RUNTIME_DIR/playbooks/global\"
  cat > \"\$POPEYE_RUNTIME_DIR/playbooks/global/release-readiness.md\" <<'DOC'
---
id: release-readiness
title: Release Readiness
status: active
allowedProfileIds: []
---
Validate receipts, audit evidence, and rollback posture before publishing.
DOC
"
```

---

## 9. Files domain proof

### 9.1 Register and reindex the fixture root

```bash
ssh "$HOST" "
  set -e
  . \$HOME/.popeye-rr-env.sh
  cd \$POPEYE_REPO_DIR
  pop files add \$HOME/popeye-release-fixtures/files --label release-fixtures --permission index_and_derive
  pop files roots --json
  pop files status
" | tee "$LOCAL_EVIDENCE/02-remote/files-roots.log"
```

```bash
ssh "$HOST" "
  set -e
  . \$HOME/.popeye-rr-env.sh
  cd \$POPEYE_REPO_DIR
  ROOT_ID=\$(pop files roots --json | python3 -c 'import sys,json; roots=json.load(sys.stdin); print(next(r[\"id\"] for r in roots if r[\"label\"]==\"release-fixtures\"))')
  echo \$ROOT_ID
  pop files reindex \$ROOT_ID
  pop files search 'release readiness' --limit 10 --json
" | tee "$LOCAL_EVIDENCE/02-remote/files-search.log"
```

### 9.2 Direct file write-intent create + reject proof

```bash
export FILE_ROOT_ID="$(ssh "$HOST" "
  . \$HOME/.popeye-rr-env.sh
  cd \$POPEYE_REPO_DIR
  pop files roots --json | python3 -c 'import sys,json; roots=json.load(sys.stdin); print(next(r[\"id\"] for r in roots if r[\"label\"]==\"release-fixtures\"))'
")"
```

```bash
curl -fsS \
  -H "Authorization: Bearer $OPERATOR_TOKEN" \
  -H "x-popeye-csrf: $OPERATOR_CSRF" \
  -H 'Content-Type: application/json' \
  -d "{\"fileRootId\":\"$FILE_ROOT_ID\",\"filePath\":\"release-readiness.md\",\"intentType\":\"update\",\"diffPreview\":\"+ release checklist smoke line\"}" \
  "http://127.0.0.1:$POPEYE_PORT/v1/files/write-intents" \
  | tee "$LOCAL_EVIDENCE/02-remote/file-write-intent-create.json"
```

```bash
export FILE_WRITE_INTENT_ID="$(python3 - <<'PY'
import json, os
path = os.path.join(os.environ['LOCAL_EVIDENCE'], '02-remote', 'file-write-intent-create.json')
with open(path) as fh:
    print(json.load(fh)['id'])
PY
)"
```

```bash
ssh "$HOST" "
  set -e
  . \$HOME/.popeye-rr-env.sh
  cd \$POPEYE_REPO_DIR
  pop files review --json
  pop files reject $FILE_WRITE_INTENT_ID 'release-readiness reject-path proof'
" | tee "$LOCAL_EVIDENCE/02-remote/file-write-intent-review.log"
```

---

## 10. Provider connect + sync proof

> Gmail, Calendar, and GitHub connect flows are intentionally operator-driven. On a headless SSH host the command will usually print the OAuth URL instead of opening a browser. Follow the URL locally, complete consent, then wait for the SSH command to finish.

### 10.1 Email (Gmail)

```bash
ssh -tt "$HOST" "
  set -e
  . \$HOME/.popeye-rr-env.sh
  cd \$POPEYE_REPO_DIR
  pop email providers --json
  pop email connect --gmail
  pop email accounts --json
  pop email sync
  pop email threads --limit 10 --json
  pop email search test --limit 10 --json
  pop email digest --generate --json
" | tee "$LOCAL_EVIDENCE/02-remote/email.log"
```

### 10.2 Calendar

```bash
ssh -tt "$HOST" "
  set -e
  . \$HOME/.popeye-rr-env.sh
  cd \$POPEYE_REPO_DIR
  pop calendar connect
  pop calendar accounts --json
  pop calendar sync
  pop calendar events --upcoming --limit 20 --json
  pop calendar search meeting --limit 10 --json
  pop calendar availability --date \$(date +%F) --json
  pop calendar digest --json
" | tee "$LOCAL_EVIDENCE/02-remote/calendar.log"
```

### 10.3 GitHub

```bash
ssh -tt "$HOST" "
  set -e
  . \$HOME/.popeye-rr-env.sh
  cd \$POPEYE_REPO_DIR
  pop github connect
  pop github accounts --json
  pop github sync
  pop github repos --limit 20 --json
  pop github prs --state open --limit 20 --json
  pop github issues --state open --limit 20 --json
  pop github notifications --limit 20 --json
  pop github digest --json
" | tee "$LOCAL_EVIDENCE/02-remote/github.log"
```

### 10.4 Todoist

```bash
ssh -tt "$HOST" "
  set -e
  . \$HOME/.popeye-rr-env.sh
  cd \$POPEYE_REPO_DIR
  pop todo connect --display-name 'Release Readiness Todoist'
  pop todo accounts --json
  pop todo sync --json
  pop todo projects
  pop todo list --limit 20 --json
" | tee "$LOCAL_EVIDENCE/02-remote/todo-connect.log"
```

Create one real Todo for later mutation and policy checks.

```bash
ssh "$HOST" "
  set -e
  . \$HOME/.popeye-rr-env.sh
  cd \$POPEYE_REPO_DIR
  pop todo add 'release readiness test todo' --priority 3 --json
" | tee "$LOCAL_EVIDENCE/02-remote/todo-add.json"
```

```bash
export TODO_ID="$(python3 - <<'PY'
import json, os
path = os.path.join(os.environ['LOCAL_EVIDENCE'], '02-remote', 'todo-add.json')
with open(path) as fh:
    print(json.load(fh)['id'])
PY
)"
```

```bash
ssh "$HOST" "
  set -e
  . \$HOME/.popeye-rr-env.sh
  cd \$POPEYE_REPO_DIR
  pop todo reprioritize $TODO_ID 2 --json
  pop todo reschedule $TODO_ID 2026-04-01 --json
  pop todo complete $TODO_ID --json
  pop todo digest --json
" | tee "$LOCAL_EVIDENCE/02-remote/todo-mutate.log"
```

---

## 11. People, finance, medical, and Telegram proof

### 11.1 People

```bash
ssh "$HOST" "
  set -e
  . \$HOME/.popeye-rr-env.sh
  cd \$POPEYE_REPO_DIR
  pop people list --json
  pop people suggestions --json
" | tee "$LOCAL_EVIDENCE/02-remote/people-list.json"
```

Extract one person id if available and inspect detail / history / activity.

```bash
export PERSON_ID="$(python3 - <<'PY'
import json, os
path = os.path.join(os.environ['LOCAL_EVIDENCE'], '02-remote', 'people-list.json')
with open(path) as fh:
    data = json.load(fh)
print(data[0]['id'] if data else '')
PY
)"
if [ -n "$PERSON_ID" ]; then
  ssh "$HOST" "
    set -e
    . \$HOME/.popeye-rr-env.sh
    cd \$POPEYE_REPO_DIR
    pop people show $PERSON_ID --json
    pop people activity $PERSON_ID --json
    pop people history $PERSON_ID --json
  " | tee "$LOCAL_EVIDENCE/02-remote/people-detail.log"
fi
```

### 11.2 Finance

```bash
ssh "$HOST" "
  set -e
  . \$HOME/.popeye-rr-env.sh
  cd \$POPEYE_REPO_DIR
  pop vaults set-kek --generate
  pop vaults create finance 'Release Readiness Finance' --restricted --json
  pop vaults list --domain finance --json
  pop finance import \$HOME/popeye-release-fixtures/finance/sample.csv
  pop finance imports --json
  pop finance transactions --limit 20 --json
  pop finance search groceries --json
  pop finance digest --period 2026-03 --json
" | tee "$LOCAL_EVIDENCE/02-remote/finance.log"
```

### 11.3 Medical

```bash
ssh "$HOST" "
  set -e
  . \$HOME/.popeye-rr-env.sh
  cd \$POPEYE_REPO_DIR
  pop vaults create medical 'Release Readiness Medical' --restricted --json
  pop vaults list --domain medical --json
  pop medical import \$HOME/popeye-release-fixtures/medical/sample.pdf
  pop medical imports --json
  pop medical appointments --json
  pop medical medications --json
  pop medical search prescription --json
  pop medical digest --json
" | tee "$LOCAL_EVIDENCE/02-remote/medical.log"
```

### 11.4 Telegram

This remains a real operator bridge check. Use your allowlisted Telegram account and confirm:

1. a DM ingests,
2. a run is created,
3. a reply is delivered,
4. the run and receipt are visible through CLI / API / UI.

Capture the follow-up state with:

```bash
ssh "$HOST" "
  set -e
  . \$HOME/.popeye-rr-env.sh
  cd \$POPEYE_REPO_DIR
  pop runs tail
  pop interventions list
" | tee "$LOCAL_EVIDENCE/02-remote/telegram-followup.log"
```

Add manual notes to `05-final/telegram-manual-notes.md`.

### 11.5 Playbooks and proposals

Capture the canonical playbook surfaces:

```bash
ssh "$HOST" "
  set -e
  . \$HOME/.popeye-rr-env.sh
  cd \$POPEYE_REPO_DIR
  pop playbook list
  pop playbook show global:release-readiness
  pop playbook revisions global:release-readiness
" | tee "$LOCAL_EVIDENCE/02-remote/playbook-cli.log"
```

With the browser tunnel still open, validate against the installed daemon:

- `/playbooks`
- `/playbooks/global%3Arelease-readiness`
- `/playbook-proposals`
- `/playbook-proposals/new`

Minimum operator flow:

1. create one draft proposal from the inspector,
2. create one patch proposal against `global:release-readiness`,
3. submit one proposal for review,
4. approve and apply one proposal,
5. confirm `q` search, effectiveness metrics, and usage drilldowns render.

Record notes in `05-final/playbook-ui-notes.md`.

---

## 12. Policy substrate proof

### 12.1 Baseline visibility

```bash
ssh "$HOST" "
  set -e
  . \$HOME/.popeye-rr-env.sh
  cd \$POPEYE_REPO_DIR
  pop security policy
  pop approvals list --json
  pop standing-approvals list --json
  pop automation-grants list --json
" | tee "$LOCAL_EVIDENCE/02-remote/policy-baseline.log"
```

### 12.2 Explicit approval path — deny then approve a finance vault open

Create a finance vault id to use.

```bash
export FINANCE_VAULT_ID="$(ssh "$HOST" "
  . \$HOME/.popeye-rr-env.sh
  cd \$POPEYE_REPO_DIR
  pop vaults list --domain finance --json | python3 -c 'import sys,json; data=json.load(sys.stdin); print(data[0][\"id\"])'
")"
```

Request a pending approval.

```bash
curl -fsS \
  -H "Authorization: Bearer $OPERATOR_TOKEN" \
  -H "x-popeye-csrf: $OPERATOR_CSRF" \
  -H 'Content-Type: application/json' \
  -d "{\"scope\":\"vault_open\",\"domain\":\"finance\",\"riskClass\":\"ask\",\"actionKind\":\"open_vault\",\"resourceScope\":\"resource\",\"resourceType\":\"vault\",\"resourceId\":\"$FINANCE_VAULT_ID\",\"requestedBy\":\"release-readiness\"}" \
  "http://127.0.0.1:$POPEYE_PORT/v1/approvals" \
  | tee "$LOCAL_EVIDENCE/02-remote/approval-request-vault-open.json"
```

```bash
export APPROVAL_DENY_ID="$(python3 - <<'PY'
import json, os
path = os.path.join(os.environ['LOCAL_EVIDENCE'], '02-remote', 'approval-request-vault-open.json')
with open(path) as fh:
    print(json.load(fh)['id'])
PY
)"
```

Deny it and prove the vault cannot be opened with the denied approval.

```bash
ssh "$HOST" "
  set -e
  . \$HOME/.popeye-rr-env.sh
  cd \$POPEYE_REPO_DIR
  pop approvals deny $APPROVAL_DENY_ID 'release-readiness deny-path'
" | tee "$LOCAL_EVIDENCE/02-remote/approval-deny.log"
```

```bash
ssh "$HOST" "
  . \$HOME/.popeye-rr-env.sh
  cd \$POPEYE_REPO_DIR
  set +e
  pop vaults open $FINANCE_VAULT_ID $APPROVAL_DENY_ID
  echo EXIT_CODE=\$?
" | tee "$LOCAL_EVIDENCE/02-remote/vault-open-denied.log"
```

Request a second approval, approve it, then open the vault.

```bash
curl -fsS \
  -H "Authorization: Bearer $OPERATOR_TOKEN" \
  -H "x-popeye-csrf: $OPERATOR_CSRF" \
  -H 'Content-Type: application/json' \
  -d "{\"scope\":\"vault_open\",\"domain\":\"finance\",\"riskClass\":\"ask\",\"actionKind\":\"open_vault\",\"resourceScope\":\"resource\",\"resourceType\":\"vault\",\"resourceId\":\"$FINANCE_VAULT_ID\",\"requestedBy\":\"release-readiness\"}" \
  "http://127.0.0.1:$POPEYE_PORT/v1/approvals" \
  | tee "$LOCAL_EVIDENCE/02-remote/approval-request-vault-open-2.json"
export APPROVAL_ALLOW_ID="$(python3 - <<'PY'
import json, os
path = os.path.join(os.environ['LOCAL_EVIDENCE'], '02-remote', 'approval-request-vault-open-2.json')
with open(path) as fh:
    print(json.load(fh)['id'])
PY
)"
ssh "$HOST" "
  set -e
  . \$HOME/.popeye-rr-env.sh
  cd \$POPEYE_REPO_DIR
  pop approvals approve $APPROVAL_ALLOW_ID 'release-readiness allow-path'
  pop vaults open $FINANCE_VAULT_ID $APPROVAL_ALLOW_ID --json
  pop vaults close $FINANCE_VAULT_ID --json
" | tee "$LOCAL_EVIDENCE/02-remote/approval-approve-and-open.log"
```

### 12.3 Standing approval path — auto-approve a matching approval request

```bash
ssh "$HOST" "
  set -e
  . \$HOME/.popeye-rr-env.sh
  cd \$POPEYE_REPO_DIR
  pop standing-approvals create \
    --scope external_write \
    --domain todos \
    --action-kind write \
    --resource-type todo \
    --resource-id rr-standing \
    --resource-scope resource \
    --requested-by release-readiness \
    --created-by operator \
    --note 'release-readiness standing approval test' \
    --json
" | tee "$LOCAL_EVIDENCE/02-remote/standing-approval-create.json"
```

```bash
curl -fsS \
  -H "Authorization: Bearer $OPERATOR_TOKEN" \
  -H "x-popeye-csrf: $OPERATOR_CSRF" \
  -H 'Content-Type: application/json' \
  -d '{"scope":"external_write","domain":"todos","riskClass":"ask","actionKind":"write","resourceScope":"resource","resourceType":"todo","resourceId":"rr-standing","requestedBy":"release-readiness","standingApprovalEligible":true}' \
  "http://127.0.0.1:$POPEYE_PORT/v1/approvals" \
  | tee "$LOCAL_EVIDENCE/02-remote/standing-approval-match.json"
```

Expect the resulting approval record to already be `approved` with `resolvedBy: standing_approval`.

### 12.4 Automation grant path — auto-approve against a heartbeat run context

Get one heartbeat run id from the real daemon.

```bash
export HEARTBEAT_RUN_ID="$(ssh "$HOST" "
  . \$HOME/.popeye-rr-env.sh
  cd \$POPEYE_REPO_DIR
  pop runs tail | python3 -c 'import sys,json; runs=json.load(sys.stdin); hb=[r for r in runs if r.get(\"taskId\",\"\") == \"task:heartbeat:default\"]; print(hb[0][\"id\"] if hb else \"\")'
")"
```

If the value is empty, wait for the next heartbeat or temporarily shorten the heartbeat interval before repeating.

Create the grant.

```bash
ssh "$HOST" "
  set -e
  . \$HOME/.popeye-rr-env.sh
  cd \$POPEYE_REPO_DIR
  pop automation-grants create \
    --scope external_write \
    --domain todos \
    --action-kind write \
    --resource-type todo \
    --resource-id rr-automation \
    --resource-scope resource \
    --requested-by release-readiness \
    --task-sources heartbeat \
    --created-by operator \
    --note 'release-readiness automation grant test' \
    --json
" | tee "$LOCAL_EVIDENCE/02-remote/automation-grant-create.json"
```

Create a matching approval request with the heartbeat run context.

```bash
curl -fsS \
  -H "Authorization: Bearer $OPERATOR_TOKEN" \
  -H "x-popeye-csrf: $OPERATOR_CSRF" \
  -H 'Content-Type: application/json' \
  -d "{\"scope\":\"external_write\",\"domain\":\"todos\",\"riskClass\":\"ask\",\"actionKind\":\"write\",\"resourceScope\":\"resource\",\"resourceType\":\"todo\",\"resourceId\":\"rr-automation\",\"requestedBy\":\"release-readiness\",\"runId\":\"$HEARTBEAT_RUN_ID\",\"automationGrantEligible\":true}" \
  "http://127.0.0.1:$POPEYE_PORT/v1/approvals" \
  | tee "$LOCAL_EVIDENCE/02-remote/automation-grant-match.json"
```

Expect the resulting approval record to already be `approved` with `resolvedBy: automation_grant`.

### 12.5 Denied-path substrate proof

```bash
curl -fsS \
  -H "Authorization: Bearer $OPERATOR_TOKEN" \
  -H "x-popeye-csrf: $OPERATOR_CSRF" \
  -H 'Content-Type: application/json' \
  -d '{"scope":"external_write","domain":"finance","riskClass":"deny","actionKind":"write","resourceScope":"resource","resourceType":"finance_record","resourceId":"rr-deny","requestedBy":"release-readiness"}' \
  "http://127.0.0.1:$POPEYE_PORT/v1/approvals" \
  | tee "$LOCAL_EVIDENCE/02-remote/denied-substrate-proof.json"
```

Expect `status: denied` and `resolvedBy: policy`.

---

## 13. Memory, receipts, recall, and observability proof

### 13.1 Create one explicit CLI task run for later sampling

```bash
ssh "$HOST" "
  set -e
  . \$HOME/.popeye-rr-env.sh
  cd \$POPEYE_REPO_DIR
  pop task run 'release-readiness-cli-task' 'Summarize release readiness in one sentence.' --json
" | tee "$LOCAL_EVIDENCE/02-remote/cli-task-create.json"
```

```bash
export CLI_RUN_ID="$(python3 - <<'PY'
import json, os
path = os.path.join(os.environ['LOCAL_EVIDENCE'], '02-remote', 'cli-task-create.json')
with open(path) as fh:
    data = json.load(fh)
print((data.get('run') or {}).get('id', ''))
PY
)"
```

### 13.2 Audit and search memory / recall

```bash
ssh "$HOST" "
  set -e
  . \$HOME/.popeye-rr-env.sh
  cd \$POPEYE_REPO_DIR
  pop memory audit
  pop memory search 'release readiness' --full
  pop knowledge search 'release readiness' --full
  pop receipt search 'release readiness'
  pop memory maintenance
" | tee "$LOCAL_EVIDENCE/02-remote/memory-and-receipts.log"
```

### 13.3 Envelope, receipt, trajectory, and recall API proof

```bash
curl -fsS -H "Authorization: Bearer $READONLY_TOKEN" "http://127.0.0.1:$POPEYE_PORT/v1/runs/$CLI_RUN_ID" \
  | tee "$LOCAL_EVIDENCE/02-remote/api-run-detail.json"
curl -fsS -H "Authorization: Bearer $READONLY_TOKEN" "http://127.0.0.1:$POPEYE_PORT/v1/runs/$CLI_RUN_ID/envelope" \
  | tee "$LOCAL_EVIDENCE/02-remote/api-run-envelope.json"
curl -fsS -H "Authorization: Bearer $READONLY_TOKEN" "http://127.0.0.1:$POPEYE_PORT/v1/runs/$CLI_RUN_ID/trajectory" \
  | tee "$LOCAL_EVIDENCE/02-remote/api-run-trajectory.json"
curl -fsS -H "Authorization: Bearer $OPERATOR_TOKEN" "http://127.0.0.1:$POPEYE_PORT/v1/recall/search?q=release%20readiness&workspaceId=default" \
  | tee "$LOCAL_EVIDENCE/02-remote/api-recall-search.json"
```

### 13.4 Security audit and SSE proof

```bash
curl -fsS -H "Authorization: Bearer $READONLY_TOKEN" "http://127.0.0.1:$POPEYE_PORT/v1/security/audit" \
  | tee "$LOCAL_EVIDENCE/02-remote/api-security-audit.json"
```

```bash
curl -N -H "Authorization: Bearer $READONLY_TOKEN" "http://127.0.0.1:$POPEYE_PORT/v1/events/stream" \
  | head -n 20 | tee "$LOCAL_EVIDENCE/02-remote/api-events-stream.txt"
```

---

## 14. Backup, restore, upgrade, rollback, and reinstall proof

### 14.1 Create and verify a backup

```bash
ssh "$HOST" "
  set -e
  . \$HOME/.popeye-rr-env.sh
  cd \$POPEYE_REPO_DIR
  BACKUP_DIR=\"\$POPEYE_RUNTIME_DIR/backups/release-readiness-$RR_ID\"
  mkdir -p \"\$BACKUP_DIR\"
  pop backup create \"\$BACKUP_DIR\"
  pop backup verify \"\$BACKUP_DIR\"
" | tee "$LOCAL_EVIDENCE/02-remote/backup-create-verify.log"
```

### 14.2 Restore drill

> On non-macOS hosts, `pop daemon stop` is launchd-specific and may no-op or fail. For the staging daemon started with `nohup`, stop it with `pkill`.

```bash
ssh "$HOST" "
  set -e
  . \$HOME/.popeye-rr-env.sh
  pkill -f 'popeyed.js|apps/daemon/src/index.ts' || true
  BACKUP_DIR=\"\$POPEYE_RUNTIME_DIR/backups/release-readiness-$RR_ID\"
  pop backup restore \"\$BACKUP_DIR\"
  cd \$POPEYE_REPO_DIR
  nohup pnpm --filter @popeye/daemon start > \"\$POPEYE_EVIDENCE_DIR/04-recovery/post-restore-daemon.log\" 2>&1 < /dev/null &
  sleep 8
  pop daemon health
  pop runs tail
" | tee "$LOCAL_EVIDENCE/02-remote/restore-drill.log"
```

### 14.3 Upgrade verification scripts

```bash
ssh "$HOST" "
  set -e
  . \$HOME/.popeye-rr-env.sh
  cd \$POPEYE_REPO_DIR
  bash scripts/verify-upgrade.sh
  bash scripts/verify-upgrade-path.sh --json
  pop upgrade verify --json
" | tee "$LOCAL_EVIDENCE/02-remote/upgrade-verify.log"
```

### 14.4 Rollback drill from the created backup

```bash
ssh "$HOST" "
  set -e
  . \$HOME/.popeye-rr-env.sh
  BACKUP_DIR=\"\$POPEYE_RUNTIME_DIR/backups/release-readiness-$RR_ID\"
  pkill -f 'popeyed.js|apps/daemon/src/index.ts' || true
  pop upgrade rollback \"\$BACKUP_DIR\" || pop backup restore \"\$BACKUP_DIR\"
  cd \$POPEYE_REPO_DIR
  nohup pnpm --filter @popeye/daemon start > \"\$POPEYE_EVIDENCE_DIR/04-recovery/post-rollback-daemon.log\" 2>&1 < /dev/null &
  sleep 8
  pop daemon health
" | tee "$LOCAL_EVIDENCE/02-remote/rollback-drill.log"
```

### 14.5 Uninstall / reinstall drill if the remote host is macOS

```bash
if [ "$REMOTE_OS" = "Darwin" ]; then
  ssh "$HOST" "
    set -e
    . \$HOME/.popeye-rr-env.sh
    cd \$POPEYE_REPO_DIR
    bash scripts/uninstall.sh
    bash scripts/install.sh --force
    pop --version
    bash scripts/smoke-test.sh
  " | tee "$LOCAL_EVIDENCE/02-remote/uninstall-reinstall.log"
fi
```

---

## 15. 24-hour unattended soak

### 15.1 Start-condition snapshot

```bash
ssh "$HOST" "
  set -e
  . \$HOME/.popeye-rr-env.sh
  cd \$POPEYE_REPO_DIR
  date -u +%Y-%m-%dT%H:%M:%SZ
  pop daemon health
  pop daemon status
  pop runs tail
  pop runs failures
  pop interventions list
  pop security audit
" | tee "$LOCAL_EVIDENCE/03-soak/soak-start.log"
```

### 15.2 Snapshot loop (run locally and leave it alone)

```bash
cat > "$LOCAL_EVIDENCE/03-soak/soak-loop.sh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
HOST="${HOST:?}"
OUT_DIR="${LOCAL_EVIDENCE:?}/03-soak"
for i in $(seq 1 12); do
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  ssh "$HOST" '
    set -e
    . "$HOME/.popeye-rr-env.sh"
    cd "$POPEYE_REPO_DIR"
    printf "=== %s ===\n" "'"$stamp"'"
    pop daemon health
    pop daemon status
    pop runs tail
    pop runs failures
    pop interventions list
    pop security audit
  ' | tee "$OUT_DIR/soak-$stamp.log"
  sleep 7200
done
SH
chmod +x "$LOCAL_EVIDENCE/03-soak/soak-loop.sh"
HOST="$HOST" LOCAL_EVIDENCE="$LOCAL_EVIDENCE" "$LOCAL_EVIDENCE/03-soak/soak-loop.sh"
```

### 15.3 End-condition snapshot

```bash
ssh "$HOST" "
  set -e
  . \$HOME/.popeye-rr-env.sh
  cd \$POPEYE_REPO_DIR
  date -u +%Y-%m-%dT%H:%M:%SZ
  pop daemon health
  pop daemon status
  pop runs tail
  pop runs failures
  pop interventions list
  pop security audit
" | tee "$LOCAL_EVIDENCE/03-soak/soak-end.log"
```

---

## 16. Release artifacts and installer proof

### 16.1 Local build artifacts (macOS host)

Run this on a macOS machine with `pkgbuild` available.

```bash
bash scripts/build-pkg.sh 2>&1 | tee "$LOCAL_EVIDENCE/04-release-artifacts/build-pkg.log"
bash scripts/generate-release-notes.sh 2>&1 | tee "$LOCAL_EVIDENCE/04-release-artifacts/release-notes.log"
bash scripts/artifact-inventory.sh 2>&1 | tee "$LOCAL_EVIDENCE/04-release-artifacts/artifact-inventory.log"
ls -lah dist/pkg | tee "$LOCAL_EVIDENCE/04-release-artifacts/dist-pkg-ls.txt"
cat dist/pkg/CHECKSUMS.sha256 | tee "$LOCAL_EVIDENCE/04-release-artifacts/CHECKSUMS.sha256"
```

### 16.2 GitHub release workflow trigger

```bash
gh workflow run release.yml -f version="$CANDIDATE_VERSION" -f skip_tests=false
```

### 16.3 Local `.pkg` installer validation on macOS

```bash
sudo installer -pkg "dist/pkg/popeye-$CANDIDATE_VERSION-darwin.pkg" -target /
pkgutil --pkg-info com.popeye.cli | tee "$LOCAL_EVIDENCE/04-release-artifacts/pkgutil-info.txt"
bash scripts/smoke-test.sh 2>&1 | tee "$LOCAL_EVIDENCE/04-release-artifacts/pkg-smoke-test.log"
```

If `savorgserver` is macOS and you want to use it as the installer-validation host too:

```bash
scp "dist/pkg/popeye-$CANDIDATE_VERSION-darwin.pkg" "$HOST":/tmp/
ssh "$HOST" "sudo installer -pkg /tmp/popeye-$CANDIDATE_VERSION-darwin.pkg -target / && pkgutil --pkg-info com.popeye.cli"
```

---

## 17. Final go / no-go closeout

### 17.1 Write the final evidence summary

```bash
cat > "$LOCAL_EVIDENCE/05-final/go-no-go.md" <<EOF
# Popeye release readiness summary

- Candidate SHA: $CANDIDATE_SHA
- Candidate version: $CANDIDATE_VERSION
- Remote host: $HOST
- Remote OS: $REMOTE_OS
- Timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)

## Required checks

- [ ] local dev-verify green
- [ ] Playwright green
- [ ] GitHub checks green on candidate SHA
- [ ] remote install succeeded
- [ ] daemon health green
- [ ] Pi smoke green
- [ ] CLI / API / web surface proof complete
- [ ] files / email / calendar / github / todos / people / finance / medical / telegram validated
- [ ] playbook / proposal lifecycle validated on the installed instance
- [ ] approvals / standing approvals / automation grants validated
- [ ] memory / receipts / recall / observability validated
- [ ] backup / restore / upgrade / rollback validated
- [ ] 24h soak completed without unexplained failure
- [ ] release artifacts built
- [ ] installer proof complete on macOS

## Decision

- [ ] GO
- [ ] NO-GO

## Blockers / notes

- Fill in manually.
EOF
```

### 17.2 Tag only after GO

```bash
git tag "v$CANDIDATE_VERSION"
git push origin "$RC_BRANCH" --tags
```

---

## 18. Hard stop conditions

Stop the pass and mark **NO-GO** immediately if any of the following happens unexpectedly:

- GitHub checks are red on the frozen SHA
- daemon becomes unhealthy or dies during normal operation
- scheduler stops or stops making forward progress
- receipts stop being created
- approvals / interventions accumulate without explanation
- backup verify fails
- restore or rollback corrupts state
- web bootstrap / cookie auth fails
- provider sync repeatedly fails without a clear, fixable root cause
- the `.pkg` cannot be installed cleanly on macOS

---

## 19. Cleanup after the pass

When the pass is complete:

```bash
ssh "$HOST" "rm -f \$HOME/.popeye-rr-env.sh"
```

If you want to remove the clean local worktree after release work is finished:

```bash
cd /Users/nationalbank/GitHub/popeye
git worktree remove ../popeye-release-worktrees/rc
```
