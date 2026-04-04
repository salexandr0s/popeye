import { chmodSync, cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import type { AppConfig, KnowledgeDocumentQuery, KnowledgeImportInput } from '../../contracts/src/index.ts';
import { initAuthStore } from './auth.ts';
import { RuntimeValidationError, createRuntimeService } from './runtime-service.ts';

const FIXTURE_ROOT = fileURLToPath(new URL('./__fixtures__/knowledge-corpus', import.meta.url));
const CLEAN_URL = 'https://fixtures.popeye.test/clean/index.html';
const NOISY_URL = 'https://fixtures.popeye.test/noisy/index.html';
const DEGRADED_URL = 'https://fixtures.popeye.test/fallback/index.html';

type FixtureRuntime = ReturnType<typeof createRuntimeService>;

type FixtureDefinition = {
  id: string;
  title: string;
  sourceType: KnowledgeImportInput['sourceType'];
  sourcePath?: string;
  sourceUri?: string;
  sourceText?: string;
  expectedMarkdownPath: string;
  expectedAdapter: string;
  expectedFallbackUsed: boolean;
  expectedStatus: string;
  expectedAssetStatus: string;
  expectedLinkLabels?: string[];
};

function fixturePath(...segments: string[]): string {
  return join(FIXTURE_ROOT, ...segments);
}

function fixtureText(...segments: string[]): string {
  return readFileSync(fixturePath(...segments), 'utf8');
}

function fixtureBytes(...segments: string[]): Buffer {
  return readFileSync(fixturePath(...segments));
}

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

function createKnowledgeRuntime(): FixtureRuntime {
  const dir = mkdtempSync(join(tmpdir(), 'popeye-knowledge-corpus-'));
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'popeye-knowledge-corpus-workspace-'));
  chmodSync(dir, 0o700);
  chmodSync(workspaceRoot, 0o700);
  return createRuntimeService(makeConfig(dir, workspaceRoot));
}

function getKnowledgeService(runtime: FixtureRuntime): {
  fetchImpl: typeof fetch;
  runCommand: (command: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;
} {
  return (runtime as unknown as {
    knowledgeService: {
      fetchImpl: typeof fetch;
      runCommand: (command: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;
    };
  }).knowledgeService;
}

function installCorpusStubs(runtime: FixtureRuntime): void {
  const knowledgeService = getKnowledgeService(runtime);
  knowledgeService.fetchImpl = vi.fn(async (input: unknown) => {
    const target = String(input);
    switch (target) {
      case CLEAN_URL:
        return new Response(fixtureText('websites', 'clean', 'original.html'), {
          status: 200,
          headers: { 'content-type': 'text/html' },
        });
      case `https://r.jina.ai/${CLEAN_URL}`:
        return new Response(fixtureText('websites', 'clean', 'jina.md'), { status: 200 });
      case NOISY_URL:
        return new Response(fixtureText('websites', 'noisy', 'original.html'), {
          status: 200,
          headers: { 'content-type': 'text/html' },
        });
      case `https://r.jina.ai/${NOISY_URL}`:
        return new Response(fixtureText('websites', 'noisy', 'jina.md'), { status: 200 });
      case 'https://fixtures.popeye.test/noisy/images/hero.png':
        return new Response(fixtureBytes('websites', 'noisy', 'images', 'hero.png'), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        });
      case DEGRADED_URL:
        return new Response(fixtureText('websites', 'degraded', 'original.html'), {
          status: 200,
          headers: { 'content-type': 'text/html' },
        });
      case `https://r.jina.ai/${DEGRADED_URL}`:
        return new Response('reader unavailable', { status: 502 });
      default:
        return new Response('not found', { status: 404 });
    }
  }) as typeof fetch;

  knowledgeService.runCommand = vi.fn(async (command: string, args: string[]) => {
    const target = String(args.at(-1) ?? '');
    if (command === 'markitdown') {
      if (target.endsWith('simple.pdf')) {
        return { stdout: fixtureText('pdfs', 'simple.markitdown.md'), stderr: '' };
      }
      if (target.endsWith('layout-heavy.pdf') || target.endsWith('native-fallback.pdf')) {
        throw new Error('markitdown unavailable');
      }
    }

    if (command === 'python3' && args.join(' ').includes('docling')) {
      if (target.endsWith('layout-heavy.pdf')) {
        return { stdout: fixtureText('pdfs', 'layout-heavy.docling.md'), stderr: '' };
      }
      throw new Error('docling unavailable');
    }

    if (command === 'python3' && args.join(' ').includes('trafilatura')) {
      throw new Error('trafilatura unavailable');
    }

    throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
  });
}

function corpusFixtures(): FixtureDefinition[] {
  return [
    {
      id: 'website-clean',
      title: 'Clean Article',
      sourceType: 'website',
      sourceUri: CLEAN_URL,
      expectedMarkdownPath: fixturePath('websites', 'clean', 'expected-normalized.md'),
      expectedAdapter: 'jina_reader',
      expectedFallbackUsed: false,
      expectedStatus: 'compiled',
      expectedAssetStatus: 'none',
      expectedLinkLabels: ['Optimizer Notes'],
    },
    {
      id: 'website-noisy',
      title: 'Noisy Systems Article',
      sourceType: 'website',
      sourceUri: NOISY_URL,
      expectedMarkdownPath: fixturePath('websites', 'noisy', 'expected-normalized.md'),
      expectedAdapter: 'jina_reader',
      expectedFallbackUsed: false,
      expectedStatus: 'compiled',
      expectedAssetStatus: 'localized',
      expectedLinkLabels: ['Compiler Notes', 'https://example.com/reference'],
    },
    {
      id: 'pdf-simple',
      title: 'Simple PDF',
      sourceType: 'pdf',
      sourcePath: fixturePath('pdfs', 'simple.pdf'),
      expectedMarkdownPath: fixturePath('pdfs', 'simple.expected-normalized.md'),
      expectedAdapter: 'markitdown',
      expectedFallbackUsed: false,
      expectedStatus: 'compiled',
      expectedAssetStatus: 'none',
    },
    {
      id: 'pdf-layout-heavy',
      title: 'Layout Heavy PDF',
      sourceType: 'pdf',
      sourcePath: fixturePath('pdfs', 'layout-heavy.pdf'),
      expectedMarkdownPath: fixturePath('pdfs', 'layout-heavy.expected-normalized.md'),
      expectedAdapter: 'docling',
      expectedFallbackUsed: true,
      expectedStatus: 'degraded',
      expectedAssetStatus: 'none',
    },
    {
      id: 'local-notes',
      title: 'Local Notes',
      sourceType: 'local_file',
      sourcePath: fixturePath('local', 'local-notes.md'),
      expectedMarkdownPath: fixturePath('local', 'local-notes.expected-normalized.md'),
      expectedAdapter: 'native',
      expectedFallbackUsed: false,
      expectedStatus: 'compiled',
      expectedAssetStatus: 'localized',
      expectedLinkLabels: ['Compiler Passes', 'https://example.com/reference'],
    },
    {
      id: 'image-source',
      title: 'Compiler Diagram',
      sourceType: 'image',
      sourcePath: fixturePath('image', 'compiler-diagram.png'),
      expectedMarkdownPath: fixturePath('image', 'compiler-diagram.expected-normalized.md'),
      expectedAdapter: 'native',
      expectedFallbackUsed: false,
      expectedStatus: 'compiled',
      expectedAssetStatus: 'localized',
    },
    {
      id: 'repo-manifest',
      title: 'repo-fixture',
      sourceType: 'repo',
      sourcePath: fixturePath('repo-fixture'),
      expectedMarkdownPath: fixturePath('repo-fixture.expected-normalized.md'),
      expectedAdapter: 'native',
      expectedFallbackUsed: false,
      expectedStatus: 'compiled_with_warnings',
      expectedAssetStatus: 'localized',
    },
    {
      id: 'dataset-profile',
      title: 'metrics.csv',
      sourceType: 'dataset',
      sourcePath: fixturePath('dataset', 'metrics.csv'),
      expectedMarkdownPath: fixturePath('dataset', 'metrics.expected-normalized.md'),
      expectedAdapter: 'native',
      expectedFallbackUsed: false,
      expectedStatus: 'compiled_with_warnings',
      expectedAssetStatus: 'none',
    },
    {
      id: 'manual-notes',
      title: 'Manual Notes',
      sourceType: 'manual_text',
      sourceText: fixtureText('manual', 'source.txt'),
      expectedMarkdownPath: fixturePath('manual', 'expected-normalized.md'),
      expectedAdapter: 'native',
      expectedFallbackUsed: false,
      expectedStatus: 'compiled',
      expectedAssetStatus: 'none',
    },
  ];
}

function copyFixtureToWorkspace(runtime: FixtureRuntime, sourcePath: string): string {
  const workspaceRoot = runtime.getWorkspace('default')!.rootPath!;
  const targetPath = join(workspaceRoot, basename(sourcePath));
  cpSync(sourcePath, targetPath, { recursive: true });
  const siblingDiagram = join(dirname(sourcePath), 'diagram.png');
  if (existsSync(siblingDiagram)) {
    cpSync(siblingDiagram, join(workspaceRoot, 'diagram.png'));
  }
  return targetPath;
}

describe('Knowledge corpus fixtures', () => {
  it.each(corpusFixtures())('imports $id and matches the committed normalized markdown golden', async (fixture) => {
    const runtime = createKnowledgeRuntime();
    installCorpusStubs(runtime);

    try {
      const input: KnowledgeImportInput = {
        workspaceId: 'default',
        sourceType: fixture.sourceType,
        title: fixture.title,
        ...(fixture.sourcePath ? { sourcePath: fixture.sourcePath } : {}),
        ...(fixture.sourceUri ? { sourceUri: fixture.sourceUri } : {}),
        ...(fixture.sourceText ? { sourceText: fixture.sourceText } : {}),
      };

      const imported = await runtime.importKnowledgeSource(input);
      const detail = runtime.getKnowledgeDocument(imported.normalizedDocument.id)!;
      const snapshot = runtime.listKnowledgeSourceSnapshots(imported.source.id)[0]!;
      const snapshotPaths = runtime.databases.app.prepare(
        `SELECT original_dir_path, normalized_markdown_path, assets_dir_path
         FROM knowledge_source_snapshots
         WHERE source_id = ?
         ORDER BY created_at DESC
         LIMIT 1`,
      ).get(imported.source.id) as {
        original_dir_path: string;
        normalized_markdown_path: string;
        assets_dir_path: string;
      };

      expect(detail.markdownText).toBe(readFileSync(fixture.expectedMarkdownPath, 'utf8'));
      expect(imported.source).toMatchObject({
        adapter: fixture.expectedAdapter,
        fallbackUsed: fixture.expectedFallbackUsed,
        status: fixture.expectedStatus,
        assetStatus: fixture.expectedAssetStatus,
      });
      expect(snapshot).toMatchObject({
        adapter: fixture.expectedAdapter,
        status: fixture.expectedStatus,
        assetStatus: fixture.expectedAssetStatus,
        outcome: 'created',
      });
      expect(imported.compileJob).toMatchObject({ status: 'succeeded' });
      expect(imported.draftRevision?.status).toBe('draft');
      expect(readdirSync(snapshotPaths.original_dir_path).length).toBeGreaterThan(0);
      expect(existsSync(snapshotPaths.normalized_markdown_path)).toBe(true);
      if (fixture.expectedAssetStatus !== 'none') {
        expect(existsSync(snapshotPaths.assets_dir_path)).toBe(true);
        expect(readdirSync(snapshotPaths.assets_dir_path).length).toBeGreaterThan(0);
      }
      if (fixture.expectedLinkLabels?.length) {
        const neighborhood = runtime.getKnowledgeNeighborhood(imported.normalizedDocument.id)!;
        expect(neighborhood.outgoing.map((link) => link.targetLabel)).toEqual(
          expect.arrayContaining(fixture.expectedLinkLabels),
        );
      }
    } finally {
      await runtime.close();
    }
  });

  it('keeps a single logical source and no new draft when a committed local fixture is imported unchanged twice', async () => {
    const runtime = createKnowledgeRuntime();
    installCorpusStubs(runtime);

    try {
      const sourcePath = copyFixtureToWorkspace(runtime, fixturePath('local', 'local-notes.md'));
      const first = await runtime.importKnowledgeSource({
        workspaceId: 'default',
        sourceType: 'local_file',
        title: 'Local Notes',
        sourcePath,
      });
      const second = await runtime.importKnowledgeSource({
        workspaceId: 'default',
        sourceType: 'local_file',
        title: 'Local Notes',
        sourcePath,
      });

      expect(second.outcome).toBe('unchanged');
      expect(second.source.id).toBe(first.source.id);
      expect(second.draftRevision).toBeNull();
      expect(runtime.listKnowledgeSources('default')).toHaveLength(1);
      expect(runtime.listKnowledgeSourceSnapshots(first.source.id)).toHaveLength(1);
    } finally {
      await runtime.close();
    }
  });

  it('creates a new snapshot and draft revision when a committed local fixture changes before reingest', async () => {
    const runtime = createKnowledgeRuntime();
    installCorpusStubs(runtime);

    try {
      const sourcePath = copyFixtureToWorkspace(runtime, fixturePath('local', 'local-notes.md'));
      const first = await runtime.importKnowledgeSource({
        workspaceId: 'default',
        sourceType: 'local_file',
        title: 'Local Notes',
        sourcePath,
      });
      writeFileSync(
        sourcePath,
        '# Local Notes\n\n![Diagram](diagram.png)\n\nReingested notes now mention loop-invariant code motion.\n',
        { encoding: 'utf8', mode: 0o600 },
      );

      const reingested = await runtime.reingestKnowledgeSource(first.source.id);
      const detail = runtime.getKnowledgeDocument(reingested.normalizedDocument.id)!;

      expect(reingested.outcome).toBe('updated');
      expect(reingested.source.id).toBe(first.source.id);
      expect(reingested.draftRevision?.status).toBe('draft');
      expect(runtime.listKnowledgeSourceSnapshots(first.source.id)).toHaveLength(2);
      expect(detail.markdownText).toContain('loop-invariant code motion');
    } finally {
      await runtime.close();
    }
  });

  it('matches the degraded website fallback golden when structured web extraction fails', async () => {
    const runtime = createKnowledgeRuntime();
    installCorpusStubs(runtime);

    try {
      const imported = await runtime.importKnowledgeSource({
        workspaceId: 'default',
        sourceType: 'website',
        title: 'Fallback Systems Note',
        sourceUri: DEGRADED_URL,
      });
      const detail = runtime.getKnowledgeDocument(imported.normalizedDocument.id)!;

      expect(detail.markdownText).toBe(fixtureText('websites', 'degraded', 'expected-normalized.md'));
      expect(imported.source).toMatchObject({
        adapter: 'native',
        fallbackUsed: true,
        status: 'degraded',
        assetStatus: 'none',
      });
      expect(imported.draftRevision?.status).toBe('draft');
    } finally {
      await runtime.close();
    }
  });

  it('matches the degraded native document golden when document converters are unavailable', async () => {
    const runtime = createKnowledgeRuntime();
    installCorpusStubs(runtime);

    try {
      const imported = await runtime.importKnowledgeSource({
        workspaceId: 'default',
        sourceType: 'pdf',
        title: 'Native Fallback PDF',
        sourcePath: fixturePath('pdfs', 'native-fallback.pdf'),
      });
      const detail = runtime.getKnowledgeDocument(imported.normalizedDocument.id)!;

      expect(detail.markdownText).toBe(fixtureText('pdfs', 'native-fallback.expected-normalized.md'));
      expect(imported.source).toMatchObject({
        adapter: 'native',
        fallbackUsed: true,
        status: 'degraded',
        assetStatus: 'none',
      });
    } finally {
      await runtime.close();
    }
  });

  it('keeps localized assets while leaving missing refs untouched on a partial asset failure golden', async () => {
    const runtime = createKnowledgeRuntime();
    installCorpusStubs(runtime);

    try {
      const sourcePath = copyFixtureToWorkspace(runtime, fixturePath('local', 'partial-assets.md'));
      const imported = await runtime.importKnowledgeSource({
        workspaceId: 'default',
        sourceType: 'local_file',
        title: 'Partial Asset Notes',
        sourcePath,
      });
      const detail = runtime.getKnowledgeDocument(imported.normalizedDocument.id)!;

      expect(detail.markdownText).toBe(fixtureText('local', 'partial-assets.expected-normalized.md'));
      expect(imported.source).toMatchObject({
        adapter: 'native',
        fallbackUsed: false,
        status: 'compiled_with_warnings',
        assetStatus: 'partial_failure',
      });
      expect(detail.markdownText).toContain('![Missing](missing.png)');
    } finally {
      await runtime.close();
    }
  });

  it('indexes committed fixture markdown bodies into FTS-backed Knowledge search', async () => {
    const runtime = createKnowledgeRuntime();
    installCorpusStubs(runtime);

    try {
      await runtime.importKnowledgeSource({
        workspaceId: 'default',
        sourceType: 'manual_text',
        title: 'Manual Notes',
        sourceText: fixtureText('manual', 'source.txt'),
      });

      const results = runtime.listKnowledgeDocuments({
        workspaceId: 'default',
        kind: 'source_normalized',
        q: 'dominators',
      } satisfies KnowledgeDocumentQuery);

      expect(results).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ title: 'Manual Notes' }),
        ]),
      );
    } finally {
      await runtime.close();
    }
  });

  it('reports degraded, warning, and asset-failure counts truthfully across the committed corpus', async () => {
    const runtime = createKnowledgeRuntime();
    installCorpusStubs(runtime);

    try {
      await runtime.importKnowledgeSource({
        workspaceId: 'default',
        sourceType: 'repo',
        title: 'repo-fixture',
        sourcePath: fixturePath('repo-fixture'),
      });
      await runtime.importKnowledgeSource({
        workspaceId: 'default',
        sourceType: 'website',
        title: 'Fallback Systems Note',
        sourceUri: DEGRADED_URL,
      });
      await runtime.importKnowledgeSource({
        workspaceId: 'default',
        sourceType: 'pdf',
        title: 'Native Fallback PDF',
        sourcePath: fixturePath('pdfs', 'native-fallback.pdf'),
      });
      const partialPath = copyFixtureToWorkspace(runtime, fixturePath('local', 'partial-assets.md'));
      await runtime.importKnowledgeSource({
        workspaceId: 'default',
        sourceType: 'local_file',
        title: 'Partial Asset Notes',
        sourcePath: partialPath,
      });

      expect(runtime.getKnowledgeAudit('default')).toMatchObject({
        totalSources: 4,
        degradedSources: 2,
        warningSources: 2,
        assetLocalizationFailures: 1,
      });
    } finally {
      await runtime.close();
    }
  });

  it('hard-fails truly unreadable local sources instead of inventing a fake import', async () => {
    const runtime = createKnowledgeRuntime();
    installCorpusStubs(runtime);

    try {
      await expect(runtime.importKnowledgeSource({
        workspaceId: 'default',
        sourceType: 'local_file',
        title: 'Missing Notes',
        sourcePath: fixturePath('local', 'does-not-exist.md'),
      })).rejects.toBeInstanceOf(RuntimeValidationError);
    } finally {
      await runtime.close();
    }
  });
});
