import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { CapabilityContext, CapabilityToolDescriptor } from '@popeye/contracts';
import { redactText } from '@popeye/observability';
import { z } from 'zod';

import type { FileRootService } from './file-root-service.js';
import type { FileSearchService } from './file-search.js';
import { isPathWithinRoot, validateFileSize } from './path-security.js';

export function createFileTools(
  rootService: FileRootService,
  searchService: FileSearchService,
  ctx: CapabilityContext,
): CapabilityToolDescriptor[] {
  return [
    {
      name: 'popeye_file_search',
      label: 'Popeye File Search',
      description: 'Search indexed files by query. Returns file paths and metadata from registered file roots.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query for file names/paths' },
          rootId: { type: 'string', description: 'Optional: restrict to specific file root' },
          limit: { type: 'number', description: 'Maximum results (default 10)' },
        },
        required: ['query'],
        additionalProperties: false,
      },
      execute: async (params) => {
        const parsed = z.object({
          query: z.string().min(1),
          rootId: z.string().optional(),
          limit: z.number().int().positive().max(100).optional(),
        }).parse(params ?? {});

        const response = searchService.search({
          query: parsed.query,
          rootId: parsed.rootId,
          limit: parsed.limit ?? 10,
          includeContent: false,
        });

        if (response.results.length === 0) {
          return { content: [{ type: 'text', text: 'No matching files found.' }] };
        }

        const lines = response.results.map((r, i) =>
          `${i + 1}. ${r.relativePath} [root:${r.fileRootId}]${r.memoryId ? ` [memory:${r.memoryId}]` : ''}`,
        );
        return { content: [{ type: 'text', text: lines.join('\n') }], details: response };
      },
    },
    {
      name: 'popeye_file_read',
      label: 'Popeye File Read',
      description: 'Read a specific file from an allowed file root. Records context release for tracking.',
      inputSchema: {
        type: 'object',
        properties: {
          rootId: { type: 'string', description: 'File root ID' },
          relativePath: { type: 'string', description: 'Path relative to the file root' },
          maxChars: { type: 'number', description: 'Maximum characters to return (default 50000)' },
        },
        required: ['rootId', 'relativePath'],
        additionalProperties: false,
      },
      execute: async (params) => {
        const parsed = z.object({
          rootId: z.string().min(1),
          relativePath: z.string().min(1),
          maxChars: z.number().int().positive().optional(),
        }).parse(params ?? {});

        const root = rootService.getRoot(parsed.rootId);
        if (!root) {
          return { content: [{ type: 'text', text: `File root ${parsed.rootId} not found.` }] };
        }

        // All permission levels (read, index, index_and_derive) allow reading
        const fullPath = resolve(root.rootPath, parsed.relativePath);
        if (!isPathWithinRoot(root.rootPath, fullPath)) {
          return { content: [{ type: 'text', text: 'Access denied: path is outside the file root.' }] };
        }

        const sizeCheck = validateFileSize(fullPath, root.maxFileSizeBytes);
        if (!sizeCheck.valid) {
          return { content: [{ type: 'text', text: `File too large: ${sizeCheck.sizeBytes} bytes (max ${root.maxFileSizeBytes})` }] };
        }

        let rawContent: string;
        try {
          rawContent = readFileSync(fullPath, 'utf-8');
        } catch (err) {
          return { content: [{ type: 'text', text: `Error reading file: ${err instanceof Error ? err.message : String(err)}` }] };
        }

        // Redact sensitive patterns before releasing to agent context
        const config = ctx.config as Record<string, unknown>;
        const security = config['security'] as Record<string, unknown> | undefined;
        const redactionPatterns = (security?.['redactionPatterns'] as string[]) ?? [];
        const content = redactText(rawContent, redactionPatterns).text;

        // Record context release
        ctx.contextReleaseRecord({
          domain: 'files',
          sourceRef: `file_root:${root.id}/${parsed.relativePath}`,
          releaseLevel: 'full',
          tokenEstimate: Math.ceil(content.length / 4),
        });

        const maxChars = parsed.maxChars ?? 50_000;
        const truncated = content.length > maxChars;
        const text = truncated ? content.slice(0, maxChars) : content;

        return {
          content: [{ type: 'text', text: truncated ? `[Truncated to ${maxChars} chars]\n\n${text}` : text }],
          details: { path: parsed.relativePath, truncated, totalChars: content.length },
        };
      },
    },
    {
      name: 'popeye_file_list',
      label: 'Popeye File List',
      description: 'List files within a file root by pattern. Returns indexed file paths.',
      inputSchema: {
        type: 'object',
        properties: {
          rootId: { type: 'string', description: 'File root ID' },
          pattern: { type: 'string', description: 'Optional glob pattern to filter' },
          limit: { type: 'number', description: 'Maximum results (default 50)' },
        },
        required: ['rootId'],
        additionalProperties: false,
      },
      execute: async (params) => {
        const parsed = z.object({
          rootId: z.string().min(1),
          pattern: z.string().optional(),
          limit: z.number().int().positive().max(500).optional(),
        }).parse(params ?? {});

        const root = rootService.getRoot(parsed.rootId);
        if (!root) {
          return { content: [{ type: 'text', text: `File root ${parsed.rootId} not found.` }] };
        }

        let docs = rootService.listDocuments(parsed.rootId);
        if (parsed.pattern) {
          const { minimatch } = await import('minimatch');
          docs = docs.filter((d) => minimatch(d.relativePath, parsed.pattern!, { dot: true }));
        }

        const limited = docs.slice(0, parsed.limit ?? 50);
        if (limited.length === 0) {
          return { content: [{ type: 'text', text: 'No files found in this root.' }] };
        }

        const lines = limited.map((d) => `  ${d.relativePath} (${d.sizeBytes}b)`);
        const header = `Files in "${root.label}" (${root.rootPath}):`;
        return {
          content: [{ type: 'text', text: `${header}\n${lines.join('\n')}` }],
          details: { total: docs.length, shown: limited.length },
        };
      },
    },
  ];
}
