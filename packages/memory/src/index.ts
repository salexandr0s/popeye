import type { DataClassification, EmbeddingEligibility, MemoryRecord } from '@popeye/contracts';

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
