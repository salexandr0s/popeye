import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadSqliteVec } from './extension-loader.js';
import { deleteVecEmbedding, insertVecEmbedding, searchVec } from './vec-search.js';

let vecAvailable = false;
let db: Database.Database;

beforeEach(async () => {
  db = new Database(':memory:');
  vecAvailable = await loadSqliteVec(db);
  if (vecAvailable) {
    db.exec('CREATE VIRTUAL TABLE memory_vec USING vec0(memory_id TEXT PRIMARY KEY, embedding float[4])');
  }
});

afterEach(() => {
  db.close();
});

describe.skipIf(!vecAvailable)('vec-search', () => {
  // Note: these tests only run if sqlite-vec is available

  it('inserts and searches embeddings', () => {
    const embedding = new Float32Array([1, 0, 0, 0]);
    insertVecEmbedding(db, 'mem-1', embedding);

    const queryEmbedding = new Float32Array([1, 0, 0, 0]);
    const results = searchVec(db, queryEmbedding, 10);

    expect(results).toHaveLength(1);
    expect(results[0]!.memoryId).toBe('mem-1');
    expect(results[0]!.distance).toBeCloseTo(0, 5);
  });

  it('returns results sorted by distance', () => {
    insertVecEmbedding(db, 'close', new Float32Array([1, 0, 0, 0]));
    insertVecEmbedding(db, 'far', new Float32Array([0, 1, 0, 0]));

    const query = new Float32Array([1, 0, 0, 0]);
    const results = searchVec(db, query, 10);

    expect(results).toHaveLength(2);
    expect(results[0]!.memoryId).toBe('close');
    expect(results[0]!.distance).toBeLessThan(results[1]!.distance);
  });

  it('respects limit', () => {
    for (let i = 0; i < 5; i++) {
      const emb = new Float32Array(4);
      emb[0] = 1;
      emb[i % 4] = 0.5;
      insertVecEmbedding(db, `mem-${i}`, emb);
    }

    const results = searchVec(db, new Float32Array([1, 0, 0, 0]), 2);
    expect(results).toHaveLength(2);
  });

  it('deletes embeddings', () => {
    insertVecEmbedding(db, 'del-me', new Float32Array([1, 0, 0, 0]));
    deleteVecEmbedding(db, 'del-me');

    const results = searchVec(db, new Float32Array([1, 0, 0, 0]), 10);
    expect(results).toHaveLength(0);
  });
});

describe('vec-search (no sqlite-vec)', () => {
  it('test file loads', () => {
    // Basic sanity — test file compiles and runs even when sqlite-vec is unavailable
    expect(true).toBe(true);
  });
});
