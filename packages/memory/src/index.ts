// Pure functions (no circular deps — everything comes from pure-functions.ts)
export {
  decideEmbeddingEligibility,
  computeConfidenceDecay,
  shouldPersistClassification,
  classifyMemoryType,
  computeDedupKey,
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
export type { MemorySearchLogger } from './search-service.js';
export { rerankAndMerge } from './scoring.js';
export type { ScoredCandidate, RerankParams, FactMetadata } from './scoring.js';
export type { FtsCandidate } from './fts5-search.js';
export { searchFactsFts5, searchSynthesesFts5, searchChunksFts5 } from './fts5-search.js';

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
export { runIntegrityChecks } from './integrity-checker.js';

// Expansion policy
export { classifyExpansionPolicy } from './expansion-policy.js';
export type { TokenRiskLevel, ExpansionRoute, ExpansionPolicyResult } from './expansion-policy.js';

// Strategy
export { classifyQueryStrategy, getStrategyWeights } from './strategy.js';
export type { QueryStrategy, ScoringWeights } from './strategy.js';

// Consumer profiles
export { applyConsumerProfile, getExcludedDomains, CONSUMER_PROFILES } from './consumer-profiles.js';
export type { ConsumerProfile, ProfileResolvedFilters } from './consumer-profiles.js';

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
export { createRelation, getRelationsForSource, getRelationsForTarget, countRelationsForSource } from './relations.js';
export { computeClaimKey, resolveFact } from './fact-resolver.js';
export type { FactResolution } from './fact-resolver.js';
export { buildProfileStatic, buildProfileDynamic, shouldRefreshProfile } from './profile-builder.js';
export type { BuildProfileInput } from './profile-builder.js';
export {
  runTtlExpiry,
  runStalenessMarking,
  runSourceDeletionCascade,
  pinFact,
  protectFact,
  forgetFact,
  unpinFact,
  pinSynthesis,
} from './memory-governance.js';
export type { CascadeResult } from './memory-governance.js';
export { recallContext } from './context-assembler.js';
export type { RecallContextInput } from './context-assembler.js';
export { getProfileContext } from './profile-context.js';
export type { GetProfileContextInput } from './profile-context.js';
export { parseTemporalConstraint, chooseTemporalReference, computeTemporalFit } from './temporal.js';
export { buildRecallPlan } from './recall-planner.js';
export type { BuildRecallPlanInput } from './recall-planner.js';
export { buildRecallExplanation } from './recall-explainer.js';
export type { BuildRecallExplanationInput } from './recall-explainer.js';

// Retrieval logging
export {
  logRetrievalTrace,
  queryRetrievalLogs,
  pruneRetrievalLogs,
  buildRetrievalTrace,
  hashQueryText,
} from './retrieval-logging.js';
export type { RetrievalTrace, RetrievalLogQuery, RetrievalLogRecord } from './retrieval-logging.js';

// Source streams
export {
  resolveOrCreateSourceStream,
  hasContentChanged,
  updateSourceStreamStatus,
  markSourceStreamDeleted,
  buildStableKey,
} from './source-streams.js';
export type { ResolveSourceStreamInput, SourceStreamRecord } from './source-streams.js';

// Chunk store
export { insertChunks, getChunksByArtifact, invalidateChunksByArtifact } from './chunk-store.js';
export type { InsertChunksInput, ChunkRow } from './chunk-store.js';

// Chunkers
export { selectChunker, markdownChunker, plaintextChunker, DEFAULT_CHUNK_OPTIONS } from './chunkers/index.js';
export type { Chunker, ChunkResult, ChunkOptions } from './chunkers/index.js';

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
export type { ExtensionLoaderLogger } from './extension-loader.js';

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
