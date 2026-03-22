import type { CapabilityContext } from '@popeye/contracts';

export type CapabilityDb = CapabilityContext['appDb'];

interface PreparedStatement<TRow> {
  get(...args: unknown[]): TRow | undefined;
  all(...args: unknown[]): TRow[];
  run(...args: unknown[]): { changes: number; lastInsertRowid: number | bigint };
}

export function prepareGet<TRow>(db: CapabilityDb, sql: string): (...args: unknown[]) => TRow | undefined {
  const stmt = (db.prepare as (sql: string) => PreparedStatement<TRow>)(sql);
  return (...args: unknown[]) => stmt.get(...args);
}

export function prepareAll<TRow>(db: CapabilityDb, sql: string): (...args: unknown[]) => TRow[] {
  const stmt = (db.prepare as (sql: string) => PreparedStatement<TRow>)(sql);
  return (...args: unknown[]) => stmt.all(...args);
}

export function prepareRun(db: CapabilityDb, sql: string): (...args: unknown[]) => { changes: number } {
  const stmt = (db.prepare as (sql: string) => PreparedStatement<never>)(sql);
  return (...args: unknown[]) => {
    const result = stmt.run(...args);
    return { changes: result.changes };
  };
}
