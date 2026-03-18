# OpenClaw Donor Map

Concepts adapted from OpenClaw and what was explicitly omitted. OpenClaw is a donor, not the architecture.

## Adapted concepts

These ideas were extracted from OpenClaw, restated in Popeye's contracts and naming, and implemented fresh.

| Concept | OpenClaw origin | Popeye implementation | Classification |
|---------|----------------|----------------------|----------------|
| Message ingress pipeline | Channel message routing | `ingestMessage()` in runtime-service with source-specific validation, redaction, and prompt scanning | New platform implementation (donor concept) |
| Allowlist-only messaging | Channel access controls | `telegram.allowedUserId` config with strict private-chat-only policy | New platform implementation (donor concept) |
| Rate limiting on ingress | Per-channel rate limits | Per-sender/chat sliding window counter in `message_ingress` table | New platform implementation (donor concept) |
| Prompt injection detection | Content filtering | `scanPrompt()` with quarantine and sanitize rules | New platform implementation |
| Task/Job/Run model | Job queue abstractions | Three-entity state machine with leases, retries, and interventions | New platform implementation |
| Receipt system | Execution logging | Every run produces an immutable receipt with usage metrics | New platform implementation (donor concept) |
| Memory system | Knowledge persistence | Two-layer markdown + SQLite with FTS5 and sqlite-vec | New platform implementation (donor concept) |
| Instruction compilation | System prompt assembly | 9-level precedence with compilation, hashing, and snapshot persistence | New platform implementation |

## Omitted concepts

These were evaluated and explicitly excluded. Each omission is documented with rationale.

| Concept | Why omitted |
|---------|-------------|
| Broad channel ecosystem | Popeye is not a messaging platform. Telegram is a thin bridge. |
| Media pipelines | No current need for image/audio/video processing. |
| Node/device/pairing | Single operator, single machine. No multi-device support. |
| Plugin marketplace | Fixed toolset. Extensions via code changes only. |
| Gateway routing | All routing goes through the control API with workspace scoping. |
| Donor UI stack | Interfaces are built independently against the control API. |
| Donor config schemas | Popeye uses its own Zod-validated config. |
| Open registration flows | Allowlist-only. No self-service. |
| Multi-tenant identity | Local single-operator platform; role-scoped local tokens only, no tenant/user system. |

## When adapting from OpenClaw

The porting decision checklist (from CLAUDE.md section 17):

1. **Need it now?** Is there a concrete operator workflow that requires it?
2. **Pi equivalent?** Does Pi already do this, expose a hook, or can the runtime wrap it?
3. **Thin slice?** Can you port only the minimal contract or workflow rule?
4. **Rewrite cleaner?** Is donor code entangled with donor-only assumptions?
5. **Omit entirely?** Is value weak, maintenance high, or does it drag in complexity?

## Contamination warning signs

Stop and reassess if:
- Donor file names are becoming required everywhere
- Donor config shapes are becoming canonical API
- Whole donor directories are copied into core
- Runtime naming follows donor naming without justification
- UI requirements are driven by donor patterns instead of the control plane
