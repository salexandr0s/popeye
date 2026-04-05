import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { AppConfig } from '@popeye/contracts';

import { initAuthStore } from './auth.ts';
import { createRuntimeService } from './runtime-service.ts';
import type { WikiCompilationClient } from './wiki-compilation-client.ts';

function makeConfig(dir: string, workspaceRoot: string): AppConfig {
  const authFile = join(dir, 'config', 'auth.json');
  initAuthStore(authFile);
  return {
    runtimeDataDir: dir,
    authFile,
    security: { bindHost: '127.0.0.1', bindPort: 3210, redactionPatterns: [], promptScanQuarantinePatterns: [], promptScanSanitizePatterns: [] },
    telegram: { enabled: false, allowedUserId: '42', maxMessagesPerMinute: 10, globalMaxMessagesPerMinute: 30, rateLimitWindowSeconds: 60 },
    embeddings: { provider: 'disabled', allowedClassifications: ['embeddable'], model: 'text-embedding-3-small', dimensions: 1536 },
    memory: { confidenceHalfLifeDays: 30, archiveThreshold: 0.1, dailySummaryHour: 23, consolidationEnabled: true, compactionFlushConfidence: 0.7 },
    engine: { kind: 'fake', command: 'node', args: [] },
    workspaces: [{ id: 'default', name: 'Default workspace', rootPath: workspaceRoot, heartbeatEnabled: true, heartbeatIntervalSeconds: 3600 }],
  };
}

type FixtureRuntime = ReturnType<typeof createRuntimeService>;
type InternalKnowledgeService = {
  appendToLog: (workspaceId: string, operation: 'import' | 'compile' | 'query_filed' | 'lint' | 'sync', summary: string, relatedDocumentIds?: string[]) => void;
  wikiCompilationClient: WikiCompilationClient | null;
};

function createKnowledgeRuntime(): { runtime: FixtureRuntime; workspaceRoot: string } {
  const dir = mkdtempSync(join(tmpdir(), 'popeye-knowledge-service-'));
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'popeye-knowledge-service-workspace-'));
  chmodSync(dir, 0o700);
  chmodSync(workspaceRoot, 0o700);
  return {
    runtime: createRuntimeService(makeConfig(dir, workspaceRoot)),
    workspaceRoot,
  };
}

function getKnowledgeService(runtime: FixtureRuntime): InternalKnowledgeService {
  return (runtime as unknown as { knowledgeService: InternalKnowledgeService }).knowledgeService;
}

describe('KnowledgeService integration', () => {
  it('uses knowledge root kind instead of path substrings and receipts all mutations', async () => {
    const { runtime, workspaceRoot } = createKnowledgeRuntime();
    const customRootPath = join(workspaceRoot, 'kb-root');
    mkdirSync(customRootPath, { recursive: true, mode: 0o700 });
    const customRoot = runtime.registerFileRoot({
      workspaceId: 'default',
      label: 'KB Root',
      rootPath: customRootPath,
      kind: 'knowledge_base',
      permission: 'index_and_derive',
      filePatterns: ['**/*.md'],
      excludePatterns: [],
      maxFileSizeBytes: 1_048_576,
    });

    const imported = await runtime.importKnowledgeSource({
      workspaceId: 'default',
      sourceType: 'manual_text',
      title: 'Compiler Notes',
      sourceText: 'Compilers balance optimization and correctness.',
    });

    const filed = runtime.fileQueryAsKnowledge(
      'default',
      'Compiler answer',
      'SSA simplifies optimization passes.',
      [imported.normalizedDocument.id],
    );
    const indexDoc = await runtime.regenerateKnowledgeIndex('default');
    const lint = await runtime.runKnowledgeLint('default');
    const synced = runtime.syncKnowledgeWikiDocuments('default');

    expect(imported.source.knowledgeRootId).toBe(customRoot.id);
    expect(filed.knowledgeRootId).toBe(customRoot.id);
    expect(indexDoc.knowledgeRootId).toBe(customRoot.id);
    expect(existsSync(join(customRootPath, filed.relativePath))).toBe(true);
    expect(existsSync(join(customRootPath, indexDoc.relativePath))).toBe(true);
    expect(readFileSync(join(customRootPath, filed.relativePath), 'utf8')).toContain('# Compiler answer');
    expect(synced).toBeGreaterThanOrEqual(2);
    expect(lint.findings).toBeDefined();
    expect(runtime.listMutationReceipts('knowledge')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'knowledge_import' }),
        expect.objectContaining({ kind: 'knowledge_query_filed' }),
        expect.objectContaining({ kind: 'knowledge_index_regenerate' }),
        expect.objectContaining({ kind: 'knowledge_lint' }),
        expect.objectContaining({ kind: 'knowledge_sync' }),
      ]),
    );

    await runtime.close();
  });

  it('falls back from stale default knowledge_root_id records to the active knowledge root', async () => {
    const { runtime, workspaceRoot } = createKnowledgeRuntime();
    const customRootPath = join(workspaceRoot, 'kb-root');
    mkdirSync(customRootPath, { recursive: true, mode: 0o700 });
    runtime.registerFileRoot({
      workspaceId: 'default',
      label: 'KB Root',
      rootPath: customRootPath,
      kind: 'knowledge_base',
      permission: 'index_and_derive',
      filePatterns: ['**/*.md'],
      excludePatterns: [],
      maxFileSizeBytes: 1_048_576,
    });

    const imported = await runtime.importKnowledgeSource({
      workspaceId: 'default',
      sourceType: 'manual_text',
      title: 'Compiler Notes',
      sourceText: 'Loop unrolling can improve hot paths.',
    });

    runtime.databases.app
      .exec('PRAGMA foreign_keys = OFF');
    runtime.databases.app
      .prepare('UPDATE knowledge_documents SET knowledge_root_id = ? WHERE id = ?')
      .run('default', imported.normalizedDocument.id);
    runtime.databases.app
      .exec('PRAGMA foreign_keys = ON');

    const document = runtime.getKnowledgeDocument(imported.normalizedDocument.id);
    expect(document?.exists).toBe(true);
    expect(document?.markdownText).toContain('Loop unrolling');

    await runtime.close();
  });

  it('does not auto-generate entity pages during import even when compile output suggests them', async () => {
    const { runtime, workspaceRoot } = createKnowledgeRuntime();
    mkdirSync(join(workspaceRoot, 'kb-root'), { recursive: true, mode: 0o700 });
    runtime.registerFileRoot({
      workspaceId: 'default',
      label: 'KB Root',
      rootPath: join(workspaceRoot, 'kb-root'),
      kind: 'knowledge_base',
      permission: 'index_and_derive',
      filePatterns: ['**/*.md'],
      excludePatterns: [],
      maxFileSizeBytes: 1_048_576,
    });

    const knowledgeService = getKnowledgeService(runtime);
    const compile = vi.fn(async () => ({
      markdown: '# Compiler Notes\n\nCompilers balance optimization and correctness.\n',
      suggestedEntities: ['SSA', 'Register allocation', 'Loop unrolling'],
      suggestedCrossLinks: ['optimizer-notes'],
      summary: 'Compiler notes.',
    }));
    knowledgeService.wikiCompilationClient = {
      enabled: true,
      compile,
    };

    const imported = await runtime.importKnowledgeSource({
      workspaceId: 'default',
      sourceType: 'manual_text',
      title: 'Compiler Notes',
      sourceText: 'Compilers balance optimization and correctness.',
    });

    const wikiDocs = runtime.listKnowledgeDocuments({
      workspaceId: 'default',
      kind: 'wiki_article',
    });

    expect(imported.draftRevision?.status).toBe('draft');
    expect(compile).toHaveBeenCalledTimes(2);
    expect(wikiDocs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: 'Wiki Index',
          slug: '_index',
        }),
        expect.objectContaining({
          title: 'Wiki Log',
          slug: '_log',
        }),
        expect.objectContaining({
          title: 'Compiler Notes',
          slug: 'compiler-notes',
        }),
      ]),
    );
    expect(wikiDocs.map((doc) => doc.slug)).not.toEqual(
      expect.arrayContaining(['ssa', 'register-allocation', 'loop-unrolling']),
    );

    await runtime.close();
  });

  it('appends repeated log entries without clobbering earlier content', async () => {
    const { runtime, workspaceRoot } = createKnowledgeRuntime();
    const customRootPath = join(workspaceRoot, 'kb-root');
    mkdirSync(customRootPath, { recursive: true, mode: 0o700 });
    runtime.registerFileRoot({
      workspaceId: 'default',
      label: 'KB Root',
      rootPath: customRootPath,
      kind: 'knowledge_base',
      permission: 'index_and_derive',
      filePatterns: ['**/*.md'],
      excludePatterns: [],
      maxFileSizeBytes: 1_048_576,
    });

    const knowledgeService = getKnowledgeService(runtime);
    knowledgeService.appendToLog('default', 'lint', 'First lint pass');
    knowledgeService.appendToLog('default', 'lint', 'Second lint pass');

    const logPath = join(customRootPath, 'wiki', '_log.md');
    const logMarkdown = readFileSync(logPath, 'utf8');
    expect(logMarkdown).toContain('First lint pass');
    expect(logMarkdown).toContain('Second lint pass');

    await runtime.close();
  });
});
