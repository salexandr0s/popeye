import Fastify, { type FastifyInstance } from 'fastify';
import sensible from '@fastify/sensible';

import { TaskCreateInputSchema } from '@popeye/contracts';
import { MessageIngressError, issueCsrfToken, readAuthStore, validateBearerToken, validateCsrfToken, type PopeyeRuntimeService } from '@popeye/runtime-core';

export interface ControlApiDependencies {
  runtime: PopeyeRuntimeService;
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export async function createControlApi(dependencies: ControlApiDependencies): Promise<FastifyInstance> {
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
      if (typeof secFetchSite === 'string' && !['same-origin', 'none'].includes(secFetchSite)) {
        return reply.code(403).send({ error: 'csrf_cross_site_blocked' });
      }
    }
    return undefined;
  });

  app.get('/v1/health', async () => ({ ok: true, startedAt: dependencies.runtime.startedAt }));
  app.get('/v1/status', async () => dependencies.runtime.getStatus());
  app.get('/v1/daemon/state', async () => dependencies.runtime.getDaemonState());
  app.get('/v1/daemon/scheduler', async () => dependencies.runtime.getSchedulerStatus());
  app.get('/v1/workspaces', async () => dependencies.runtime.listWorkspaces());
  app.get('/v1/projects', async () => dependencies.runtime.listProjects());
  app.get('/v1/agent-profiles', async () => dependencies.runtime.listAgentProfiles());

  app.get('/v1/tasks', async () => dependencies.runtime.listTasks());
  app.post('/v1/tasks', async (request) => {
    const input = TaskCreateInputSchema.parse(request.body);
    return dependencies.runtime.createTask(input);
  });

  app.get('/v1/jobs', async () => dependencies.runtime.listJobs());
  app.get('/v1/jobs/:id/lease', async (request, reply) => {
    const lease = dependencies.runtime.getJobLease((request.params as { id: string }).id);
    if (!lease) return reply.code(404).send({ error: 'not_found' });
    return lease;
  });
  app.post('/v1/jobs/:id/pause', async (request) => dependencies.runtime.pauseJob((request.params as { id: string }).id));
  app.post('/v1/jobs/:id/resume', async (request) => dependencies.runtime.resumeJob((request.params as { id: string }).id));
  app.post('/v1/jobs/:id/enqueue', async (request) => dependencies.runtime.enqueueJob((request.params as { id: string }).id));

  app.get('/v1/runs', async () => dependencies.runtime.listRuns());
  app.get('/v1/runs/:id', async (request, reply) => {
    const run = dependencies.runtime.getRun((request.params as { id: string }).id);
    if (!run) return reply.code(404).send({ error: 'not_found' });
    return run;
  });
  app.get('/v1/runs/:id/events', async (request) => dependencies.runtime.listRunEvents((request.params as { id: string }).id));
  app.post('/v1/runs/:id/retry', async (request) => dependencies.runtime.retryRun((request.params as { id: string }).id));
  app.post('/v1/runs/:id/cancel', async (request) => dependencies.runtime.cancelRun((request.params as { id: string }).id));

  app.get('/v1/receipts/:id', async (request, reply) => {
    const receipt = dependencies.runtime.getReceipt((request.params as { id: string }).id);
    if (!receipt) return reply.code(404).send({ error: 'not_found' });
    return receipt;
  });

  app.get('/v1/instruction-previews/:scope', async (request) => dependencies.runtime.getInstructionPreview((request.params as { scope: string }).scope));
  app.get('/v1/interventions', async () => dependencies.runtime.listInterventions());
  app.post('/v1/interventions/:id/resolve', async (request) => dependencies.runtime.resolveIntervention((request.params as { id: string }).id));

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
    reply.raw.on('close', () => dependencies.runtime.events.off('event', listener));
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
    const message = dependencies.runtime.getMessage((request.params as { id: string }).id);
    if (!message) return reply.code(404).send({ error: 'not_found' });
    return message;
  });

  app.get('/v1/usage/summary', async () => dependencies.runtime.getUsageSummary());
  app.get('/v1/security/audit', async () => ({ findings: dependencies.runtime.getSecurityAuditFindings() }));
  app.get('/v1/security/csrf-token', async (_request, reply) => {
    const authStore = readAuthStore(dependencies.runtime.config.authFile);
    const token = issueCsrfToken(authStore);
    reply.header('set-cookie', `popeye_csrf=${token}; HttpOnly; SameSite=Strict; Path=/`);
    return { token };
  });

  return app;
}
