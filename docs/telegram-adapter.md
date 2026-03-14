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
- duplicate-delivery suppression at the relay layer
- bounded Bot API send retry behavior

Current in-repo transport is **end-to-end long-polling**. Webhook hosting is still outside the package.

## Message flow

1. `TelegramLongPollRelay` polls Telegram `getUpdates` (or an external transport can still call the same normalization helpers).
2. `normalizeTelegramUpdate()` extracts `senderId`, `chatId`, `chatType`, `telegramMessageId`, and `text`. Both `message` and `edited_message` are handled. Text is taken from `text` or `caption` fields. Updates without a sender or text are discarded (returns `null`).
3. `ingestTelegramUpdate()` calls the runtime's `ingestMessage()` with source `telegram` and the extracted fields.
4. The runtime applies the full ingress pipeline (see below).
5. For accepted messages, the relay waits for the related job to reach a terminal state through the control API.
6. The relay fetches the final run events and derives the reply with this precedence:
   - `completed.output`
   - last assistant `message` text
   - receipt-derived fallback text
7. The relay sends the formatted reply back to Telegram with `sendMessage`.
8. Duplicate replayed deliveries and denied ingress responses do **not** produce a Telegram reply; the runtime remains the audit source of truth.

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

Telegram messages are deduped via an idempotency key: `telegram:{chatId}:{telegramMessageId}`. Duplicate deliveries replay the original response without re-processing.

This is also the current restart/offset story for long-poll mode: if Telegram replays an update after daemon restart, the runtime replay is accepted as a duplicate and the relay stays silent rather than sending a second reply.

## Configuration

Telegram config lives in `AppConfig.telegram`:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| enabled | boolean | `false` | Master switch |
| allowedUserId | string | -- | Telegram user ID allowed to send messages |
| maxMessagesPerMinute | integer | `10` | Rate limit threshold |
| rateLimitWindowSeconds | integer | `60` | Rate limit sliding window |

## Security audit trail

Every denied ingress attempt is recorded in the `message_ingress` table and the `security_audit` table. Rate-limited attempts are logged at `warn` severity; all other denials at `error` severity.

## Adapter types

The adapter exports these interfaces:

- `TelegramUpdate` / `TelegramMessageUpdate` -- raw Telegram update shapes
- `NormalizedTelegramUpdate` -- extracted fields after normalization
- `TelegramIngressClient` -- interface for the runtime's `ingestMessage` method
- `TelegramRunTrackingClient` -- control-plane contract for job polling + run event retrieval
- `TelegramBotClient` -- Bot API transport contract
