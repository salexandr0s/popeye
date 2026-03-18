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
export { searchFactsFts5, searchSynthesesFts5 } from './fts5-search.js';
export { searchLikeFallback, splitQueryTokens, buildLikeQuery } from './like-fallback.js';
export { searchVec, insertVecEmbedding, deleteVecEmbedding } from './vec-search.js';
export type { VecCandidate } from './vec-search.js';

// Summary DAG
export {
  estimateTokens,
  insertSummary,
  linkSummarySource,
  getSummaryChildren,
  getSummaryAncestors,
  getSummaryTree,
  getLeafSummaries,
  getSummariesByDepth,
  getLatestSummary,
  deleteSummaryChain,
} from './summary-dag.js';

// Integrity
export { runIntegrityChecks, isVecTableAvailable } from './integrity-checker.js';

// Expansion policy
export { classifyExpansionPolicy } from './expansion-policy.js';
export type { TokenRiskLevel, ExpansionRoute, ExpansionPolicyResult } from './expansion-policy.js';

// Strategy
export { classifyQueryStrategy, getStrategyWeights } from './strategy.js';
export type { QueryStrategy, ScoringWeights } from './strategy.js';

// Structured memory foundation
export { ensureMemoryNamespace, replaceOwnerTags } from './namespace.js';
export type { EnsureNamespaceInput } from './namespace.js';
export { captureArtifact } from './artifact-store.js';
export type { CaptureArtifactInput } from './artifact-store.js';
export { extractFacts } from './fact-extractor.js';
export type { ExtractFactsInput, ExtractedFact } from './fact-extractor.js';
export { upsertFacts, getEvidenceLinks } from './fact-store.js';
export type { UpsertFactsInput, UpsertFactsResult } from './fact-store.js';
export { createSynthesis } from './synthesis.js';
export type { CreateSynthesisInput } from './synthesis.js';
export { recordRevision } from './revision.js';
export { parseTemporalConstraint, chooseTemporalReference, computeTemporalFit } from './temporal.js';
export { buildRecallPlan } from './recall-planner.js';
export type { BuildRecallPlanInput } from './recall-planner.js';
export { buildRecallExplanation } from './recall-explainer.js';
export type { BuildRecallExplanationInput } from './recall-explainer.js';

// Entity extraction
export { extractEntities, canonicalizeEntityName } from './entity-extraction.js';
export type { EntityType, ExtractedEntity } from './entity-extraction.js';

// Budget allocation
export { applyBudgetAllocation } from './budget-allocation.js';
export type { BudgetConfig } from './budget-allocation.js';

// Embedding
export type { EmbeddingClient } from './embedding-client.js';
export { createOpenAIEmbeddingClient, createDisabledEmbeddingClient } from './embedding-client.js';

// Summarization
export type { SummarizationClient } from './summarization-client.js';
export { createOpenAISummarizationClient, createDisabledSummarizationClient } from './summarization-client.js';

// Compaction engine
export { CompactionEngine, splitIntoChunks, deterministicTruncation, DEFAULT_COMPACTION_CONFIG } from './compaction-engine.js';
export type { CompactionConfig, CompactionResult, PromptBuilder } from './compaction-engine.js';

// Extension loader
export { loadSqliteVec } from './extension-loader.js';

// Location helpers
export {
  buildLocationCondition,
  canonicalizeMemoryLocation,
  computeLocationScopeMatchScore,
  formatMemoryScope,
  hasExplicitMemoryLocation,
  matchesMemoryLocation,
  normalizeMemoryLocation,
  resolveMemoryLocationFilter,
} from './location.js';
export type { CanonicalMemoryLocation, MemoryLocation, MemoryLocationFilter } from './location.js';

// Types
export type {
  MemoryType,
  MemoryLayer,
  MemoryFactKind,
  MemorySynthesisKind,
  MemoryNamespaceRecord,
  MemoryArtifactRecord,
  MemoryFactRecord,
  MemorySynthesisRecord,
  MemoryRevisionRecord,
  RecallPlan,
  RecallExplanation,
  TemporalConstraint,
  RevisionStatus,
  MemoryRecord,
  MemorySearchResult,
  MemorySearchResponse,
  StoreMemoryResult,
} from './types.js';
