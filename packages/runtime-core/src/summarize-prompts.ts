export type SummarizePromptTier = 'leaf' | 'condensed_d1' | 'condensed_d2' | 'condensed_d3_plus';

export interface SummarizePromptResult {
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
}

/**
 * Select the prompt tier based on summary depth.
 * Depth 0 = leaf (raw conversation), depth 1 = first condensation, etc.
 */
export function selectPromptTier(depth: number): SummarizePromptTier {
  if (depth === 0) return 'leaf';
  if (depth === 1) return 'condensed_d1';
  if (depth === 2) return 'condensed_d2';
  return 'condensed_d3_plus';
}

const SYSTEM_PROMPTS: Record<SummarizePromptTier, string> = {
  leaf: 'You are a precise summarizer. Preserve: timestamps, decisions made, action items, error states, and any identifiers mentioned. Output a concise summary without preamble.',
  condensed_d1: 'You are a narrative consolidator. Focus on: outcomes, state changes, decisions, unresolved issues. Combine related summaries into a coherent narrative without preamble.',
  condensed_d2: 'You are a synthesis engine. Identify: recurring themes, unresolved issues, trajectory. Note contradictions between source summaries. Output a synthesis without preamble.',
  condensed_d3_plus: 'You are an arc summarizer. Structure your output as: starting context, milestones, current state, open threads. Output a high-level arc overview without preamble.',
};

const USER_PROMPT_TEMPLATES: Record<SummarizePromptTier, string> = {
  leaf: 'Summarize this conversation segment:\n\n{content}',
  condensed_d1: 'Consolidate these summaries into a coherent narrative:\n\n{content}',
  condensed_d2: 'Synthesize these summaries. Identify recurring themes, unresolved issues, and trajectory:\n\n{content}',
  condensed_d3_plus: 'Produce a high-level arc overview from these summaries:\n\n{content}',
};

const MAX_TOKENS: Record<SummarizePromptTier, number> = {
  leaf: 500,
  condensed_d1: 800,
  condensed_d2: 1000,
  condensed_d3_plus: 1200,
};

/**
 * Build a depth-aware summarization prompt.
 */
export function buildSummarizePrompt(input: {
  content: string;
  depth: number;
  startTime?: string;
  endTime?: string;
}): SummarizePromptResult {
  const tier = selectPromptTier(input.depth);
  const systemPrompt = SYSTEM_PROMPTS[tier];

  let content = input.content;
  if (input.startTime) {
    content = injectTimestamps(content, input.startTime);
  }

  const userPrompt = USER_PROMPT_TEMPLATES[tier].replace('{content}', content);

  return {
    systemPrompt,
    userPrompt,
    maxTokens: MAX_TOKENS[tier],
  };
}

const RETRY_SYSTEM_PROMPTS: Record<SummarizePromptTier, string> = {
  leaf: 'You are a strict summarizer. Your previous output was too long or off-topic. Be concise. Preserve only: key decisions, action items, errors. No preamble, no commentary.',
  condensed_d1: 'You are a strict consolidator. Your previous output was too long. Keep only: outcomes, decisions, blockers. No preamble.',
  condensed_d2: 'You are a strict synthesizer. Your previous output was too long. Keep only: themes, contradictions, trajectory. No preamble.',
  condensed_d3_plus: 'You are a strict arc summarizer. Your previous output was too long. Structure as: context, milestones, state, threads. Be maximally concise.',
};

const RETRY_MAX_TOKENS: Record<SummarizePromptTier, number> = {
  leaf: 300,
  condensed_d1: 500,
  condensed_d2: 700,
  condensed_d3_plus: 800,
};

/**
 * Build a stricter retry prompt for fallback summarization.
 */
export function buildRetryPrompt(input: {
  content: string;
  depth: number;
  startTime?: string;
  endTime?: string;
}): SummarizePromptResult {
  const tier = selectPromptTier(input.depth);

  let content = input.content;
  if (input.startTime) {
    content = injectTimestamps(content, input.startTime);
  }

  const userPrompt = USER_PROMPT_TEMPLATES[tier].replace('{content}', content);

  return {
    systemPrompt: RETRY_SYSTEM_PROMPTS[tier],
    userPrompt,
    maxTokens: RETRY_MAX_TOKENS[tier],
  };
}

/**
 * Prepend UTC timestamp to message blocks for temporal context.
 */
export function injectTimestamps(content: string, startTime: string): string {
  const date = new Date(startTime);
  if (isNaN(date.getTime())) return content;

  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');

  const tag = `[${year}-${month}-${day} ${hours}:${minutes} UTC]`;
  return `${tag}\n${content}`;
}
