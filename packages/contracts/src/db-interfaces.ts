/**
 * Minimal database access interfaces for dependency injection.
 * Domain packages depend on these; runtime-core provides implementations.
 * better-sqlite3's Database class satisfies DbConnection structurally.
 */

export interface DbStatement {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

export interface DbConnection {
  prepare(sql: string): DbStatement;
  exec(sql: string): void;
  transaction<T>(fn: () => T): () => T;
}
