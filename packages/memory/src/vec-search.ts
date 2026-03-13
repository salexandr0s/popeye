import type Database from 'better-sqlite3';

export interface VecCandidate {
  memoryId: string;
  distance: number;
}

export function searchVec(db: Database.Database, queryEmbedding: Float32Array, limit = 60): VecCandidate[] {
  const buffer = Buffer.from(queryEmbedding.buffer, queryEmbedding.byteOffset, queryEmbedding.byteLength);
  const rows = db.prepare('SELECT memory_id, distance FROM memory_vec WHERE embedding MATCH ? ORDER BY distance LIMIT ?').all(buffer, limit) as Array<{
    memory_id: string;
    distance: number;
  }>;

  return rows.map((row) => ({
    memoryId: row.memory_id,
    distance: row.distance,
  }));
}

export function insertVecEmbedding(db: Database.Database, memoryId: string, embedding: Float32Array): void {
  const buffer = Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
  db.prepare('INSERT INTO memory_vec(memory_id, embedding) VALUES (?, ?)').run(memoryId, buffer);
}

export function deleteVecEmbedding(db: Database.Database, memoryId: string): void {
  db.prepare('DELETE FROM memory_vec WHERE memory_id = ?').run(memoryId);
}
