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
  { name: 'unicode-bidi-override', pattern: /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/ },
  { name: 'zero-width-chars', pattern: /[\u200B\u200C\u200D\uFEFF]/ },
  { name: 'mixed-script-attack', pattern: /(?:[a-zA-Z]+[\u0400-\u04FF]|[\u0400-\u04FF]+[a-zA-Z])/ },
];

export interface PromptScanOptions {
  customQuarantinePatterns?: string[];
  customSanitizePatterns?: Array<{ pattern: string; replacement: string }>;
}

export function scanPrompt(text: string, options?: PromptScanOptions): PromptScanResult {
  // NFKC normalization decomposes compatibility characters (fullwidth Latin,
  // ligatures) into base forms, catching more evasion vectors than NFC.
  const normalized = text.normalize('NFKC');

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
  // Quarantine patterns must NOT use the `g` flag — .test() on a global
  // regex mutates lastIndex, causing intermittent match failures across calls.
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
    // Replace directly and check if the string changed — avoids lastIndex
    // pollution from calling .test() on a global regex before .replace().
    const replaced = sanitizedText.replace(rule.pattern, rule.replacement);
    if (replaced !== sanitizedText) {
      matchedRules.push(rule.name);
      sanitizedText = replaced;
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
