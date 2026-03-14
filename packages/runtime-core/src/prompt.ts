import { type PromptScanResult } from '@popeye/contracts';
import safe from 'safe-regex2';

const SANITIZE_RULES: Array<{ name: string; pattern: RegExp; replacement: string }> = [
  { name: 'ignore-previous', pattern: /ignore previous instructions/gi, replacement: '[sanitized instruction override]' },
  { name: 'system-prompt', pattern: /reveal (the )?system prompt/gi, replacement: '[sanitized secret request]' },
];

const QUARANTINE_RULES: Array<{ name: string; pattern: RegExp }> = [
  { name: 'credential-exfiltration', pattern: /(print|show|reveal).*(token|secret|password|private key)/i },
  { name: 'destructive-bypass', pattern: /(disable|bypass).*(policy|approval|guardrail)/i },
  { name: 'tool-abuse', pattern: /(run|execute).*(rm -rf|curl .*metadata|scp |ssh )/i },
  { name: 'base64-command', pattern: /(?:execute|run|eval)\s+(?:atob|base64|btoa)/i },
  { name: 'url-exfiltration', pattern: /(?:fetch|curl|wget|xmlhttprequest)\s*\(?\s*['"]https?:\/\//i },
  { name: 'unicode-bidi-override', pattern: /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/ },
];

export interface PromptScanOptions {
  customQuarantinePatterns?: string[];
  customSanitizePatterns?: Array<{ pattern: string; replacement: string }>;
}

export function scanPrompt(text: string, options?: PromptScanOptions): PromptScanResult {
  // Normalize Unicode to NFC to prevent homoglyph bypasses
  const normalized = text.normalize('NFC');

  const customQuarantineInput = options?.customQuarantinePatterns ?? [];
  const customQuarantineRules: Array<{ name: string; pattern: RegExp }> = [];
  const skippedRules: string[] = [];

  for (let i = 0; i < customQuarantineInput.length; i++) {
    const p = customQuarantineInput[i]!;
    const name = `custom-quarantine-${i + 1}`;
    if (!safe(p)) {
      skippedRules.push(`${name}[skipped:redos]`);
      continue;
    }
    customQuarantineRules.push({ name, pattern: new RegExp(p, 'i') });
  }

  const customSanitizeInput = options?.customSanitizePatterns ?? [];
  const customSanitizeRules: Array<{ name: string; pattern: RegExp; replacement: string }> = [];

  for (let i = 0; i < customSanitizeInput.length; i++) {
    const p = customSanitizeInput[i]!;
    const name = `custom-sanitize-${i + 1}`;
    if (!safe(p.pattern)) {
      skippedRules.push(`${name}[skipped:redos]`);
      continue;
    }
    customSanitizeRules.push({ name, pattern: new RegExp(p.pattern, 'gi'), replacement: p.replacement });
  }

  const allQuarantineRules = [...QUARANTINE_RULES, ...customQuarantineRules];
  const allSanitizeRules = [...SANITIZE_RULES, ...customSanitizeRules];

  const matchedRules: string[] = [];
  for (const rule of allQuarantineRules) {
    if (rule.pattern.test(normalized)) {
      matchedRules.push(rule.name);
    }
  }
  if (matchedRules.length > 0) {
    matchedRules.push(...skippedRules);
    return {
      verdict: 'quarantine',
      sanitizedText: normalized,
      matchedRules,
    };
  }

  let sanitizedText = normalized;
  for (const rule of allSanitizeRules) {
    if (rule.pattern.test(sanitizedText)) {
      matchedRules.push(rule.name);
      sanitizedText = sanitizedText.replace(rule.pattern, rule.replacement);
    }
  }

  const verdict = matchedRules.length > 0 ? 'sanitize' : 'allow';
  matchedRules.push(...skippedRules);
  return {
    verdict,
    sanitizedText,
    matchedRules,
  };
}
