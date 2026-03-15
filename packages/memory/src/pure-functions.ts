import type { DataClassification, EmbeddingEligibility } from '@popeye/contracts';

import type { MemoryRecord, MemoryType } from './types.js';
import { sha256 } from '@popeye/observability';

const DENIED_SOURCE_TYPES = new Set(['receipt', 'telegram', 'daily_summary']);

export function decideEmbeddingEligibility(record: MemoryRecord): EmbeddingEligibility {
  if (record.classification !== 'embeddable') {
    return 'deny';
  }
  if (DENIED_SOURCE_TYPES.has(record.sourceType)) {
    return 'deny';
  }
  return 'allow';
}

export function computeConfidenceDecay(initialConfidence: number, daysSinceLastReinforcement: number, halfLifeDays = 30): number {
  return initialConfidence * 0.5 ** (daysSinceLastReinforcement / halfLifeDays);
}

export function shouldPersistClassification(classification: DataClassification): boolean {
  return classification !== 'secret';
}

const PROCEDURAL_KEYWORDS = /\b(step|workflow|procedure|how[\s-]to|recipe|runbook|process)\b/i;
const SEMANTIC_KEYWORDS = /\b(decision|fact|learned|definition|concept|principle|rule)\b/i;

export function classifyMemoryType(sourceType: string, content: string): MemoryType {
  if (sourceType === 'receipt' || sourceType === 'daily_summary') {
    return 'episodic';
  }
  if (sourceType === 'curated_memory' || sourceType === 'workspace_doc') {
    return 'semantic';
  }
  if (sourceType === 'compaction_flush') {
    if (PROCEDURAL_KEYWORDS.test(content)) return 'procedural';
    if (SEMANTIC_KEYWORDS.test(content)) return 'semantic';
    return 'episodic';
  }
  return 'episodic';
}

export function computeDedupKey(description: string, content: string, scope: string): string {
  return sha256(`${scope}:${description.trim().toLowerCase()}:${content.trim().substring(0, 500)}`);
}

export function computeReinforcedConfidence(current: number, boost = 0.1): number {
  return Math.min(1, current + boost);
}

export function shouldArchive(confidence: number, threshold = 0.1): boolean {
  return confidence < threshold;
}

export function computeTextOverlap(a: string, b: string): number {
  const tokensA = new Set(a.split(/\s+/).filter(Boolean));
  const tokensB = new Set(b.split(/\s+/).filter(Boolean));
  if (tokensA.size === 0 && tokensB.size === 0) return 1;
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let intersection = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) intersection++;
  }
  const union = tokensA.size + tokensB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function renderDailySummaryMarkdown(input: {
  date: string;
  workspaceId: string;
  runsCompleted: number;
  runsFailed: number;
  discoveries: string[];
  errors: string[];
  followUps: string[];
}): string {
  const lines: string[] = [
    `# Daily Summary — ${input.date}`,
    '',
    `**Workspace:** ${input.workspaceId}`,
    `**Runs completed:** ${input.runsCompleted}`,
    `**Runs failed:** ${input.runsFailed}`,
    '',
  ];

  if (input.discoveries.length > 0) {
    lines.push('## Discoveries', '');
    for (const d of input.discoveries) lines.push(`- ${d}`);
    lines.push('');
  }

  if (input.errors.length > 0) {
    lines.push('## Errors', '');
    for (const e of input.errors) lines.push(`- ${e}`);
    lines.push('');
  }

  if (input.followUps.length > 0) {
    lines.push('## Follow-ups', '');
    for (const f of input.followUps) lines.push(`- ${f}`);
    lines.push('');
  }

  return lines.join('\n');
}

const FTS5_SPECIAL = /["""{}()*:^~]/g;

export function buildFts5MatchExpression(query: string): string {
  const tokens = query
    .replace(FTS5_SPECIAL, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) return '""';
  return tokens.map((t) => `"${t}"`).join(' OR ');
}

export function normalizeRelevanceScore(ftsRank: number): number {
  return 1 / (1 + Math.abs(ftsRank));
}

export function computeRecencyScore(createdAt: string, now: Date): number {
  const created = new Date(createdAt);
  const daysSinceCreation = (now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24);
  return Math.exp(-daysSinceCreation / 90);
}

export function computeScopeMatchScore(memoryScope: string, queryScope: string | undefined): number {
  if (queryScope === undefined) return 0.5;
  if (memoryScope === queryScope) return 1.0;
  if (memoryScope === 'global') return 0.7;
  return 0.1;
}

// --- Query Sanitization ---

const MEMORY_BLOCK_PATTERNS = [
  /\[Memory:[\s\S]*?\[\/Memory\]/gi,      // [Memory: ...][/Memory] paired
  /\[Retrieved Memory\][\s\S]*?\[\/Retrieved Memory\]/gi, // retrieved memory blocks
  /<gigabrain-context>[\s\S]*?<\/gigabrain-context>/gi, // gigabrain injection
  /<memory(?:\s[^>]*)?>[\s\S]*?<\/memory>/gi, // <memory>...</memory>
  /<!--\s*memory[\s\S]*?-->/gi,            // <!-- memory ... -->
  /\[Memory:[^\]]*\]/gi,                   // standalone [Memory: ...] without closing tag
];

export function sanitizeSearchQuery(query: string): string {
  let result = query;
  for (const pattern of MEMORY_BLOCK_PATTERNS) {
    result = result.replace(pattern, ' ');
  }
  return result.replace(/\s+/g, ' ').trim();
}

// --- Durable Pattern Detection ---

const DURABLE_NAME_PATTERN = /\b(my name is|i am called|name:\s*)\b/i;
const DURABLE_DATE_PATTERN = /\b(birthday|born on|anniversary)\b/i;
const DURABLE_ROLE_PATTERN = /\b(i work as|my role is|i am a|my job is)\b/i;
const DURABLE_IDENTITY_PATTERN = /\b(my email|my phone|i live in|i am from)\b/i;

export function isDurableMemory(content: string): boolean {
  if (DURABLE_NAME_PATTERN.test(content)) return true;
  if (DURABLE_DATE_PATTERN.test(content)) return true;
  if (DURABLE_ROLE_PATTERN.test(content)) return true;
  if (DURABLE_IDENTITY_PATTERN.test(content)) return true;
  return false;
}

// --- Jaccard Similarity Fallback ---

export function computeJaccardRelevance(query: string, candidateContent: string): number {
  const queryTokens = new Set(query.toLowerCase().split(/\s+/).filter(Boolean));
  const contentWords = candidateContent.toLowerCase().split(/\s+/).filter(Boolean);
  const contentTokens = new Set(contentWords.slice(0, 500));

  if (queryTokens.size === 0 && contentTokens.size === 0) return 0;
  if (queryTokens.size === 0 || contentTokens.size === 0) return 0;

  let intersection = 0;
  for (const t of queryTokens) {
    if (contentTokens.has(t)) intersection++;
  }
  const union = queryTokens.size + contentTokens.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// --- Quality Assessment ---

export interface QualityAssessment {
  pass: boolean;
  reason?: string;
  score: number;
}

const MIN_CONTENT_LENGTH = 20;
const REPETITION_THRESHOLD = 0.9;
const SYSTEM_PROMPT_PATTERNS = [
  /^you are a helpful/i,
  /^you are an ai/i,
  /^as an ai language model/i,
  /^i am a large language model/i,
  /^system:\s/i,
];

export function assessMemoryQuality(description: string, content: string): QualityAssessment {
  if (!description.trim()) {
    return { pass: false, reason: 'empty_description', score: 0 };
  }

  const trimmed = content.trim();
  if (trimmed.length < MIN_CONTENT_LENGTH) {
    return { pass: false, reason: 'content_too_short', score: 0.1 };
  }

  // Check for repetitive tokens
  const tokens = trimmed.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length > 0) {
    const freq = new Map<string, number>();
    for (const t of tokens) freq.set(t, (freq.get(t) ?? 0) + 1);
    const maxFreq = Math.max(...freq.values());
    if (maxFreq / tokens.length > REPETITION_THRESHOLD) {
      return { pass: false, reason: 'repetitive_content', score: 0.1 };
    }
  }

  // Check for content identical to description
  if (trimmed.toLowerCase() === description.trim().toLowerCase()) {
    return { pass: false, reason: 'content_equals_description', score: 0.2 };
  }

  // Check for system prompt echoes
  for (const pattern of SYSTEM_PROMPT_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { pass: false, reason: 'system_prompt_echo', score: 0.1 };
    }
  }

  // Compute a rough quality score based on content richness
  const lengthScore = Math.min(1, trimmed.length / 200);
  const uniqueTokenRatio = tokens.length > 0 ? new Set(tokens).size / tokens.length : 0;
  const score = 0.5 * lengthScore + 0.5 * uniqueTokenRatio;

  return { pass: true, score };
}
