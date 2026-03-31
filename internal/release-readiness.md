# Popeye Release Readiness Plan

**Date:** 2026-03-30  
**Status:** Draft execution plan  
**Target product version:** `0.1.0` (or the next version bumped immediately before release)  
**Primary staging / operational validation host:** `savorgserver` over SSH  
**Primary repo:** `popeye`  
**Primary engine repo:** sibling `pi` checkout  
**Requested path:** `internal/release-readiness.md`  
**Classification:** New platform implementation maintenance  
**Scope:** Release readiness, staging validation, operational proof, packaging proof, and final go/no-go  
**Operational companion:** `internal/release-readiness-checklist.md`

---

## 1. Objective

Get Popeye to a release candidate state that is not merely "tests pass in dev," but:

1. **GitHub and local verification are green**
2. **The actual product is installed and running on `savorgserver`**
3. **The daemon survives real startup / stop / restart / upgrade / rollback / restore flows**
4. **All first-class domains and operator surfaces are exercised against a real running instance**
5. **Autonomous behavior is validated over a sustained soak period**
6. **Release artifacts (`.pkg`, tarball, checksums, notes, inventory) are built and verified**
7. **There is explicit go/no-go evidence, not just confidence**

---

## 2. Important truth before starting

### 2.1 `savorgserver` is necessary, but it may not be sufficient

The canonical polished release gate still requires a **macOS-first** shipping story and an official signed/notarized macOS `.pkg`.

Therefore:

- If `savorgserver` **is macOS**, it can serve as both:
  - the staging/soak host, and
  - the install / upgrade / rollback / packaging validation host.
- If `savorgserver` is **not macOS**, it can still serve as:
  - the real operational staging host,
  - the autonomy soak host,
  - the real-engine runtime validation host,
  - but it **cannot** be the final proof for the macOS installer release gate.

If `savorgserver` is not macOS, this plan still uses it for the main operational pass, but adds a final **clean macOS installer pass** before release is called GO.

### 2.2 We do not start this pass on a moving target

Before starting the remote readiness pass:

- merge all intended release-candidate changes (including the ESLint PR and any memory improvements meant for this release), or
- explicitly defer them.

No opportunistic feature work or toolchain work happens during readiness validation except **blocker fixes**.

---

## 3. Release candidate entry criteria

Do **not** start the remote execution phases until all of the following are true.

### 3.1 Candidate freeze

- [ ] Release-candidate scope is decided
- [ ] Memory-side work for this release is either merged or explicitly excluded
- [ ] PR #26 (`chore/toolchain-eslint-10`) is merged, or superseded by an equivalent green state on `main`
- [ ] `main` is the source of truth for the release candidate
- [ ] Candidate SHA is recorded
- [ ] Candidate version is recorded

### 3.2 Repo health

On the release-candidate SHA:

- [ ] `git status` clean
- [ ] `pnpm install --frozen-lockfile`
- [ ] `pnpm dev-verify`
- [ ] `pnpm exec playwright install chromium`
- [ ] `pnpm test:e2e`
- [ ] `pnpm verify:pi-checkout -- --pi-path ../pi`
- [ ] GitHub Actions on the candidate SHA are green:
  - [ ] `ci / verify`
  - [ ] `security / semgrep`
  - [ ] `codeql / Analyze (javascript-typescript)`
  - [ ] `pi-smoke` if the release-candidate Pi ref is part of the gate

### 3.3 Documentation alignment

- [ ] `docs/current-state-matrix.md` still matches repo truth
- [ ] `docs/fully-polished-release-gate.md` remains the acceptance bar
- [ ] runbooks used in this plan exist and are current enough to follow:
  - [ ] `docs/runbooks/bootstrap.md`
  - [ ] `docs/runbooks/daemon.md`
  - [ ] `docs/runbooks/backup-restore.md`
  - [ ] `docs/runbooks/upgrade.md`
  - [ ] `docs/runbooks/release-engineering.md`

---

## 4. Evidence model

Every phase must leave artifacts. No phase counts as complete without saved evidence.

## 4.1 Evidence directories

### Local

```bash
export RR_ID="$(date +%F)-popeye-rc"
export LOCAL_EVIDENCE="$PWD/dist/release-readiness/$RR_ID"
mkdir -p "$LOCAL_EVIDENCE"/{00-meta,01-local,02-remote,03-soak,04-release-artifacts,05-final}
```

### Remote (`savorgserver`)

```bash
ssh savorgserver 'mkdir -p "$HOME/popeye-release-evidence"'
ssh savorgserver 'mkdir -p "$HOME/popeye-release-evidence/'"$RR_ID"'/{00-meta,01-bootstrap,02-domains,03-autonomy,04-recovery,05-packaging}"'
```

## 4.2 Evidence files to collect

Minimum required:

- `candidate-sha.txt`
- `candidate-version.txt`
- local `dev-verify.log`
- local `playwright-e2e.log`
- GitHub check screenshots or API snapshots
- remote bootstrap logs
- remote daemon health snapshots
- remote domain validation logs
- remote approvals/autonomy logs
- remote backup/restore logs
- remote upgrade/rollback logs
- soak summary
- artifact checksums
- release notes draft
- artifact inventory
- final go/no-go checklist

---

## 5. Phase 0 — Freeze the candidate and capture the baseline

## 5.1 Operator decisions

Before touching `savorgserver`, explicitly decide:

- what memory changes are included in this release
- whether release target is still `0.1.0` or needs a version bump
- whether `savorgserver` is staging-only or also the final installer-validation host

## 5.2 Commands

```bash
git switch main
git pull --ff-only
git rev-parse HEAD | tee "$LOCAL_EVIDENCE/00-meta/candidate-sha.txt"
node -p "require('./package.json').version" | tee "$LOCAL_EVIDENCE/00-meta/candidate-version.txt"
pnpm install --frozen-lockfile 2>&1 | tee "$LOCAL_EVIDENCE/01-local/install.log"
pnpm dev-verify 2>&1 | tee "$LOCAL_EVIDENCE/01-local/dev-verify.log"
pnpm exec playwright install chromium 2>&1 | tee "$LOCAL_EVIDENCE/01-local/playwright-install.log"
pnpm test:e2e 2>&1 | tee "$LOCAL_EVIDENCE/01-local/playwright-e2e.log"
pnpm verify:pi-checkout -- --pi-path "$LOCAL_PI_DIR" 2>&1 | tee "$LOCAL_EVIDENCE/01-local/pi-checkout.log"
```

When running from the required clean release worktree, resolve `LOCAL_PI_DIR` to
the actual sibling Pi checkout before this block (for example `../../pi` from
`../popeye-release-worktrees/rc`).

## 5.3 Exit criteria

- [ ] local candidate SHA recorded
- [ ] local candidate version recorded
- [ ] local full verification green
- [ ] local Playwright green
- [ ] local Pi checkout verification green
- [ ] GitHub checks green on same SHA

---

## 6. Phase 1 — Prepare `savorgserver`

## 6.1 Host facts (first command we run)

```bash
ssh savorgserver '
  set -e
  uname -a
  sw_vers || true
  node -v || true
  pnpm -v || true
  python3 --version || true
  command -v tmux || true
  command -v jq || true
  command -v sqlite3 || true
' | tee "$LOCAL_EVIDENCE/02-remote/host-facts.log"
```

Record:

- OS and version
- architecture
- Node version
- pnpm version
- whether it is macOS

## 6.2 Remote working directories

Recommended remote layout:

```text
~/src/popeye
~/src/pi
~/popeye-release-evidence/<RR_ID>/...
```

## 6.3 Clone / sync candidate code

```bash
ssh savorgserver '
  set -e
  mkdir -p ~/src
  if [ ! -d ~/src/popeye/.git ]; then
    git clone <POPEYE_REPO_URL> ~/src/popeye
  fi
  if [ ! -d ~/src/pi/.git ]; then
    git clone <PI_REPO_URL> ~/src/pi
  fi
  cd ~/src/popeye
  git fetch origin --tags
  git checkout <CANDIDATE_SHA>
  cd ~/src/pi
  git fetch origin --tags
  git checkout <PI_REF_FOR_RC>
'
```

> Replace `<CANDIDATE_SHA>` with the frozen Popeye SHA.  
> Replace `<PI_REF_FOR_RC>` with the pinned Pi ref intended for the release candidate.

## 6.4 Remote dependency install and Pi build

```bash
ssh savorgserver '
  set -e
  cd ~/src/popeye
  pnpm install --frozen-lockfile
  cd ~/src/pi
  npm ci
  npm run build
' | tee "$LOCAL_EVIDENCE/02-remote/remote-install-and-pi-build.log"
```

## 6.5 Exit criteria

- [ ] `savorgserver` OS identified
- [ ] repo and Pi checkouts exist
- [ ] candidate SHA checked out remotely
- [ ] remote `pnpm install --frozen-lockfile` succeeded
- [ ] remote Pi build succeeded

---

## 7. Phase 2 — Install Popeye on `savorgserver`

This phase proves an actual installation, not just a dev checkout.

## 7.1 Preferred execution mode order

1. **Bundled/source install** from repo checkout (`scripts/install.sh`) — mandatory
2. **LaunchAgent-managed daemon** — mandatory if `savorgserver` is macOS
3. **`.pkg` install validation** — mandatory for final release sign-off if `savorgserver` is macOS; otherwise done later on a separate clean macOS host

## 7.2 Bundled/source install on `savorgserver`

```bash
ssh savorgserver '
  set -e
  cd ~/src/popeye
  bash scripts/install.sh --force
' | tee "$LOCAL_EVIDENCE/02-remote/install-script.log"
```

## 7.3 Remote config and auth path setup

On `savorgserver`, the plan assumes:

```bash
export POPEYE_CONFIG_PATH="$HOME/Library/Application Support/Popeye/config.json"
```

Add it to the remote shell profile before continuing.

## 7.4 Remote config tasks

Update the remote config for the real candidate environment:

- set `engine.kind` to `pi`
- set `engine.piPath` to the remote Pi checkout path
- set `engine.piVersion` to match the Pi checkout
- set provider OAuth credentials where needed
- ensure loopback bind remains `127.0.0.1`
- confirm runtime paths are correct and writable

If this pass is supposed to validate a **fresh staging install** and
`config.json` did not exist at the start, but the runtime directory already
contains stale `state/`, `memory/`, `receipts/`, or `vaults/` data from an
earlier dev snapshot, archive the runtime directory and regenerate the config
before continuing. That stale snapshot is environmental contamination, not
evidence of a supported release-candidate upgrade path.

## 7.5 Foreground daemon proof

```bash
ssh savorgserver '
  set -e
  export POPEYE_CONFIG_PATH="$HOME/Library/Application Support/Popeye/config.json"
  cd ~/src/popeye
  rm -f "$HOME/Library/Application Support/Popeye/config/auth.json"
  pop auth init > /dev/null
  pnpm verify:pi-checkout -- --pi-path ~/src/pi
  pop daemon start
' | tee "$LOCAL_EVIDENCE/02-remote/foreground-daemon-start.log"
```

Immediately after:

```bash
ssh savorgserver '
  set -e
  export POPEYE_CONFIG_PATH="$HOME/Library/Application Support/Popeye/config.json"
  pop security audit
  pop daemon health
  pop daemon status
  pop pi smoke
' | tee "$LOCAL_EVIDENCE/02-remote/bootstrap-health.log"
```

## 7.6 LaunchAgent proof (macOS only)

```bash
ssh savorgserver '
  set -e
  export POPEYE_CONFIG_PATH="$HOME/Library/Application Support/Popeye/config.json"
  pop daemon install
  pop daemon load
  sleep 5
  pop daemon status
  pop daemon health
' | tee "$LOCAL_EVIDENCE/02-remote/launchagent-proof.log"
```

## 7.7 Exit criteria

- [ ] `pop` installed and on PATH remotely
- [ ] `pop --version` works remotely
- [ ] auth store initialized remotely
- [ ] remote security audit passes
- [ ] remote daemon health passes
- [ ] remote Pi smoke passes
- [ ] LaunchAgent mode verified if host is macOS

---

## 8. Phase 3 — Validate primary operator surfaces

## 8.1 CLI surface

Capture these commands on `savorgserver`:

```bash
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
```

Save to:

- `02-domains/cli-surface.log`

Pass criteria:

- no crashes
- no unauthorized failures from correctly configured local usage
- outputs are structurally sane

## 8.2 Web inspector

### Required validation

1. **Automated**: existing Playwright suite stays green on the candidate SHA
2. **Installed-instance validation**: verify the real running daemon/UI on `savorgserver`

### Access method

If the host is remote, port-forward locally:

```bash
ssh -L 3210:127.0.0.1:3210 savorgserver
```

Then visit:

- `http://127.0.0.1:3210`

### Minimum manual installed-instance smoke

Verify the following pages load against the actual `savorgserver` daemon:

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

Pass criteria:

- pages load without console/server crashes
- data shown matches CLI/API state
- navigation works end to end

> Note: the current Playwright suite validates the web inspector in a controlled local test harness. It does **not** by itself prove the real installed `savorgserver` instance. This plan therefore requires both the existing automated suite and an installed-instance UI smoke.

---

## 9. Phase 4 — Domain-by-domain product validation on `savorgserver`

This phase proves the product, not just the framework.

## 9.1 Files

### Setup

Create a sanitized fixture directory on `savorgserver` with markdown/text files.

### Commands

```bash
pop files add ~/popeye-release-fixtures/files --label release-fixtures --permission index_and_derive
pop files roots --json
pop files reindex <root-id>
pop files status
pop files search "release readiness" --limit 10 --json
```

### Pass criteria

- root registration succeeds
- reindex succeeds
- files become searchable
- file root stats update correctly

### Extra validation

Run at least one task that proposes a file write intent, then validate:

```bash
pop files review --json
pop files apply <intent-id>
# or
pop files reject <intent-id> "release-readiness rejection test"
```

This proves the write-intent review queue works end to end.

## 9.2 Playbooks and proposals

### Setup

Create one deterministic canonical playbook fixture on `savorgserver` before the
installed-instance UI smoke:

- one **active** global playbook file under the runtime `playbooks/global/`
  directory
- title/body that clearly identify it as a release-readiness fixture

### Required validation

CLI:

```bash
pop playbook list
pop playbook show global:release-readiness
pop playbook revisions global:release-readiness
```

Web inspector:

- `/playbooks`
- `/playbooks/global%3Arelease-readiness`
- `/playbook-proposals`
- `/playbook-proposals/new`

Operator flow:

- create one draft proposal from the web inspector
- create one patch proposal against the canonical playbook
- if stale evidence exists, verify a drafting repair proposal can be surfaced
- submit at least one proposal for review
- approve and apply one proposal back into the canonical file
- verify search via `q` and the playbook effectiveness / usage drilldowns render
  against the installed daemon

### Pass criteria

- canonical playbook discovery works on the installed instance
- proposal authoring / review / apply work end to end
- only approved + applied + activated canonical playbooks affect runtime
- playbook/proposal pages load without console/server crashes

## 9.3 Email (blessed Gmail path)

### Commands

```bash
pop email providers --json
pop email connect --gmail [--read-write if needed]
pop email accounts --json
pop email sync
pop email threads --limit 10 --json
pop email search "test" --limit 10 --json
pop email digest --generate --json
```

### Pass criteria

- OAuth connect completes
- account appears
- sync completes without fatal errors
- threads/search/digest all work
- receipts exist for sync/digest runs

## 9.4 Calendar (blessed Google Calendar path)

### Commands

```bash
pop calendar connect [--read-write if needed]
pop calendar accounts --json
pop calendar sync
pop calendar events --upcoming --limit 20 --json
pop calendar search "meeting" --limit 10 --json
pop calendar availability --date $(date +%F) --json
pop calendar digest --json
```

### Pass criteria

- OAuth connect completes
- account appears
- sync succeeds
- events/search/availability/digest all work

## 9.5 GitHub (blessed direct API path)

### Commands

```bash
pop github connect [--read-write if needed]
pop github accounts --json
pop github sync
pop github repos --limit 20 --json
pop github prs --state open --limit 20 --json
pop github issues --state open --limit 20 --json
pop github notifications --limit 20 --json
pop github digest --json
```

### Pass criteria

- OAuth connect completes
- account appears
- sync succeeds
- repos/PRs/issues/notifications/digest all work

## 9.6 Todos (blessed Todoist path)

### Commands

```bash
pop todo connect --display-name "Release Readiness Todoist"
pop todo accounts --json
pop todo sync --json
pop todo projects
pop todo list --limit 20 --json
pop todo add "release readiness test todo" --priority 3
pop todo reprioritize <todo-id> 2
pop todo reschedule <todo-id> 2026-04-01
pop todo complete <todo-id>
pop todo digest --json
```

### Pass criteria

- account appears
- sync succeeds
- CRUD-ish workflow works through policy/approval model
- digest works

## 9.7 People

### Commands

```bash
pop people list --json
pop people search "<known-person>" --limit 10 --json
pop people suggestions --json
pop people activity <person-id> --json
pop people history <person-id> --json
```

### Pass criteria

- people graph exists after email/calendar/GitHub sync
- search/suggestions/activity/history all work
- no crashes or malformed outputs

## 9.8 Finance (restricted domain)

### Setup

Prepare a sanitized finance CSV fixture before the remote pass.

### Commands

```bash
pop vaults set-kek --generate
pop vaults create finance "Release Readiness Finance" --restricted
pop vaults list --domain finance --json
pop finance import ~/popeye-release-fixtures/finance/sample.csv
pop finance imports --json
pop finance transactions --limit 20 --json
pop finance search "groceries" --json
pop finance digest --period 2026-03 --json
```

### Pass criteria

- KEK stored successfully
- restricted finance vault created
- import succeeds
- transactions/search/digest work
- data remains in restricted vault-backed storage

## 9.9 Medical (restricted domain)

### Setup

Prepare sanitized medical fixture(s) before the remote pass.

### Commands

```bash
pop vaults create medical "Release Readiness Medical" --restricted
pop vaults list --domain medical --json
pop medical import ~/popeye-release-fixtures/medical/sample.pdf
pop medical imports --json
pop medical appointments --json
pop medical medications --json
pop medical search "prescription" --json
pop medical digest --json
```

### Pass criteria

- restricted medical vault created
- import succeeds
- appointments/medications/search/digest work
- restricted-domain posture remains intact

## 9.10 Telegram bridge

### Required proof

At least one real DM round trip using the allowlisted account:

- message ingests
- prompt scan is applied
- run is created
- reply is persisted and delivered
- receipts remain visible through the control plane

### Pass criteria

- bridge remains thin and non-admin
- no bypass of control API
- no remote admin dependency on Telegram

---

## 10. Phase 5 — Approvals, autonomy, and policy enforcement

This phase is mandatory. Popeye is not release-ready without policy proof.

## 10.1 Baseline policy visibility

```bash
pop security policy
pop approvals list
pop standing-approvals list
pop automation-grants list
```

## 10.2 Explicit approval path

Exercise at least one action that should require approval (recommended: a Todo write or a vault open / context release path).

### Required evidence

- approval requested
- approval visible via CLI/API/UI
- operator approves or denies it
- resulting action outcome matches the approval decision
- receipt and audit trail exist

## 10.3 Standing approval path

Create one standing approval and prove it is respected.

Recommended test:

```bash
pop standing-approvals create \
  --scope external_write \
  --domain todos \
  --action-kind write \
  --resource-type todo \
  --resource-id "*" \
  --resource-scope resource \
  --created-by operator \
  --note "release readiness standing approval test"
```

Then perform a Todo write and confirm it no longer requires a per-action approval.

## 10.4 Automation grant path

Create one automation grant for an eligible action and prove unattended execution works.

Recommended test:

```bash
pop automation-grants create \
  --scope external_write \
  --domain todos \
  --action-kind write \
  --resource-type todo \
  --resource-id "*" \
  --resource-scope resource \
  --task-sources heartbeat,schedule \
  --created-by operator \
  --note "release readiness automation grant test"
```

Then run a scheduled/automated Todo write path and confirm:

- no per-action approval appears
- action still leaves receipts/audit evidence

## 10.5 Denied-path proof

Exercise one explicitly denied path (recommended: restricted-domain mutation or a disallowed scope) and prove:

- action is denied
- no side effect occurs
- denial is visible to the operator

---

## 11. Phase 6 — Memory, receipts, auditability, and observability

## 11.1 Memory proof

### Commands

```bash
pop memory audit
pop memory search "release readiness"
pop knowledge search "release readiness"
pop memory maintenance
```

### Required evidence

- new runs produce receipts
- receipts feed searchable memory
- memory audit responds cleanly
- maintenance runs cleanly

## 11.2 Receipt proof

For representative runs from multiple domains:

```bash
pop runs tail
pop receipt show <receipt-id>
pop receipt search "release"
pop run show <run-id>
pop run envelope <run-id>
```

### Pass criteria

Each sampled receipt should show:

- run status
- timestamps
- model/provider context where applicable
- usage / cost fields
- enough evidence for operator diagnosis

## 11.3 Security audit and API health proof

Using CLI and direct API:

```bash
pop security audit
pop daemon health
```

And with a token:

```bash
TOKEN=$(jq -r '.current.token' "$HOME/Library/Application Support/Popeye/config/auth.json")
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3210/v1/health
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3210/v1/status
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3210/v1/daemon/state
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3210/v1/daemon/scheduler
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3210/v1/security/audit
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3210/v1/usage/summary
```

### Pass criteria

- loopback auth works
- daemon state is coherent
- scheduler reports healthy
- no unexpected auth/CSRF/security noise

---

## 12. Phase 7 — Backup, restore, upgrade, rollback, and uninstall/reinstall

This is mandatory. Popeye is not release-ready without operational reversibility.

## 12.1 Backup/verify/restore drill

### Commands

```bash
pop daemon stop
pop backup create
pop backup verify <backup-path>
pop daemon start
pop daemon health
```

Then perform an actual restore drill onto a controlled state:

```bash
pop daemon stop
pop backup restore <backup-path>
pop daemon start
pop daemon health
pop runs tail
```

### Pass criteria

- backup create succeeds
- verify succeeds
- restore succeeds
- daemon returns healthy
- recent state remains intact

## 12.2 Upgrade verification drill

### Commands

```bash
bash scripts/verify-upgrade.sh
bash scripts/verify-upgrade-path.sh --json
pop upgrade verify --json
```

### Pass criteria

- all scripts succeed
- no failed checks in JSON output

## 12.3 Rollback drill

Simulate a rollback to the previous good state:

```bash
pop daemon stop
pop upgrade rollback <backup-path>
pop daemon start
pop daemon health
```

If version-level rollback is needed:

```bash
cd ~/src/popeye
git checkout <previous-good-tag-or-sha>
pnpm install --frozen-lockfile
pnpm build
pop backup restore <backup-path>
pop daemon start
```

### Pass criteria

- rollback succeeds
- daemon starts
- health returns green
- no data corruption observed

## 12.4 Uninstall / reinstall drill (macOS only)

```bash
bash scripts/uninstall.sh
bash scripts/install.sh --force
pop --version
pop daemon health || true
bash scripts/smoke-test.sh
```

### Pass criteria

- binaries removed and reinstalled cleanly
- user data remains preserved unless intentionally removed
- smoke test passes after reinstall

---

## 13. Phase 8 — 24-hour unattended soak on `savorgserver`

This is the heart of the readiness pass.

## 13.1 Minimum soak setup

Before the soak window starts:

- at least one workspace configured
- real Pi engine enabled
- Gmail / Calendar / GitHub / Todoist connected
- finance + medical vaults/imports established
- at least one file root indexed
- standing approvals / automation grants configured as intended
- daemon running under its intended persistent mode

## 13.2 Soak goals

Over at least 24 continuous hours, prove:

- daemon remains alive
- scheduler remains alive
- heartbeats / scheduled work continue to execute
- syncs/digests continue to execute without operator babysitting
- receipts continue to accumulate
- no stuck interventions accumulate unexpectedly
- no abandoned/stale runs appear outside intentional recovery tests

## 13.3 Monitoring plan during soak

Check every 2–4 hours (or automate snapshots) for:

```bash
pop daemon health
pop daemon status
pop runs tail
pop runs failures
pop interventions list
pop security audit
```

And via API snapshots:

- `/v1/health`
- `/v1/status`
- `/v1/daemon/state`
- `/v1/daemon/scheduler`
- `/v1/security/audit`
- `/v1/usage/summary`

## 13.4 Soak thresholds

The soak is a **NO-GO** if any of the following happen unexpectedly:

- daemon dies or becomes unhealthy
- scheduler stops
- auth breaks
- repeated run failures accumulate without a known root cause
- approvals/interventions pile up without explanation
- receipts stop being created
- state corruption or duplicate migrations appear

## 13.5 Soak exit criteria

- [ ] 24h continuous runtime completed
- [ ] no unexplained daemon outage
- [ ] no unexplained scheduler outage
- [ ] no repeated failing run loop
- [ ] receipts and audit evidence remained complete

---

## 14. Phase 9 — Release artifact production and installer proof

## 14.1 Build artifacts

On the release candidate SHA:

```bash
bash scripts/build-pkg.sh
bash scripts/generate-release-notes.sh
bash scripts/artifact-inventory.sh
```

Save outputs to:

- `04-release-artifacts/build-pkg.log`
- `04-release-artifacts/release-notes.log`
- `04-release-artifacts/artifact-inventory.log`

## 14.2 Required artifacts

- `.pkg`
- `.tar.gz`
- `CHECKSUMS.sha256`
- `RELEASE-NOTES.md`
- `INVENTORY.md`

## 14.3 Signing / notarization

If this release is meant to be distributed beyond the local operator machine, run signing/notarization through the configured GitHub release workflow or equivalent macOS signing environment.

Required if the release claim is **distribution-grade macOS `.pkg`**.

## 14.4 Installer validation

### If `savorgserver` is macOS and can be treated as clean enough

Validate:

```bash
sudo installer -pkg dist/pkg/popeye-<version>-darwin.pkg -target /
pkgutil --pkg-info com.popeye.cli
bash scripts/smoke-test.sh
```

### If `savorgserver` is not macOS or not clean enough

Run the same installer proof on a separate clean macOS machine before GO.

### Pass criteria

- installer succeeds
- package receipt exists
- `pop --version` works
- smoke test passes
- daemon can be configured and started after installer install

---

## 15. Final go / no-go checklist

Release is **GO** only if every item below is checked.

### Code and CI

- [ ] Candidate SHA frozen
- [ ] Candidate version frozen
- [ ] local `pnpm dev-verify` green
- [ ] local Playwright green
- [ ] GitHub CI/security/code-scanning green

### Real environment (`savorgserver`)

- [ ] Popeye installed on `savorgserver`
- [ ] real Pi engine verified on `savorgserver`
- [ ] daemon health green on `savorgserver`
- [ ] security audit green on `savorgserver`
- [ ] blessed providers connected and synced
- [ ] all first-class domains exercised successfully
- [ ] playbook / proposal lifecycle validated on the installed instance
- [ ] approvals / standing approvals / automation grants validated
- [ ] receipts / memory / audit evidence validated
- [ ] backup / restore validated
- [ ] upgrade / rollback validated
- [ ] 24-hour soak completed successfully

### Release engineering

- [ ] release artifacts built
- [ ] checksums generated
- [ ] release notes drafted
- [ ] artifact inventory generated
- [ ] installer validated on clean macOS
- [ ] signing/notarization completed if required

### Docs and evidence

- [ ] evidence directory complete
- [ ] release notes include real verification results
- [ ] current-state matrix still honest
- [ ] any known gaps are explicitly documented and accepted

If any box is unchecked, the release is **NO-GO**.

---

## 16. Rollback plan

## 16.1 If a blocker is found during remote staging

- stop the readiness pass
- create a dedicated blocker-fix branch
- fix only the blocker
- rerun the affected phase(s) plus any dependent phases
- do **not** paper over failures in notes

## 16.2 If the installed daemon breaks after upgrade

1. `pop daemon stop`
2. `pop upgrade rollback <backup-path>` or `pop backup restore <backup-path>`
3. restart the daemon
4. verify health and recent state
5. mark release candidate NO-GO until root cause is fixed

## 16.3 If the packaged installer is bad

- do not publish
- revoke the candidate
- rebuild from the corrected SHA
- regenerate checksums, notes, and inventory
- rerun installer validation from scratch

---

## 17. Monitoring plan for release candidate and release day

## 17.1 Signals to watch

- daemon health
- scheduler health
- active run count
- failed run count
- open interventions count
- security audit events
- receipt creation continuity
- provider sync success/failure counts
- backup verification results

## 17.2 Thresholds

Treat any of the following as a release blocker:

- daemon unhealthy for more than one consecutive check
- scheduler not running
- repeated `failed_final` runs for the same workflow
- unbounded growth in interventions
- broken auth / CSRF behavior
- backup verify failing
- missing usage/cost fields in sampled receipts

## 17.3 Where to look

- `pop daemon health`
- `pop runs tail`
- `pop runs failures`
- `pop interventions list`
- `pop security audit`
- API endpoints from `docs/runbooks/incident-response.md`
- release evidence logs collected during this plan

---

## 18. Communications checklist

Even if the operator is only one person, the release still needs explicit artifacts.

Before release:

- [ ] decide version
- [ ] update / review release notes
- [ ] record candidate SHA
- [ ] record Pi ref/version used
- [ ] record whether release is local-only or distribution-grade
- [ ] record whether signing/notarization was completed

At release time:

- [ ] create git tag `v<version>`
- [ ] push tag
- [ ] run GitHub release workflow (if used)
- [ ] upload artifacts / checksums / notes / inventory
- [ ] save final go/no-go decision in evidence directory

After release:

- [ ] archive soak summary
- [ ] archive backup/restore drill result
- [ ] archive upgrade/rollback drill result
- [ ] note any deferred follow-ups

---

## 19. Day-2 follow-ups (post-release, not blocking release unless severe)

- remove temporary TypeScript 6 bridge once upstream `@typescript-eslint` officially supports TS6
- clean up stale local branches after release
- improve installed-instance UI automation so future release passes do not need manual web smoke
- tighten release scripts where they are currently thin (`smoke-test.sh`, `verify-upgrade.sh`) if the readiness pass shows they under-report risk
- convert this plan into a scripted release harness where practical

---

## 20. Recommended execution order summary

If we were doing this tomorrow, the exact order should be:

1. merge intended RC work to `main`
2. freeze candidate SHA/version
3. run full local verification + GitHub verification
4. prepare `savorgserver`
5. install Popeye on `savorgserver`
6. bootstrap real engine + auth + provider config
7. validate daemon/security/Pi health
8. validate CLI + installed-instance web inspector
9. validate every domain end to end
10. validate approvals / autonomy / denial paths
11. validate memory / receipts / audit / API health
12. validate backup / restore / upgrade / rollback
13. run 24-hour unattended soak
14. build and validate release artifacts
15. perform clean macOS installer proof if not already covered on `savorgserver`
16. do final go/no-go review
17. only then publish

---

## 21. Definition of success

This plan succeeds when we can truthfully say:

> Popeye is green locally, green in GitHub, installed and running on `savorgserver`, proven under real engine operation, proven across all core domains, proven through approval/autonomy/recovery flows, proven through backup/restore/upgrade/rollback, and proven through release artifact validation — with saved evidence for every claim.
