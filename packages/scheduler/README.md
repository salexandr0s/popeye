# @popeye/scheduler

Retry delay calculation with exponential backoff for the Popeye task scheduler.
Provides pure functions for computing when a failed run should next be attempted,
with configurable base delay and maximum backoff.

## Key exports

- `calculateRetryDelaySeconds(attempt, options)` -- exponential backoff delay
- `calculateRetryAvailableAt(attempt, now, options)` -- absolute timestamp for next retry
- `isDueAt(availableAt, now)` -- check whether a scheduled item is ready to execute

## Dependencies

- `@popeye/contracts`

## Layer

Runtime domain. Pure logic with no I/O or side effects.
