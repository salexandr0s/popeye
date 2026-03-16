import type Database from 'better-sqlite3';
import { estimateTokens, insertSummary } from './summary-dag.js';

export interface CompactionConfig {
  fanout: number;
  freshTailCount: number;
  maxLeafTokens: number;
  maxCondensedTokens: number;
  maxRetries: number;
}

export const DEFAULT_COMPACTION_CONFIG: CompactionConfig = {
  fanout: 8,
  freshTailCount: 4,
  maxLeafTokens: 2000,
  maxCondensedTokens: 4000,
  maxRetries: 1,
};

export interface CompactionResult {
  summaryIds: string[];
  rootSummaryId: string | null;
  leafCount: number;
  condensedLevels: number;
  totalTokensSummarized: number;
}

interface SummarizeInput {
  content: string;
  depth: number;
  startTime: string;
  endTime: string;
}

type SummarizeFn = (input: {
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
}) => Promise<string>;

/**
 * Build a depth-aware prompt. Imported dynamically to avoid cross-package import.
 * The caller provides the prompt builder from runtime-core.
 */
export interface PromptBuilder {
  buildSummarizePrompt(input: { content: string; depth: number; startTime?: string; endTime?: string }): {
    systemPrompt: string;
    userPrompt: string;
    maxTokens: number;
  };
  buildRetryPrompt(input: { content: string; depth: number; startTime?: string; endTime?: string }): {
    systemPrompt: string;
    userPrompt: string;
    maxTokens: number;
  };
}

/**
 * Split content into chunks of approximately maxTokens each.
 */
export function splitIntoChunks(content: string, maxTokens: number): string[] {
  const maxChars = maxTokens * 4;
  const paragraphs = content.split(/\n\n+/).filter((p) => p.trim().length > 0);
  if (paragraphs.length === 0) return [content];

  const chunks: string[] = [];
  let current = '';

  for (const para of paragraphs) {
    if (current.length + para.length > maxChars && current.length > 0) {
      chunks.push(current.trim());
      current = '';
    }
    current += `${para}\n\n`;
  }
  if (current.trim().length > 0) chunks.push(current.trim());

  return chunks;
}

/**
 * Group items into fanout-sized batches.
 */
function groupByFanout<T>(items: T[], fanout: number): T[][] {
  const groups: T[][] = [];
  for (let i = 0; i < items.length; i += fanout) {
    groups.push(items.slice(i, i + fanout));
  }
  return groups;
}

/**
 * Deterministic truncation fallback when LLM fails.
 */
export function deterministicTruncation(content: string, maxTokens: number): string {
  const maxChars = maxTokens * 4;
  if (content.length <= maxChars) return content;
  return content.slice(0, maxChars) + '\n\n[... truncated]';
}

export class CompactionEngine {
  private readonly db: Database.Database;
  private readonly summarizeFn: SummarizeFn;
  private readonly prompts: PromptBuilder;
  private readonly config: CompactionConfig;

  constructor(
    db: Database.Database,
    summarizeFn: SummarizeFn,
    prompts: PromptBuilder,
    config?: Partial<CompactionConfig>,
  ) {
    this.db = db;
    this.summarizeFn = summarizeFn;
    this.prompts = prompts;
    this.config = { ...DEFAULT_COMPACTION_CONFIG, ...config };
  }

  /**
   * Multi-pass compaction with DAG storage.
   */
  async compactRun(
    runId: string,
    content: string,
    workspaceId: string,
    startTime: string,
    endTime: string,
  ): Promise<CompactionResult> {
    const summaryIds: string[] = [];

    // 1. Split into chunks
    const allChunks = splitIntoChunks(content, this.config.maxLeafTokens);

    // 2. Protect fresh tail
    const protectedCount = Math.min(this.config.freshTailCount, allChunks.length);
    const compactableChunks = allChunks.slice(0, allChunks.length - protectedCount);

    if (compactableChunks.length === 0) {
      return { summaryIds: [], rootSummaryId: null, leafCount: 0, condensedLevels: 0, totalTokensSummarized: 0 };
    }

    // 3. Leaf pass: summarize each chunk group
    const leafGroups = groupByFanout(compactableChunks, this.config.fanout);
    const leafSummaries: Array<{ id: string; content: string }> = [];
    let totalTokensSummarized = 0;

    for (const group of leafGroups) {
      const groupContent = group.join('\n\n---\n\n');
      totalTokensSummarized += estimateTokens(groupContent);

      const summaryText = await this.summarizeWithFallback({
        content: groupContent,
        depth: 0,
        startTime,
        endTime,
      });

      const id = insertSummary(this.db, {
        runId,
        workspaceId,
        depth: 0,
        content: summaryText,
        startTime,
        endTime,
      });
      summaryIds.push(id);
      leafSummaries.push({ id, content: summaryText });
    }

    // 4. Condensed passes: group leaf summaries and condense until single root
    let currentLevel = leafSummaries;
    let depth = 1;
    const updateParent = this.db.prepare('UPDATE memory_summaries SET parent_id = ? WHERE id = ?');

    while (currentLevel.length > 1) {
      const groups = groupByFanout(currentLevel, this.config.fanout);
      const nextLevel: Array<{ id: string; content: string }> = [];

      for (const group of groups) {
        const groupContent = group.map((s) => s.content).join('\n\n---\n\n');
        totalTokensSummarized += estimateTokens(groupContent);

        const summaryText = await this.summarizeWithFallback({
          content: groupContent,
          depth,
          startTime,
          endTime,
        });

        const id = insertSummary(this.db, {
          runId,
          workspaceId,
          depth,
          content: summaryText,
          startTime,
          endTime,
        });

        // Link children to this parent
        for (const child of group) {
          updateParent.run(id, child.id);
        }

        summaryIds.push(id);
        nextLevel.push({ id, content: summaryText });
      }

      currentLevel = nextLevel;
      depth++;
    }

    const rootSummaryId = currentLevel.length === 1 ? currentLevel[0]!.id : null;

    return {
      summaryIds,
      rootSummaryId,
      leafCount: leafSummaries.length,
      condensedLevels: depth - 1,
      totalTokensSummarized,
    };
  }

  /**
   * Three-tier summarization with fallback.
   */
  private async summarizeWithFallback(input: SummarizeInput): Promise<string> {
    // Tier 1: Normal prompt
    try {
      const prompt = this.prompts.buildSummarizePrompt(input);
      const result = await this.summarizeFn(prompt);
      if (result.trim().length > 0) return result;
    } catch {
      // Fall through to tier 2
    }

    // Tier 2: Retry with stricter prompt
    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      try {
        const prompt = this.prompts.buildRetryPrompt(input);
        const result = await this.summarizeFn(prompt);
        if (result.trim().length > 0) return result;
      } catch {
        // Fall through to tier 3
      }
    }

    // Tier 3: Deterministic truncation
    return deterministicTruncation(input.content, this.config.maxCondensedTokens);
  }
}
