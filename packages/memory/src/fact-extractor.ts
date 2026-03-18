import type { DataClassification, MemoryFactKind, MemorySourceType, MemoryType } from '@popeye/contracts';

const PROCEDURE_PATTERN = /\b(step|workflow|procedure|runbook|how to|how do|guide|process)\b/i;
const PREFERENCE_PATTERN = /\b(prefer|preference|likes|dislikes|wants|avoid)\b/i;
const IDENTITY_PATTERN = /\b(name|email|phone|birthday|born|role|job|lives in|from)\b/i;
const RELATIONSHIP_PATTERN = /\b(owner|maintainer|reports to|works with|member of|connected to)\b/i;
const STATE_PATTERN = /\b(failed|failure|error|blocked|succeeded|completed|status|state)\b/i;

export interface ExtractFactsInput {
  description: string;
  content: string;
  classification: DataClassification;
  sourceType: MemorySourceType;
  scope: string;
  memoryType: MemoryType;
  sourceRunId?: string | null | undefined;
  sourceTimestamp?: string | null | undefined;
  occurredAt?: string | null | undefined;
}

export interface ExtractedFact {
  text: string;
  factKind: MemoryFactKind;
  memoryType: MemoryType;
  confidence: number;
  sourceReliability: number;
  extractionConfidence: number;
  occurredAt: string | null;
  validFrom: string | null;
  validTo: string | null;
  durable: boolean;
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function splitIntoCandidates(text: string): string[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((part) => compactWhitespace(part))
    .filter((part) => part.length >= 24);

  const sentences = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((part) => compactWhitespace(part))
    .filter((part) => part.length >= 24);

  return [...new Set([...paragraphs.slice(0, 4), ...sentences.slice(0, 6)])].slice(0, 6);
}

function inferFactKind(text: string, memoryType: MemoryType): MemoryFactKind {
  if (memoryType === 'procedural' || PROCEDURE_PATTERN.test(text)) return 'procedure';
  if (PREFERENCE_PATTERN.test(text)) return 'preference';
  if (IDENTITY_PATTERN.test(text)) return 'identity';
  if (RELATIONSHIP_PATTERN.test(text)) return 'relationship';
  if (STATE_PATTERN.test(text)) return 'state';
  if (memoryType === 'semantic') return 'summary';
  return 'event';
}

function inferSourceReliability(sourceType: MemorySourceType): number {
  switch (sourceType) {
    case 'workspace_doc':
      return 0.95;
    case 'receipt':
      return 0.9;
    case 'compaction_flush':
      return 0.75;
    case 'daily_summary':
      return 0.8;
    default:
      return 0.7;
  }
}

function buildPrimaryFact(input: ExtractFactsInput): string {
  const description = compactWhitespace(input.description);
  const leading = splitIntoCandidates(input.content)[0];
  if (leading && !leading.toLowerCase().includes(description.toLowerCase())) {
    return `${description}: ${leading}`;
  }
  return description;
}

function buildSourceCandidates(input: ExtractFactsInput): string[] {
  const candidates = [buildPrimaryFact(input), ...splitIntoCandidates(input.content)];

  if (input.sourceType === 'workspace_doc') {
    return candidates.slice(0, 5);
  }
  if (input.sourceType === 'receipt') {
    return candidates.slice(0, 4);
  }
  if (input.sourceType === 'compaction_flush') {
    return candidates.slice(0, 4);
  }
  return candidates.slice(0, 3);
}

export function extractFacts(input: ExtractFactsInput): ExtractedFact[] {
  const sourceReliability = inferSourceReliability(input.sourceType);
  const candidates = buildSourceCandidates(input);
  const baseConfidence = Math.min(1, Math.max(0.4, sourceReliability));
  const facts: ExtractedFact[] = [];

  for (const [index, candidate] of candidates.entries()) {
    const text = compactWhitespace(candidate);
    if (text.length < 24) continue;

    const factKind = inferFactKind(text, input.memoryType);
    facts.push({
      text,
      factKind,
      memoryType: input.memoryType,
      confidence: Math.max(0.35, baseConfidence - (index * 0.05)),
      sourceReliability,
      extractionConfidence: Math.max(0.5, 0.9 - (index * 0.08)),
      occurredAt: input.occurredAt ?? input.sourceTimestamp ?? null,
      validFrom: null,
      validTo: null,
      durable: input.classification === 'embeddable' && (factKind === 'identity' || factKind === 'preference' || factKind === 'procedure'),
    });
  }

  return facts;
}
