import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';

import type {
  AppliedPlaybook,
  PlaybookFrontMatter,
  PlaybookScope,
  ResolvedPlaybook,
} from '@popeye/contracts';
import {
  AppliedPlaybookSchema,
  PlaybookFrontMatterSchema,
  ResolvedPlaybookSchema,
} from '@popeye/contracts';
import { sha256 } from '@popeye/observability';

export const WORKSPACE_PLAYBOOKS_DIR = '.popeye/playbooks';
export const PROJECT_PLAYBOOKS_DIR = '.popeye/playbooks';
export const GLOBAL_PLAYBOOKS_DIR = 'playbooks';

export interface ScopedPlaybookDirectory {
  scope: PlaybookScope;
  dirPath: string | null;
  workspaceId?: string | null;
  projectId?: string | null;
}

export interface PlaybookDiscoveryOptions {
  directories: ScopedPlaybookDirectory[];
  profileId?: string | null;
}

export interface PlaybookDiscoveryResult {
  all: ResolvedPlaybook[];
  selected: ResolvedPlaybook[];
}

export interface ParsedPlaybookMarkdown {
  frontMatter: PlaybookFrontMatter;
  body: string;
  contentHash: string;
  revisionHash: string;
}

function normalizeText(value: string): string {
  return value.replace(/\r\n?/g, '\n');
}

function normalizeBody(body: string): string {
  return normalizeText(body).trim();
}

function parseScalar(rawValue: string): string | string[] {
  const value = rawValue.trim();
  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim();
    if (!inner) return [];
    return inner
      .split(',')
      .map((entry) => stripQuotes(entry.trim()))
      .filter((entry) => entry.length > 0);
  }
  return stripQuotes(value);
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith('\'') && value.endsWith('\''))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function parseFrontMatterBlock(block: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = normalizeText(block).split('\n');
  let pendingArrayKey: string | null = null;
  let pendingArrayValues: string[] = [];

  const flushPendingArray = (): void => {
    if (pendingArrayKey) {
      result[pendingArrayKey] = pendingArrayValues;
      pendingArrayKey = null;
      pendingArrayValues = [];
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line.trim()) continue;
    if (line.trimStart().startsWith('#')) continue;

    const arrayEntryMatch = line.match(/^\s*-\s+(.*)$/);
    if (arrayEntryMatch) {
      if (!pendingArrayKey) {
        throw new Error(`Invalid playbook front matter list entry: ${line}`);
      }
      pendingArrayValues.push(stripQuotes(arrayEntryMatch[1]!.trim()));
      continue;
    }

    flushPendingArray();

    const keyValueMatch = line.match(/^([A-Za-z0-9_]+):(?:\s*(.*))?$/);
    if (!keyValueMatch) {
      throw new Error(`Invalid playbook front matter line: ${line}`);
    }

    const [, key, rawValue = ''] = keyValueMatch;
    if (!key) {
      throw new Error(`Invalid playbook front matter line: ${line}`);
    }

    const parsedValue = parseScalar(rawValue);
    if (Array.isArray(parsedValue)) {
      result[key] = parsedValue;
      continue;
    }

    if (rawValue.trim().length === 0) {
      pendingArrayKey = key;
      pendingArrayValues = [];
      continue;
    }

    result[key] = parsedValue;
  }

  flushPendingArray();
  return result;
}

function splitFrontMatter(markdown: string): { frontMatterBlock: string; body: string } {
  const normalized = normalizeText(markdown);
  if (!normalized.startsWith('---\n')) {
    throw new Error('Playbook markdown must start with front matter');
  }
  const closingIndex = normalized.indexOf('\n---\n', 4);
  if (closingIndex === -1) {
    throw new Error('Playbook front matter must be closed by a second --- line');
  }
  return {
    frontMatterBlock: normalized.slice(4, closingIndex),
    body: normalized.slice(closingIndex + 5),
  };
}

function canonicalizeFrontMatter(frontMatter: PlaybookFrontMatter): string {
  return JSON.stringify({
    id: frontMatter.id,
    title: frontMatter.title,
    status: frontMatter.status,
    allowedProfileIds: Array.from(new Set(frontMatter.allowedProfileIds)).sort(),
  });
}

function canonicalizePlaybook(record: {
  frontMatter: PlaybookFrontMatter;
  body: string;
}): ParsedPlaybookMarkdown {
  const normalizedFrontMatter = PlaybookFrontMatterSchema.parse({
    ...record.frontMatter,
    allowedProfileIds: Array.from(new Set(record.frontMatter.allowedProfileIds)).sort(),
  });
  const normalizedBody = normalizeBody(record.body);
  return {
    frontMatter: normalizedFrontMatter,
    body: normalizedBody,
    contentHash: sha256(normalizedBody),
    revisionHash: sha256(`${canonicalizeFrontMatter(normalizedFrontMatter)}\n\n${normalizedBody}`),
  };
}

function stringifyFrontMatterScalar(value: string): string {
  return JSON.stringify(value);
}

export function renderPlaybookMarkdown(record: {
  frontMatter: PlaybookFrontMatter;
  body: string;
}): string {
  const canonical = canonicalizePlaybook(record);
  const allowedProfileIds = canonical.frontMatter.allowedProfileIds;
  const frontMatterLines = [
    '---',
    `id: ${stringifyFrontMatterScalar(canonical.frontMatter.id)}`,
    `title: ${stringifyFrontMatterScalar(canonical.frontMatter.title)}`,
    `status: ${canonical.frontMatter.status}`,
    allowedProfileIds.length === 0
      ? 'allowedProfileIds: []'
      : ['allowedProfileIds:', ...allowedProfileIds.map((value) => `  - ${stringifyFrontMatterScalar(value)}`)].join('\n'),
    '---',
  ];
  return `${frontMatterLines.join('\n')}\n${canonical.body}\n`;
}

export function buildPlaybookDiff(previousMarkdown: string | null, nextMarkdown: string): string {
  const previousLines = previousMarkdown ? normalizeText(previousMarkdown).trimEnd().split('\n') : [];
  const nextLines = normalizeText(nextMarkdown).trimEnd().split('\n');

  if (previousLines.length === 0) {
    return nextLines.map((line) => `+ ${line}`).join('\n');
  }

  const max = Math.max(previousLines.length, nextLines.length);
  const diffLines: string[] = [];
  for (let index = 0; index < max; index += 1) {
    const previous = previousLines[index];
    const next = nextLines[index];
    if (previous === next) {
      if (next !== undefined) diffLines.push(`  ${next}`);
      continue;
    }
    if (previous !== undefined) diffLines.push(`- ${previous}`);
    if (next !== undefined) diffLines.push(`+ ${next}`);
  }

  return diffLines.join('\n');
}

export function buildPlaybookRecordId(playbook: {
  id: string;
  scope: PlaybookScope;
  workspaceId?: string | null;
  projectId?: string | null;
}): string {
  switch (playbook.scope) {
    case 'workspace':
      return `workspace:${playbook.workspaceId ?? 'unknown'}:${playbook.id}`;
    case 'project':
      return `project:${playbook.projectId ?? 'unknown'}:${playbook.id}`;
    case 'global':
    default:
      return `global:${playbook.id}`;
  }
}

function walkMarkdownFiles(dirPath: string): string[] {
  if (!existsSync(dirPath)) return [];
  const entries = readdirSync(dirPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = resolve(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkMarkdownFiles(fullPath));
      continue;
    }
    if (entry.isFile() && fullPath.endsWith('.md')) {
      files.push(fullPath);
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}

function loadPlaybooksFromDirectory(directory: ScopedPlaybookDirectory): ResolvedPlaybook[] {
  if (!directory.dirPath) return [];
  const rootPath = resolve(directory.dirPath);
  const records: ResolvedPlaybook[] = [];

  for (const filePath of walkMarkdownFiles(rootPath)) {
    const raw = readFileSync(filePath, 'utf8');
    const parsed = parsePlaybookMarkdown(raw);
    records.push(ResolvedPlaybookSchema.parse({
      recordId: buildPlaybookRecordId({
        id: parsed.frontMatter.id,
        scope: directory.scope,
        workspaceId: directory.workspaceId ?? null,
        projectId: directory.projectId ?? null,
      }),
      id: parsed.frontMatter.id,
      title: parsed.frontMatter.title,
      status: parsed.frontMatter.status,
      scope: directory.scope,
      workspaceId: directory.workspaceId ?? null,
      projectId: directory.projectId ?? null,
      path: filePath,
      body: parsed.body,
      contentHash: parsed.contentHash,
      revisionHash: parsed.revisionHash,
      allowedProfileIds: parsed.frontMatter.allowedProfileIds,
    }));
  }

  return records;
}

function scopeRank(scope: PlaybookScope): number {
  switch (scope) {
    case 'global':
      return 0;
    case 'workspace':
      return 1;
    case 'project':
      return 2;
  }
}

function sortPlaybooks(playbooks: ResolvedPlaybook[]): ResolvedPlaybook[] {
  return [...playbooks].sort((left, right) => {
    const byScope = scopeRank(left.scope) - scopeRank(right.scope);
    if (byScope !== 0) return byScope;
    const byId = left.id.localeCompare(right.id);
    if (byId !== 0) return byId;
    return relativePathForSort(left.path).localeCompare(relativePathForSort(right.path));
  });
}

function relativePathForSort(filePath: string): string {
  return filePath.split(sep).join('/');
}

export function parsePlaybookMarkdown(markdown: string): ParsedPlaybookMarkdown {
  const { frontMatterBlock, body } = splitFrontMatter(markdown);
  return canonicalizePlaybook({
    frontMatter: PlaybookFrontMatterSchema.parse(parseFrontMatterBlock(frontMatterBlock)),
    body,
  });
}

export function toAppliedPlaybook(playbook: ResolvedPlaybook): AppliedPlaybook {
  return AppliedPlaybookSchema.parse({
    id: playbook.id,
    title: playbook.title,
    scope: playbook.scope,
    revisionHash: playbook.revisionHash,
  });
}

export function discoverScopedPlaybooks(options: PlaybookDiscoveryOptions): PlaybookDiscoveryResult {
  const discovered = sortPlaybooks(
    options.directories.flatMap((directory) => loadPlaybooksFromDirectory(directory)),
  );

  const seenRecordIds = new Set<string>();
  for (const playbook of discovered) {
    if (seenRecordIds.has(playbook.recordId)) {
      throw new Error(`Duplicate playbook detected for ${playbook.recordId}`);
    }
    seenRecordIds.add(playbook.recordId);
  }

  const selected = discovered.filter((playbook) =>
    playbook.status === 'active'
    && (
      playbook.allowedProfileIds.length === 0
      || (options.profileId != null && playbook.allowedProfileIds.includes(options.profileId))
    ),
  );

  return {
    all: discovered,
    selected,
  };
}
