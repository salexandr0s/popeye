import type { DbConnection } from '@popeye/contracts';

export interface SchedulerDeps {
  app: DbConnection;
}

export interface TaskManagerCallbacks {
  emit(event: string, payload: unknown): void;
  processSchedulerTick(): Promise<void>;
}
