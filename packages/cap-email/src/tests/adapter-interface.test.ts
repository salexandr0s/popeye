import { describe, expect, it } from 'vitest';

import type { EmailProviderAdapter } from '../providers/adapter-interface.js';
import { GwsCliAdapter } from '../providers/gws-adapter.js';
import { ProtonBridgeAdapter } from '../providers/proton-adapter.js';

describe('EmailProviderAdapter contract', () => {
  it('GwsCliAdapter implements all required methods', () => {
    const adapter: EmailProviderAdapter = new GwsCliAdapter();
    expect(typeof adapter.getProfile).toBe('function');
    expect(typeof adapter.listThreads).toBe('function');
    expect(typeof adapter.getThread).toBe('function');
    expect(typeof adapter.getMessage).toBe('function');
    // listHistory is optional but GWS supports it
    expect(typeof adapter.listHistory).toBe('function');
  });

  it('ProtonBridgeAdapter implements all required methods', () => {
    const adapter: EmailProviderAdapter = new ProtonBridgeAdapter({
      username: 'user@proton.me',
      password: 'pass',
    });
    expect(typeof adapter.getProfile).toBe('function');
    expect(typeof adapter.listThreads).toBe('function');
    expect(typeof adapter.getThread).toBe('function');
    expect(typeof adapter.getMessage).toBe('function');
    // listHistory is optional — Proton doesn't support it
    expect(adapter.listHistory).toBeUndefined();
  });
});
