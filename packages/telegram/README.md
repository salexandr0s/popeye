# @popeye/telegram

Telegram update normalization and control-API bridge. This is a thin adapter
that transforms raw Telegram webhook payloads into typed domain events and
formats runtime responses back into Telegram-compatible replies. It is not
a channel ecosystem -- all state lives in the Popeye runtime, and all
messages route through the control API.

## Key exports

- `normalizeTelegramUpdate(update)` -- parse raw Telegram webhook payload into domain event
- `formatTelegramReply(response)` -- format a runtime response for Telegram delivery
- `ingestTelegramUpdate(update, options)` -- end-to-end ingestion through control API

## Dependencies

- `@popeye/contracts`

## Layer

Interface. Stateless adapter between Telegram and the control API.
