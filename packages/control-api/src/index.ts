import type { ServerResponse } from 'node:http';

import Fastify, { type FastifyInstance } from 'fastify';
import sensible from '@fastify/sensible';
import rateLimit from '@fastify/rate-limit';
import helmet from '@fastify/helmet';

import {
  ApprovalResolveInputSchema,
  ConnectionCreateInputSchema,
  ConnectionUpdateInputSchema,
  ContextReleasePreviewRequestSchema,
  EmailAccountRegistrationInputSchema,
  CalendarAccountRegistrationInputSchema,
  TodoAccountRegistrationInputSchema,
  DomainKindSchema,
  FileRootRegistrationInputSchema,
  FileRootUpdateInputSchema,
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
  TodoCreateInputSchema,
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
  RuntimeValidationError,
  issueCsrfToken,
  resolveBearerPrincipal,
  serializeAuthCookie,
  serializeCsrfCookie,
  validateCsrfToken,
  type PopeyeRuntimeService,
} from '@popeye/runtime-core';
import { nowIso, stripUndefined, type AuthRole, type AuthRotationRecord, type SecurityAuditEvent } from '@popeye/contracts';
import type { PopeyeLogger } from '@popeye/observability';

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
  /** Optional structured logger for security and operational events. */
  logger?: PopeyeLogger;
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

type RequestAuthContext =
  | { kind: 'bearer'; role: AuthRole; csrfToken: string; record: AuthRotationRecord }
  | { kind: 'browser_session'; role: 'operator'; sessionId: string; csrfToken: string };

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
  workspaceId: z.string().optional(),
  projectId: z.string().optional(),
  includeGlobal: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
  types: z.string().optional(),
  full: z.string().optional(),
});

const MemoryListQueryParamsSchema = z.object({
  type: z.string().optional(),
  scope: z.string().optional(),
  workspaceId: z.string().optional(),
  projectId: z.string().optional(),
  includeGlobal: z.enum(['true', 'false']).optional(),
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

const ROLE_RANK: Record<AuthRole, number> = {
  readonly: 0,
  service: 1,
  operator: 2,
};

function hasRequiredRole(actual: AuthRole, required: AuthRole): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}

function requiredRoleForRoute(path: string, method: string): AuthRole {
  if (path === '/v1/auth/exchange') {
    return 'operator';
  }

  const readonlyPaths = new Set([
    '/v1/health',
    '/v1/status',
    '/v1/engine/capabilities',
    '/v1/daemon/state',
    '/v1/daemon/scheduler',
    '/v1/sessions',
    '/v1/receipts',
    '/v1/interventions',
    '/v1/events/stream',
    '/v1/usage/summary',
    '/v1/security/csrf-token',
  ]);
  if (readonlyPaths.has(path)) {
    return 'readonly';
  }

  if (
    path.startsWith('/v1/tasks/')
    || path === '/v1/tasks'
    || path.startsWith('/v1/jobs/')
    || path === '/v1/jobs'
    || path.startsWith('/v1/runs/')
    || path === '/v1/runs'
    || path.startsWith('/v1/receipts/')
    || path.startsWith('/v1/instruction-previews/')
    || path.startsWith('/v1/interventions/')
    || path.startsWith('/v1/messages/')
    || path.startsWith('/v1/telegram/relay/checkpoint')
    || path.startsWith('/v1/telegram/deliveries/')
    || path === '/v1/telegram/deliveries/uncertain'
  ) {
    if (method === 'GET' || method === 'HEAD') {
      return 'readonly';
    }
  }

  if (path === '/v1/memory' || path.startsWith('/v1/memory/')) {
    return 'operator';
  }

  const serviceMutations: Array<[string, RegExp]> = [
    ['POST', /^\/v1\/tasks$/],
    ['POST', /^\/v1\/jobs\/[^/]+\/pause$/],
    ['POST', /^\/v1\/jobs\/[^/]+\/resume$/],
    ['POST', /^\/v1\/jobs\/[^/]+\/enqueue$/],
    ['POST', /^\/v1\/runs\/[^/]+\/retry$/],
    ['POST', /^\/v1\/runs\/[^/]+\/cancel$/],
    ['POST', /^\/v1\/messages\/ingest$/],
    ['POST', /^\/v1\/telegram\/relay\/checkpoint$/],
    ['POST', /^\/v1\/telegram\/replies\/[^/]+\/[^/]+\/mark-sent$/],
    ['POST', /^\/v1\/telegram\/replies\/[^/]+\/[^/]+\/mark-sending$/],
    ['POST', /^\/v1\/telegram\/replies\/[^/]+\/[^/]+\/mark-pending$/],
    ['POST', /^\/v1\/telegram\/replies\/[^/]+\/[^/]+\/mark-uncertain$/],
    ['POST', /^\/v1\/telegram\/deliveries\/[^/]+\/resolve$/],
    ['POST', /^\/v1\/telegram\/send-attempts$/],
  ];
  if (serviceMutations.some(([candidateMethod, pattern]) => candidateMethod === method && pattern.test(path))) {
    return 'service';
  }

  return 'operator';
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

function recordAuthFailureAudit(
  runtime: PopeyeRuntimeService,
  request: { headers: Record<string, unknown>; ip: string | undefined },
  outcome: 'bearer_invalid' | 'cookie_missing' | 'role_forbidden',
  details?: Record<string, string>,
): void {
  const eventByOutcome: Record<typeof outcome, SecurityAuditEvent> = {
    bearer_invalid: {
      code: 'auth_bearer_invalid',
      severity: 'warn',
      message: 'Bearer token authentication failed',
      component: 'control-api',
      timestamp: nowIso(),
      details: {
        remoteAddress: request.ip ?? '',
        userAgent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : '',
      },
    },
    cookie_missing: {
      code: 'auth_browser_cookie_missing',
      severity: 'warn',
      message: 'Browser session cookie was missing',
      component: 'control-api',
      timestamp: nowIso(),
      details: {
        remoteAddress: request.ip ?? '',
        userAgent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : '',
      },
    },
    role_forbidden: {
      code: 'auth_role_forbidden',
      severity: 'warn',
      message: 'Authenticated principal lacked the required role for the requested route',
      component: 'control-api',
      timestamp: nowIso(),
      details: {
        remoteAddress: request.ip ?? '',
        userAgent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : '',
        ...(details ?? {}),
      },
    },
  };
  runtime.recordSecurityAuditEvent(eventByOutcome[outcome]);
}

function recordCsrfFailureAudit(
  runtime: PopeyeRuntimeService,
  request: { headers: Record<string, unknown>; ip: string | undefined },
  outcome: 'token_invalid' | 'cross_site_blocked',
): void {
  const eventByOutcome: Record<typeof outcome, SecurityAuditEvent> = {
    token_invalid: {
      code: 'csrf_token_invalid',
      severity: 'warn',
      message: 'CSRF token validation failed',
      component: 'control-api',
      timestamp: nowIso(),
      details: {
        remoteAddress: request.ip ?? '',
        userAgent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : '',
      },
    },
    cross_site_blocked: {
      code: 'csrf_cross_site_blocked',
      severity: 'warn',
      message: 'Cross-site request blocked by Sec-Fetch-Site policy',
      component: 'control-api',
      timestamp: nowIso(),
      details: {
        remoteAddress: request.ip ?? '',
        userAgent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : '',
        secFetchSite: typeof request.headers['sec-fetch-site'] === 'string' ? request.headers['sec-fetch-site'] : '',
      },
    },
  };
  runtime.recordSecurityAuditEvent(eventByOutcome[outcome]);
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
  const log = dependencies.logger ?? null;

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
      const authStore = dependencies.runtime.loadRoleAuthStore();
      const principal = resolveBearerPrincipal(authHeader, authStore);
      if (!principal) {
        log?.warn('bearer auth failed', { path, method: request.method });
        recordAuthFailureAudit(dependencies.runtime, request, 'bearer_invalid');
        return reply.code(401).send({ error: 'unauthorized' });
      }
      request.popeyeAuthContext = {
        kind: 'bearer',
        role: principal.role,
        record: principal.record,
        csrfToken: issueCsrfToken(principal.record),
      };
    } else {
      const sessionId = readCookieValue(cookieHeader, AUTH_COOKIE_NAME);
      if (!sessionId) {
        log?.warn('browser session missing', { path });
        recordAuthFailureAudit(dependencies.runtime, request, 'cookie_missing');
        return reply.code(401).send({ error: 'unauthorized' });
      }
      const sessionResult = dependencies.runtime.validateBrowserSession(sessionId);
      if (sessionResult.status !== 'valid') {
        log?.warn('browser session rejected', { path, status: sessionResult.status });
        recordBrowserSessionAudit(dependencies.runtime, request, sessionResult.status);
        return reply.code(401).send({ error: 'unauthorized' });
      }
      request.popeyeAuthContext = {
        kind: 'browser_session',
        role: 'operator',
        sessionId: sessionResult.session.id,
        csrfToken: sessionResult.session.csrfToken,
      };
    }

    const requiredRole = requiredRoleForRoute(path, request.method);
    const actualRole = request.popeyeAuthContext.role;
    if (!hasRequiredRole(actualRole, requiredRole)) {
      log?.warn('role authorization failed', { path, method: request.method, actualRole, requiredRole });
      recordAuthFailureAudit(dependencies.runtime, request, 'role_forbidden', {
        path,
        method: request.method,
        actualRole,
        requiredRole,
      });
      return reply.code(403).send({ error: 'forbidden' });
    }

    if (MUTATING_METHODS.has(request.method)) {
      const csrfHeader = request.headers['x-popeye-csrf'];
      const csrf = Array.isArray(csrfHeader) ? csrfHeader[0] : csrfHeader;
      const authContext = request.popeyeAuthContext;
      const csrfValid = authContext?.kind === 'bearer'
        ? validateCsrfToken(csrf, authContext.record)
        : csrf === authContext?.csrfToken;
      if (!csrfValid) {
        log?.warn('csrf validation failed', { path, method: request.method });
        recordCsrfFailureAudit(dependencies.runtime, request, 'token_invalid');
        return reply.code(403).send({ error: 'csrf_invalid' });
      }
      const secFetchSite = request.headers['sec-fetch-site'];
      if (authContext?.kind === 'browser_session') {
        // Browser sessions always come from browsers that send Sec-Fetch-Site.
        // Require it and validate it for defense-in-depth.
        if (typeof secFetchSite !== 'string' || !['same-origin', 'none'].includes(secFetchSite)) {
          log?.warn('browser session missing or invalid sec-fetch-site', { path, secFetchSite });
          recordCsrfFailureAudit(dependencies.runtime, request, 'cross_site_blocked');
          return reply.code(403).send({ error: 'csrf_sec_fetch_required' });
        }
      } else {
        // Bearer auth: Sec-Fetch-Site is optional (CLI, scripts don't send it),
        // but if present it must be same-origin or none.
        if (
          typeof secFetchSite === 'string' &&
          !['same-origin', 'none'].includes(secFetchSite)
        ) {
          log?.warn('cross-site request blocked', { path, secFetchSite });
          recordCsrfFailureAudit(dependencies.runtime, request, 'cross_site_blocked');
          return reply.code(403).send({ error: 'csrf_cross_site_blocked' });
        }
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
  app.get('/v1/engine/capabilities', async () => dependencies.runtime.getEngineCapabilities());
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
  app.get('/v1/profiles', async () =>
    z.array(AgentProfileRecordSchema).parse(dependencies.runtime.listAgentProfiles()),
  );
  app.get('/v1/profiles/:id', async (request, reply) => {
    const id = parseIdParam(request.params);
    const profile = dependencies.runtime.getAgentProfile(id);
    if (!profile) return reply.code(404).send({ error: 'not_found' });
    return AgentProfileRecordSchema.parse(profile);
  });

  app.get('/v1/tasks', async () => dependencies.runtime.listTasks());
  app.get('/v1/tasks/:id', async (request, reply) => {
    const id = parseIdParam(request.params);
    const task = dependencies.runtime.getTask(id);
    if (!task) return reply.code(404).send({ error: 'not_found' });
    return task;
  });
  app.post('/v1/tasks', async (request, reply) => {
    const input = TaskCreateInputSchema.parse(request.body);
    try {
      return dependencies.runtime.createTask(input);
    } catch (error) {
      if (error instanceof RuntimeValidationError) {
        return reply.code(400).send({ error: 'invalid_profile', details: error.message });
      }
      throw error;
    }
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
  app.get('/v1/runs/:id/envelope', async (request, reply) => {
    const id = parseIdParam(request.params);
    const envelope = dependencies.runtime.getExecutionEnvelope(id);
    if (!envelope) return reply.code(404).send({ error: 'not_found' });
    return envelope;
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

  const ScopeParamSchema = z.object({ scope: z.string().min(1).max(100) });

  app.get('/v1/instruction-previews/:scope', async (request, reply) => {
    const { scope } = ScopeParamSchema.parse(request.params);
    const query = InstructionPreviewQueryParamsSchema.parse(request.query);
    try {
      return dependencies.runtime.getInstructionPreview(scope, query.projectId);
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
      workspaceId: params.workspaceId,
      projectId: params.projectId,
      ...(params.includeGlobal !== undefined && { includeGlobal: params.includeGlobal === 'true' }),
      memoryTypes: params.types ? (params.types.split(',') as Array<'episodic' | 'semantic' | 'procedural'>) : undefined,
      limit: params.limit ?? 20,
      includeContent: params.full === 'true',
    });
  });

  app.get('/v1/memory/audit', async () => dependencies.runtime.getMemoryAudit());

  app.get('/v1/memory/integrity', async (request) => {
    const params = z.object({ fix: z.enum(['true', 'false']).optional() }).parse(request.query);
    return dependencies.runtime.checkMemoryIntegrity({ fix: params.fix === 'true' });
  });

  app.get('/v1/memory/budget-fit', async (request) => {
    const params = z.object({
      q: z.string().max(1000),
      scope: z.string().optional(),
      workspaceId: z.string().optional(),
      projectId: z.string().optional(),
      includeGlobal: z.enum(['true', 'false']).optional(),
      maxTokens: z.coerce.number().int().positive().default(8000),
      limit: z.coerce.number().int().positive().max(100).optional(),
    }).parse(request.query);
    return dependencies.runtime.budgetFitMemory(stripUndefined({
      query: params.q,
      maxTokens: params.maxTokens,
      scope: params.scope,
      workspaceId: params.workspaceId,
      projectId: params.projectId,
      ...(params.includeGlobal !== undefined && { includeGlobal: params.includeGlobal === 'true' }),
      limit: params.limit,
    }));
  });

  app.get('/v1/memory/:id/describe', async (request, reply) => {
    const id = parseIdParam(request.params);
    const desc = dependencies.runtime.describeMemory(id);
    if (!desc) return reply.code(404).send({ error: 'not_found' });
    return desc;
  });

  app.get('/v1/memory/:id/expand', async (request, reply) => {
    const id = parseIdParam(request.params);
    const params = z.object({ maxTokens: z.coerce.number().int().positive().optional() }).parse(request.query);
    const expanded = dependencies.runtime.expandMemory(id, params.maxTokens);
    if (!expanded) return reply.code(404).send({ error: 'not_found' });
    return expanded;
  });

  app.get('/v1/memory/:id', async (request, reply) => {
    const id = parseIdParam(request.params);
    const memory = dependencies.runtime.getMemory(id);
    if (!memory) return reply.code(404).send({ error: 'not_found' });
    return memory;
  });

  app.get('/v1/memory', async (request) => {
    const params = MemoryListQueryParamsSchema.parse(request.query);
    return dependencies.runtime.listMemories(stripUndefined({
      type: params.type,
      scope: params.scope,
      workspaceId: params.workspaceId,
      projectId: params.projectId,
      ...(params.includeGlobal !== undefined && { includeGlobal: params.includeGlobal === 'true' }),
      limit: params.limit ?? 50,
    }));
  });

  app.post('/v1/memory/maintenance', async () => dependencies.runtime.triggerMemoryMaintenance());

  app.post('/v1/memory/import', async (request) => {
    const input = MemoryImportInputSchema.parse(request.body);
    return dependencies.runtime.importMemory(stripUndefined(input));
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
      log?.warn('sse connection limit reached', { current: sseConnections.size, max: MAX_SSE_CONNECTIONS });
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
        dependencies.runtime.recordTelegramSendAttempt(stripUndefined(body)),
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

  // --- Policy substrate routes ---

  app.get('/v1/approvals', async (request) => {
    const query = z.object({ scope: z.string().optional(), status: z.string().optional(), domain: z.string().optional() }).parse(request.query);
    return dependencies.runtime.listApprovals(stripUndefined(query));
  });

  app.post('/v1/approvals', async (request) => {
    const body = z.object({
      scope: z.string(),
      domain: DomainKindSchema,
      riskClass: z.string(),
      resourceType: z.string(),
      resourceId: z.string(),
      requestedBy: z.string(),
      payloadPreview: z.string().optional(),
      idempotencyKey: z.string().optional(),
      expiresAt: z.string().optional(),
    }).parse(request.body);
    return dependencies.runtime.requestApproval(stripUndefined(body));
  });

  app.get('/v1/approvals/:id', async (request, reply) => {
    const id = parseIdParam(request.params);
    const approval = dependencies.runtime.getApproval(id);
    if (!approval) return reply.code(404).send({ error: 'approval not found' });
    return approval;
  });

  app.post('/v1/approvals/:id/resolve', async (request, reply) => {
    const id = parseIdParam(request.params);
    const body = ApprovalResolveInputSchema.parse(request.body);
    try {
      return dependencies.runtime.resolveApproval(id, body);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('not found')) return reply.code(404).send({ error: msg });
      if (msg.includes('already resolved')) return reply.code(409).send({ error: msg });
      throw err;
    }
  });

  app.get('/v1/security/policy', async () => dependencies.runtime.getSecurityPolicy());

  app.get('/v1/connections', async (request) => {
    const query = z.object({ domain: z.string().optional() }).parse(request.query);
    return dependencies.runtime.listConnections(query.domain);
  });

  app.post('/v1/connections', async (request) => {
    const body = ConnectionCreateInputSchema.parse(request.body);
    return dependencies.runtime.createConnection(body);
  });

  app.patch('/v1/connections/:id', async (request, reply) => {
    const id = parseIdParam(request.params);
    const body = ConnectionUpdateInputSchema.parse(request.body);
    const result = dependencies.runtime.updateConnection(id, body);
    if (!result) return reply.code(404).send({ error: 'connection not found' });
    return result;
  });

  app.delete('/v1/connections/:id', async (request, reply) => {
    const id = parseIdParam(request.params);
    const deleted = dependencies.runtime.deleteConnection(id);
    if (!deleted) return reply.code(404).send({ error: 'connection not found' });
    return { ok: true };
  });

  app.post('/v1/context-release/preview', async (request) => {
    const body = ContextReleasePreviewRequestSchema.parse(request.body);
    return dependencies.runtime.previewContextRelease(body);
  });

  // --- Secret store routes ---

  app.post('/v1/secrets', async (request) => {
    const body = z.object({
      key: z.string().min(1),
      value: z.string().min(1),
      connectionId: z.string().optional(),
      description: z.string().optional(),
    }).parse(request.body);
    return dependencies.runtime.setSecret({
      key: body.key,
      value: body.value,
      ...(body.connectionId !== undefined ? { connectionId: body.connectionId } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
    });
  });

  // --- File roots routes ---

  app.get('/v1/files/roots', async (request) => {
    const query = z.object({ workspaceId: z.string().optional() }).parse(request.query);
    return dependencies.runtime.listFileRoots(query.workspaceId);
  });

  app.post('/v1/files/roots', async (request) => {
    const body = FileRootRegistrationInputSchema.parse(request.body);
    return dependencies.runtime.registerFileRoot(body);
  });

  app.get('/v1/files/roots/:id', async (request, reply) => {
    const id = parseIdParam(request.params);
    const root = dependencies.runtime.getFileRoot(id);
    if (!root) return reply.code(404).send({ error: 'file root not found' });
    return root;
  });

  app.patch('/v1/files/roots/:id', async (request, reply) => {
    const id = parseIdParam(request.params);
    const body = FileRootUpdateInputSchema.parse(request.body);
    const result = dependencies.runtime.updateFileRoot(id, body);
    if (!result) return reply.code(404).send({ error: 'file root not found' });
    return result;
  });

  app.delete('/v1/files/roots/:id', async (request, reply) => {
    const id = parseIdParam(request.params);
    const disabled = dependencies.runtime.disableFileRoot(id);
    if (!disabled) return reply.code(404).send({ error: 'file root not found' });
    return { ok: true };
  });

  app.get('/v1/files/search', async (request) => {
    const query = z.object({
      query: z.string().min(1).max(1000),
      rootId: z.string().optional(),
      workspaceId: z.string().optional(),
      limit: z.coerce.number().int().positive().max(100).optional(),
    }).parse(request.query);
    return dependencies.runtime.searchFiles({
      query: query.query,
      limit: query.limit ?? 10,
      includeContent: false,
      ...(query.rootId ? { rootId: query.rootId } : {}),
      ...(query.workspaceId ? { workspaceId: query.workspaceId } : {}),
    });
  });

  app.get('/v1/files/documents/:id', async (request, reply) => {
    const id = parseIdParam(request.params);
    const doc = dependencies.runtime.getFileDocument(id);
    if (!doc) return reply.code(404).send({ error: 'document not found' });
    return doc;
  });

  app.post('/v1/files/roots/:id/reindex', async (request, reply) => {
    const id = parseIdParam(request.params);
    const result = dependencies.runtime.reindexFileRoot(id);
    if (!result) return reply.code(404).send({ error: 'file root not found' });
    return result;
  });

  // --- Email routes ---

  app.get('/v1/email/accounts', async () => {
    return dependencies.runtime.listEmailAccounts();
  });

  app.get('/v1/email/threads', async (request) => {
    const query = z.object({
      accountId: z.string().optional(),
      limit: z.coerce.number().int().positive().max(100).optional(),
      unreadOnly: z.enum(['true', 'false']).optional(),
    }).parse(request.query);
    const accounts = dependencies.runtime.listEmailAccounts();
    if (accounts.length === 0) return [];
    const accountId = query.accountId ?? accounts[0]!.id;
    return dependencies.runtime.listEmailThreads(accountId, {
      limit: query.limit ?? 50,
      unreadOnly: query.unreadOnly === 'true',
    });
  });

  app.get('/v1/email/threads/:id', async (request, reply) => {
    const id = parseIdParam(request.params);
    const thread = dependencies.runtime.getEmailThread(id);
    if (!thread) return reply.code(404).send({ error: 'thread not found' });
    return thread;
  });

  app.get('/v1/email/messages/:id', async (request, reply) => {
    const id = parseIdParam(request.params);
    const message = dependencies.runtime.getEmailMessage(id);
    if (!message) return reply.code(404).send({ error: 'message not found' });
    return message;
  });

  app.get('/v1/email/digest', async (request) => {
    const query = z.object({ accountId: z.string().optional() }).parse(request.query);
    const accounts = dependencies.runtime.listEmailAccounts();
    if (accounts.length === 0) return null;
    const accountId = query.accountId ?? accounts[0]!.id;
    return dependencies.runtime.getEmailDigest(accountId);
  });

  app.get('/v1/email/search', async (request) => {
    const query = z.object({
      query: z.string().min(1).max(1000),
      accountId: z.string().optional(),
      limit: z.coerce.number().int().positive().max(100).optional(),
    }).parse(request.query);
    return dependencies.runtime.searchEmail({
      query: query.query,
      accountId: query.accountId,
      limit: query.limit ?? 20,
    });
  });

  app.post('/v1/email/accounts', async (request) => {
    const body = EmailAccountRegistrationInputSchema.parse(request.body);
    return dependencies.runtime.registerEmailAccount(body);
  });

  app.post('/v1/email/sync', async (request) => {
    const body = z.object({ accountId: z.string().min(1) }).parse(request.body);
    return dependencies.runtime.syncEmailAccount(body.accountId);
  });

  app.post('/v1/email/digest', async (request) => {
    const body = z.object({ accountId: z.string().optional() }).default({}).parse(request.body ?? {});
    return dependencies.runtime.triggerEmailDigest(body.accountId);
  });

  app.get('/v1/email/providers', async () => {
    const { detectAvailableProviders } = await import('@popeye/cap-email');
    return detectAvailableProviders();
  });

  // --- GitHub routes ---

  app.get('/v1/github/accounts', async () => {
    return dependencies.runtime.listGithubAccounts();
  });

  app.get('/v1/github/repos', async (request) => {
    const query = z.object({
      accountId: z.string().optional(),
      limit: z.coerce.number().int().positive().max(200).optional(),
    }).parse(request.query);
    const accounts = dependencies.runtime.listGithubAccounts();
    if (accounts.length === 0) return [];
    const accountId = query.accountId ?? accounts[0]!.id;
    return dependencies.runtime.listGithubRepos(accountId, { limit: query.limit });
  });

  app.get('/v1/github/prs', async (request) => {
    const query = z.object({
      accountId: z.string().optional(),
      state: z.string().optional(),
      limit: z.coerce.number().int().positive().max(100).optional(),
    }).parse(request.query);
    const accounts = dependencies.runtime.listGithubAccounts();
    if (accounts.length === 0) return [];
    const accountId = query.accountId ?? accounts[0]!.id;
    return dependencies.runtime.listGithubPullRequests(accountId, {
      state: query.state,
      limit: query.limit ?? 50,
    });
  });

  app.get('/v1/github/prs/:id', async (request, reply) => {
    const id = parseIdParam(request.params);
    const pr = dependencies.runtime.getGithubPullRequest(id);
    if (!pr) return reply.code(404).send({ error: 'pull request not found' });
    return pr;
  });

  app.get('/v1/github/issues', async (request) => {
    const query = z.object({
      accountId: z.string().optional(),
      state: z.string().optional(),
      assigned: z.enum(['true', 'false']).optional(),
      limit: z.coerce.number().int().positive().max(100).optional(),
    }).parse(request.query);
    const accounts = dependencies.runtime.listGithubAccounts();
    if (accounts.length === 0) return [];
    const accountId = query.accountId ?? accounts[0]!.id;
    return dependencies.runtime.listGithubIssues(accountId, {
      state: query.state,
      limit: query.limit ?? 50,
      assignedOnly: query.assigned === 'true',
    });
  });

  app.get('/v1/github/issues/:id', async (request, reply) => {
    const id = parseIdParam(request.params);
    const issue = dependencies.runtime.getGithubIssue(id);
    if (!issue) return reply.code(404).send({ error: 'issue not found' });
    return issue;
  });

  app.get('/v1/github/notifications', async (request) => {
    const query = z.object({
      accountId: z.string().optional(),
      limit: z.coerce.number().int().positive().max(100).optional(),
    }).parse(request.query);
    const accounts = dependencies.runtime.listGithubAccounts();
    if (accounts.length === 0) return [];
    const accountId = query.accountId ?? accounts[0]!.id;
    return dependencies.runtime.listGithubNotifications(accountId, {
      unreadOnly: true,
      limit: query.limit ?? 50,
    });
  });

  app.get('/v1/github/digest', async (request) => {
    const query = z.object({ accountId: z.string().optional() }).parse(request.query);
    const accounts = dependencies.runtime.listGithubAccounts();
    if (accounts.length === 0) return null;
    const accountId = query.accountId ?? accounts[0]!.id;
    return dependencies.runtime.getGithubDigest(accountId);
  });

  app.get('/v1/github/search', async (request) => {
    const query = z.object({
      query: z.string().min(1).max(1000),
      accountId: z.string().optional(),
      entityType: z.enum(['pr', 'issue', 'all']).optional(),
      limit: z.coerce.number().int().positive().max(100).optional(),
    }).parse(request.query);
    return dependencies.runtime.searchGithub({
      query: query.query,
      accountId: query.accountId,
      entityType: query.entityType,
      limit: query.limit ?? 20,
    });
  });

  // --- Calendar routes ---

  app.get('/v1/calendar/accounts', async () => {
    return dependencies.runtime.listCalendarAccounts();
  });

  app.get('/v1/calendar/events', async (request) => {
    const query = z.object({
      accountId: z.string().optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      limit: z.coerce.number().int().positive().max(200).optional(),
    }).parse(request.query);
    const accounts = dependencies.runtime.listCalendarAccounts();
    if (accounts.length === 0) return [];
    const accountId = query.accountId ?? accounts[0]!.id;
    return dependencies.runtime.listCalendarEvents(accountId, {
      limit: query.limit,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
    });
  });

  app.get('/v1/calendar/events/:id', async (request, reply) => {
    const id = parseIdParam(request.params);
    const event = dependencies.runtime.getCalendarEvent(id);
    if (!event) return reply.code(404).send({ error: 'calendar event not found' });
    return event;
  });

  app.get('/v1/calendar/search', async (request) => {
    const query = z.object({
      query: z.string().min(1).max(1000),
      accountId: z.string().optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      limit: z.coerce.number().int().positive().max(100).optional(),
    }).parse(request.query);
    return dependencies.runtime.searchCalendar({
      query: query.query,
      accountId: query.accountId,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
      limit: query.limit ?? 20,
    });
  });

  app.get('/v1/calendar/digest', async (request) => {
    const query = z.object({ accountId: z.string().optional() }).parse(request.query);
    const accounts = dependencies.runtime.listCalendarAccounts();
    if (accounts.length === 0) return null;
    const accountId = query.accountId ?? accounts[0]!.id;
    return dependencies.runtime.getCalendarDigest(accountId);
  });

  app.get('/v1/calendar/availability', async (request) => {
    const query = z.object({
      accountId: z.string().optional(),
      date: z.string().min(1),
      startHour: z.coerce.number().int().min(0).max(23).optional(),
      endHour: z.coerce.number().int().min(1).max(24).optional(),
      slotMinutes: z.coerce.number().int().positive().optional(),
    }).parse(request.query);
    const accounts = dependencies.runtime.listCalendarAccounts();
    if (accounts.length === 0) return [];
    const accountId = query.accountId ?? accounts[0]!.id;
    return dependencies.runtime.getCalendarAvailability(
      accountId,
      query.date,
      query.startHour ?? 9,
      query.endHour ?? 17,
      query.slotMinutes ?? 30,
    );
  });

  app.post('/v1/calendar/accounts', async (request) => {
    const body = CalendarAccountRegistrationInputSchema.parse(request.body);
    return dependencies.runtime.registerCalendarAccount(body);
  });

  app.post('/v1/calendar/sync', async (request) => {
    const body = z.object({ accountId: z.string().min(1) }).parse(request.body);
    return dependencies.runtime.syncCalendarAccount(body.accountId);
  });

  // --- Todos routes ---

  app.get('/v1/todos/accounts', async () => {
    return dependencies.runtime.listTodoAccounts();
  });

  app.get('/v1/todos/items', async (request) => {
    const query = z.object({
      accountId: z.string().optional(),
      status: z.string().optional(),
      priority: z.coerce.number().int().min(1).max(4).optional(),
      project: z.string().optional(),
      limit: z.coerce.number().int().positive().max(200).optional(),
    }).parse(request.query);
    const accounts = dependencies.runtime.listTodoAccounts();
    if (accounts.length === 0) return [];
    const accountId = query.accountId ?? accounts[0]!.id;
    return dependencies.runtime.listTodos(accountId, {
      status: query.status,
      priority: query.priority,
      projectName: query.project,
      limit: query.limit ?? 50,
    });
  });

  app.get('/v1/todos/items/:id', async (request, reply) => {
    const id = parseIdParam(request.params);
    const todo = dependencies.runtime.getTodo(id);
    if (!todo) return reply.code(404).send({ error: 'todo not found' });
    return todo;
  });

  app.get('/v1/todos/search', async (request) => {
    const query = z.object({
      query: z.string().min(1).max(1000),
      accountId: z.string().optional(),
      status: z.enum(['pending', 'completed', 'all']).optional(),
      limit: z.coerce.number().int().positive().max(100).optional(),
    }).parse(request.query);
    return dependencies.runtime.searchTodos({
      query: query.query,
      accountId: query.accountId,
      status: query.status,
      limit: query.limit ?? 20,
    });
  });

  app.get('/v1/todos/digest', async (request) => {
    const query = z.object({ accountId: z.string().optional() }).parse(request.query);
    const accounts = dependencies.runtime.listTodoAccounts();
    if (accounts.length === 0) return null;
    const accountId = query.accountId ?? accounts[0]!.id;
    return dependencies.runtime.getTodoDigest(accountId);
  });

  app.post('/v1/todos/items', async (request) => {
    const body = TodoCreateInputSchema.parse(request.body);
    return dependencies.runtime.createTodo(body);
  });

  app.post('/v1/todos/items/:id/complete', async (request, reply) => {
    const id = parseIdParam(request.params);
    const result = dependencies.runtime.completeTodo(id);
    if (!result) return reply.code(404).send({ error: 'todo not found' });
    return result;
  });

  app.post('/v1/todos/accounts', async (request) => {
    const body = TodoAccountRegistrationInputSchema.parse(request.body);
    return dependencies.runtime.registerTodoAccount(body);
  });

  app.post('/v1/todos/sync', async (request) => {
    const body = z.object({ accountId: z.string().min(1) }).parse(request.body);
    return dependencies.runtime.syncTodoAccount(body.accountId);
  });

  return app;
}
