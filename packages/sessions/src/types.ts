import type { DbConnection } from '@popeye/contracts';

export interface SessionDeps {
  app: DbConnection;
}
