import { describe, expect, it } from 'vitest';

import { redactText } from './index.js';

describe('redactText', () => {
  it('redacts built-in secrets', () => {
    const result = redactText('token key-1234567890 and Bearer abcdefghijklmnopqrstuvwxyz123456');
    expect(result.text).toContain('[REDACTED:generic-key]');
    expect(result.text).toContain('[REDACTED:bearer-token]');
    expect(result.events.length).toBeGreaterThan(0);
  });

  it('redacts AWS access keys', () => {
    const result = redactText('Config: AKIAIOSFODNN7EXAMPLE is the key');
    expect(result.text).toContain('[REDACTED:aws-access-key]');
    expect(result.events.length).toBeGreaterThan(0);
  });

  it('redacts GitHub PATs', () => {
    const result = redactText('Token: github_pat_abcdefghijklmnopqrst is set');
    expect(result.text).toContain('[REDACTED:github-pat]');
    expect(result.events.length).toBeGreaterThan(0);
  });

  it('redacts Anthropic keys', () => {
    const result = redactText('Key: sk-ant-api03-abcdefghijklmnopqrst is configured');
    expect(result.text).toContain('[REDACTED:anthropic-key]');
    expect(result.events.length).toBeGreaterThan(0);
  });

  it('redacts Slack webhooks', () => {
    const result = redactText('Webhook: https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX');
    expect(result.text).toContain('[REDACTED:slack-webhook]');
    expect(result.events.length).toBeGreaterThan(0);
  });
});
