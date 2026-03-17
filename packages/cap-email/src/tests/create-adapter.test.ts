import { describe, expect, it } from 'vitest';

import { createAdapter } from '../providers/create-adapter.js';
import { GwsCliAdapter } from '../providers/gws-adapter.js';
import { ProtonBridgeAdapter } from '../providers/proton-adapter.js';

describe('createAdapter', () => {
  it('creates GwsCliAdapter for gmail provider', () => {
    const adapter = createAdapter('gmail');
    expect(adapter).toBeInstanceOf(GwsCliAdapter);
  });

  it('creates GwsCliAdapter with custom path', () => {
    const adapter = createAdapter('gmail', { gwsPath: '/custom/gws' });
    expect(adapter).toBeInstanceOf(GwsCliAdapter);
  });

  it('creates ProtonBridgeAdapter for proton provider', () => {
    const adapter = createAdapter('proton', {
      username: 'user@proton.me',
      password: 'bridge-pass',
    });
    expect(adapter).toBeInstanceOf(ProtonBridgeAdapter);
  });

  it('throws when proton credentials are missing', () => {
    expect(() => createAdapter('proton')).toThrow('requires username and password');
    expect(() => createAdapter('proton', { username: 'user@proton.me' })).toThrow('requires username and password');
    expect(() => createAdapter('proton', { password: 'pass' })).toThrow('requires username and password');
  });
});
