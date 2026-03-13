# @popeye/telegram

Telegram update normalization and control API bridge. A thin, stateless adapter
that transforms raw Telegram webhook payloads into typed domain events and
routes them through the Popeye control API.

## Purpose

Parses Telegram `Update` objects (messages and edited messages), extracts sender
ID, chat metadata, and message text, and normalizes them into a consistent
internal format. Provides a client interface for ingesting normalized updates
through `/v1/messages/ingest`. All state lives in the Popeye runtime -- this
adapter holds none.

## Layer

Interface. Stateless adapter between Telegram and the control API.

## Provenance

New platform implementation. Not a port of OpenClaw's channel ecosystem.

## Key exports

| Export                         | Description                                          |
| ------------------------------ | ---------------------------------------------------- |
| `normalizeTelegramUpdate()`    | Parse raw Telegram webhook into `NormalizedTelegramUpdate` or null |
| `formatTelegramReply()`        | Clean up runtime response text for Telegram delivery |
| `ingestTelegramUpdate()`       | End-to-end: normalize + send to control API ingress  |
| `TelegramIngressClient`        | Interface for the ingress HTTP client                |
| `TelegramUpdate`               | Raw Telegram webhook payload type                    |
| `NormalizedTelegramUpdate`     | Normalized internal representation                   |

## Dependencies

- `@popeye/contracts` -- `IngestMessageInput`, `MessageIngressResponse`, `TelegramChatType`

## Usage

```ts
import { normalizeTelegramUpdate, ingestTelegramUpdate } from '@popeye/telegram';

const normalized = normalizeTelegramUpdate(webhookPayload);
if (normalized) {
  const response = await ingestTelegramUpdate(client, webhookPayload, 'default');
}
```

See `src/index.test.ts` for normalization and ingestion tests.
