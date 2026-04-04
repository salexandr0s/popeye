import { describe, expect, it } from 'vitest';

import { evaluateGate, parseArgs, renderMarkdown } from './knowledge-beta-corpus.ts';

describe('knowledge beta corpus helpers', () => {
  it('parses upload and gate flags', () => {
    const parsed = parseArgs([
      '--manifest', './manifest.json',
      '--token', 'token-123',
      '--no-upload',
      '--enforce-gate',
    ]);

    expect(parsed.upload).toBe(false);
    expect(parsed.enforceGate).toBe(true);
  });

  it('evaluates gate failures for hard failures and reingest mismatches', () => {
    const gate = evaluateGate({
      manifest: {
        workspaceId: 'default',
        gate: {
          minImportSuccessRate: 0.9,
          maxHardFailures: 0,
        },
        sources: [
          {
            label: 'article-1',
            title: 'Article 1',
            sourceType: 'website',
            sourceUri: 'https://example.com/a',
            reingestAfterImport: true,
            expectedReingestOutcome: 'unchanged',
          },
        ],
      },
      imports: [
        {
          label: 'article-1',
          title: 'Article 1',
          sourceType: 'website',
          outcome: 'failed',
          error: 'timeout',
        },
      ],
      reingests: [
        {
          label: 'article-1',
          title: 'Article 1',
          sourceType: 'website',
          outcome: 'updated',
        },
      ],
    });

    expect(gate.status).toBe('failed');
    expect(gate.actualHardFailures).toBe(1);
    expect(gate.failedExpectedReingestChecks).toBe(1);
  });

  it('renders gate results into markdown', () => {
    const markdown = renderMarkdown({
      manifestPath: '/tmp/manifest.json',
      baseUrl: 'http://127.0.0.1:3210',
      rows: [
        {
          label: 'article-1',
          title: 'Article 1',
          sourceType: 'website',
          outcome: 'created',
        },
      ],
      reingests: [],
      converters: [],
      audit: {
        totalSources: 1,
        totalDocuments: 1,
        totalDraftRevisions: 1,
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
    });

    expect(markdown).toContain('Gate status: passed');
    expect(markdown).toContain('PASS — Import success rate');
  });
});
