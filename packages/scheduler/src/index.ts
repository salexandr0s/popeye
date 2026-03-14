import type { RetryPolicy } from '@popeye/contracts';

export { TaskManager } from './task-manager.js';
export type { SchedulerDeps, TaskManagerCallbacks } from './types.js';

export function calculateRetryDelaySeconds(attempt: number, policy: RetryPolicy): number {
  const delay = policy.baseDelaySeconds * policy.multiplier ** Math.max(attempt - 1, 0);
  return Math.min(delay, policy.maxDelaySeconds);
}

export function calculateRetryAvailableAt(attempt: number, policy: RetryPolicy, now = new Date()): string {
  return new Date(now.getTime() + calculateRetryDelaySeconds(attempt, policy) * 1000).toISOString();
}

export function isDueAt(availableAt: string, now = new Date()): boolean {
  return new Date(availableAt).getTime() <= now.getTime();
}
