# Security Audit Handoff — Popeye

_Date: March 14, 2026_

## Status

- Repo inspected locally
- No code changes made
- Targeted security tests passed: **20/20**
- Verification command run:

```bash
pnpm vitest run \
  packages/control-api/src/csrf.test.ts \
  packages/control-api/src/sec-fetch.test.ts \
  packages/control-api/src/security-headers.test.ts \
  packages/runtime-core/src/security-audit.test.ts \
  packages/runtime-core/src/message-ingestion.test.ts
```

## Executive summary

Popeye already has strong defensive controls for a local-first, single-operator system:

- loopback-only binding enforced in config and runtime
- bearer auth for CLI/API clients
- browser bootstrap nonce + HttpOnly session cookie for the web inspector
- CSRF + `Sec-Fetch-Site` enforcement on mutations
- Telegram private-chat / allowlist / rate limiting / prompt scanning
- redact-on-write behavior for ingress, memory, and error paths
- CI security workflows: Semgrep, CodeQL, secret scan, dependency audit, Playwright

Recommended assurance target: **ASVS L2 baseline with selected L3 checks** for auth, ingress, secrets, and auditability.

The main remaining risk is **not** an obvious auth bypass. The biggest gaps are in **auditability**, **startup hardening**, and **doc/implementation alignment**.

## Scope reviewed

- `apps/daemon/src/index.ts`
- `packages/control-api/src/index.ts`
- `packages/runtime-core/src/{auth,browser-sessions,message-ingestion,prompt,security-audit,runtime-service,database}.ts`
- `packages/telegram/src/index.ts`
- `packages/observability/src/{index,logger}.ts`
- `packages/contracts/src/config.ts`
- `.github/workflows/{ci,security,codeql,pi-smoke}.yml`
- `scripts/scan-secrets.mjs`
- `docs/control-api.md`
- `docs/api-contracts.md`
- `docs/telegram-adapter.md`
- ADRs: `docs/adr/0003`, `0004`, `0006`, `0009`

## Priority findings

| ID | Severity | Title | Evidence | Recommended action |
|---|---|---|---|---|
| AUD-001 | Medium | Missing `security_audit` records for missing/invalid auth | `packages/control-api/src/index.ts:237-256` | Emit explicit audit events for missing auth, invalid bearer token, and missing browser auth cookie |
| AUD-002 | Medium | Missing `security_audit` records for CSRF failures | `packages/control-api/src/index.ts:265-283`, `docs/control-api.md:16-21` | Record audit events for `csrf_invalid` and `csrf_cross_site_blocked` |
| INGRESS-001 | Medium | Prompt-scan rule matches are not persisted to audit | `packages/runtime-core/src/prompt.ts:23-91`, `packages/runtime-core/src/message-ingestion.ts:515-523`, `:610-627` | Persist `matchedRules` and verdict metadata to `security_audit` and/or intervention details |
| CONFIG-001 | Medium | Custom redaction regexes are not fail-closed at startup | `packages/contracts/src/config.ts:10-18`, `packages/observability/src/index.ts:38-43`, `packages/runtime-core/src/security-audit.ts:102-110` | Validate regex syntax and ReDoS safety during config load/startup, not only during later audit |
| TELEGRAM-001 | Low | Global Telegram rate-limit behavior is narrower than docs imply | `packages/runtime-core/src/message-ingestion.ts:396-406`, `docs/api-contracts.md:57-61` | Align docs with implementation or change implementation to match intended policy |

## Detailed findings

### AUD-001 — Missing `security_audit` records for missing/invalid auth

**Severity:** Medium  
**Area:** Control API auth boundary  
**OWASP/ASVS:** A07 / V2, V10

**Evidence**
- `packages/control-api/src/index.ts:237-243` returns `401` for invalid bearer auth without recording a security audit event
- `packages/control-api/src/index.ts:249-252` returns `401` when no browser session cookie is present without recording a security audit event
- Browser session **invalid/expired** cases are audited via `recordBrowserSessionAudit()`, but missing/invalid bearer auth is not

**Why it matters**
- Reduces incident visibility for unauthorized access attempts
- Conflicts with the project contract that auth failures should be auditable
- Makes release-readiness and incident-response evidence weaker than intended

**Recommended fix**
- Add standardized audit events such as:
  - `auth_missing`
  - `auth_bearer_invalid`
  - `auth_browser_cookie_missing`
- Include `remoteAddress`, `userAgent`, and route path in `details`
- Add regression tests asserting rows appear in `security_audit`

### AUD-002 — Missing `security_audit` records for CSRF failures

**Severity:** Medium  
**Area:** Mutation protections  
**OWASP/ASVS:** A01, A05 / V4, V10

**Evidence**
- `packages/control-api/src/index.ts:265-283` returns:
  - `403 { error: "csrf_invalid" }`
  - `403 { error: "csrf_cross_site_blocked" }`
- `docs/control-api.md:16-21` documents these protections, but the current code path does not appear to write a corresponding audit row

**Why it matters**
- Failed cross-site or invalid-token mutation attempts should leave durable evidence
- Limits forensic and operational visibility into abuse or browser-side misuse

**Recommended fix**
- Emit audit events for:
  - invalid/missing CSRF token
  - rejected `Sec-Fetch-Site` values
- Add test coverage that verifies both HTTP response and `security_audit` persistence

### INGRESS-001 — Prompt-scan rule matches are not persisted to audit

**Severity:** Medium  
**Area:** Telegram and message ingress trust boundary  
**OWASP/ASVS:** A03, A09 / V5, V10

**Evidence**
- `packages/runtime-core/src/prompt.ts:23-91` returns `verdict`, `sanitizedText`, and `matchedRules`
- `packages/runtime-core/src/message-ingestion.ts:515-523` and `:610-627` act on the verdict, but do not persist the matched rule names into audit data
- Interventions are created for quarantined content, but without the full prompt-scan rule evidence

**Why it matters**
- Weakens operator explainability for quarantined or sanitized input
- Makes retesting and rule tuning harder
- Reduces evidence quality during incident review

**Recommended fix**
- Persist `matchedRules` and `verdict` in:
  - `security_audit.details_json`, and/or
  - intervention reason/details
- Add tests asserting the exact matched rule list is durable

### CONFIG-001 — Custom redaction regexes are not fail-closed at startup

**Severity:** Medium  
**Area:** Config validation / redaction pipeline  
**OWASP/ASVS:** A05 / V1, V14

**Evidence**
- `packages/contracts/src/config.ts:10-18` accepts raw regex strings in `redactionPatterns`
- `packages/observability/src/index.ts:38-43` compiles those patterns at runtime inside `redactText()`
- `packages/runtime-core/src/security-audit.ts:102-110` checks invalid/unsafe patterns only when `runLocalSecurityAudit()` is invoked

**Why it matters**
- An invalid or unsafe deployment pattern should fail fast during startup
- Current behavior risks late failures or inconsistent redaction behavior before the audit command is run

**Recommended fix**
- Validate custom regex syntax and safety during config loading or runtime startup
- Refuse to boot with invalid or ReDoS-prone redaction patterns
- Add startup tests for invalid and unsafe regex configuration

### TELEGRAM-001 — Global Telegram rate-limit behavior is narrower than docs imply

**Severity:** Low  
**Area:** Ingress policy / docs alignment  
**OWASP/ASVS:** A04, A05 / V1

**Evidence**
- `packages/runtime-core/src/message-ingestion.ts:396-406` counts only `accepted = 1` Telegram ingress rows for the global limit
- `docs/api-contracts.md:57-61` describes Telegram ingress as enforcing “durable rate limiting” without clarifying that the global counter is accepted-message-only

**Why it matters**
- Operator expectations may differ from runtime behavior during abuse scenarios
- Documentation drift makes security review and testing less deterministic

**Recommended fix**
- Choose one and make it explicit:
  1. document the current accepted-only behavior, or
  2. change the implementation to count all recent Telegram ingress attempts
- Add a test that locks the intended policy in place

## Secondary hardening / watchlist

These were observed during review and are worth follow-up, but were not elevated above the priority findings above.

### HARDEN-001 — `/v1/auth/exchange` could be hardened further

**Evidence**
- `packages/control-api/src/index.ts:288-300` relies on nonce validation for the exempt auth-exchange path
- No explicit `Origin` or `Sec-Fetch-Site` validation is applied on this exempt route

**Suggested follow-up**
- Add same-origin checks for browser bootstrap if they fit the loopback threat model
- Add a negative test for cross-site or malformed exchange attempts

### HARDEN-002 — CORS posture is implicit, not explicit

**Evidence**
- No explicit CORS plugin or route-level CORS policy was found in `packages/control-api`
- Current posture appears safe by omission, but it is not encoded as a tested invariant

**Suggested follow-up**
- Add explicit tests asserting no permissive CORS headers are emitted
- Consider documenting the intended CORS posture in `docs/control-api.md`

### HARDEN-003 — Confirm `embeddings.allowedClassifications` is wired into runtime policy

**Evidence**
- `packages/contracts/src/config.ts:39-44` defines `allowedClassifications`
- Repo search during audit did not find runtime enforcement beyond schema/tests; current embedding gate in `packages/memory/src/search-service.ts:190-194` checks only `classification === 'embeddable'`

**Suggested follow-up**
- Confirm whether this config is intentionally unused or incomplete
- If intended, wire it into the embedding decision path and add tests

## Strong controls already in place

- Loopback-only binding enforced in config and runtime:
  - `packages/contracts/src/config.ts:10-18`
  - `packages/runtime-core/src/runtime-service.ts:404-408`
  - `apps/daemon/src/index.ts:104-107`
- Browser auth split from long-lived bearer token:
  - `docs/control-api.md:5-12`
  - `packages/control-api/src/index.ts:288-300`
  - `packages/runtime-core/src/browser-sessions.ts`
- CSRF + `Sec-Fetch-Site` mutation checks:
  - `packages/control-api/src/index.ts:265-283`
- Telegram allowlist / private-chat / idempotency / prompt scanning:
  - `packages/runtime-core/src/message-ingestion.ts:468-523`
- Redaction-before-write pipeline:
  - `packages/observability/src/index.ts:32-63`
- SQLite hardening:
  - `packages/runtime-core/src/database.ts:406-408`
- Security automation in CI:
  - `.github/workflows/ci.yml`
  - `.github/workflows/security.yml`
  - `.github/workflows/codeql.yml`

## Recommended next sequence

1. **Close auditability gaps first**
   - add auth failure audit events
   - add CSRF failure audit events
2. **Improve ingress evidence**
   - persist prompt-scan `matchedRules`
3. **Fail closed on config**
   - validate custom redaction regexes during startup
4. **Resolve policy drift**
   - align Telegram global rate-limit docs and implementation
5. **Optional hardening**
   - tighten `/v1/auth/exchange`
   - make CORS posture explicit
   - confirm embedding classification policy wiring

## Release handoff checklist

- [ ] All protected routes reject missing/invalid auth
- [ ] Auth failures create `security_audit` rows
- [ ] CSRF failures create `security_audit` rows
- [ ] Prompt quarantine/sanitize events persist rule evidence
- [ ] Invalid redaction regex config fails startup
- [ ] Telegram rate-limit docs and tests match runtime behavior
- [ ] Security CI remains green: Semgrep, CodeQL, secret scan, dep audit
- [ ] Loopback-only bind and `0600`/`0700` file permissions are verified on target host

## Notes for the next owner

- This handoff is based on repo inspection and targeted test execution on **March 14, 2026**
- It is **not** a live staging or production penetration test
- If this moves into active remediation, the first follow-up should be a small, isolated security patch set with tests for:
  - auth failure auditing
  - CSRF failure auditing
  - prompt-scan evidence persistence
  - redaction regex startup validation
