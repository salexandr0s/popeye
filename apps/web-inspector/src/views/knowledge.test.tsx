// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import { Knowledge } from './knowledge';

const api = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
}));

vi.mock('../api/provider', () => ({
  useApi: () => api,
}));

describe('Knowledge view', () => {
  beforeEach(() => {
    api.get.mockReset();
    api.post.mockReset();
    api.patch.mockReset();
    api.get
      .mockResolvedValueOnce([
        {
          id: 'source-1',
          workspaceId: 'default',
          knowledgeRootId: 'root-1',
          sourceType: 'manual_text',
          title: 'Compiler Notes',
          originalUri: null,
          originalPath: null,
          originalFileName: null,
          originalMediaType: 'text/plain',
          adapter: 'native',
          fallbackUsed: false,
          status: 'compiled',
          contentHash: 'hash-1',
          assetStatus: 'none',
          latestOutcome: 'created',
          conversionWarnings: [],
          createdAt: '2026-04-04T10:00:00Z',
          updatedAt: '2026-04-04T10:00:00Z',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'doc-1',
          workspaceId: 'default',
          knowledgeRootId: 'root-1',
          sourceId: 'source-1',
          kind: 'wiki_article',
          title: 'Compiler Notes',
          slug: 'compiler-notes',
          relativePath: 'wiki/compiler-notes.md',
          revisionHash: 'hash-1',
          status: 'active',
          createdAt: '2026-04-04T10:00:00Z',
          updatedAt: '2026-04-04T10:01:00Z',
        },
      ])
      .mockResolvedValueOnce({
        totalSources: 1,
        totalDocuments: 1,
        totalDraftRevisions: 0,
        unresolvedLinks: 0,
        brokenLinks: 0,
        failedConversions: 0,
        degradedSources: 0,
        warningSources: 0,
        assetLocalizationFailures: 0,
        lastCompileAt: '2026-04-04T10:01:00Z',
      })
      .mockResolvedValueOnce([
        {
          id: 'jina_reader',
          status: 'ready',
          provenance: 'remote',
          details: 'Remote Jina Reader probe succeeded.',
          version: null,
          lastCheckedAt: '2026-04-04T10:02:00Z',
          installHint: 'Ensure outbound HTTPS access to r.jina.ai.',
          usedFor: ['website', 'x_post'],
          fallbackRank: 1,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'beta-1',
          workspaceId: 'default',
          manifestPath: '/tmp/knowledge-beta-manifest.json',
          importCount: 1,
          reingestCount: 0,
          hardFailureCount: 0,
          importSuccessRate: 1,
          gateStatus: 'passed',
          createdAt: '2026-04-04T10:03:00Z',
        },
      ])
      .mockResolvedValueOnce({
        id: 'beta-1',
        workspaceId: 'default',
        manifestPath: '/tmp/knowledge-beta-manifest.json',
        importCount: 1,
        reingestCount: 0,
        hardFailureCount: 0,
        importSuccessRate: 1,
        gateStatus: 'passed',
        createdAt: '2026-04-04T10:03:00Z',
        reportMarkdown: '# Knowledge beta corpus report\n',
        imports: [
          {
            label: 'article-1',
            title: 'Compiler Notes',
            sourceType: 'website',
            outcome: 'created',
            sourceId: 'source-1',
            adapter: 'jina_reader',
            status: 'compiled',
            assetStatus: 'none',
          },
        ],
        reingests: [],
        converters: [],
        audit: {
          totalSources: 1,
          totalDocuments: 1,
          totalDraftRevisions: 0,
          unresolvedLinks: 0,
          brokenLinks: 0,
          failedConversions: 0,
          degradedSources: 0,
          warningSources: 0,
          assetLocalizationFailures: 0,
          lastCompileAt: '2026-04-04T10:01:00Z',
        },
        gate: {
          status: 'passed',
          minImportSuccessRate: 0.9,
          actualImportSuccessRate: 1,
          maxHardFailures: 0,
          actualHardFailures: 0,
          expectedReingestChecks: 0,
          failedExpectedReingestChecks: 0,
          checks: [
            {
              id: 'import-success-rate',
              label: 'Import success rate',
              passed: true,
              details: '100% actual vs 90% minimum',
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        id: 'doc-1',
        workspaceId: 'default',
        knowledgeRootId: 'root-1',
        sourceId: 'source-1',
        kind: 'wiki_article',
        title: 'Compiler Notes',
        slug: 'compiler-notes',
        relativePath: 'wiki/compiler-notes.md',
        revisionHash: 'hash-1',
        status: 'active',
        createdAt: '2026-04-04T10:00:00Z',
        updatedAt: '2026-04-04T10:01:00Z',
        markdownText: '# Compiler Notes\n\nSSA form.\n',
        exists: true,
        sourceIds: ['source-1'],
      })
      .mockResolvedValueOnce({
        document: {
          id: 'doc-1',
          workspaceId: 'default',
          knowledgeRootId: 'root-1',
          sourceId: 'source-1',
          kind: 'wiki_article',
          title: 'Compiler Notes',
          slug: 'compiler-notes',
          relativePath: 'wiki/compiler-notes.md',
          revisionHash: 'hash-1',
          status: 'active',
          createdAt: '2026-04-04T10:00:00Z',
          updatedAt: '2026-04-04T10:01:00Z',
        },
        incoming: [],
        outgoing: [],
        relatedDocuments: [],
      });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders knowledge documents with audit and converter health', async () => {
    render(
      <MemoryRouter>
        <Knowledge />
      </MemoryRouter>,
    );

    expect(screen.getByText('Knowledge')).toBeTruthy();
    await waitFor(() => {
      expect(screen.getAllByText('Compiler Notes').length).toBeGreaterThan(0);
      expect(screen.getByText(/Read-only knowledge documents/)).toBeTruthy();
      expect(screen.getByText(/Converters Ready/)).toBeTruthy();
      expect(screen.getByText(/Latest beta corpus run/)).toBeTruthy();
      expect(screen.getByText(/Remote Jina Reader probe succeeded/)).toBeTruthy();
    });
  });
});
