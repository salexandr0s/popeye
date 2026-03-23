# ADR 0019: Per-run cache control and Pi fork upgrade to v0.58+

**Date:** 2026-03-23
**Status:** pending
**Classification:** Pi wrapper (cache control forwarding) + Pi fork modification (RPC protocol extension)

## Context

Analysis of NousResearch/hermes-agent revealed that their Anthropic integration uses a
"system_and_3" prompt caching strategy (cache breakpoints on the system prompt + last 3
messages), reducing input token costs ~75% on multi-turn conversations.

Investigation shows Pi's Anthropic provider **already implements cache_control** in
`packages/ai/src/providers/anthropic.ts`:
- `getCacheControl()` returns `{ type: "ephemeral" }` (or with `ttl: "1h"` for official API)
- Applied to system prompt content blocks and the last user message
- Controlled by `PI_CACHE_RETENTION` env var: `"short"` (default), `"long"`, `"none"`

However, Popeye cannot control cache retention per-run because:
1. The Pi RPC `prompt` command only accepts `message`, `images`, and `streamingBehavior`
2. `PI_CACHE_RETENTION` is process-wide — it applies to all runs in a daemon session
3. There is no metadata passthrough mechanism from Popeye to Pi's `StreamOptions`

Separately, the Pi fork is pinned at v0.57.1 while upstream has moved to v0.58.0+ with
notable improvements: 1M context window, JSONL framing fixes for Unicode, Bedrock prompt
caching limits, tool result image support, and extension hooks. The fork has only 1 custom
commit (`b0dd89d8` — native host-tool RPC bridge), making an upgrade low-risk.

## Decision Drivers

- **Cost reduction:** Prompt caching is a near-free win for Anthropic-backed runs
- **Operational control:** Different tasks have different caching needs (ephemeral debug vs. long-running heartbeat)
- **Fork hygiene:** The fork is 1 commit ahead, upstream has moved significantly. Staying behind accumulates merge debt
- **Pi rule 9:** Fork modifications must be isolated changesets; upgrades must not mix with unrelated runtime changes

## Considered Options

### Option A: Environment variable only (no fork change)

Set `PI_CACHE_RETENTION=long` in the daemon spawn environment. All runs get caching.

Pros:
- Zero code changes
- Works immediately

Cons:
- No per-run control (debug runs waste cache budget, short-lived tasks don't benefit)
- Cannot disable caching for specific profiles or tasks

### Option B: Per-run RPC protocol extension (fork change)

Extend Pi's RPC `prompt` command to accept `cacheRetention` field. Forward from Popeye's
`EngineRunRequest` through the RPC command builder.

Pros:
- Per-run control aligned with profile/task policy
- Small change (~10 lines in Pi, ~5 lines in Popeye)
- Clean separation: Pi owns cache mechanics, Popeye owns policy

Cons:
- Requires Pi fork modification (must rebase on upgrade)

### Option C: Combined upgrade + protocol extension

Upgrade Pi fork to latest upstream first, then add `cacheRetention` to the RPC protocol
in a separate commit. Bundle both in one Pi upgrade changeset.

Pros:
- Picks up 6+ months of upstream improvements (1M context, JSONL framing, Bedrock fixes)
- Fork stays thin (1 custom commit reapplied on new base)
- `cacheRetention` added cleanly on top of fresh baseline
- Reduces future merge debt

Cons:
- Larger changeset (upgrade + extension)
- Must re-validate host-tool RPC bridge against new upstream
- Smoke tests required before merging

## Decision

**Option C: Combined upgrade + protocol extension.**

Execute in two isolated commits within the Pi repo:

1. **Commit 1 (upgrade):** Rebase fork on latest upstream tag. Re-apply `b0dd89d8`
   (host-tool RPC bridge). Run full smoke suite. Update `pi-fork-delta.md`.

2. **Commit 2 (cache control):** Add `cacheRetention?: "none" | "short" | "long"` to
   the RPC `prompt` command in `rpc-types.ts`. Update `rpc-mode.ts` to extract the field
   and pass to `StreamOptions`. No default — Pi's own `PI_CACHE_RETENTION` env var remains
   the fallback when the field is absent.

Then in the Popeye repo (separate changeset):

3. **Commit 3:** Add `cacheRetention` to `EngineRunRequest`. Forward in the RPC prompt
   command builder. Add `cacheRetention` to `EngineConfigSchema` as a default policy.
   Allow per-profile override via `AgentProfileRecord.modelPolicy` (parse as structured
   JSON when it contains cache settings).

## Consequences

Positive:
- Prompt caching available immediately for all Anthropic runs (default: `"short"`)
- Operator can set per-profile caching policy (e.g., `"long"` for heartbeats, `"none"` for debug)
- Fork picks up upstream fixes: 1M context, JSONL framing, Bedrock hardening
- Fork merge debt reduced to 1 custom commit on fresh baseline

Negative:
- Upgrade requires smoke test validation (manual or CI)
- If upstream changed RPC types, host-tool bridge may need minor adaptation
- Two-repo changeset requires coordinated testing

## Revisit Triggers

- Upstream Pi adds native `cacheRetention` in the RPC protocol (our commit becomes unnecessary)
- Anthropic changes cache_control API semantics
- Popeye moves to a different engine (Pi fork becomes irrelevant)

## Follow-ups

- [ ] Execute Pi fork upgrade (commit 1)
- [ ] Add `cacheRetention` to Pi RPC protocol (commit 2)
- [ ] Run `pop pi smoke` and full smoke suite against upgraded Pi
- [ ] Update Popeye engine-pi adapter (commit 3)
- [ ] Update `docs/pi-fork-delta.md` with upgrade details
- [ ] Update `config/example.json` with new Pi version pin
- [ ] Set `cacheRetention: "short"` as default in `EngineConfigSchema`
