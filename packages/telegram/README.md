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

Current in-repo support is end-to-end **long-poll receive/send transport**.
Webhook hosting remains out of scope for the package.

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

Reply behavior:

- canonical reply text comes from `GET /v1/runs/:id/reply`
- reply precedence is `completed.output`, then last assistant `message`, then receipt fallback
- duplicate Telegram deliveries marked `sent` are replay-safe and do not send a second reply
- the relay now claims delivery as `sending` before `sendMessage`; replayed stale claims are marked `uncertain` instead of being auto-sent again
- when `sendMessage` succeeds, the relay forwards Telegram's outbound `message_id` into the control plane so the runtime retains delivery evidence for audit/debugging
- retryable definitive Bot API failures reset delivery back to `pending`; ambiguous transport failures and permanent Bot API failures are marked `uncertain` and require operator follow-up
- denied ingress is silent at the relay layer; the runtime remains the audit source of truth
- long-poll progress is durably checkpointed through control-plane relay routes, and checkpoint commits are monotonic per workspace
- reply preparation is bounded-concurrent by default, but reply send + checkpoint acknowledgement stay ordered
- only retryable definitive Bot API failures are retried automatically; ambiguous transport failures are not blindly retried

This package remains a thin bridge. It does not introduce a channel system or bypass the control API.

See `src/index.test.ts` for normalization, relay, and transport tests.
