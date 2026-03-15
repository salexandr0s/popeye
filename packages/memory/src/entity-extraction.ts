export type EntityType = 'person' | 'project' | 'org' | 'tool';

export interface ExtractedEntity {
  name: string;
  type: EntityType;
  canonicalName: string;
}

/**
 * Lowercase, trim, and collapse whitespace for dedup matching.
 */
export function canonicalizeEntityName(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, ' ');
}

// --- Extraction patterns ---

const PERSON_EXPLICIT =
  /(?:name is|called)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/g;

const PERSON_PROPER_NAME =
  /(?<=[.!?]\s+|\n)(?!(?:The|This|That|It|We|They|He|She|I)\b)([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})/g;

const PROJECT_SCOPED = /@[\w-]+\/[\w-]+/g;

const PROJECT_KEYWORD =
  /(?:project\s+)["']?(\w[\w -]{1,30})["']?/gi;

const ORG_KEYWORD =
  /(?:company|organization|org|team)\s+(?:is\s+|called\s+|named\s+)?["']?([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})["']?/gi;

const TOOL_NAMES = [
  'TypeScript', 'JavaScript', 'Python', 'Rust', 'Go',
  'Vitest', 'Playwright', 'Fastify', 'Express', 'React',
  'Next\\.js', 'Prisma', 'Drizzle', 'SQLite', 'PostgreSQL',
  'Redis', 'Docker', 'Kubernetes', 'Node\\.js', 'Zod', 'Tailwind',
];
const TOOL_PATTERN = new RegExp(`\\b(${TOOL_NAMES.join('|')})\\b`, 'gi');

/**
 * Common words that should NOT be extracted as person names even when
 * capitalized. Keeps false-positive rate low.
 */
const COMMON_WORDS = new Set([
  'the', 'this', 'that', 'it', 'we', 'they', 'he', 'she', 'i',
  'my', 'your', 'our', 'their', 'its', 'is', 'are', 'was', 'were',
  'has', 'have', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'can', 'may', 'might', 'must', 'shall', 'not', 'no',
  'yes', 'and', 'or', 'but', 'if', 'then', 'when', 'where', 'how',
  'what', 'who', 'which', 'all', 'each', 'every', 'some', 'any',
  'for', 'from', 'with', 'about', 'into', 'through', 'during',
  'before', 'after', 'above', 'below', 'between', 'under', 'over',
  'step', 'memory', 'data', 'error', 'test', 'note', 'summary',
]);

function isCommonWord(word: string): boolean {
  return COMMON_WORDS.has(word.toLowerCase());
}

/**
 * Extract entities from text using regex heuristics.
 *
 * Conservative by design: false positives are worse than false negatives
 * because entity boost weight is small (0.05).
 */
export function extractEntities(text: string): ExtractedEntity[] {
  const seen = new Map<string, ExtractedEntity>();

  function add(name: string, type: EntityType): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    const canonical = canonicalizeEntityName(trimmed);
    if (canonical.length < 2) return;
    const key = `${type}:${canonical}`;
    if (!seen.has(key)) {
      seen.set(key, { name: trimmed, type, canonicalName: canonical });
    }
  }

  // --- Tools (run first so tool names aren't mistaken for person names) ---
  const toolMatches = text.matchAll(TOOL_PATTERN);
  for (const m of toolMatches) {
    add(m[1]!, 'tool');
  }

  // Build a set of canonical tool names to exclude from person extraction
  const toolCanonicalized = new Set<string>();
  for (const [key] of seen) {
    if (key.startsWith('tool:')) toolCanonicalized.add(key.slice(5));
  }

  // --- Persons (explicit patterns) ---
  const personExplicit = text.matchAll(PERSON_EXPLICIT);
  for (const m of personExplicit) {
    const name = m[1]!.trim();
    if (!isCommonWord(name) && !toolCanonicalized.has(canonicalizeEntityName(name))) {
      add(name, 'person');
    }
  }

  // --- Persons (proper names not at sentence start) ---
  const personProper = text.matchAll(PERSON_PROPER_NAME);
  for (const m of personProper) {
    const name = m[1]!.trim();
    const words = name.split(/\s+/);
    if (words.every((w) => !isCommonWord(w)) && !toolCanonicalized.has(canonicalizeEntityName(name))) {
      add(name, 'person');
    }
  }

  // --- Projects (scoped packages) ---
  const scopedMatches = text.matchAll(PROJECT_SCOPED);
  for (const m of scopedMatches) {
    add(m[0]!, 'project');
  }

  // --- Projects (keyword) ---
  const projectKeyword = text.matchAll(PROJECT_KEYWORD);
  for (const m of projectKeyword) {
    add(m[1]!, 'project');
  }

  // --- Orgs ---
  const orgMatches = text.matchAll(ORG_KEYWORD);
  for (const m of orgMatches) {
    add(m[1]!, 'org');
  }

  return [...seen.values()];
}
