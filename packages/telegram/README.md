# @popeye/telegram

Telegram update normalization and control API bridge. A thin, stateless adapter
that transforms raw Telegram webhook payloads into typed domain events and
routes them through the Popeye control API.

## Purpose

Parses Telegram `Update` objects (messages and edited messages), extracts sender
ID, chat metadata, and message text, and normalizes them into a consistent
internal format. Provides a client interface for ingesting normalized updates
through `/v1/messages/ingest`, a Telegram Bot API transport client, and a
long-poll relay that waits for run completion before replying. All state lives
in the Popeye runtime -- this adapter holds none.

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
| `createTelegramBotClient()`    | Thin Telegram Bot API client (`getUpdates`, `sendMessage`) |
| `TelegramLongPollRelay`        | Long-poll worker that ingests, waits for completion, and replies |
| `TelegramIngressClient`        | Interface for the ingress HTTP client                |
| `TelegramUpdate`               | Raw Telegram webhook payload type                    |
| `NormalizedTelegramUpdate`     | Normalized internal representation                   |

## Dependencies

- `@popeye/contracts` -- `IngestMessageInput`, `MessageIngressResponse`, `TelegramChatType`

## Usage

```ts
import { PopeyeApiClient } from '@popeye/api-client';
import { TelegramLongPollRelay, createTelegramBotClient } from '@popeye/telegram';

const relay = new TelegramLongPollRelay({
  bot: createTelegramBotClient({ token: process.env.TELEGRAM_BOT_TOKEN! }),
  control: new PopeyeApiClient({ baseUrl: 'http://127.0.0.1:3210', token: process.env.POPEYE_TOKEN! }),
  workspaceId: 'default',
});

relay.start();
```

See `src/index.test.ts` for normalization, relay, and transport tests.
