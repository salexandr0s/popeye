import { DEFAULT_CHUNK_OPTIONS, type ChunkOptions, type ChunkResult, type Chunker } from './chunker-types.js';

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

interface Section {
  headingPath: string | null;
  kind: string;
  text: string;
  language: string | null;
}

/**
 * Parse markdown into sections based on heading hierarchy and code fences.
 */
function parseMarkdownSections(content: string): Section[] {
  const lines = content.split('\n');
  const sections: Section[] = [];
  const headingStack: string[] = [];
  let currentText = '';
  let currentKind = 'paragraph';
  let inCodeFence = false;
  let codeFenceLang: string | null = null;
  let codeContent = '';

  function flushText(): void {
    const trimmed = currentText.trim();
    if (trimmed.length > 0) {
      sections.push({
        headingPath: headingStack.length > 0 ? headingStack.join(' > ') : null,
        kind: currentKind,
        text: trimmed,
        language: null,
      });
    }
    currentText = '';
    currentKind = 'paragraph';
  }

  for (const line of lines) {
    // Code fence start/end
    const fenceMatch = /^(`{3,}|~{3,})(\w*)/.exec(line);
    if (fenceMatch) {
      if (!inCodeFence) {
        flushText();
        inCodeFence = true;
        codeFenceLang = fenceMatch[2] || null;
        codeContent = '';
        continue;
      } else {
        // End of code fence
        inCodeFence = false;
        const trimmedCode = codeContent.trim();
        if (trimmedCode.length > 0) {
          sections.push({
            headingPath: headingStack.length > 0 ? headingStack.join(' > ') : null,
            kind: 'code_block',
            text: trimmedCode,
            language: codeFenceLang,
          });
        }
        codeFenceLang = null;
        codeContent = '';
        continue;
      }
    }

    if (inCodeFence) {
      codeContent += line + '\n';
      continue;
    }

    // Heading
    const headingMatch = /^(#{1,6})\s+(.+)$/.exec(line);
    if (headingMatch) {
      flushText();
      const level = headingMatch[1]!.length;
      const title = headingMatch[2]!.trim();

      // Pop headings at or below this level
      while (headingStack.length >= level) {
        headingStack.pop();
      }
      headingStack.push(`${'#'.repeat(level)} ${title}`);

      // The heading itself is part of the next section's context, not a separate chunk
      continue;
    }

    // Regular content line
    currentText += line + '\n';
  }

  // Flush any remaining text
  if (inCodeFence && codeContent.trim().length > 0) {
    // Unclosed code fence — treat as code block anyway
    sections.push({
      headingPath: headingStack.length > 0 ? headingStack.join(' > ') : null,
      kind: 'code_block',
      text: codeContent.trim(),
      language: codeFenceLang,
    });
  }
  flushText();

  return sections;
}

/**
 * Split a large section into sub-chunks by paragraph boundaries.
 */
function splitByParagraphs(section: Section, maxTokens: number): Section[] {
  const paragraphs = section.text.split(/\n\n+/).filter((p) => p.trim().length > 0);
  if (paragraphs.length <= 1) return [section];

  const result: Section[] = [];
  let current = '';

  for (const para of paragraphs) {
    if (current.length > 0 && estimateTokens(current + '\n\n' + para) > maxTokens) {
      result.push({ ...section, text: current.trim() });
      current = '';
    }
    current += (current.length > 0 ? '\n\n' : '') + para;
  }
  if (current.trim().length > 0) {
    result.push({ ...section, text: current.trim() });
  }

  return result;
}

/**
 * Markdown chunker: splits by heading hierarchy and code fences.
 * Falls back to paragraph splitting for flat markdown.
 */
export const markdownChunker: Chunker = {
  chunk(content: string, opts?: ChunkOptions): ChunkResult[] {
    const options = { ...DEFAULT_CHUNK_OPTIONS, ...opts };
    const sections = parseMarkdownSections(content);

    if (sections.length === 0) return [];

    // Split large sections by paragraphs
    const expanded: Section[] = [];
    for (const section of sections) {
      if (estimateTokens(section.text) > options.maxTokensPerChunk && section.kind !== 'code_block') {
        expanded.push(...splitByParagraphs(section, options.maxTokensPerChunk));
      } else {
        expanded.push(section);
      }
    }

    // Merge small chunks with neighbors
    const merged: Section[] = [];
    for (const section of expanded) {
      const last = merged[merged.length - 1];
      if (
        last &&
        estimateTokens(section.text) < options.minTokensPerChunk &&
        section.kind !== 'code_block' &&
        last.kind !== 'code_block' &&
        last.headingPath === section.headingPath &&
        estimateTokens(last.text + '\n\n' + section.text) <= options.maxTokensPerChunk
      ) {
        last.text = last.text + '\n\n' + section.text;
      } else {
        merged.push({ ...section });
      }
    }

    // Convert to ChunkResult, enforce maxChunks
    const capped = merged.slice(0, options.maxChunks);
    return capped.map((section, i) => ({
      index: i,
      sectionPath: section.headingPath,
      chunkKind: section.kind,
      text: section.text,
      tokenCount: estimateTokens(section.text),
      language: section.language,
    }));
  },
};
