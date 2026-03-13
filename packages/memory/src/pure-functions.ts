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
