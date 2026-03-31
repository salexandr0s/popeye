import { describe, expect, it } from 'vitest';

import { compileInstructionBundle } from './index.js';

describe('compileInstructionBundle', () => {
  it('orders by precedence and produces a hash', () => {
    const bundle = compileInstructionBundle([
      { precedence: 5, type: 'project', content: 'project', contentHash: 'b' },
      { precedence: 2, type: 'popeye_base', content: 'base', contentHash: 'a' },
    ]);
    expect(bundle.sources[0]?.precedence).toBe(2);
    expect(bundle.compiledText).toContain('base');
    expect(bundle.bundleHash).toHaveLength(64);
    expect(bundle.playbooks).toEqual([]);
  });

  it('preserves auditable applied playbooks in the compiled bundle', () => {
    const bundle = compileInstructionBundle({
      sources: [
        {
          precedence: 6,
          type: 'playbook',
          inlineId: 'playbooks',
          contentHash: 'playbook-source-hash',
          content: 'Playbook body',
        },
      ],
      playbooks: [
        {
          id: 'triage',
          title: 'Triage',
          scope: 'workspace',
          revisionHash: 'rev-123',
        },
      ],
    });

    expect(bundle.playbooks).toEqual([
      {
        id: 'triage',
        title: 'Triage',
        scope: 'workspace',
        revisionHash: 'rev-123',
      },
    ]);
  });
});
