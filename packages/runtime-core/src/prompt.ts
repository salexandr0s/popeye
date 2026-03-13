import { type PromptScanResult } from '@popeye/contracts';

const SANITIZE_RULES: Array<{ name: string; pattern: RegExp; replacement: string }> = [
  { name: 'ignore-previous', pattern: /ignore previous instructions/gi, replacement: '[sanitized instruction override]' },
  { name: 'system-prompt', pattern: /reveal (the )?system prompt/gi, replacement: '[sanitized secret request]' },
];

const QUARANTINE_RULES: Array<{ name: string; pattern: RegExp }> = [
  { name: 'credential-exfiltration', pattern: /(print|show|reveal).*(token|secret|password|private key)/i },
  { name: 'destructive-bypass', pattern: /(disable|bypass).*(policy|approval|guardrail)/i },
  { name: 'tool-abuse', pattern: /(run|execute).*(rm -rf|curl .*metadata|scp |ssh )/i },
];

export function scanPrompt(text: string): PromptScanResult {
  const matchedRules: string[] = [];
  for (const rule of QUARANTINE_RULES) {
    if (rule.pattern.test(text)) {
      matchedRules.push(rule.name);
    }
  }
  if (matchedRules.length > 0) {
    return {
      verdict: 'quarantine',
      sanitizedText: text,
      matchedRules,
    };
  }

  let sanitizedText = text;
  for (const rule of SANITIZE_RULES) {
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
