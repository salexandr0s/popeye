import Fastify, { type FastifyInstance } from 'fastify';
import sensible from '@fastify/sensible';

import {
  AgentProfileRecordSchema,
  PathIdParamSchema,
  ProjectRecordSchema,
  ProjectRegistrationInputSchema,
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
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function parseIdParam(params: unknown): string {
  return PathIdParamSchema.parse(params).id;
}

export async function createControlApi(
  dependencies: ControlApiDependencies,
): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(sensible);

  app.addHook('preHandler', async (request, reply) => {
    const authStore = readAuthStore(dependencies.runtime.config.authFile);
    if (!validateBearerToken(request.headers.authorization, authStore)) {
      return reply.code(401).send({ error: 'unauthorized' });
    }

    if (MUTATING_METHODS.has(request.method)) {
      const csrfHeader = request.headers['x-popeye-csrf'];
      const csrf = Array.isArray(csrfHeader) ? csrfHeader[0] : csrfHeader;
      if (!validateCsrfToken(csrf, authStore)) {
        return reply.code(403).send({ error: 'csrf_invalid' });
      }
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
  app.get('/v1/runs', async () => dependencies.runtime.listRuns());
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
    const params = request.query as { q?: string; query?: string; scope?: string; limit?: string; types?: string; full?: string };
    const queryText = params.q ?? params.query ?? '';
    if (!queryText) return { query: '', results: [], totalCandidates: 0, latencyMs: 0, searchMode: 'fts_only' };
    return dependencies.runtime.searchMemory({
      query: queryText,
      scope: params.scope,
      memoryTypes: params.types ? (params.types.split(',') as Array<'episodic' | 'semantic' | 'procedural'>) : undefined,
      limit: params.limit ? parseInt(params.limit, 10) : 20,
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
    const params = request.query as { type?: string; scope?: string; limit?: string };
    return dependencies.runtime.listMemories({
      type: params.type,
      scope: params.scope,
      limit: params.limit ? parseInt(params.limit, 10) : 50,
    });
  });

  app.post('/v1/memory/maintenance', async () => dependencies.runtime.triggerMemoryMaintenance());

  app.get('/v1/events/stream', async (_request, reply) => {
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
    reply.raw.on('close', () =>
      dependencies.runtime.events.off('event', listener),
    );
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
    const authStore = readAuthStore(dependencies.runtime.config.authFile);
    const token = issueCsrfToken(authStore);
    reply.header(
      'set-cookie',
      `popeye_csrf=${token}; HttpOnly; SameSite=Strict; Path=/`,
    );
    return { token };
  });

  return app;
}
