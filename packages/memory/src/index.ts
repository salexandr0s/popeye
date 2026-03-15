// Pure functions (no circular deps — everything comes from pure-functions.ts)
export {
  decideEmbeddingEligibility,
  computeConfidenceDecay,
  shouldPersistClassification,
  classifyMemoryType,
  computeDedupKey,
  computeReinforcedConfidence,
  shouldArchive,
  computeTextOverlap,
  renderDailySummaryMarkdown,
  buildFts5MatchExpression,
  normalizeRelevanceScore,
  computeRecencyScore,
  computeScopeMatchScore,
  sanitizeSearchQuery,
  assessMemoryQuality,
  isDurableMemory,
  computeJaccardRelevance,
} from './pure-functions.js';
export type { QualityAssessment } from './pure-functions.js';

// Search pipeline
export { MemorySearchService } from './search-service.js';
export { rerankAndMerge } from './scoring.js';
export type { ScoredCandidate, RerankParams } from './scoring.js';
export { searchFts5, syncFtsInsert, syncFtsDelete } from './fts5-search.js';
export type { FtsCandidate } from './fts5-search.js';
export { searchVec, insertVecEmbedding, deleteVecEmbedding } from './vec-search.js';
export type { VecCandidate } from './vec-search.js';

// Strategy
export { classifyQueryStrategy, getStrategyWeights } from './strategy.js';
export type { QueryStrategy, ScoringWeights } from './strategy.js';

// Entity extraction
export { extractEntities, canonicalizeEntityName } from './entity-extraction.js';
export type { EntityType, ExtractedEntity } from './entity-extraction.js';

// Budget allocation
export { applyBudgetAllocation } from './budget-allocation.js';
export type { BudgetConfig } from './budget-allocation.js';

// Embedding
export type { EmbeddingClient } from './embedding-client.js';
export { createOpenAIEmbeddingClient, createDisabledEmbeddingClient } from './embedding-client.js';

// Extension loader
export { loadSqliteVec } from './extension-loader.js';

// Types
export type { MemoryType, MemoryRecord, MemorySearchResult, MemorySearchResponse, StoreMemoryResult } from './types.js';
