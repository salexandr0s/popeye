# Telegram Adapter

The Telegram adapter (`@popeye/telegram`) is a thin bridge between Telegram update payloads and the Popeye control API. It belongs to the interface layer and contains no runtime logic.

## Design principles

- Stateless adapter. All state lives in the Popeye runtime.
- Routes messages through `/v1/messages/ingest`, never directly to the Pi engine.
- Allowlist-only DM policy. No pairing flow, no open registration.
- All messages are treated as untrusted input.

## Current implemented scope

The current mainline package implements:

- Telegram update normalization (`normalizeTelegramUpdate()`)
- ingress bridging into the control API (`ingestTelegramUpdate()`)
- Bot API transport (`createTelegramBotClient()`)
- long-poll receive/send orchestration (`TelegramLongPollRelay`)
- reply text cleanup + fallback receipt formatting (`formatTelegramReply()`, `buildTelegramRunReply()`)
- durable long-poll checkpoints and reply-delivery markers via the control API
- duplicate-delivery suppression at the relay layer
- bounded concurrent reply preparation with ordered send/ack
- explicit ambiguous-delivery handling (`pending` → `sending` → `sent` / `uncertain`)

Current in-repo transport is **end-to-end long-polling**. Webhook hosting is still outside the package.

## Message flow

1. `TelegramLongPollRelay` polls Telegram `getUpdates` (or an external transport can still call the same normalization helpers).
2. `normalizeTelegramUpdate()` extracts `senderId`, `chatId`, `chatType`, `telegramMessageId`, and `text`. Both `message` and `edited_message` are handled. Text is taken from `text` or `caption` fields. Updates without a sender or text are discarded (returns `null`).
3. `ingestTelegramUpdate()` calls the runtime's `ingestMessage()` with source `telegram` and the extracted fields.
4. The runtime applies the full ingress pipeline (see below).
5. For accepted messages, the relay waits for the related job to reach a terminal state through the control API.
6. The relay fetches `GET /v1/runs/:id/reply`, which packages reply text with this precedence:
   - `completed.output`
   - last assistant `message` text
   - receipt-derived fallback text
7. Before calling Telegram `sendMessage`, the relay durably claims the delivery as `sending`.
8. After `sendMessage` succeeds, the relay marks the Telegram delivery `sent`, passes the outbound Bot API `message_id` for runtime observability, then commits the durable long-poll checkpoint.
9. Retryable definitive Bot API failures reset the delivery to `pending` and leave the update unacked so replay can try again.
10. Ambiguous transport failures, permanent Bot API failures, and replayed stale `sending` deliveries are marked `uncertain`, create `needs_operator_input`, and do **not** auto-send a duplicate reply.

Current delivery semantics are intentionally explicit:

- reply delivery is still not exactly-once, but the relay now prefers duplicate suppression over blind resend when delivery becomes ambiguous
- a crash between successful `sendMessage` and `mark-sent` now leaves the delivery in durable `sending`; replay marks it `uncertain` instead of auto-sending a duplicate
- relay checkpoint commits are monotonic max-acks per workspace and do not regress
- reply preparation is bounded-concurrent, while send + checkpoint acknowledgement stay ordered for correctness

## Runtime ingress pipeline (for Telegram source)

The runtime service applies these checks in order when `source === "telegram"`:

1. **Secret redaction** -- redacts API keys, Bearer tokens, PEM blocks, JWTs, and long hex strings from the message body before any further processing.
2. **Telegram enabled** -- checks `config.telegram.enabled`. If false, returns 403 with `telegram_disabled`.
3. **Private chat required** -- `chatType` must be `"private"`. Group/supergroup/channel messages are rejected with `telegram_private_chat_required`.
4. **Allowlist check** -- `senderId` must match `config.telegram.allowedUserId`. Rejects with `telegram_not_allowlisted`.
5. **Rate limiting** -- counts recent ingress attempts for the sender/chat within `rateLimitWindowSeconds`. If the count exceeds `maxMessagesPerMinute`, rejects with `telegram_rate_limited` (HTTP 429).
6. **Prompt injection detection** -- scans for quarantine patterns (credential exfiltration, destructive bypass, tool abuse). If quarantined, rejects with `telegram_prompt_injection` and creates a `prompt_injection_quarantined` intervention. Sanitize-level matches rewrite the text but accept the message.
7. **Final redaction** -- a second redaction pass on the sanitized text.

## Idempotency

Telegram messages are deduped via a workspace-scoped idempotency key: `telegram:{workspaceId}:{chatId}:{telegramMessageId}`. Duplicate deliveries replay the original response without re-processing.

This is also the current restart/offset story for long-poll mode: if Telegram replays an update after daemon restart, the runtime replay is accepted as a duplicate. Deliveries already marked `sent` stay silent; deliveries still marked `sending` are escalated to `uncertain` rather than re-sent automatically.

## Configuration

Telegram config lives in `AppConfig.telegram`:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| enabled | boolean | `false` | Master switch |
| allowedUserId | string | -- | Telegram user ID allowed to send messages |
| maxMessagesPerMinute | integer | `10` | Rate limit threshold |
| rateLimitWindowSeconds | integer | `60` | Rate limit sliding window |
| maxConcurrentPreparations | integer | `4` | Controls parallel reply preparation. Send + checkpoint ack remain strictly ordered. Max: 16. |

## Delivery states

| State | Meaning |
|-------|---------|
| `pending` | Delivery created, reply not yet attempted |
| `sending` | Relay claimed the delivery, send in progress |
| `sent` | Reply confirmed delivered |
| `uncertain` | Ambiguous failure — needs operator attention |
| `abandoned` | Operator explicitly abandoned the delivery |

## Operator resolution flow

When a delivery reaches `uncertain`, a `needs_operator_input` intervention is created. The operator can resolve it via `POST /v1/telegram/deliveries/:id/resolve` with one of three actions:

- **`confirm_sent`** — Marks delivery `sent`. Optionally records the outbound Telegram message ID.
- **`resend`** — Resets delivery to `pending`. The relay's per-cycle sweep picks up operator-reset deliveries and re-sends them.
- **`abandon`** — Marks delivery `abandoned`. No further send attempts.

Each resolution creates a durable `telegram_delivery_resolutions` audit row and resolves the linked intervention.

## Send-attempt auditability

Every `sendMessage` call records a `telegram_send_attempts` row with:
- Attempt number (auto-incremented per delivery)
- Content hash (SHA-256 of reply text)
- Outcome: `sent`, `retryable_failure`, `permanent_failure`, `ambiguous`
- Error summary (truncated to 500 chars, redacted)
- Source: `relay` or `operator_resend`

Attempts are best-effort: audit recording failures do not block delivery.

## Security audit trail

Every denied ingress attempt is recorded in the `message_ingress` table and the `security_audit` table. Rate-limited attempts are logged at `warn` severity; all other denials at `error` severity.

## Adapter types

The adapter exports these interfaces:

- `TelegramUpdate` / `TelegramMessageUpdate` -- raw Telegram update shapes
- `NormalizedTelegramUpdate` -- extracted fields after normalization
- `TelegramIngressClient` -- interface for the runtime's `ingestMessage` method
- `TelegramRunTrackingClient` -- control-plane contract for job polling + run event retrieval
- `TelegramBotClient` -- Bot API transport contract
