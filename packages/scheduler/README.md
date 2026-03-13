# @popeye/scheduler

Retry delay calculation with exponential backoff for the Popeye task scheduler.
Pure functions for computing when a failed run should next be attempted.

## Purpose

Provides the timing logic used by `PopeyeRuntimeService` to schedule retries
after run failures. Implements exponential backoff with configurable base delay,
multiplier, and maximum delay cap. Also provides a due-time check for evaluating
whether a scheduled item is ready to execute.

## Layer

Runtime domain. Pure logic with no I/O or side effects.

## Provenance

New platform implementation.

## Key exports

| Export                          | Description                                                    |
| ------------------------------- | -------------------------------------------------------------- |
| `calculateRetryDelaySeconds()`  | Compute backoff delay for a given attempt number and policy     |
| `calculateRetryAvailableAt()`   | Compute absolute ISO timestamp for the next retry              |
| `isDueAt()`                     | Check whether a scheduled `availableAt` timestamp has arrived  |

## Dependencies

- `@popeye/contracts` -- `RetryPolicy` type definition

## Usage

```ts
import { calculateRetryDelaySeconds, isDueAt } from '@popeye/scheduler';

const delay = calculateRetryDelaySeconds(3, { baseDelaySeconds: 5, multiplier: 2, maxDelaySeconds: 300 });
// => 20

const ready = isDueAt('2024-01-01T00:00:00Z');
// => true (if now is past that time)
```

See `src/index.test.ts` for backoff and scheduling tests.
