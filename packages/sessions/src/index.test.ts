import { describe, expect, it } from 'vitest';

import { selectSessionRoot } from './index.js';

describe('selectSessionRoot', () => {
  it('creates deterministic ids', () => {
    expect(selectSessionRoot({ kind: 'system_heartbeat', scope: 'workspace-a' }).id).toBe('system_heartbeat:workspace-a');
  });
});
