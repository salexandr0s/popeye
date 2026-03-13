import { type PromptScanResult } from '@popeye/contracts';

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

  const allQuarantineRules = [
    ...QUARANTINE_RULES,
    ...(options?.customQuarantinePatterns ?? []).map((p, i) => ({
      name: `custom-quarantine-${i + 1}`,
      pattern: new RegExp(p, 'i'),
    })),
  ];

  const allSanitizeRules = [
    ...SANITIZE_RULES,
    ...(options?.customSanitizePatterns ?? []).map((p, i) => ({
      name: `custom-sanitize-${i + 1}`,
      pattern: new RegExp(p.pattern, 'gi'),
      replacement: p.replacement,
    })),
  ];

  const matchedRules: string[] = [];
  for (const rule of allQuarantineRules) {
    if (rule.pattern.test(normalized)) {
      matchedRules.push(rule.name);
    }
  }
  if (matchedRules.length > 0) {
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

  return {
    verdict: matchedRules.length > 0 ? 'sanitize' : 'allow',
    sanitizedText,
    matchedRules,
  };
}
