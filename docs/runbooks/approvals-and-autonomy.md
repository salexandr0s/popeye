# Approvals and autonomy runbook

This runbook explains how Popeye decides whether an action runs automatically, requires
operator approval, or is denied — and how to customize that behavior.

## How policy evaluation works

Every action the runtime considers (sync, write, send, delete, context release, vault
open, etc.) passes through the `ActionPolicyEvaluator`. Evaluation checks three layers
in order:

1. **Explicit rules** — operator-configured overrides in `config.approvalPolicy.rules`
2. **Built-in defaults** — the hardcoded domain × action matrix
3. **Fallback** — `config.approvalPolicy.defaultRiskClass` (default: `ask`)

The first match wins.

## Risk classes

| Class | Meaning |
|-------|---------|
| `auto` | Runs unattended. No approval needed. |
| `ask` | Requires explicit approval, a standing approval, or an automation grant. |
| `deny` | Blocked. Cannot be overridden by standing approvals or automation grants. |

## Built-in default matrix

### Actions that auto-run (all domains unless overridden)

| Action | Scope | Notes |
|--------|-------|-------|
| `sync` | `external_write` | Provider sync cycles |
| `import` | `external_write` | Data import jobs |
| `digest` | `external_write` | Digest generation |
| `classify` | `external_write` | Classification jobs |
| `triage` | `external_write` | Triage jobs |

### Domain-specific write defaults

| Domain | Action | Risk | Standing | Automation | Notes |
|--------|--------|------|----------|------------|-------|
| Email | `draft` | `auto` | — | — | Drafts auto-run |
| Email | `send` | `ask` | yes | no | Sends need approval or standing grant |
| Calendar | `write` | `ask` | yes | no | Event create/update need approval |
| GitHub | `write` | `ask` | yes | yes | PR comments, notification mark-read |
| Todos | `write` | `ask` | yes | yes | Reprioritize, reschedule, move |
| *(generic)* | `write` | `ask` | yes | no | Fallback for unlisted domains |
| *(generic)* | `send` | `ask` | yes | no | Fallback for unlisted domains |
| *(generic)* | `delete` | `ask` | no | no | Always requires explicit approval |

### Restricted domains (finance, medical)

| Domain | Action | Risk | Notes |
|--------|--------|------|-------|
| Finance | `write` / `send` / `delete` | `deny` | No external mutations ever |
| Medical | `write` / `send` / `delete` | `deny` | No external mutations ever |

### Other scopes

| Scope | Action | Risk | Standing | Notes |
|-------|--------|------|----------|-------|
| `data_source_connect` | `connect` | `ask` | no | New connections always need approval |
| `vault_open` | `open_vault` | `ask` | yes | Vault access can use standing grants |
| `context_release` | `release_context` | `ask` | no | Always explicit per-request |
| `context_release` (finance) | `release_context` | `ask` | no | Stricter: operator-only |
| `context_release` (medical) | `release_context` | `ask` | no | Stricter: operator-only |

## Standing approvals

Standing approvals pre-authorize a specific action pattern so it runs without
per-action prompting.

### Create a standing approval

```bash
# Allow email sends to a specific recipient
pop approvals standing create \
  --scope external_write \
  --domain email \
  --action-kind send \
  --resource-scope resource \
  --resource-type recipient \
  --resource-id "alice@example.com" \
  --reason "Pre-approved for weekly report delivery"

# Allow calendar writes on a specific calendar
pop approvals standing create \
  --scope external_write \
  --domain calendar \
  --action-kind write \
  --resource-scope resource \
  --resource-type calendar \
  --resource-id "work-calendar-id" \
  --reason "Allow scheduling on work calendar"
```

### List standing approvals

```bash
pop approvals standing list
```

### Revoke a standing approval

```bash
pop approvals standing revoke <approval-id> --reason "No longer needed"
```

### Via web inspector

Navigate to **Standing Approvals** in the sidebar. Create, view, and revoke from the
UI.

## Automation grants

Automation grants allow actions to run fully unattended — they are stronger than
standing approvals. Only actions marked `automationGrantEligible` can use them.

Currently eligible: GitHub writes, Todo writes.

### Create an automation grant

```bash
# Auto-approve GitHub PR comments on a specific repo
pop approvals grant create \
  --scope external_write \
  --domain github \
  --action-kind write \
  --resource-scope resource \
  --resource-type pr_comment \
  --resource-id "org/repo" \
  --reason "Auto-comment on CI results"

# Auto-approve todo reprioritization
pop approvals grant create \
  --scope external_write \
  --domain todos \
  --action-kind write \
  --resource-scope resource \
  --resource-type todo \
  --resource-id "*" \
  --reason "Allow automated task triage"
```

### List and revoke

```bash
pop approvals grant list
pop approvals grant revoke <grant-id> --reason "Revoking"
```

## Custom policy rules (config)

For more advanced overrides, add rules to `config.json`:

```json
{
  "approvalPolicy": {
    "defaultRiskClass": "ask",
    "pendingExpiryMinutes": 60,
    "rules": [
      {
        "scope": "external_write",
        "domain": "email",
        "riskClass": "auto",
        "actionKinds": ["draft"],
        "resourceScopes": []
      },
      {
        "scope": "external_write",
        "domain": "github",
        "riskClass": "deny",
        "actionKinds": ["delete"],
        "resourceScopes": []
      }
    ]
  }
}
```

Rules are evaluated in array order. The first matching rule wins.

**Warning:** Config rules override built-in defaults entirely for the matched scope +
domain + action. Do not weaken restricted-domain denials (`finance`, `medical`) — those
are deny-by-design.

## Inspecting the effective policy

```bash
# View full security policy including action defaults, rules, and grants
pop security policy

# Via API
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3210/v1/security/policy
```

The response includes `actionDefaults` (built-in matrix), `approvalRules` (config
overrides), and `defaultRiskClass`.

## Approval lifecycle

1. Runtime evaluates action → risk class is `ask`
2. Runtime checks standing approvals and automation grants for a match
3. If matched → action runs, receipt records the grant provenance
4. If not matched → approval request created (pending)
5. Operator resolves via CLI (`pop approvals resolve <id>`) or web inspector
6. Pending approvals expire after `pendingExpiryMinutes` (default: 60)

All approvals — granted, denied, expired — are receipted and visible in the audit
trail.

## Common scenarios

### "I want email digests to run automatically but sends to require approval"

This is the default behavior. No configuration needed.

### "I want GitHub comments on my repos to run without prompting"

Create an automation grant for GitHub writes:

```bash
pop approvals grant create \
  --scope external_write \
  --domain github \
  --action-kind write \
  --resource-type pr_comment \
  --resource-id "myorg/*" \
  --reason "Auto-comment on my repos"
```

### "I want to block all calendar writes entirely"

Add a config rule:

```json
{
  "scope": "external_write",
  "domain": "calendar",
  "riskClass": "deny",
  "actionKinds": ["write"],
  "resourceScopes": []
}
```

### "I want todo reprioritization to run unattended"

Create an automation grant (todos writes are automation-grant eligible by default):

```bash
pop approvals grant create \
  --scope external_write \
  --domain todos \
  --action-kind write \
  --resource-type todo \
  --resource-id "*" \
  --reason "Automated triage"
```
