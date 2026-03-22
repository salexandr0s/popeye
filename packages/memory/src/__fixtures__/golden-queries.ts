/**
 * Golden query fixtures for retrieval regression testing.
 *
 * Each fixture describes a query, the expected strategy classification,
 * and the expected layer distribution of results. These act as regression
 * guards — if a retrieval change causes a fixture to fail, it surfaces
 * the change for review.
 *
 * Note: these fixtures assert structural properties (strategy, layer
 * presence, result count ranges), not exact result content. Exact content
 * depends on the test DB population and may shift as extraction improves.
 */

export interface GoldenQueryFixture {
  /** Human label for the test case. */
  name: string;
  /** Raw query text. */
  query: string;
  /** Expected strategy classification. */
  expectedStrategy: 'factual' | 'temporal' | 'procedural' | 'exploratory';
  /** Layers that MUST appear in results (at least one result with this layer). 'legacy' = no layer set. */
  expectedLayers: Array<'fact' | 'synthesis' | 'artifact' | 'curated' | 'legacy'>;
  /** Minimum number of results expected. */
  minResults: number;
  /** Maximum number of results expected (upper bound sanity check). */
  maxResults: number;
}

/**
 * Seed data for a minimal golden test database.
 * Each entry has the fields needed to insert into both legacy `memories`
 * and structured tables (facts/syntheses) for coverage.
 */
export interface GoldenSeedMemory {
  id: string;
  description: string;
  content: string;
  sourceType: string;
  memoryType: string;
  scope: string;
  confidence: number;
  layer?: 'fact' | 'synthesis' | undefined;
  factKind?: string | undefined;
  synthesisKind?: string | undefined;
  domain?: string;
}

export const GOLDEN_SEED_MEMORIES: GoldenSeedMemory[] = [
  {
    id: 'golden-fact-sqlite',
    description: 'SQLite workspace indexing decision',
    content: 'We decided to use SQLite with WAL mode and FTS5 for memory indexing. Foreign keys are enabled.',
    sourceType: 'workspace_doc',
    memoryType: 'semantic',
    scope: 'workspace/test-ws',
    confidence: 0.9,
    layer: 'fact',
    factKind: 'preference',
    domain: 'general',
  },
  {
    id: 'golden-fact-preference',
    description: 'Dark mode preference',
    content: 'User prefers dark mode in all editors and terminal applications.',
    sourceType: 'curated_memory',
    memoryType: 'semantic',
    scope: 'global',
    confidence: 0.95,
    layer: 'fact',
    factKind: 'preference',
    domain: 'general',
  },
  {
    id: 'golden-fact-event',
    description: 'Auth middleware rewrite started',
    content: 'Started rewriting the auth middleware yesterday due to compliance requirements.',
    sourceType: 'coding_session',
    memoryType: 'episodic',
    scope: 'workspace/test-ws',
    confidence: 0.8,
    layer: 'fact',
    factKind: 'event',
    domain: 'coding',
  },
  {
    id: 'golden-synthesis-daily',
    description: 'Daily summary 2026-03-21',
    content: 'Completed 3 runs. Focused on memory system upgrade planning. No critical errors.',
    sourceType: 'daily_summary',
    memoryType: 'episodic',
    scope: 'workspace/test-ws',
    confidence: 0.7,
    layer: 'synthesis',
    synthesisKind: 'daily',
    domain: 'general',
  },
  {
    id: 'golden-fact-procedure',
    description: 'How to run memory tests',
    content: 'To run memory tests: cd packages/memory && pnpm vitest run. Use --reporter=verbose for detailed output.',
    sourceType: 'workspace_doc',
    memoryType: 'procedural',
    scope: 'workspace/test-ws',
    confidence: 0.85,
    layer: 'fact',
    factKind: 'procedure',
    domain: 'coding',
  },
];

export const GOLDEN_QUERY_FIXTURES: GoldenQueryFixture[] = [
  {
    name: 'factual query — SQLite decision',
    query: 'What is our SQLite indexing decision?',
    expectedStrategy: 'factual',
    expectedLayers: ['fact'],
    minResults: 1,
    maxResults: 20,
  },
  {
    name: 'temporal query — recent auth work',
    query: 'What happened yesterday with auth?',
    expectedStrategy: 'temporal',
    expectedLayers: ['fact'],
    minResults: 1,
    maxResults: 20,
  },
  {
    name: 'procedural query — how to run tests',
    query: 'How to run memory tests?',
    expectedStrategy: 'procedural',
    expectedLayers: ['fact'],
    minResults: 1,
    maxResults: 20,
  },
  {
    name: 'exploratory query — dark mode',
    query: 'dark mode',
    expectedStrategy: 'exploratory',
    expectedLayers: ['fact'],
    minResults: 1,
    maxResults: 20,
  },
  {
    name: 'temporal query — daily summary',
    query: 'What did I do today?',
    expectedStrategy: 'temporal',
    expectedLayers: ['legacy', 'synthesis'],
    minResults: 1,
    maxResults: 20,
  },
];
