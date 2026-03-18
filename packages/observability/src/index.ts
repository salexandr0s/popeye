import { createHash } from 'node:crypto';

import safe from 'safe-regex2';
import type { SecurityAuditEvent } from '@popeye/contracts';

export { createLogger } from './logger.js';
export type { PopeyeLogger, CorrelationIds, CreateLoggerOptions } from './logger.js';

const BUILTIN_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'openai-key', pattern: /sk-[A-Za-z0-9]{10,}/g },
  { name: 'generic-key', pattern: /key-[A-Za-z0-9]{10,}/g },
  { name: 'bearer-token', pattern: /Bearer\s+[A-Za-z0-9._-]{20,}/g },
  { name: 'pem-block', pattern: /-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/g },
  { name: 'jwt', pattern: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9._-]{10,}\.[A-Za-z0-9._-]{10,}/g },
  { name: 'hex-secret', pattern: /(?<=(?:key|token|secret|password|credential|api_key|apikey)[=:\s"']+)[a-fA-F0-9]{40,}/gi },
  { name: 'aws-access-key', pattern: /AKIA[A-Z0-9]{16}/g },
  { name: 'github-pat', pattern: /github_pat_[A-Za-z0-9_]{20,}/g },
  { name: 'anthropic-key', pattern: /sk-ant-[A-Za-z0-9-]{20,}/g },
  { name: 'slack-webhook', pattern: /https:\/\/hooks\.slack\.com\/services\/T[A-Za-z0-9_/]+/g },
  { name: 'gcp-service-key', pattern: /"private_key":\s*"-----BEGIN[^"]*-----"/g },
  { name: 'azure-connection-string', pattern: /(?:AccountKey|SharedAccessKey)=[A-Za-z0-9+/=]{20,}/g },
  { name: 'database-url', pattern: /(?:postgres|mysql|mongodb|redis):\/\/[^\s"']+/g },
  { name: 'stripe-key', pattern: /(?:sk|pk)_(?:test|live)_[A-Za-z0-9]{10,}/g },
];

export interface RedactionResult {
  text: string;
  events: SecurityAuditEvent[];
}

const INPUT_SIZE_LIMIT = 1_048_576;

export function redactText(input: string, customPatterns: string[] = []): RedactionResult {
  let text = input;
  if (text.length > INPUT_SIZE_LIMIT) {
    text = text.slice(0, INPUT_SIZE_LIMIT);
  }
  const events: SecurityAuditEvent[] = [];
  const allPatterns = [...BUILTIN_PATTERNS];
  for (let i = 0; i < customPatterns.length; i++) {
    const p = customPatterns[i]!;
    const name = `custom-${i + 1}`;
    let isSafe: boolean;
    try {
      isSafe = safe(p);
    } catch {
      isSafe = false;
    }
    if (!isSafe) {
      events.push({
        code: 'redaction_pattern_skipped',
        severity: 'warn',
        message: `Skipped unsafe redaction pattern: ${name}`,
        component: 'observability',
        timestamp: new Date().toISOString(),
        details: { pattern: name, reason: 'redos' },
      });
      continue;
    }
    try {
      allPatterns.push({ name, pattern: new RegExp(p, 'g') });
    } catch {
      events.push({
        code: 'redaction_pattern_skipped',
        severity: 'warn',
        message: `Skipped invalid redaction pattern: ${name}`,
        component: 'observability',
        timestamp: new Date().toISOString(),
        details: { pattern: name, reason: 'invalid_regex' },
      });
    }
  }

  for (const entry of allPatterns) {
    entry.pattern.lastIndex = 0;
    if (!entry.pattern.test(text)) {
      continue;
    }
    entry.pattern.lastIndex = 0;
    text = text.replace(entry.pattern, `[REDACTED:${entry.name}]`);
    events.push({
      code: 'redaction_applied',
      severity: 'warn',
      message: `Applied ${entry.name}`,
      component: 'observability',
      timestamp: new Date().toISOString(),
      details: { pattern: entry.name },
    });
  }

  return { text, events };
}

export function extractRedactionPatterns(config: Record<string, unknown>): string[] {
  if (typeof config !== 'object' || config === null) return [];
  const security = config['security'];
  if (typeof security !== 'object' || security === null) return [];
  const patterns = (security as Record<string, unknown>)['redactionPatterns'];
  if (!Array.isArray(patterns)) return [];
  return patterns.filter((p): p is string => typeof p === 'string');
}

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}
