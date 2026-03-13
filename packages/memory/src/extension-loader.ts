import type Database from 'better-sqlite3';

export async function loadSqliteVec(db: Database.Database): Promise<boolean> {
  try {
    const sqliteVec = await import('sqlite-vec') as { load: (db: Database.Database) => void };
    sqliteVec.load(db);
    return true;
  } catch {
    console.warn('[memory] sqlite-vec extension not available — falling back to FTS5-only search');
    return false;
  }
}
