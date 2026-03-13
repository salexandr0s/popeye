import { describe, expect, it } from 'vitest';

import { createDisabledEmbeddingClient } from './embedding-client.js';

describe('createDisabledEmbeddingClient', () => {
  it('has enabled=false', () => {
    const client = createDisabledEmbeddingClient();
    expect(client.enabled).toBe(false);
  });

  it('has model=disabled', () => {
    const client = createDisabledEmbeddingClient();
    expect(client.model).toBe('disabled');
  });

  it('has dimensions=0', () => {
    const client = createDisabledEmbeddingClient();
    expect(client.dimensions).toBe(0);
  });

  it('embed returns empty array', async () => {
    const client = createDisabledEmbeddingClient();
    const result = await client.embed(['test']);
    expect(result).toEqual([]);
  });
});

// Note: createOpenAIEmbeddingClient tests are integration tests that require
// OPENAI_API_KEY and network access. They are not included here.
