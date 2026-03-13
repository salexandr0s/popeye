import { createHash } from 'node:crypto';

import type { SecurityAuditEvent } from '@popeye/contracts';

const BUILTIN_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'openai-key', pattern: /sk-[A-Za-z0-9]{10,}/g },
  { name: 'generic-key', pattern: /key-[A-Za-z0-9]{10,}/g },
  { name: 'bearer-token', pattern: /Bearer\s+[A-Za-z0-9._-]{20,}/g },
  { name: 'pem-block', pattern: /-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/g },
  { name: 'jwt', pattern: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9._-]{10,}\.[A-Za-z0-9._-]{10,}/g },
  { name: 'hex-secret', pattern: /\b[a-fA-F0-9]{40,}\b/g },
];

export interface RedactionResult {
  text: string;
  events: SecurityAuditEvent[];
}

export function redactText(input: string, customPatterns: string[] = []): RedactionResult {
  let text = input;
  const events: SecurityAuditEvent[] = [];
  const allPatterns = [
    ...BUILTIN_PATTERNS,
    ...customPatterns.map((pattern, index) => ({
      name: `custom-${index + 1}`,
      pattern: new RegExp(pattern, 'g'),
    })),
  ];

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

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
