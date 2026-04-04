import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { z } from 'zod';

import { PopeyeApiClient } from '../packages/api-client/src/client.ts';
import type {
  KnowledgeBetaGate,
  KnowledgeBetaReportRow,
} from '../packages/contracts/src/index.ts';

const ManifestSourceSchema = z.object({
  label: z.string().min(1),
  title: z.string().min(1),
  sourceType: z.enum(['local_file', 'manual_text', 'website', 'pdf', 'x_post', 'repo', 'dataset', 'image']),
  sourcePath: z.string().optional(),
  sourceUri: z.string().url().optional(),
  sourceText: z.string().optional(),
  reingestAfterImport: z.boolean().default(false),
  expectedReingestOutcome: z.enum(['unchanged', 'updated']).optional(),
});

const ManifestGateSchema = z.object({
  minImportSuccessRate: z.number().min(0).max(1).default(0.9),
  maxHardFailures: z.number().int().nonnegative().default(0),
});

const ManifestSchema = z.object({
  workspaceId: z.string().min(1),
  sources: z.array(ManifestSourceSchema).min(1),
  gate: ManifestGateSchema.default({}),
});

type Manifest = z.infer<typeof ManifestSchema>;
type ReportRow = KnowledgeBetaReportRow;

export function parseArgs(argv: string[]): {
  manifest: string;
  baseUrl: string;
  token: string;
  report: string;
  upload: boolean;
  enforceGate: boolean;
} {
  const args = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current?.startsWith('--')) continue;
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      flags.add(current.slice(2));
      continue;
    }
    args.set(current.slice(2), next);
    index += 1;
  }

  const manifest = args.get('manifest');
  if (!manifest) {
    throw new Error('Missing required --manifest <path>');
  }

  const token = args.get('token') ?? process.env.POPEYE_API_TOKEN;
  if (!token) {
    throw new Error('Missing required --token <token> or POPEYE_API_TOKEN env var');
  }

  return {
    manifest,
    baseUrl: args.get('base-url') ?? 'http://127.0.0.1:3210',
    token,
    report: args.get('report') ?? resolve(process.cwd(), 'dist', 'knowledge-beta-report.md'),
    upload: !flags.has('no-upload'),
    enforceGate: flags.has('enforce-gate'),
  };
}

function loadManifest(path: string): Manifest {
  const absolutePath = resolve(path);
  const parsed = ManifestSchema.parse(JSON.parse(readFileSync(absolutePath, 'utf8')));
  const baseDir = dirname(absolutePath);
  return {
    workspaceId: parsed.workspaceId,
    sources: parsed.sources.map((source) => ({
      ...source,
      sourcePath: source.sourcePath ? resolve(baseDir, source.sourcePath) : undefined,
    })),
    gate: parsed.gate,
  };
}

export function evaluateGate(input: {
  manifest: Manifest;
  imports: ReportRow[];
  reingests: ReportRow[];
}): KnowledgeBetaGate {
  const hardFailureCount = input.imports.filter((row) => Boolean(row.error)).length;
  const importSuccessRate = input.imports.length === 0 ? 0 : (input.imports.length - hardFailureCount) / input.imports.length;
  const reingestExpectations = input.manifest.sources.filter((source) => source.reingestAfterImport && source.expectedReingestOutcome);
  const failedExpectedReingests = reingestExpectations.filter((source) => {
    const match = input.reingests.find((row) => row.label === source.label);
    return !match || match.outcome !== source.expectedReingestOutcome;
  });
  const checks = [
    {
      id: 'import-success-rate',
      label: 'Import success rate',
      passed: importSuccessRate >= input.manifest.gate.minImportSuccessRate,
      details: `${Math.round(importSuccessRate * 100)}% actual vs ${Math.round(input.manifest.gate.minImportSuccessRate * 100)}% minimum`,
    },
    {
      id: 'hard-failures',
      label: 'Hard failures',
      passed: hardFailureCount <= input.manifest.gate.maxHardFailures,
      details: `${hardFailureCount} actual vs ${input.manifest.gate.maxHardFailures} allowed`,
    },
    {
      id: 'expected-reingests',
      label: 'Expected reingest outcomes',
      passed: failedExpectedReingests.length === 0,
      details: failedExpectedReingests.length === 0
        ? `${reingestExpectations.length} expected reingest checks passed`
        : `${failedExpectedReingests.length} of ${reingestExpectations.length} expected reingest checks failed`,
    },
  ];

  return {
    status: checks.every((check) => check.passed) ? 'passed' : 'failed',
    minImportSuccessRate: input.manifest.gate.minImportSuccessRate,
    actualImportSuccessRate: importSuccessRate,
    maxHardFailures: input.manifest.gate.maxHardFailures,
    actualHardFailures: hardFailureCount,
    expectedReingestChecks: reingestExpectations.length,
    failedExpectedReingestChecks: failedExpectedReingests.length,
    checks,
  };
}

export function renderMarkdown(input: {
  manifestPath: string;
  baseUrl: string;
  rows: ReportRow[];
  reingests: ReportRow[];
  converters: Awaited<ReturnType<PopeyeApiClient['listKnowledgeConverters']>>;
  audit: Awaited<ReturnType<PopeyeApiClient['getKnowledgeAudit']>>;
  gate: KnowledgeBetaGate;
}): string {
  const lines: string[] = [];
  lines.push('# Knowledge beta corpus report', '');
  lines.push(`- Manifest: ${input.manifestPath}`);
  lines.push(`- Base URL: ${input.baseUrl}`);
  lines.push(`- Imports attempted: ${input.rows.length}`);
  lines.push(`- Gate status: ${input.gate.status}`);
  lines.push(`- Import success rate: ${Math.round(input.gate.actualImportSuccessRate * 100)}%`);
  lines.push(`- Hard failures: ${input.gate.actualHardFailures}`);
  lines.push('');

  lines.push('## Gate checks', '');
  for (const check of input.gate.checks) {
    lines.push(`- ${check.passed ? 'PASS' : 'FAIL'} — ${check.label}`);
    lines.push(`  - ${check.details}`);
  }
  lines.push('');

  lines.push('## Converter readiness', '');
  for (const converter of input.converters) {
    lines.push(`- ${converter.id}: ${converter.status}${converter.version ? ` (${converter.version})` : ''}`);
    lines.push(`  - ${converter.details}`);
    if (converter.installHint) lines.push(`  - Install hint: ${converter.installHint}`);
  }
  lines.push('');

  lines.push('## Imports', '');
  for (const row of input.rows) {
    lines.push(`- ${row.label} — ${row.outcome}`);
    lines.push(`  - title: ${row.title}`);
    lines.push(`  - type: ${row.sourceType}`);
    if (row.sourceId) lines.push(`  - sourceId: ${row.sourceId}`);
    if (row.adapter) lines.push(`  - adapter: ${row.adapter}`);
    if (row.status) lines.push(`  - status: ${row.status}`);
    if (row.assetStatus) lines.push(`  - assetStatus: ${row.assetStatus}`);
    if (row.draftRevisionId) lines.push(`  - draftRevisionId: ${row.draftRevisionId}`);
    if (row.error) lines.push(`  - error: ${row.error}`);
  }
  lines.push('');

  lines.push('## Reingests', '');
  if (input.reingests.length === 0) {
    lines.push('- None requested');
  } else {
    for (const row of input.reingests) {
      lines.push(`- ${row.label} — ${row.outcome}`);
      if (row.sourceId) lines.push(`  - sourceId: ${row.sourceId}`);
      if (row.adapter) lines.push(`  - adapter: ${row.adapter}`);
      if (row.status) lines.push(`  - status: ${row.status}`);
      if (row.assetStatus) lines.push(`  - assetStatus: ${row.assetStatus}`);
      if (row.draftRevisionId) lines.push(`  - draftRevisionId: ${row.draftRevisionId}`);
      if (row.error) lines.push(`  - error: ${row.error}`);
    }
  }
  lines.push('');

  lines.push('## Audit snapshot', '');
  lines.push(`- totalSources: ${input.audit.totalSources}`);
  lines.push(`- totalDocuments: ${input.audit.totalDocuments}`);
  lines.push(`- totalDraftRevisions: ${input.audit.totalDraftRevisions}`);
  lines.push(`- degradedSources: ${input.audit.degradedSources}`);
  lines.push(`- warningSources: ${input.audit.warningSources}`);
  lines.push(`- assetLocalizationFailures: ${input.audit.assetLocalizationFailures}`);
  lines.push(`- failedConversions: ${input.audit.failedConversions}`);
  lines.push(`- unresolvedLinks: ${input.audit.unresolvedLinks}`);
  lines.push(`- brokenLinks: ${input.audit.brokenLinks}`);

  return `${lines.join('\n')}\n`;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const manifest = loadManifest(options.manifest);
  const client = new PopeyeApiClient({ baseUrl: options.baseUrl, token: options.token });

  const importRows: ReportRow[] = [];
  const reingestRows: ReportRow[] = [];
  const sourceIdsByLabel = new Map<string, string>();

  for (const source of manifest.sources) {
    try {
      const result = await client.importKnowledgeSource({
        workspaceId: manifest.workspaceId,
        sourceType: source.sourceType,
        title: source.title,
        ...(source.sourcePath ? { sourcePath: source.sourcePath } : {}),
        ...(source.sourceUri ? { sourceUri: source.sourceUri } : {}),
        ...(source.sourceText ? { sourceText: source.sourceText } : {}),
      });
      sourceIdsByLabel.set(source.label, result.source.id);
      importRows.push({
        label: source.label,
        title: source.title,
        sourceType: source.sourceType,
        outcome: result.outcome,
        sourceId: result.source.id,
        adapter: result.source.adapter,
        status: result.source.status,
        assetStatus: result.source.assetStatus,
        draftRevisionId: result.draftRevision?.id ?? null,
      });
    } catch (error) {
      importRows.push({
        label: source.label,
        title: source.title,
        sourceType: source.sourceType,
        outcome: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  for (const source of manifest.sources.filter((entry) => entry.reingestAfterImport)) {
    const sourceId = sourceIdsByLabel.get(source.label);
    if (!sourceId) {
      reingestRows.push({
        label: source.label,
        title: source.title,
        sourceType: source.sourceType,
        outcome: 'skipped',
        error: 'No sourceId available from import phase',
      });
      continue;
    }

    try {
      const result = await client.reingestKnowledgeSource(sourceId);
      reingestRows.push({
        label: source.label,
        title: source.title,
        sourceType: source.sourceType,
        outcome: result.outcome,
        sourceId: result.source.id,
        adapter: result.source.adapter,
        status: result.source.status,
        assetStatus: result.source.assetStatus,
        draftRevisionId: result.draftRevision?.id ?? null,
      });
    } catch (error) {
      reingestRows.push({
        label: source.label,
        title: source.title,
        sourceType: source.sourceType,
        outcome: 'failed',
        sourceId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const [converters, audit] = await Promise.all([
    client.listKnowledgeConverters(),
    client.getKnowledgeAudit(manifest.workspaceId),
  ]);
  const gate = evaluateGate({
    manifest,
    imports: importRows,
    reingests: reingestRows,
  });

  const markdown = renderMarkdown({
    manifestPath: resolve(options.manifest),
    baseUrl: options.baseUrl,
    rows: importRows,
    reingests: reingestRows,
    converters,
    audit,
    gate,
  });
  const reportPath = resolve(options.report);
  const jsonPath = reportPath.endsWith('.md') ? `${reportPath.slice(0, -3)}.json` : `${reportPath}.json`;
  mkdirSync(dirname(reportPath), { recursive: true });
  let uploadedRunId: string | null = null;
  if (options.upload) {
    const uploaded = await client.createKnowledgeBetaRun({
      workspaceId: manifest.workspaceId,
      manifestPath: resolve(options.manifest),
      reportMarkdown: markdown,
      imports: importRows,
      reingests: reingestRows,
      converters,
      audit,
      gate,
    });
    uploadedRunId = uploaded.id;
  }
  writeFileSync(reportPath, markdown, 'utf8');
  writeFileSync(jsonPath, JSON.stringify({ gate, imports: importRows, reingests: reingestRows, converters, audit, uploadedRunId }, null, 2), 'utf8');
  process.stdout.write(`Wrote Knowledge beta reports to ${reportPath} and ${jsonPath}\n`);
  if (uploadedRunId) {
    process.stdout.write(`Uploaded Knowledge beta run ${uploadedRunId}\n`);
  }
  if (options.enforceGate && gate.status !== 'passed') {
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
