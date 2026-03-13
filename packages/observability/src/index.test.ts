import { describe, expect, it } from 'vitest';

import { redactText } from './index.js';

describe('redactText', () => {
  it('redacts built-in secrets', () => {
    const result = redactText('token key-1234567890 and Bearer abcdefghijklmnopqrstuvwxyz123456');
    expect(result.text).toContain('[REDACTED:generic-key]');
    expect(result.text).toContain('[REDACTED:bearer-token]');
    expect(result.events.length).toBeGreaterThan(0);
  });
});
