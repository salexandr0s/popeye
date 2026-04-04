# Knowledge beta corpus runbook

Use this runbook to harden Knowledge v1 against a real source mix before shipping.

## Release gate

Knowledge v1 is **not release-ready** until all of the following are green on the candidate SHA:

- `pnpm dev-verify`
- committed Knowledge corpus fixture suite
- private beta corpus pass
- no blocker-class bugs open for import, reingest, draft review/apply/reject, or search correctness

## Private corpus target mix

Build a private corpus of **20–50 sources** with roughly this mix:

- **8–15 websites/articles**
- **5–10 PDFs**
- **2–4 repos**
- **2–4 datasets**
- **2–4 images**
- **2–4 manual notes**

Prefer sources with:

- images or diagrams
- external links and internal markdown links
- at least a few known reingest candidates
- both clean and noisy layouts

## Manifest-driven run

1. Copy `scripts/knowledge-beta-manifest.example.json` to a private location.
2. Replace the example entries with real local paths / URLs.
3. Run the corpus harness against a live local daemon:

```bash
pnpm tsx scripts/knowledge-beta-corpus.ts \
  --manifest /absolute/path/to/private-knowledge-corpus.json \
  --base-url http://127.0.0.1:3210 \
  --token "$POPEYE_API_TOKEN" \
  --report dist/knowledge-beta-report.md \
  --enforce-gate
```

The script writes:

- a markdown summary report
- a JSON report next to it for bug filing / diffs between runs
- a stored Knowledge beta run in Popeye unless `--no-upload` is passed

Manifest notes:

- set `gate.minImportSuccessRate` and `gate.maxHardFailures` to control pass/fail
- set `expectedReingestOutcome` on reingest candidates to verify unchanged vs updated behavior

## Operator review checklist

After the harness finishes, review the same corpus in the macOS Knowledge UI.
Start from the Knowledge screen's **Latest Beta Run** summary so the stored run,
gate status, and top issues match the uploaded harness report before checking
individual documents.

For each source, verify:

- import completed with a truthful `status`
- converter warnings are visible and understandable
- normalized markdown is readable and usable
- localized assets render from local `assets/` paths when available
- snapshot history is present for reingested sources
- a draft wiki revision exists for changed imports
- backlinks / related docs / outgoing links are reasonable
- Knowledge search can find the document by body text, not just title
- the **Latest Beta Run** panel in macOS shows the same gate result and top issue
  rows as the uploaded harness report

## Pass / fail rules

The corpus pass is green only when all of these are true:

- **100%** of committed fixture tests pass
- **>= 90%** of private corpus imports succeed without hard failure
- **100%** of unchanged reingests avoid duplicate logical source rows
- all degraded imports have visible warnings in the UI/API
- no public surface leaks runtime-internal absolute paths
- no blocker bug remains open

Treat these as blockers:

- duplicate logical sources after reimport/reingest
- missing or corrupted normalized markdown
- asset localization corrupting markdown
- wrong apply/reject behavior on draft revisions
- search returning the wrong workspace/kind results
- contract mismatches between runtime, API, and clients

## Finding template

Use this template for every corpus bug:

```md
### Knowledge beta finding
- Source label:
- Source type:
- Outcome: import | reingest | review | search
- Expected:
- Observed:
- Status shown by Popeye:
- Adapter used:
- Repro steps:
- Candidate severity: blocker | ship-with-warning | post-v1
- Attach report excerpt / screenshot:
```
