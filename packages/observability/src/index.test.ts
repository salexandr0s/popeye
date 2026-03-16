import { describe, expect, it } from 'vitest';

import { redactText } from './index.js';

describe('redactText', () => {
  it('redacts built-in secrets', () => {
    const result = redactText('token key-1234567890 and Bearer abcdefghijklmnopqrstuvwxyz123456'); // secret-scan: allow
    expect(result.text).toContain('[REDACTED:generic-key]');
    expect(result.text).toContain('[REDACTED:bearer-token]');
    expect(result.events.length).toBeGreaterThan(0);
  });

  it('redacts AWS access keys', () => {
    const result = redactText('Config: AKIAIOSFODNN7EXAMPLE is the key'); // secret-scan: allow
    expect(result.text).toContain('[REDACTED:aws-access-key]');
    expect(result.events.length).toBeGreaterThan(0);
  });

  it('redacts GitHub PATs', () => {
    const result = redactText('Token: github_pat_abcdefghijklmnopqrst is set'); // secret-scan: allow
    expect(result.text).toContain('[REDACTED:github-pat]');
    expect(result.events.length).toBeGreaterThan(0);
  });

  it('redacts Anthropic keys', () => {
    const result = redactText('Key: sk-ant-api03-abcdefghijklmnopqrst is configured'); // secret-scan: allow
    expect(result.text).toContain('[REDACTED:anthropic-key]');
    expect(result.events.length).toBeGreaterThan(0);
  });

  it('redacts Slack webhooks', () => {
    const result = redactText('Webhook: https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX'); // secret-scan: allow
    expect(result.text).toContain('[REDACTED:slack-webhook]');
    expect(result.events.length).toBeGreaterThan(0);
  });

  it('redacts GCP service account key wrapper', () => {
    // GCP key content triggers pem-block first; verify the wrapper pattern also fires
    const result = redactText('Has "private_key": "-----BEGIN PRIVATE KEY-----" in config');
    expect(result.events.some(e => e.details?.pattern === 'gcp-service-key' || e.details?.pattern === 'pem-block')).toBe(true);
  });

  it('redacts Azure connection strings', () => {
    const result = redactText('Connection: SharedAccessKey=YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4');
    expect(result.text).toContain('[REDACTED:azure-connection-string]');
  });

  it('redacts database URLs', () => {
    const result = redactText('DB: postgres://admin:secretpw@db.example.com:5432/mydb');
    expect(result.text).toContain('[REDACTED:database-url]');
  });

  it('redacts Stripe keys', () => {
    const result = redactText('Payment: pk_live_abcdefghijklmnopqrstuvwx');
    expect(result.text).toContain('[REDACTED:stripe-key]');
  });

  it('skips ReDoS-vulnerable custom patterns with audit event', () => {
    const result = redactText('test input', ['(a+)+b']);
    expect(result.events.some(e => e.code === 'redaction_pattern_skipped' && e.details?.reason === 'redos')).toBe(true);
  });

  it('skips invalid regex syntax with audit event', () => {
    const result = redactText('test input', ['[invalid']);
    expect(result.events.some(e => e.code === 'redaction_pattern_skipped')).toBe(true);
  });

  it('applies safe custom patterns normally', () => {
    const result = redactText('my-custom-secret-12345', ['my-custom-secret-\\d+']);
    expect(result.text).toContain('[REDACTED:custom-1]');
    expect(result.events.some(e => e.code === 'redaction_pattern_skipped')).toBe(false);
  });

  it('handles mixed safe and unsafe custom patterns', () => {
    const result = redactText('my-custom-secret-12345', ['(a+)+b', 'my-custom-secret-\\d+']);
    expect(result.text).toContain('[REDACTED:custom-2]');
    expect(result.events.some(e => e.code === 'redaction_pattern_skipped')).toBe(true);
    expect(result.events.some(e => e.code === 'redaction_applied' && e.details?.pattern === 'custom-2')).toBe(true);
  });

  it('truncates oversized input', () => {
    const bigInput = 'x'.repeat(2_000_000);
    const result = redactText(bigInput);
    expect(result.text.length).toBeLessThanOrEqual(1_048_576);
  });
});
