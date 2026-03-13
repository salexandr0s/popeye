# @popeye/receipts

Receipt rendering and artifact I/O for the Popeye platform. Every run is
receipted -- including failures and cancellations -- to maintain a complete
operational audit trail.

## Purpose

Transforms structured `ReceiptRecord` objects into human-readable text output
showing run status, provider, model, token usage, and estimated cost. Also
provides file-based artifact storage for persisting receipt JSON to the runtime
data directory, organized by run ID.

## Layer

Runtime domain. Rendering is pure logic; artifact I/O is a thin filesystem
wrapper.

## Provenance

New platform implementation.

## Key exports

| Export                   | Description                                              |
| ------------------------ | -------------------------------------------------------- |
| `renderReceipt(receipt)` | Format a `ReceiptRecord` as human-readable text          |
| `writeReceiptArtifact()` | Persist receipt JSON to `receipts/by-run/<id>.json`      |
| `readReceiptArtifact()`  | Read a persisted receipt artifact by ID                  |

## Dependencies

- `@popeye/contracts` -- `ReceiptRecord`, `RuntimePaths` types

## Usage

```ts
import { renderReceipt, writeReceiptArtifact } from '@popeye/receipts';

console.log(renderReceipt(receipt));
// Receipt abc-123
// Run: run-456
// Status: succeeded
// Tokens: 1500/800
// Estimated cost: $0.0230

writeReceiptArtifact(paths, receipt.id, JSON.stringify(receipt));
```
