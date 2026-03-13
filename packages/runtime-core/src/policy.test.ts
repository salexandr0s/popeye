import { describe, expect, it } from 'vitest';

import { evaluateCriticalFileMutation } from './policy.js';

describe('evaluateCriticalFileMutation', () => {
  it('blocks unapproved protected files', () => {
    const result = evaluateCriticalFileMutation({ path: '/tmp/WORKSPACE.md', approved: false });
    expect(result.allowed).toBe(false);
    expect(result.requiresReceipt).toBe(true);
  });

  it('allows approved protected files', () => {
    const result = evaluateCriticalFileMutation({ path: '/tmp/WORKSPACE.md', approved: true });
    expect(result.allowed).toBe(true);
  });
});
