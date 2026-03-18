import type { CapabilityContext, CapabilityModule } from '@popeye/contracts';

import { FileRootService } from './file-root-service.js';
import { FileIndexer } from './file-indexer.js';
import { FileSearchService } from './file-search.js';
import { createFileTools } from './tools.js';
import { getFilesMigrations } from './migrations.js';

export { FileRootService } from './file-root-service.js';
export { FileIndexer } from './file-indexer.js';
export { FileSearchService } from './file-search.js';
export { validateRootPath, isPathWithinRoot, isPathAllowed, validateFileSize } from './path-security.js';
export { getFilesMigrations } from './migrations.js';

const DEFAULT_REINDEX_INTERVAL_MS = 6 * 3600_000; // 6 hours
const STALE_REPAIR_INTERVAL_MS = 24 * 3600_000; // 24 hours

export function createFilesCapability(): CapabilityModule {
  let rootService: FileRootService | null = null;
  let indexer: FileIndexer | null = null;
  let searchService: FileSearchService | null = null;
  let ctx: CapabilityContext | null = null;

  return {
    descriptor: {
      id: 'files',
      name: 'File Roots',
      version: '1.0.0',
      domain: 'files',
      dependencies: [],
    },

    initialize(context: CapabilityContext): void {
      ctx = context;
      rootService = new FileRootService(context.appDb);
      indexer = new FileIndexer(context.appDb, context);
      searchService = new FileSearchService(context.appDb);
      context.log.info('cap-files initialized');
    },

    shutdown(): void {
      rootService = null;
      indexer = null;
      searchService = null;
      ctx = null;
    },

    healthCheck() {
      return { healthy: rootService !== null };
    },

    getRuntimeTools(taskContext) {
      if (!rootService || !searchService || !ctx) return [];
      return createFileTools(rootService, searchService, ctx, taskContext);
    },

    getTimers() {
      return [
        {
          id: 'files-reindex',
          intervalMs: DEFAULT_REINDEX_INTERVAL_MS,
          immediate: false,
          handler: () => {
            if (!rootService || !indexer) return;
            const roots = rootService.listRoots();
            for (const root of roots) {
              if (!root.enabled) continue;
              if (root.permission === 'read') continue; // read-only roots are not indexed
              try {
                indexer.indexRoot(root);
              } catch (err) {
                ctx?.log.error(`Reindex failed for root ${root.id}: ${err instanceof Error ? err.message : String(err)}`);
              }
            }
          },
        },
        {
          id: 'files-stale-repair',
          intervalMs: STALE_REPAIR_INTERVAL_MS,
          immediate: false,
          handler: () => {
            if (!rootService || !indexer) return;
            const roots = rootService.listRoots();
            for (const root of roots) {
              if (!root.enabled) continue;
              try {
                indexer.removeStaleDocuments(root.id);
              } catch (err) {
                ctx?.log.error(`Stale repair failed for root ${root.id}: ${err instanceof Error ? err.message : String(err)}`);
              }
            }
          },
        },
      ];
    },

    getMigrations() {
      return getFilesMigrations();
    },
  };
}
