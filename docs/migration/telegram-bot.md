# Telegram Bot Migration

## Old model (OpenClaw)

- Channel adapter with pairing flow
- Multi-channel ecosystem support
- Group chat capability
- Custom command framework
- Media pipeline integration
- Gateway-wide routing

## New model (Popeye)

`@popeye/telegram` is a thin bridge to the control API:
- Routes all messages through `/v1/messages/ingest`
- Allowlist-only DM policy (no open registration)
- DM-only (no group chats)
- Rate-limited message ingress
- Stateless adapter — all state in Popeye runtime
- Prompt injection detection on all inbound messages
- Current implementation status: ingress normalization, end-to-end long-poll receive/send transport, and control-API-backed reply delivery are implemented in-repo

## Migration steps

1. **Note your Telegram user ID** — becomes the `allowedUserId` in config
2. **Set config**:
   ```json
   {
     "telegram": {
       "enabled": true,
       "allowedUserId": "<your-telegram-user-id>",
       "maxMessagesPerMinute": 10,
       "rateLimitWindowSeconds": 60
     }
   }
   ```
3. **Set bot token** — via `TELEGRAM_BOT_TOKEN` env var (never in config files)
4. **Deploy adapter** — `popeyed` authenticates to the control API using the runtime auth token and starts the long-poll relay automatically when Telegram is enabled
5. **Test ingress** — send a DM, verify it appears in `pop run list`
6. **Test reply delivery** — confirm the bot replies from `completed.output` when present, otherwise the last assistant message, with receipt rendering only as a fallback
7. **Test replay safety** — resend or replay the same Telegram update and confirm Popeye does not create a second run or send a second reply
8. **Verify routing** — inspect `message_ingress`, jobs, runs, and receipts if the bot does not answer as expected

## Intentional omissions

- **Group chats** — single-operator, no group semantics
- **Multi-user** — allowlist is single-user by design
- **Media** — text messages only
- **Custom commands** — all messages are natural language
- **Pairing** — replaced by static allowlist configuration
