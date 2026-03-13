# Telegram Adapter

The Telegram adapter (`@popeye/telegram`) is a thin bridge between Telegram Bot API updates and the Popeye control API. It belongs to the interface layer and contains no runtime logic.

## Design principles

- Stateless adapter. All state lives in the Popeye runtime.
- Routes messages through `/v1/messages/ingest`, never directly to the Pi engine.
- Allowlist-only DM policy. No pairing flow, no open registration.
- All messages are treated as untrusted input.

## Message flow

1. Telegram sends a webhook update (or the adapter polls).
2. `normalizeTelegramUpdate()` extracts `senderId`, `chatId`, `chatType`, `telegramMessageId`, and `text` from the update. Both `message` and `edited_message` are handled. Text is taken from `text` or `caption` fields. Updates without a sender or text are discarded (returns `null`).
3. `ingestTelegramUpdate()` calls the runtime's `ingestMessage()` with source `telegram` and the extracted fields.
4. The runtime applies the full ingress pipeline (see below).
5. The adapter receives a `MessageIngressResponse` and can format a reply via `formatTelegramReply()`.

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
