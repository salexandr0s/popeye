import type { ServerResponse } from 'node:http';

import Fastify, { type FastifyInstance } from 'fastify';
import sensible from '@fastify/sensible';
import rateLimit from '@fastify/rate-limit';
import helmet from '@fastify/helmet';

import {
  MemoryImportInputSchema,
  AuthExchangeRequestSchema,
  AgentProfileRecordSchema,
  MemoryPromotionExecuteRequestSchema,
  MemoryPromotionProposalRequestSchema,
  PathIdParamSchema,
  ProjectRecordSchema,
  ProjectRegistrationInputSchema,
  RunReplySchema,
  RunStateSchema,
  TaskCreateInputSchema,
  TelegramDeliveryRecordSchema,
  TelegramDeliveryResolutionRecordSchema,
  TelegramDeliveryResolutionRequestSchema,
  TelegramDeliveryStateSchema,
  TelegramRelayCheckpointCommitRequestSchema,
  TelegramRelayCheckpointResponseSchema,
  TelegramReplyDeliveryMarkUncertainRequestSchema,
  TelegramReplyDeliveryMarkSentRequestSchema,
  TelegramReplyDeliveryStateUpdateRequestSchema,
  TelegramSendAttemptRecordSchema,
  WorkspaceRecordSchema,
  WorkspaceRegistrationInputSchema,
} from '@popeye/contracts';
import { z } from 'zod';
import {
  AUTH_COOKIE_NAME,
  InstructionPreviewContextError,
  MessageIngressError,
  RuntimeConflictError,
  RuntimeNotFoundError,
  issueCsrfToken,
  serializeAuthCookie,
  serializeCsrfCookie,
  validateBearerToken,
  validateCsrfToken,
  type PopeyeRuntimeService,
} from '@popeye/runtime-core';
import { nowIso, type SecurityAuditEvent } from '@popeye/contracts';

export interface ControlApiDependencies {
  runtime: PopeyeRuntimeService;
  cspNonce?: string;
  /** Paths exempt from bearer auth (e.g. nonce exchange). CSRF is also skipped for these. */
  authExemptPaths?: ReadonlySet<string>;
  validateAuthExchangeNonce?: (nonce: string) => 'accepted' | 'expired' | 'invalid';
  /** When true, emitted Set-Cookie headers include the Secure flag. */
  useSecureCookies?: boolean;
  /** Maximum concurrent SSE connections. Defaults to 10. */
  maxSseConnections?: number;
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

type RequestAuthContext =
  | { kind: 'bearer'; csrfToken: string }
  | { kind: 'browser_session'; sessionId: string; csrfToken: string };

declare module 'fastify' {
  interface FastifyRequest {
    popeyeAuthContext?: RequestAuthContext;
  }
}

function readCookieHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

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

const InstructionPreviewQueryParamsSchema = z.object({
  projectId: z.string().min(1).optional(),
});

const TelegramRelayCheckpointQueryParamsSchema = z.object({
  workspaceId: z.string().min(1),
});

function parseIdParam(params: unknown): string {
  return PathIdParamSchema.parse(params).id;
}

function readCookieValue(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) {
    return undefined;
  }
  for (const entry of cookieHeader.split(';')) {
    const trimmed = entry.trim();
    if (trimmed.length === 0) continue;
    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;
    if (trimmed.slice(0, separator).trim() !== name) continue;
    const value = trimmed.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return undefined;
}

function recordAuthExchangeAudit(
  runtime: PopeyeRuntimeService,
  request: { headers: Record<string, unknown>; ip: string | undefined },
  outcome: 'accepted' | 'expired' | 'invalid',
): void {
  const eventByOutcome: Record<typeof outcome, SecurityAuditEvent> = {
    accepted: {
      code: 'auth_exchange_succeeded',
      severity: 'info',
      message: 'Browser bootstrap nonce exchanged for auth cookie',
      component: 'control-api',
      timestamp: nowIso(),
      details: {
        remoteAddress: request.ip ?? '',
        userAgent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : '',
      },
    },
    expired: {
      code: 'auth_exchange_nonce_expired',
      severity: 'warn',
      message: 'Browser bootstrap nonce was expired during auth exchange',
      component: 'control-api',
      timestamp: nowIso(),
      details: {
        remoteAddress: request.ip ?? '',
        userAgent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : '',
      },
    },
    invalid: {
      code: 'auth_exchange_nonce_invalid',
      severity: 'warn',
      message: 'Browser bootstrap nonce was invalid during auth exchange',
      component: 'control-api',
      timestamp: nowIso(),
      details: {
        remoteAddress: request.ip ?? '',
        userAgent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : '',
      },
    },
  };
  runtime.recordSecurityAuditEvent(eventByOutcome[outcome]);
}

function recordBrowserSessionAudit(
  runtime: PopeyeRuntimeService,
  request: { headers: Record<string, unknown>; ip: string | undefined },
  outcome: 'expired' | 'invalid',
): void {
  const event: SecurityAuditEvent = outcome === 'expired'
    ? {
        code: 'browser_session_expired',
        severity: 'warn',
        message: 'Browser session expired',
        component: 'control-api',
        timestamp: nowIso(),
        details: {
          remoteAddress: request.ip ?? '',
          userAgent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : '',
        },
      }
    : {
        code: 'browser_session_invalid',
        severity: 'warn',
        message: 'Browser session was invalid',
        component: 'control-api',
        timestamp: nowIso(),
        details: {
          remoteAddress: request.ip ?? '',
          userAgent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : '',
        },
      };
  runtime.recordSecurityAuditEvent(event);
}

export async function createControlApi(
  dependencies: ControlApiDependencies,
): Promise<FastifyInstance> {
  const app = Fastify({
    bodyLimit: 1_048_576,
    logger: { level: 'info', redact: ['req.headers.authorization', 'req.headers.cookie'] },
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

  const authExemptPaths = dependencies.authExemptPaths ?? new Set<string>();

  app.addHook('preHandler', async (request, reply) => {
    const path = request.url.split('?')[0]!;
    if (!path.startsWith('/v1/')) {
      return undefined;
    }
    // Allow explicitly exempted paths (e.g. nonce exchange) to bypass bearer + CSRF
    if (authExemptPaths.has(path)) {
      return undefined;
    }

    const cookieHeader = readCookieHeader(request.headers.cookie);
    const authHeader = request.headers.authorization;
    if (authHeader !== undefined) {
      const authStore = dependencies.runtime.loadAuthStore();
      if (!validateBearerToken(authHeader, authStore)) {
        return reply.code(401).send({ error: 'unauthorized' });
      }
      request.popeyeAuthContext = {
        kind: 'bearer',
        csrfToken: issueCsrfToken(authStore),
      };
    } else {
      const sessionId = readCookieValue(cookieHeader, AUTH_COOKIE_NAME);
      if (!sessionId) {
        return reply.code(401).send({ error: 'unauthorized' });
      }
      const sessionResult = dependencies.runtime.validateBrowserSession(sessionId);
      if (sessionResult.status !== 'valid') {
        recordBrowserSessionAudit(dependencies.runtime, request, sessionResult.status);
        return reply.code(401).send({ error: 'unauthorized' });
      }
      request.popeyeAuthContext = {
        kind: 'browser_session',
        sessionId: sessionResult.session.id,
        csrfToken: sessionResult.session.csrfToken,
      };
    }

    if (MUTATING_METHODS.has(request.method)) {
      const csrfHeader = request.headers['x-popeye-csrf'];
      const csrf = Array.isArray(csrfHeader) ? csrfHeader[0] : csrfHeader;
      const authContext = request.popeyeAuthContext;
      const csrfValid = authContext?.kind === 'bearer'
        ? validateCsrfToken(csrf, dependencies.runtime.loadAuthStore())
        : csrf === authContext?.csrfToken;
      if (!csrfValid) {
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

  app.post('/v1/auth/exchange', async (request, reply) => {
    if (!dependencies.validateAuthExchangeNonce) {
      return reply.code(404).send({ error: 'not_found' });
    }
    const body = AuthExchangeRequestSchema.parse(request.body);
    const outcome = dependencies.validateAuthExchangeNonce(body.nonce);
    recordAuthExchangeAudit(dependencies.runtime, request, outcome);
    if (outcome !== 'accepted') {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    const session = dependencies.runtime.createBrowserSession();
    reply.header('set-cookie', serializeAuthCookie(session.id, dependencies.useSecureCookies));
    return { ok: true as const };
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
  app.get('/v1/jobs/:id', async (request, reply) => {
    const id = parseIdParam(request.params);
    const job = dependencies.runtime.getJob(id);
    if (!job) return reply.code(404).send({ error: 'not_found' });
    return job;
  });
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
  app.get('/v1/runs/:id/receipt', async (request, reply) => {
    const id = parseIdParam(request.params);
    const receipt = dependencies.runtime.getReceiptByRunId(id);
    if (!receipt) return reply.code(404).send({ error: 'not_found' });
    return receipt;
  });
  app.get('/v1/runs/:id/reply', async (request, reply) => {
    const id = parseIdParam(request.params);
    const run = dependencies.runtime.getRun(id);
    if (!run) return reply.code(404).send({ error: 'not_found' });
    const runReply = dependencies.runtime.getRunReply(id);
    if (!runReply) return reply.code(409).send({ error: 'run_not_terminal' });
    return RunReplySchema.parse(runReply);
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

  app.get('/v1/instruction-previews/:scope', async (request, reply) => {
    const params = request.params as { scope: string };
    const query = InstructionPreviewQueryParamsSchema.parse(request.query);
    try {
      return dependencies.runtime.getInstructionPreview(params.scope, query.projectId);
    } catch (error) {
      if (error instanceof InstructionPreviewContextError) {
        const statusCode = error.errorCode === 'invalid_context' ? 400 : 404;
        return reply.code(statusCode).send({ error: error.errorCode });
      }
      throw error;
    }
  });
  app.get('/v1/interventions', async () => dependencies.runtime.listInterventions());
  app.post('/v1/interventions/:id/resolve', async (request) => {
    const body = z.object({ resolutionNote: z.string().max(2000).optional() }).default({}).parse(request.body ?? {});
    return dependencies.runtime.resolveIntervention(parseIdParam(request.params), body.resolutionNote);
  });

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

  app.post('/v1/memory/import', async (request) => {
    const input = MemoryImportInputSchema.parse(request.body);
    return dependencies.runtime.importMemory(input);
  });

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

  const MAX_SSE_CONNECTIONS = dependencies.maxSseConnections ?? 10;
  const sseConnections = new Set<ServerResponse>();
  app.get('/v1/events/stream', (_request, reply) => {
    if (sseConnections.size >= MAX_SSE_CONNECTIONS) {
      void reply.code(429).send({ error: 'too_many_sse_connections' });
      return;
    }
    sseConnections.add(reply.raw);
    reply.hijack();
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
      sseConnections.delete(reply.raw);
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
  app.get('/v1/telegram/relay/checkpoint', async (request) => {
    const query = TelegramRelayCheckpointQueryParamsSchema.parse(request.query);
    return TelegramRelayCheckpointResponseSchema.parse(dependencies.runtime.getTelegramRelayCheckpoint(query.workspaceId));
  });
  app.post('/v1/telegram/relay/checkpoint', async (request, reply) => {
    try {
      return dependencies.runtime.commitTelegramRelayCheckpoint(
        TelegramRelayCheckpointCommitRequestSchema.parse(request.body),
      );
    } catch (error) {
      if (error instanceof Error && error.name === 'RuntimeNotFoundError') {
        return reply.code(404).send({ error: 'not_found' });
      }
      throw error;
    }
  });
  app.post('/v1/telegram/replies/:chatId/:telegramMessageId/mark-sent', async (request, reply) => {
    const params = z.object({
      chatId: z.string().min(1),
      telegramMessageId: z.coerce.number().int().nonnegative(),
    }).parse(request.params);
    const body = TelegramReplyDeliveryMarkSentRequestSchema.parse(request.body);
    const delivery = dependencies.runtime.markTelegramReplySent(params.chatId, params.telegramMessageId, {
      workspaceId: body.workspaceId,
      ...(body.runId === undefined ? {} : { runId: body.runId }),
      ...(body.sentTelegramMessageId === undefined ? {} : { sentTelegramMessageId: body.sentTelegramMessageId }),
    });
    if (!delivery) return reply.code(404).send({ error: 'not_found' });
    return TelegramDeliveryStateSchema.parse(delivery);
  });
  app.post('/v1/telegram/replies/:chatId/:telegramMessageId/mark-sending', async (request, reply) => {
    const params = z.object({
      chatId: z.string().min(1),
      telegramMessageId: z.coerce.number().int().nonnegative(),
    }).parse(request.params);
    const body = TelegramReplyDeliveryStateUpdateRequestSchema.parse(request.body);
    const delivery = dependencies.runtime.markTelegramReplySending(params.chatId, params.telegramMessageId, {
      workspaceId: body.workspaceId,
      ...(body.runId === undefined ? {} : { runId: body.runId }),
    });
    if (!delivery) return reply.code(404).send({ error: 'not_found' });
    return TelegramDeliveryStateSchema.parse(delivery);
  });
  app.post('/v1/telegram/replies/:chatId/:telegramMessageId/mark-pending', async (request, reply) => {
    const params = z.object({
      chatId: z.string().min(1),
      telegramMessageId: z.coerce.number().int().nonnegative(),
    }).parse(request.params);
    const body = TelegramReplyDeliveryStateUpdateRequestSchema.parse(request.body);
    const delivery = dependencies.runtime.markTelegramReplyPending(params.chatId, params.telegramMessageId, {
      workspaceId: body.workspaceId,
      ...(body.runId === undefined ? {} : { runId: body.runId }),
    });
    if (!delivery) return reply.code(404).send({ error: 'not_found' });
    return TelegramDeliveryStateSchema.parse(delivery);
  });
  app.post('/v1/telegram/replies/:chatId/:telegramMessageId/mark-uncertain', async (request, reply) => {
    const params = z.object({
      chatId: z.string().min(1),
      telegramMessageId: z.coerce.number().int().nonnegative(),
    }).parse(request.params);
    const body = TelegramReplyDeliveryMarkUncertainRequestSchema.parse(request.body);
    const delivery = dependencies.runtime.markTelegramReplyUncertain(params.chatId, params.telegramMessageId, {
      workspaceId: body.workspaceId,
      ...(body.runId === undefined ? {} : { runId: body.runId }),
      ...(body.reason === undefined ? {} : { reason: body.reason }),
    });
    if (!delivery) return reply.code(404).send({ error: 'not_found' });
    return TelegramDeliveryStateSchema.parse(delivery);
  });

  // --- Telegram delivery resolution & send-attempt routes ---

  const TelegramDeliveryListQuerySchema = z.object({
    workspaceId: z.string().min(1).optional(),
  });

  app.get('/v1/telegram/deliveries/uncertain', async (request) => {
    const query = TelegramDeliveryListQuerySchema.parse(request.query);
    return z.array(TelegramDeliveryRecordSchema).parse(
      dependencies.runtime.listUncertainDeliveries(query.workspaceId),
    );
  });

  app.get('/v1/telegram/deliveries/:id', async (request, reply) => {
    const id = parseIdParam(request.params);
    const delivery = dependencies.runtime.getDeliveryById(id);
    if (!delivery) return reply.code(404).send({ error: 'not_found' });
    return TelegramDeliveryRecordSchema.parse(delivery);
  });

  app.post('/v1/telegram/deliveries/:id/resolve', async (request, reply) => {
    const id = parseIdParam(request.params);
    const body = TelegramDeliveryResolutionRequestSchema.parse(request.body);
    try {
      return TelegramDeliveryResolutionRecordSchema.parse(
        dependencies.runtime.resolveTelegramDelivery(id, body),
      );
    } catch (error) {
      if (error instanceof RuntimeNotFoundError) {
        return reply.code(404).send({ error: 'not_found' });
      }
      if (error instanceof RuntimeConflictError) {
        return reply.code(409).send({ error: 'conflict', message: error.message });
      }
      throw error;
    }
  });

  app.get('/v1/telegram/deliveries/:id/resolutions', async (request) => {
    const id = parseIdParam(request.params);
    return z.array(TelegramDeliveryResolutionRecordSchema).parse(
      dependencies.runtime.listDeliveryResolutions(id),
    );
  });

  app.get('/v1/telegram/deliveries/:id/attempts', async (request) => {
    const id = parseIdParam(request.params);
    return z.array(TelegramSendAttemptRecordSchema).parse(
      dependencies.runtime.listTelegramSendAttempts(id),
    );
  });

  app.post('/v1/telegram/send-attempts', async (request, reply) => {
    const body = z.object({
      deliveryId: z.string().min(1).optional(),
      chatId: z.string().min(1).optional(),
      telegramMessageId: z.number().int().optional(),
      workspaceId: z.string().min(1),
      startedAt: z.string().min(1),
      finishedAt: z.string().optional(),
      runId: z.string().optional(),
      contentHash: z.string().min(1),
      outcome: z.enum(['sent', 'retryable_failure', 'permanent_failure', 'ambiguous']),
      sentTelegramMessageId: z.number().int().optional(),
      errorSummary: z.string().max(500).optional(),
      source: z.string().optional(),
    }).parse(request.body);
    try {
      return TelegramSendAttemptRecordSchema.parse(
        dependencies.runtime.recordTelegramSendAttempt(body),
      );
    } catch (error) {
      if (error instanceof RuntimeNotFoundError) {
        return reply.code(404).send({ error: 'not_found' });
      }
      throw error;
    }
  });

  app.get('/v1/usage/summary', async () => dependencies.runtime.getUsageSummary());
  app.get('/v1/security/audit', async () => ({
    findings: dependencies.runtime.getSecurityAuditFindings(),
  }));
  app.get('/v1/security/csrf-token', async (_request, reply) => {
    const authContext = _request.popeyeAuthContext;
    const token = authContext?.csrfToken;
    if (!token) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    reply.header('set-cookie', serializeCsrfCookie(token, dependencies.useSecureCookies));
    return { token };
  });

  return app;
}
