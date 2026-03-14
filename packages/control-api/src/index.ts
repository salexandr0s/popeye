import Fastify, { type FastifyInstance } from 'fastify';
import sensible from '@fastify/sensible';
import rateLimit from '@fastify/rate-limit';
import helmet from '@fastify/helmet';

import {
  AgentProfileRecordSchema,
  MemoryPromotionExecuteRequestSchema,
  MemoryPromotionProposalRequestSchema,
  PathIdParamSchema,
  ProjectRecordSchema,
  ProjectRegistrationInputSchema,
  RunStateSchema,
  TaskCreateInputSchema,
  WorkspaceRecordSchema,
  WorkspaceRegistrationInputSchema,
} from '@popeye/contracts';
import { z } from 'zod';
import {
  MessageIngressError,
  issueCsrfToken,
  readAuthStore,
  validateBearerToken,
  validateCsrfToken,
  type PopeyeRuntimeService,
} from '@popeye/runtime-core';

export interface ControlApiDependencies {
  runtime: PopeyeRuntimeService;
  cspNonce?: string;
  /** Paths exempt from bearer auth (e.g. nonce exchange). CSRF is also skipped for these. */
  authExemptPaths?: ReadonlySet<string>;
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const MemorySearchQueryParamsSchema = z.object({
  q: z.string().max(1000).optional(),
  query: z.string().max(1000).optional(),
  scope: z.string().optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
  types: z.string().optional(),
  full: z.string().optional(),
});

const MemoryListQueryParamsSchema = z.object({
  type: z.string().optional(),
  scope: z.string().optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
});

const RunListQueryParamsSchema = z.object({
  state: z.string().optional(),
});

function parseIdParam(params: unknown): string {
  return PathIdParamSchema.parse(params).id;
}

export async function createControlApi(
  dependencies: ControlApiDependencies,
): Promise<FastifyInstance> {
  const app = Fastify({
    bodyLimit: 1_048_576,
    logger: { level: 'info', redact: ['req.headers.authorization'] },
  });
  await app.register(sensible);
  await app.register(rateLimit, { max: 100, timeWindow: '1 minute' });
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: dependencies.cspNonce ? ["'self'", `'nonce-${dependencies.cspNonce}'`] : ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        connectSrc: ["'self'"],
      },
    },
  });

  // Cached auth store to avoid per-request file reads
  let cachedAuthStore: ReturnType<typeof readAuthStore> | null = null;
  let authStoreLastRead = 0;
  function getCachedAuthStore(): ReturnType<typeof readAuthStore> {
    const now = Date.now();
    // 1s eventual-consistency window for token revocation (POP-SEC-005)
    if (!cachedAuthStore || now - authStoreLastRead > 1000) {
      cachedAuthStore = readAuthStore(dependencies.runtime.config.authFile);
      authStoreLastRead = now;
    }
    return cachedAuthStore;
  }

  const authExemptPaths = dependencies.authExemptPaths ?? new Set<string>();

  app.addHook('preHandler', async (request, reply) => {
    // Allow explicitly exempted paths (e.g. nonce exchange) to bypass bearer + CSRF
    if (authExemptPaths.has(request.url.split('?')[0]!)) {
      return undefined;
    }

    const authStore = getCachedAuthStore();
    if (!validateBearerToken(request.headers.authorization, authStore)) {
      return reply.code(401).send({ error: 'unauthorized' });
    }

    if (MUTATING_METHODS.has(request.method)) {
      const csrfHeader = request.headers['x-popeye-csrf'];
      const csrf = Array.isArray(csrfHeader) ? csrfHeader[0] : csrfHeader;
      if (!validateCsrfToken(csrf, authStore)) {
        return reply.code(403).send({ error: 'csrf_invalid' });
      }
      // POP-SEC-007: Sec-Fetch-Site may be absent in non-browser clients.
      // The bearer token is the primary auth layer; this is defense-in-depth.
      const secFetchSite = request.headers['sec-fetch-site'];
      if (
        typeof secFetchSite === 'string' &&
        !['same-origin', 'none'].includes(secFetchSite)
      ) {
        return reply.code(403).send({ error: 'csrf_cross_site_blocked' });
      }
    }
    return undefined;
  });

  app.get('/v1/health', async () => ({
    ok: true,
    startedAt: dependencies.runtime.startedAt,
  }));
  app.get('/v1/status', async () => dependencies.runtime.getStatus());
  app.get('/v1/daemon/state', async () => dependencies.runtime.getDaemonState());
  app.get('/v1/daemon/scheduler', async () => dependencies.runtime.getSchedulerStatus());
  app.get('/v1/workspaces', async () =>
    z.array(WorkspaceRecordSchema).parse(dependencies.runtime.listWorkspaces()),
  );
  app.get('/v1/workspaces/:id', async (request, reply) => {
    const id = parseIdParam(request.params);
    const workspace = dependencies.runtime.getWorkspace(id);
    if (!workspace) return reply.code(404).send({ error: 'not_found' });
    return workspace;
  });
  app.post('/v1/workspaces', async (request) => {
    const input = WorkspaceRegistrationInputSchema.parse(request.body);
    return dependencies.runtime.registerWorkspace(input);
  });
  app.get('/v1/projects', async () =>
    z.array(ProjectRecordSchema).parse(dependencies.runtime.listProjects()),
  );
  app.get('/v1/projects/:id', async (request, reply) => {
    const id = parseIdParam(request.params);
    const project = dependencies.runtime.getProject(id);
    if (!project) return reply.code(404).send({ error: 'not_found' });
    return project;
  });
  app.post('/v1/projects', async (request) => {
    const input = ProjectRegistrationInputSchema.parse(request.body);
    return dependencies.runtime.registerProject(input);
  });
  app.get('/v1/agent-profiles', async () =>
    z.array(AgentProfileRecordSchema).parse(dependencies.runtime.listAgentProfiles()),
  );

  app.get('/v1/tasks', async () => dependencies.runtime.listTasks());
  app.get('/v1/tasks/:id', async (request, reply) => {
    const id = parseIdParam(request.params);
    const task = dependencies.runtime.getTask(id);
    if (!task) return reply.code(404).send({ error: 'not_found' });
    return task;
  });
  app.post('/v1/tasks', async (request) => {
    const input = TaskCreateInputSchema.parse(request.body);
    return dependencies.runtime.createTask(input);
  });

  app.get('/v1/jobs', async () => dependencies.runtime.listJobs());
  app.get('/v1/jobs/:id/lease', async (request, reply) => {
    const id = parseIdParam(request.params);
    const lease = dependencies.runtime.getJobLease(id);
    if (!lease) return reply.code(404).send({ error: 'not_found' });
    return lease;
  });
  app.post('/v1/jobs/:id/pause', async (request) =>
    dependencies.runtime.pauseJob(parseIdParam(request.params)),
  );
  app.post('/v1/jobs/:id/resume', async (request) =>
    dependencies.runtime.resumeJob(parseIdParam(request.params)),
  );
  app.post('/v1/jobs/:id/enqueue', async (request) =>
    dependencies.runtime.enqueueJob(parseIdParam(request.params)),
  );

  app.get('/v1/sessions', async () => dependencies.runtime.listSessionRoots());
  app.get('/v1/runs', async (request) => {
    const params = RunListQueryParamsSchema.parse(request.query);
    const runs = dependencies.runtime.listRuns();
    if (!params.state) return runs;
    const states = params.state
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => RunStateSchema.parse(value));
    if (states.length === 0) return runs;
    return runs.filter((run) => states.includes(run.state));
  });
  app.get('/v1/runs/:id', async (request, reply) => {
    const id = parseIdParam(request.params);
    const run = dependencies.runtime.getRun(id);
    if (!run) return reply.code(404).send({ error: 'not_found' });
    return run;
  });
  app.get('/v1/runs/:id/events', async (request) =>
    dependencies.runtime.listRunEvents(parseIdParam(request.params)),
  );
  app.post('/v1/runs/:id/retry', async (request) =>
    dependencies.runtime.retryRun(parseIdParam(request.params)),
  );
  app.post('/v1/runs/:id/cancel', async (request) =>
    dependencies.runtime.cancelRun(parseIdParam(request.params)),
  );

  app.get('/v1/receipts', async () => dependencies.runtime.listReceipts());
  app.get('/v1/receipts/:id', async (request, reply) => {
    const id = parseIdParam(request.params);
    const receipt = dependencies.runtime.getReceipt(id);
    if (!receipt) return reply.code(404).send({ error: 'not_found' });
    return receipt;
  });

  app.get('/v1/instruction-previews/:scope', async (request) =>
    dependencies.runtime.getInstructionPreview(
      (request.params as { scope: string }).scope,
    ),
  );
  app.get('/v1/interventions', async () => dependencies.runtime.listInterventions());
  app.post('/v1/interventions/:id/resolve', async (request) =>
    dependencies.runtime.resolveIntervention(parseIdParam(request.params)),
  );

  app.get('/v1/memory/search', async (request) => {
    const params = MemorySearchQueryParamsSchema.parse(request.query);
    const queryText = params.q ?? params.query ?? '';
    if (!queryText) return { query: '', results: [], totalCandidates: 0, latencyMs: 0, searchMode: 'fts_only' };
    return dependencies.runtime.searchMemory({
      query: queryText,
      scope: params.scope,
      memoryTypes: params.types ? (params.types.split(',') as Array<'episodic' | 'semantic' | 'procedural'>) : undefined,
      limit: params.limit ?? 20,
      includeContent: params.full === 'true',
    });
  });

  app.get('/v1/memory/audit', async () => dependencies.runtime.getMemoryAudit());

  app.get('/v1/memory/:id', async (request, reply) => {
    const id = parseIdParam(request.params);
    const memory = dependencies.runtime.getMemory(id);
    if (!memory) return reply.code(404).send({ error: 'not_found' });
    return memory;
  });

  app.get('/v1/memory', async (request) => {
    const params = MemoryListQueryParamsSchema.parse(request.query);
    return dependencies.runtime.listMemories({
      type: params.type,
      scope: params.scope,
      limit: params.limit ?? 50,
    });
  });

  app.post('/v1/memory/maintenance', async () => dependencies.runtime.triggerMemoryMaintenance());

  app.post('/v1/memory/:id/promote/propose', async (request, reply) => {
    const id = parseIdParam(request.params);
    const body = MemoryPromotionProposalRequestSchema.parse(request.body);
    const result = dependencies.runtime.proposeMemoryPromotion(id, body.targetPath);
    if (!result.diff) return reply.code(404).send({ error: 'not_found' });
    return result;
  });

  app.post('/v1/memory/:id/promote/execute', async (request) => {
    const id = parseIdParam(request.params);
    const body = MemoryPromotionExecuteRequestSchema.parse(request.body);
    return dependencies.runtime.executeMemoryPromotion({ memoryId: id, ...body });
  });

  const MAX_SSE_CONNECTIONS = 10;
  let sseConnectionCount = 0;
  app.get('/v1/events/stream', async (_request, reply) => {
    if (sseConnectionCount >= MAX_SSE_CONNECTIONS) {
      return reply.code(429).send({ error: 'too_many_sse_connections' });
    }
    sseConnectionCount++;
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    const listener = (event: { event: string; data: string }) => {
      reply.raw.write(`event: ${event.event}\n`);
      reply.raw.write(`data: ${event.data}\n\n`);
    };
    dependencies.runtime.events.on('event', listener);
    const heartbeat = setInterval(() => {
      reply.raw.write(': heartbeat\n\n');
    }, 30_000);
    reply.raw.on('close', () => {
      sseConnectionCount--;
      clearInterval(heartbeat);
      dependencies.runtime.events.off('event', listener);
    });
  });

  app.post('/v1/messages/ingest', async (request, reply) => {
    try {
      return dependencies.runtime.ingestMessage(request.body);
    } catch (error) {
      if (error instanceof MessageIngressError) {
        return reply.code(error.statusCode).send(error.response);
      }
      throw error;
    }
  });
  app.get('/v1/messages/:id', async (request, reply) => {
    const id = parseIdParam(request.params);
    const message = dependencies.runtime.getMessage(id);
    if (!message) return reply.code(404).send({ error: 'not_found' });
    return message;
  });

  app.get('/v1/usage/summary', async () => dependencies.runtime.getUsageSummary());
  app.get('/v1/security/audit', async () => ({
    findings: dependencies.runtime.getSecurityAuditFindings(),
  }));
  app.get('/v1/security/csrf-token', async (_request, reply) => {
    const authStore = getCachedAuthStore();
    const token = issueCsrfToken(authStore);
    reply.header(
      'set-cookie',
      `popeye_csrf=${token}; HttpOnly; SameSite=Strict; Path=/`,
    );
    return { token };
  });

  return app;
}
