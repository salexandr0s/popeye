import type Database from 'better-sqlite3';

export async function loadSqliteVec(db: Database.Database, dimensions = 1536): Promise<boolean> {
  try {
    const sqliteVec = await import('sqlite-vec') as { load: (db: Database.Database) => void };
    sqliteVec.load(db);
    db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS memory_vec USING vec0(memory_id TEXT PRIMARY KEY, embedding float[${dimensions}])`);
    return true;
  } catch {
    console.warn('[memory] sqlite-vec extension not available — falling back to FTS5-only search');
    return false;
  }
}
