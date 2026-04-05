import type { KnowledgeSourceRecord } from '@popeye/contracts';

export interface WikiCompilePromptResult {
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
}

const WIKI_SYSTEM_PROMPT = `You are a precise wiki compiler for a personal knowledge base. Your job is to transform source material into well-structured wiki articles.

Rules:
- Write in clear, factual prose. No marketing language or fluff.
- Use [[wikilink]] syntax to cross-reference entities, concepts, and related topics.
- Extract key entities (people, organizations, technologies, concepts) and suggest them for dedicated pages.
- Suggest cross-links to related topics that may already exist in the wiki.
- Preserve all factual claims, dates, numbers, and specifics from the source.
- Structure with clear headings (## level) and short paragraphs.
- Include a one-paragraph summary at the top of the article.

Output format: JSON object with these fields:
- "markdown": The full wiki article in markdown (with [[wikilinks]])
- "suggestedEntities": Array of entity names that deserve their own wiki pages
- "suggestedCrossLinks": Array of topic slugs that this article should link to
- "summary": A one-sentence summary of the article`;

const WIKI_UPDATE_SYSTEM_PROMPT = `You are a precise wiki compiler for a personal knowledge base. You are updating an existing wiki article with new source material.

Rules:
- Merge new information into the existing article without losing prior content.
- Resolve contradictions by noting both claims with dates if possible.
- Add new [[wikilinks]] for newly mentioned entities and concepts.
- Update the summary paragraph to reflect the combined content.
- If sections overlap, consolidate rather than duplicate.
- Preserve the existing article structure where possible; extend it for new topics.

Output format: JSON object with these fields:
- "markdown": The updated wiki article in markdown (with [[wikilinks]])
- "suggestedEntities": Array of NEW entity names from this update that deserve their own pages
- "suggestedCrossLinks": Array of NEW topic slugs that this article should link to
- "summary": An updated one-sentence summary of the article`;

const ENTITY_SYSTEM_PROMPT = `You are a precise wiki compiler for a personal knowledge base. Your job is to create a focused wiki page about a specific entity (person, organization, technology, or concept).

Rules:
- Write a concise overview based on the context provided.
- Use [[wikilinks]] to cross-reference related entities and concepts.
- Include key facts: what it is, why it matters, how it relates to the source material.
- Structure with clear headings. Keep it factual and brief.
- Mark areas where information is incomplete with "<!-- needs expansion -->".

Output format: JSON object with these fields:
- "markdown": The entity wiki page in markdown (with [[wikilinks]])
- "suggestedEntities": Array of related entity names mentioned that may need pages
- "suggestedCrossLinks": Array of topic slugs this page should link to
- "summary": A one-sentence description of this entity`;

const INDEX_SYSTEM_PROMPT = `You are a wiki index compiler. Given a list of wiki pages with their summaries, create a well-organized index document.

Rules:
- Group pages into logical categories (e.g., People, Technologies, Concepts, Events).
- Each entry: "- [[slug]] — one-line summary"
- Sort categories alphabetically, entries alphabetically within categories.
- Add a brief introductory paragraph with total page count and category overview.

Output format: JSON object with these fields:
- "markdown": The index document in markdown
- "suggestedEntities": [] (always empty for index)
- "suggestedCrossLinks": [] (always empty for index)
- "summary": "Wiki index with N pages across M categories"`;

export function buildSourceCompilePrompt(
  source: KnowledgeSourceRecord,
  normalizedMarkdown: string,
  _currentWikiMarkdown: string,
): WikiCompilePromptResult {
  const sourceContext = [
    `Title: ${source.title}`,
    `Source type: ${source.sourceType}`,
    source.originalUri ? `Original URL: ${source.originalUri}` : null,
    source.originalPath ? `Original path: ${source.originalPath}` : null,
    `Imported: ${source.createdAt}`,
  ].filter(Boolean).join('\n');

  const userPrompt = [
    '## Source metadata',
    sourceContext,
    '',
    '## Source content',
    normalizedMarkdown,
  ].join('\n');

  return {
    systemPrompt: WIKI_SYSTEM_PROMPT,
    userPrompt,
    maxTokens: 4000,
  };
}

export function buildSourceUpdatePrompt(
  source: KnowledgeSourceRecord,
  normalizedMarkdown: string,
  currentWikiMarkdown: string,
): WikiCompilePromptResult {
  const sourceContext = [
    `Title: ${source.title}`,
    `Source type: ${source.sourceType}`,
    source.originalUri ? `Original URL: ${source.originalUri}` : null,
    `Updated: ${source.updatedAt}`,
  ].filter(Boolean).join('\n');

  const userPrompt = [
    '## Existing wiki article',
    currentWikiMarkdown,
    '',
    '## New source metadata',
    sourceContext,
    '',
    '## New source content',
    normalizedMarkdown,
  ].join('\n');

  return {
    systemPrompt: WIKI_UPDATE_SYSTEM_PROMPT,
    userPrompt,
    maxTokens: 4000,
  };
}

export function buildEntityPagePrompt(
  entityName: string,
  mentionContexts: string[],
  existingPage: string | null,
): WikiCompilePromptResult {
  const contextBlock = mentionContexts
    .map((ctx, i) => `### Context ${i + 1}\n${ctx}`)
    .join('\n\n');

  const userPrompt = existingPage
    ? [
        `## Entity: ${entityName}`,
        '',
        '## Existing page',
        existingPage,
        '',
        '## New mention contexts',
        contextBlock,
      ].join('\n')
    : [
        `## Entity: ${entityName}`,
        '',
        '## Mention contexts',
        contextBlock,
      ].join('\n');

  return {
    systemPrompt: existingPage ? WIKI_UPDATE_SYSTEM_PROMPT : ENTITY_SYSTEM_PROMPT,
    userPrompt,
    maxTokens: 2000,
  };
}

export function buildIndexPrompt(
  documents: Array<{ slug: string; title: string; summary: string }>,
): WikiCompilePromptResult {
  const listing = documents
    .map((d) => `- [[${d.slug}]] "${d.title}" — ${d.summary || 'No summary'}`)
    .join('\n');

  const userPrompt = [
    `## Wiki pages (${documents.length} total)`,
    '',
    listing,
  ].join('\n');

  return {
    systemPrompt: INDEX_SYSTEM_PROMPT,
    userPrompt,
    maxTokens: 3000,
  };
}
