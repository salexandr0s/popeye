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
2. **Store the bot token in Popeye** — prefer the native secret store, not daemon env as the only long-term path:
   ```bash
   pop telegram configure --allowed-user-id <your-telegram-user-id> --token-file /path/to/token --provider file --enable
   ```
   - Use `--provider file` for SSH/headless setups.
   - Use `--provider keychain` only when Keychain access is available and approved.
3. **Set config** (or let `pop telegram configure` write these fields for you):
   ```json
   {
     "telegram": {
        "enabled": true,
        "allowedUserId": "<your-telegram-user-id>",
        "secretRefId": "<popeye-secret-ref-id>",
        "maxMessagesPerMinute": 10,
        "rateLimitWindowSeconds": 60
      }
    }
   ```
4. **Restart the daemon** — `popeyed` authenticates to the control API using the runtime auth token and starts the long-poll relay automatically when Telegram is enabled
5. **Test ingress** — send a DM, verify it appears in `pop runs tail`
6. **Test reply delivery** — confirm `GET /v1/runs/:id/reply` returns `completed.output` when present, otherwise the last assistant message, with receipt rendering only as a fallback
7. **Test replay safety** — resend or replay the same Telegram update and confirm Popeye does not create a second run or send a second reply once the delivery is marked `sent` and the long-poll checkpoint advances
8. **Verify routing** — inspect `message_ingress`, jobs, runs, and receipts if the bot does not answer as expected

## Intentional omissions

- **Group chats** — single-operator, no group semantics
- **Multi-user** — allowlist is single-user by design
- **Media** — text messages only
- **Custom commands** — all messages are natural language
- **Pairing** — replaced by static allowlist configuration
