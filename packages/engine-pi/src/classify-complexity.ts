export type ComplexityClass = 'simple' | 'standard' | 'complex';

export interface ComplexityResult {
  classification: ComplexityClass;
  score: number;
  signals: string[];
}

export interface ModelRoutingDecision {
  model: string | undefined;
  classification: ComplexityClass;
  score: number;
  signals: string[];
}

const COMPLEXITY_KEYWORDS = new Set([
  'debug',
  'optimize',
  'refactor',
  'analyze',
  'implement',
  'investigate',
  'fix',
]);

const CODE_BLOCK_RE = /```/g;
const URL_RE = /https?:\/\/\S+/;
const ERROR_TRACE_RE = /(?:Error|Exception|Traceback|at\s+\w+\s*\()/;

export function classifyPromptComplexity(prompt: string): ComplexityResult {
  const signals: string[] = [];
  let score = 0.5;

  const trimmed = prompt.trim();
  const charCount = trimmed.length;
  const words = trimmed.split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  const codeBlockMarkers = trimmed.match(CODE_BLOCK_RE)?.length ?? 0;
  const codeBlockPairs = Math.floor(codeBlockMarkers / 2);
  const hasUrl = URL_RE.test(trimmed);
  const hasLineBreaks = trimmed.includes('\n');
  const hasErrorTrace = ERROR_TRACE_RE.test(trimmed);
  const lowerPrompt = trimmed.toLowerCase();
  const hasKeywords = [...COMPLEXITY_KEYWORDS].some((kw) => lowerPrompt.includes(kw));

  if (charCount < 160) {
    signals.push('short_length');
    score -= 0.15;
  }
  if (wordCount < 28) {
    signals.push('few_words');
    score -= 0.1;
  }

  if (codeBlockPairs >= 2) {
    signals.push('multiple_code_blocks');
    score += 0.25;
  } else if (codeBlockPairs === 1) {
    signals.push('has_code_block');
    score += 0.1;
  }
  if (wordCount > 500) {
    signals.push('very_long');
    score += 0.2;
  }
  if (hasUrl) {
    signals.push('has_url');
    score += 0.1;
  }
  if (hasLineBreaks) {
    signals.push('has_line_breaks');
    score += 0.05;
  }
  if (hasErrorTrace) {
    signals.push('has_error_trace');
    score += 0.15;
  }
  if (hasKeywords) {
    signals.push('has_complexity_keywords');
    score += 0.1;
  }

  score = Math.max(0, Math.min(1, score));

  let classification: ComplexityClass;
  if (
    score < 0.3 &&
    charCount < 160 &&
    wordCount < 28 &&
    codeBlockPairs === 0 &&
    !hasUrl &&
    !hasLineBreaks &&
    !hasKeywords &&
    !hasErrorTrace
  ) {
    classification = 'simple';
  } else if (score > 0.7) {
    classification = 'complex';
  } else {
    classification = 'standard';
  }

  return { classification, score, signals };
}

export function resolveModelForPrompt(
  config: { enabled: boolean; simpleModel?: string | undefined; standardModel?: string | undefined; complexModel?: string | undefined } | undefined,
  prompt: string,
): ModelRoutingDecision | undefined {
  if (!config?.enabled) return undefined;
  const result = classifyPromptComplexity(prompt);
  let model: string | undefined;
  switch (result.classification) {
    case 'simple':
      model = config.simpleModel;
      break;
    case 'complex':
      model = config.complexModel;
      break;
    default:
      model = config.standardModel;
      break;
  }
  return { model, ...result };
}
