# @popeye/receipts

Human-readable receipt rendering for completed runs. Transforms structured
receipt records into formatted text output that includes run status, duration,
token usage metrics, cost breakdown, and error summaries. Every run is receipted,
including failures and cancellations.

## Key exports

- `renderReceipt(receipt)` -- format a receipt record as human-readable text

## Dependencies

- `@popeye/contracts`

## Layer

Runtime domain. Pure rendering logic with no I/O or side effects.
