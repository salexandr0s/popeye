import type { ServerResponse } from 'node:http';

import Fastify, { type FastifyInstance } from 'fastify';
import sensible from '@fastify/sensible';
import rateLimit from '@fastify/rate-limit';
import helmet from '@fastify/helmet';

import {
  ApprovalRequestSchema,
  ApprovalResolveInputSchema,
  AutomationGrantCreateRequestSchema,
  ConnectionCreateInputSchema,
  ConnectionUpdateInputSchema,
  OAuthConnectStartRequestSchema,
  ContextReleasePreviewRequestSchema,
  EmailAccountRegistrationInputSchema,
  EmailDraftCreateInputSchema,
  EmailDraftUpdateInputSchema,
  CalendarAccountRegistrationInputSchema,
  CalendarEventCreateInputSchema,
  CalendarEventUpdateInputSchema,
  TodoAccountRegistrationInputSchema,
  TodoistConnectInputSchema,
  type DomainKind,
  FileRootRegistrationInputSchema,
  FileRootUpdateInputSchema,
  GithubCommentCreateInputSchema,
  GithubNotificationMarkReadInputSchema,
  MemoryImportInputSchema,
  RecallDetailParamsSchema,
  RecallSearchQueryParamsSchema,
  RecallSourceKindSchema,
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
  ConnectionResourceRuleCreateInputSchema,
  ConnectionResourceRuleDeleteInputSchema,
  ConnectionReconnectRequestSchema,
  FileWriteIntentCreateInputSchema,
  FileWriteIntentReviewInputSchema,
  PersonIdentityAttachInputSchema,
  PersonIdentityDetachInputSchema,
  PersonMergeInputSchema,
  PersonSplitInputSchema,
  PersonUpdateInputSchema,
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
  PolicyGrantRevokeRequestSchema,
  StandingApprovalCreateRequestSchema,
  VaultCreateRequestSchema,
  VaultOpenRequestSchema,
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
  constantTimeEquals,
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
  /** @deprecated Use generateCspNonce instead. Static nonce reused for all responses. */
  cspNonce?: string;
  /** Generate a fresh CSP nonce per request. Preferred over static cspNonce. */
  generateCspNonce?: () => string;
  validateAuthExchangeNonce?: (nonce: string) => 'accepted' | 'expired' | 'invalid';
  /** When true, emitted Set-Cookie headers include the Secure flag. */
  useSecureCookies?: boolean;
  /** Maximum concurrent SSE connections. Defaults to 10. */
  maxSseConnections?: number;
  /** Maximum API requests per minute per IP. Defaults to 600. */
  rateLimitMax?: number;
  /** Optional structured logger for security and operational events. */
  logger?: PopeyeLogger;
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const CSRF_EXEMPT_PATHS = new Set(['/v1/auth/exchange']);

type RequestAuthContext =
  | { kind: 'bearer'; role: AuthRole; csrfToken: string; record: AuthRotationRecord }
  | { kind: 'browser_session'; role: 'operator'; sessionId: string; csrfToken: string };

declare module 'fastify' {
  interface FastifyRequest {
    popeyeAuthContext?: RequestAuthContext;
    popeyeCspNonce?: string;
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
  domains: z.string().optional(),
  consumerProfile: z.enum(['assistant', 'coding']).optional(),
});

const MemoryListQueryParamsSchema = z.object({
  type: z.string().optional(),
  scope: z.string().optional(),
  workspaceId: z.string().optional(),
  projectId: z.string().optional(),
  includeGlobal: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
});

const MemoryLocationQueryParamsSchema = z.object({
  scope: z.string().optional(),
  workspaceId: z.string().optional(),
  projectId: z.string().optional(),
  includeGlobal: z.enum(['true', 'false']).optional(),
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

function parseMemoryLocationQuery(query: unknown): {
  workspaceId: string | null;
  projectId: string | null;
  includeGlobal?: boolean;
} {
  const parsed = MemoryLocationQueryParamsSchema.parse(query);
  let workspaceId = parsed.workspaceId ?? null;
  let projectId = parsed.projectId ?? null;
  if (parsed.scope && parsed.workspaceId === undefined && parsed.projectId === undefined) {
    const scope = parsed.scope.trim();
    if (scope === 'global' || scope.length === 0) {
      workspaceId = null;
      projectId = null;
    } else {
      const separator = scope.indexOf('/');
      if (separator === -1) {
        workspaceId = scope;
        projectId = null;
      } else {
        workspaceId = scope.slice(0, separator).trim() || null;
        projectId = scope.slice(separator + 1).trim() || null;
      }
    }
  }
  return stripUndefined({
    workspaceId,
    projectId,
    ...(parsed.includeGlobal !== undefined ? { includeGlobal: parsed.includeGlobal === 'true' } : {}),
  });
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

function renderOAuthCallbackPage(input: {
  status: 'success' | 'error';
  title: string;
  body: string;
}): string {
  const accent = input.status === 'success' ? '#0b7a4b' : '#b42318';
  const escapedTitle = escapeHtml(input.title);
  const escapedBody = escapeHtml(input.body);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapedTitle}</title>
    <style>
      body {
        margin: 0;
        font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #f5f7fb;
        color: #111827;
      }
      main {
        max-width: 560px;
        margin: 64px auto;
        padding: 32px;
        background: #ffffff;
        border: 1px solid #dbe3ef;
        border-radius: 18px;
        box-shadow: 0 24px 64px rgba(15, 23, 42, 0.08);
      }
      h1 {
        margin: 0 0 12px;
        color: ${accent};
        font-size: 28px;
      }
      p {
        margin: 0;
        line-height: 1.6;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapedTitle}</h1>
      <p>${escapedBody}</p>
    </main>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
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
    ['POST', /^\/v1\/finance\/imports$/],
    ['POST', /^\/v1\/finance\/transactions$/],
    ['POST', /^\/v1\/finance\/transactions\/batch$/],
    ['POST', /^\/v1\/finance\/imports\/[^/]+\/status$/],
    ['POST', /^\/v1\/medical\/imports$/],
    ['POST', /^\/v1\/medical\/appointments$/],
    ['POST', /^\/v1\/medical\/medications$/],
    ['POST', /^\/v1\/medical\/imports\/[^/]+\/status$/],
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
  await app.register(rateLimit, {
    max: dependencies.rateLimitMax ?? 600,
    timeWindow: '1 minute',
    allowList: (request) => !request.url.startsWith('/v1/'),
  });
  // POP-AUD-006: CSP nonce generated per request instead of reused across all responses.
  // Helmet handles all security headers except CSP, which we set manually per-request.
  const cspNonceGenerator = dependencies.generateCspNonce
    ?? (dependencies.cspNonce ? () => dependencies.cspNonce! : undefined);
  await app.register(helmet, { contentSecurityPolicy: false });

  if (cspNonceGenerator) {
    app.addHook('onRequest', async (request) => {
      request.popeyeCspNonce = cspNonceGenerator();
    });
    app.addHook('onSend', async (request, reply) => {
      const nonce = request.popeyeCspNonce;
      if (nonce) {
        reply.header(
          'content-security-policy',
          `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; connect-src 'self'`,
        );
      }
    });
  }

  const log = dependencies.logger ?? null;

  app.addHook('preHandler', async (request, reply) => {
    const path = request.url.split('?')[0]!;
    if (!path.startsWith('/v1/')) {
      return undefined;
    }
    // POP-AUD-003: OAuth callback bypasses auth by design — OAuth redirects carry
    // state in query params, not auth headers. Protected by: (1) OAuth state parameter
    // validation in the handler, (2) per-route rate limit (10 req/min), (3) loopback-only binding.
    if (path === '/v1/connections/oauth/callback') {
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

    if (MUTATING_METHODS.has(request.method) && !CSRF_EXEMPT_PATHS.has(path)) {
      const csrfHeader = request.headers['x-popeye-csrf'];
      const csrf = Array.isArray(csrfHeader) ? csrfHeader[0] : csrfHeader;
      const authContext = request.popeyeAuthContext;
      const csrfValid = authContext?.kind === 'bearer'
        ? validateCsrfToken(csrf, authContext.record)
        : (csrf !== undefined && authContext?.csrfToken !== undefined && constantTimeEquals(csrf, authContext.csrfToken));
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
    const authContext = request.popeyeAuthContext;
    if (!authContext || authContext.kind !== 'bearer' || authContext.role !== 'operator') {
      log?.warn('auth exchange requires operator bearer auth', { path: '/v1/auth/exchange' });
      recordAuthFailureAudit(dependencies.runtime, request, 'role_forbidden', {
        path: '/v1/auth/exchange',
        method: 'POST',
        actualRole: authContext?.role ?? 'none',
        requiredRole: 'operator_bearer',
      });
      return reply.code(403).send({ error: 'forbidden' });
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
    const body = z.object({ resolutionNote: z.string().max(2000).optional() }).parse(request.body ?? {});
    return dependencies.runtime.resolveIntervention(parseIdParam(request.params), body.resolutionNote);
  });

  app.get('/v1/memory/search', async (request) => {
    const params = MemorySearchQueryParamsSchema.parse(request.query);
    const queryText = params.q ?? params.query ?? '';
    if (!queryText) return { query: '', results: [], totalCandidates: 0, latencyMs: 0, searchMode: 'fts_only' };
    const consumerProfile = params.consumerProfile ?? (request.headers['x-consumer-profile'] as string | undefined);
    const searchInput: Parameters<typeof dependencies.runtime.searchMemory>[0] = {
      query: queryText,
      limit: params.limit ?? 20,
      includeContent: params.full === 'true',
    };
    if (params.scope !== undefined) searchInput.scope = params.scope;
    if (params.workspaceId !== undefined) searchInput.workspaceId = params.workspaceId;
    if (params.projectId !== undefined) searchInput.projectId = params.projectId;
    if (params.includeGlobal !== undefined) searchInput.includeGlobal = params.includeGlobal === 'true';
    if (params.types !== undefined) searchInput.memoryTypes = params.types.split(',') as Array<'episodic' | 'semantic' | 'procedural'>;
    if (params.domains !== undefined) searchInput.domains = params.domains.split(',') as typeof searchInput.domains;
    if (consumerProfile !== undefined) searchInput.consumerProfile = consumerProfile;
    return dependencies.runtime.searchMemory(searchInput);
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
      domains: z.string().optional(),
      consumerProfile: z.enum(['assistant', 'coding']).optional(),
    }).parse(request.query);
    const budgetConsumerProfile = params.consumerProfile ?? (request.headers['x-consumer-profile'] as string | undefined);
    return dependencies.runtime.budgetFitMemory(stripUndefined({
      query: params.q,
      maxTokens: params.maxTokens,
      scope: params.scope,
      workspaceId: params.workspaceId,
      projectId: params.projectId,
      ...(params.includeGlobal !== undefined && { includeGlobal: params.includeGlobal === 'true' }),
      ...(params.domains !== undefined && { domains: params.domains.split(',') }),
      ...(budgetConsumerProfile !== undefined && { consumerProfile: budgetConsumerProfile }),
      limit: params.limit,
    }));
  });

  app.get('/v1/memory/:id/describe', async (request, reply) => {
    const id = parseIdParam(request.params);
    const locationFilter = parseMemoryLocationQuery(request.query);
    const desc = dependencies.runtime.describeMemory(id, locationFilter);
    if (!desc) return reply.code(404).send({ error: 'not_found' });
    return desc;
  });

  app.get('/v1/memory/:id/expand', async (request, reply) => {
    const id = parseIdParam(request.params);
    const params = z.object({
      maxTokens: z.coerce.number().int().positive().optional(),
      scope: z.string().optional(),
      workspaceId: z.string().optional(),
      projectId: z.string().optional(),
      includeGlobal: z.enum(['true', 'false']).optional(),
    }).parse(request.query);
    const expanded = dependencies.runtime.expandMemory(id, params.maxTokens, parseMemoryLocationQuery(params));
    if (!expanded) return reply.code(404).send({ error: 'not_found' });
    return expanded;
  });

  app.get('/v1/memory/:id', async (request, reply) => {
    const id = parseIdParam(request.params);
    const locationFilter = parseMemoryLocationQuery(request.query);
    const memory = dependencies.runtime.getMemory(id, locationFilter);
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

  app.get('/v1/memory/context', async (request) => {
    const params = z.object({
      q: z.string().max(1000),
      scope: z.string().optional(),
      workspaceId: z.string().optional(),
      projectId: z.string().optional(),
      maxTokens: z.coerce.number().int().positive().max(32000).optional(),
      consumerProfile: z.string().optional(),
      includeProvenance: z.enum(['true', 'false']).optional(),
    }).parse(request.query);
    const ctxOpts: Parameters<typeof dependencies.runtime.assembleMemoryContext>[0] = {
      query: params.q,
    };
    if (params.scope !== undefined) ctxOpts.scope = params.scope;
    if (params.workspaceId !== undefined) ctxOpts.workspaceId = params.workspaceId;
    if (params.projectId !== undefined) ctxOpts.projectId = params.projectId;
    if (params.maxTokens !== undefined) ctxOpts.maxTokens = params.maxTokens;
    if (params.consumerProfile !== undefined) ctxOpts.consumerProfile = params.consumerProfile;
    if (params.includeProvenance !== undefined) ctxOpts.includeProvenance = params.includeProvenance === 'true';
    return dependencies.runtime.assembleMemoryContext(ctxOpts);
  });

  app.post('/v1/memory/:id/pin', async (request, reply) => {
    const id = parseIdParam(request.params);
    const body = z.object({
      targetKind: z.enum(['fact', 'synthesis']).default('fact'),
      reason: z.string().default(''),
    }).parse(request.body);
    const result = dependencies.runtime.pinMemory(id, body.targetKind, body.reason);
    if (!result) return reply.code(404).send({ error: 'not_found' });
    return result;
  });

  app.post('/v1/memory/:id/forget', async (request, reply) => {
    const id = parseIdParam(request.params);
    const body = z.object({ reason: z.string().default('') }).parse(request.body);
    const result = dependencies.runtime.forgetMemory(id, body.reason);
    if (!result) return reply.code(404).send({ error: 'not_found' });
    return result;
  });

  app.get('/v1/memory/:id/history', async (request, reply) => {
    const id = parseIdParam(request.params);
    const result = dependencies.runtime.getMemoryHistory(id);
    if (!result) return reply.code(404).send({ error: 'not_found' });
    return result;
  });

  app.post('/v1/memory/import', async (request) => {
    const input = MemoryImportInputSchema.parse(request.body);
    return dependencies.runtime.importMemory(stripUndefined(input));
  });

  app.post('/v1/memory/:id/promote/propose', async (request, reply) => {
    const id = parseIdParam(request.params);
    const body = MemoryPromotionProposalRequestSchema.parse(request.body);
    const locationFilter = parseMemoryLocationQuery(request.query);
    if (!dependencies.runtime.getMemory(id, locationFilter)) {
      return reply.code(404).send({ error: 'not_found' });
    }
    const result = dependencies.runtime.proposeMemoryPromotion(id, body.targetPath);
    if (!result.diff) return reply.code(404).send({ error: 'not_found' });
    return result;
  });

  app.post('/v1/memory/:id/promote/execute', async (request, reply) => {
    const id = parseIdParam(request.params);
    const body = MemoryPromotionExecuteRequestSchema.parse(request.body);
    const locationFilter = parseMemoryLocationQuery(request.query);
    if (!dependencies.runtime.getMemory(id, locationFilter)) {
      return reply.code(404).send({ error: 'not_found' });
    }
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

  // --- Analytics routes ---

  app.get('/v1/analytics/usage', async (request) => {
    const query = z.object({
      from: z.string().optional(),
      to: z.string().optional(),
      granularity: z.enum(['hourly', 'daily', 'weekly', 'monthly']).default('daily'),
      workspaceId: z.string().optional(),
    }).parse(request.query);
    return dependencies.runtime.getAnalyticsUsage(query);
  });

  app.get('/v1/analytics/models', async (request) => {
    const query = z.object({
      from: z.string().optional(),
      to: z.string().optional(),
      workspaceId: z.string().optional(),
    }).parse(request.query);
    return dependencies.runtime.getAnalyticsModels(query);
  });

  app.get('/v1/analytics/projects', async (request) => {
    const query = z.object({
      from: z.string().optional(),
      to: z.string().optional(),
    }).parse(request.query);
    return dependencies.runtime.getAnalyticsProjects(query);
  });

  // --- Unified recall routes ---

  app.get('/v1/recall/search', async (request) => {
    const parsed = RecallSearchQueryParamsSchema.parse(request.query);
    const rawQuery = parsed.query ?? parsed.q;
    if (!rawQuery) {
      return { query: '', results: [], totalMatches: 0 };
    }
    const parsedKinds = parsed.kinds !== undefined
      ? z.array(RecallSourceKindSchema).parse(
          parsed.kinds
            .split(',')
            .map((kind) => kind.trim())
            .filter(Boolean),
        )
      : undefined;
    return dependencies.runtime.searchRecall(stripUndefined({
      query: rawQuery,
      ...(parsed.workspaceId !== undefined ? { workspaceId: parsed.workspaceId } : {}),
      ...(parsed.projectId !== undefined ? { projectId: parsed.projectId } : {}),
      ...(parsed.includeGlobal !== undefined ? { includeGlobal: parsed.includeGlobal === 'true' } : {}),
      ...(parsedKinds !== undefined ? { kinds: parsedKinds } : {}),
      limit: parsed.limit ?? 20,
    }));
  });

  app.get('/v1/recall/:kind/:id', async (request, reply) => {
    const { kind, id } = RecallDetailParamsSchema.parse(request.params);
    const detail = dependencies.runtime.getRecallDetail(kind, id);
    if (!detail) return reply.code(404).send({ error: 'not_found' });
    return detail;
  });

  // --- Session search route ---

  app.get('/v1/sessions/search', async (request) => {
    const query = z.object({
      q: z.string().min(1),
      type: z.string().optional(),
      workspaceId: z.string().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
    }).parse(request.query);
    return dependencies.runtime.searchRunEvents(query);
  });

  // --- Trajectory route ---

  app.get('/v1/runs/:id/trajectory', async (request, reply) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const query = z.object({
      format: z.enum(['jsonl', 'sharegpt']).default('jsonl'),
      types: z.string().optional(),
    }).parse(request.query);
    const result = dependencies.runtime.getRunTrajectory(id, query);
    if (!result) return reply.code(404).send({ error: 'not_found' });
    return reply.type(result.contentType).send(result.body);
  });

  // --- Delegation routes ---

  app.get('/v1/runs/:id/delegates', async (request, reply) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const run = dependencies.runtime.getRun(id);
    if (!run) return reply.code(404).send({ error: 'not_found' });
    return dependencies.runtime.listDelegateRuns(id);
  });

  app.get('/v1/runs/:id/delegation-tree', async (request, reply) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const tree = dependencies.runtime.getDelegationTree(id);
    if (!tree) return reply.code(404).send({ error: 'not_found' });
    return tree;
  });

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
    const query = z.object({
      scope: z.string().optional(),
      status: z.string().optional(),
      domain: z.string().optional(),
      actionKind: z.string().optional(),
      runId: z.string().optional(),
      resolvedBy: z.string().optional(),
    }).parse(request.query);
    return dependencies.runtime.listApprovals(stripUndefined(query));
  });

  app.post('/v1/approvals', async (request) => {
    const body = ApprovalRequestSchema.parse(request.body);
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

  app.get('/v1/policies/standing-approvals', async (request) => {
    const query = z.object({
      status: z.string().optional(),
      domain: z.string().optional(),
      actionKind: z.string().optional(),
    }).parse(request.query);
    return dependencies.runtime.listStandingApprovals(stripUndefined(query));
  });

  app.post('/v1/policies/standing-approvals', async (request) => {
    const body = StandingApprovalCreateRequestSchema.parse(request.body);
    return dependencies.runtime.createStandingApproval(body);
  });

  app.post('/v1/policies/standing-approvals/:id/revoke', async (request, reply) => {
    const id = parseIdParam(request.params);
    const body = PolicyGrantRevokeRequestSchema.parse(request.body);
    try {
      return dependencies.runtime.revokeStandingApproval(id, body);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('not found')) return reply.code(404).send({ error: msg });
      throw err;
    }
  });

  app.get('/v1/policies/automation-grants', async (request) => {
    const query = z.object({
      status: z.string().optional(),
      domain: z.string().optional(),
      actionKind: z.string().optional(),
    }).parse(request.query);
    return dependencies.runtime.listAutomationGrants(stripUndefined(query));
  });

  app.post('/v1/policies/automation-grants', async (request) => {
    const body = AutomationGrantCreateRequestSchema.parse(request.body);
    return dependencies.runtime.createAutomationGrant(body);
  });

  app.post('/v1/policies/automation-grants/:id/revoke', async (request, reply) => {
    const id = parseIdParam(request.params);
    const body = PolicyGrantRevokeRequestSchema.parse(request.body);
    try {
      return dependencies.runtime.revokeAutomationGrant(id, body);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('not found')) return reply.code(404).send({ error: msg });
      throw err;
    }
  });

  app.get('/v1/security/policy', async () => dependencies.runtime.getSecurityPolicy());

  app.get('/v1/vaults', async (request) => {
    const query = z.object({ domain: z.string().optional() }).parse(request.query);
    return dependencies.runtime.listVaults(query.domain as DomainKind | undefined);
  });

  app.post('/v1/vaults', async (request) => {
    const body = VaultCreateRequestSchema.parse(request.body);
    const vaultInput: { domain: DomainKind; name: string; kind?: 'capability' | 'restricted' } = { domain: body.domain, name: body.name };
    if (body.kind) vaultInput.kind = body.kind;
    return dependencies.runtime.createVault(vaultInput);
  });

  app.get('/v1/vaults/:id', async (request, reply) => {
    const id = parseIdParam(request.params);
    const vault = dependencies.runtime.getVault(id);
    if (!vault) return reply.code(404).send({ error: 'vault not found' });
    return vault;
  });

  app.post('/v1/vaults/:id/open', async (request, reply) => {
    const id = parseIdParam(request.params);
    const body = VaultOpenRequestSchema.parse(request.body);
    const vault = dependencies.runtime.getVault(id);
    if (!vault) return reply.code(404).send({ error: 'vault not found' });
    const opened = dependencies.runtime.openVault(id, body.approvalId);
    if (!opened) return reply.code(403).send({ error: 'vault_open_denied' });
    return dependencies.runtime.getVault(id);
  });

  app.post('/v1/vaults/:id/close', async (request, reply) => {
    const id = parseIdParam(request.params);
    const closed = dependencies.runtime.closeVault(id);
    if (!closed) return reply.code(404).send({ error: 'vault not found' });
    return dependencies.runtime.getVault(id);
  });

  app.post('/v1/vaults/:id/seal', async (request, reply) => {
    const id = parseIdParam(request.params);
    const sealed = dependencies.runtime.sealVault(id);
    if (!sealed) return reply.code(404).send({ error: 'vault not found' });
    return dependencies.runtime.getVault(id);
  });

  app.get('/v1/connections', async (request) => {
    const query = z.object({ domain: z.string().optional() }).parse(request.query);
    return dependencies.runtime.listConnections(query.domain);
  });

  app.post('/v1/connections/oauth/start', async (request, reply) => {
    const body = OAuthConnectStartRequestSchema.parse(request.body);
    try {
      return dependencies.runtime.startOAuthConnectSession(body);
    } catch (error) {
      if (error instanceof RuntimeValidationError) {
        return reply.code(400).send({ error: 'invalid_oauth_connect_start', details: error.message });
      }
      if (error instanceof RuntimeNotFoundError) {
        return reply.code(404).send({ error: 'oauth_connection_not_found', details: error.message });
      }
      throw error;
    }
  });

  app.get('/v1/connections/oauth/sessions/:id', async (request, reply) => {
    const id = parseIdParam(request.params);
    const session = dependencies.runtime.getOAuthSession(id);
    if (!session) {
      return reply.code(404).send({ error: 'oauth_session_not_found' });
    }
    return session;
  });

  app.get('/v1/connections/oauth/callback', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const query = z.object({
      code: z.string().optional(),
      state: z.string().optional(),
      error: z.string().optional(),
      error_description: z.string().optional(),
    }).parse(request.query);

    try {
      const session = await dependencies.runtime.completeOAuthConnectCallback({
        code: query.code,
        state: query.state,
        error: query.error,
        errorDescription: query.error_description,
      });
      return reply
        .type('text/html; charset=utf-8')
        .send(renderOAuthCallbackPage({
          status: 'success',
          title: 'Connection Complete',
          body: `${session.providerKind} is now connected. You can return to Popeye.`,
        }));
    } catch (error) {
      const details = error instanceof Error ? error.message : 'OAuth callback failed';
      return reply
        .code(400)
        .type('text/html; charset=utf-8')
        .send(renderOAuthCallbackPage({
          status: 'error',
          title: 'Connection Failed',
          body: details,
        }));
    }
  });

  app.post('/v1/connections', async (request, reply) => {
    const body = ConnectionCreateInputSchema.parse(request.body);
    try {
      return dependencies.runtime.createConnection(body);
    } catch (error) {
      if (error instanceof RuntimeValidationError) {
        return reply.code(400).send({ error: 'invalid_connection', details: error.message });
      }
      throw error;
    }
  });

  app.patch('/v1/connections/:id', async (request, reply) => {
    const id = parseIdParam(request.params);
    const body = ConnectionUpdateInputSchema.parse(request.body);
    let result;
    try {
      result = dependencies.runtime.updateConnection(id, body);
    } catch (error) {
      if (error instanceof RuntimeValidationError) {
        return reply.code(400).send({ error: 'invalid_connection', details: error.message });
      }
      throw error;
    }
    if (!result) return reply.code(404).send({ error: 'connection not found' });
    return result;
  });

  app.delete('/v1/connections/:id', async (request, reply) => {
    const id = parseIdParam(request.params);
    const deleted = dependencies.runtime.deleteConnection(id);
    if (!deleted) return reply.code(404).send({ error: 'connection not found' });
    return { ok: true };
  });

  // --- Connection resource-rule routes ---

  app.get('/v1/connections/:id/resource-rules', async (request) => {
    const id = parseIdParam(request.params);
    return dependencies.runtime.listConnectionResourceRules(id);
  });

  app.post('/v1/connections/:id/resource-rules', async (request, reply) => {
    const id = parseIdParam(request.params);
    const body = ConnectionResourceRuleCreateInputSchema.parse(request.body);
    const result = dependencies.runtime.addConnectionResourceRule(id, body);
    if (!result) return reply.code(404).send({ error: 'connection not found' });
    return result;
  });

  app.delete('/v1/connections/:id/resource-rules', async (request, reply) => {
    const id = parseIdParam(request.params);
    const body = ConnectionResourceRuleDeleteInputSchema.parse(request.body);
    const result = dependencies.runtime.removeConnectionResourceRule(id, body.resourceType, body.resourceId);
    if (!result) return reply.code(404).send({ error: 'connection not found' });
    return result;
  });

  // --- Connection diagnostics & reconnect ---

  app.get('/v1/connections/:id/diagnostics', async (request, reply) => {
    const id = parseIdParam(request.params);
    const result = dependencies.runtime.getConnectionDiagnostics(id);
    if (!result) return reply.code(404).send({ error: 'connection not found' });
    return result;
  });

  app.post('/v1/connections/:id/reconnect', async (request, reply) => {
    const id = parseIdParam(request.params);
    const body = ConnectionReconnectRequestSchema.parse(request.body);
    const result = dependencies.runtime.reconnectConnection(id, body.action);
    if (!result) return reply.code(404).send({ error: 'connection not found' });
    return result;
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

  app.post('/v1/files/roots', async (request, reply) => {
    const body = FileRootRegistrationInputSchema.parse(request.body);
    try {
      return dependencies.runtime.registerFileRoot(body);
    } catch (error) {
      if (error instanceof RuntimeValidationError) {
        return reply.code(400).send({ error: 'invalid_file_root', details: error.message });
      }
      throw error;
    }
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

  app.get('/v1/files/search', async (request, reply) => {
    const query = z.object({
      query: z.string().min(1).max(1000),
      rootId: z.string().optional(),
      workspaceId: z.string().optional(),
      limit: z.coerce.number().int().positive().max(100).optional(),
    }).parse(request.query);
    try {
      return dependencies.runtime.searchFiles({
        query: query.query,
        limit: query.limit ?? 10,
        includeContent: false,
        ...(query.rootId ? { rootId: query.rootId } : {}),
        ...(query.workspaceId ? { workspaceId: query.workspaceId } : {}),
      });
    } catch (error) {
      if (error instanceof RuntimeValidationError) {
        return reply.code(400).send({ error: 'invalid_file_root', details: error.message });
      }
      throw error;
    }
  });

  app.get('/v1/files/documents/:id', async (request, reply) => {
    const id = parseIdParam(request.params);
    const doc = dependencies.runtime.getFileDocument(id);
    if (!doc) return reply.code(404).send({ error: 'document not found' });
    return doc;
  });

  app.post('/v1/files/roots/:id/reindex', async (request, reply) => {
    const id = parseIdParam(request.params);
    let result;
    try {
      result = dependencies.runtime.reindexFileRoot(id);
    } catch (error) {
      if (error instanceof RuntimeValidationError) {
        return reply.code(400).send({ error: 'invalid_file_root', details: error.message });
      }
      throw error;
    }
    if (!result) return reply.code(404).send({ error: 'file root not found' });
    return result;
  });

  // --- Email routes ---

  app.get('/v1/email/accounts', async () => {
    return dependencies.runtime.listEmailAccounts();
  });

  app.get('/v1/email/threads', async (request, reply) => {
    const query = z.object({
      accountId: z.string().optional(),
      limit: z.coerce.number().int().positive().max(100).optional(),
      unreadOnly: z.enum(['true', 'false']).optional(),
    }).parse(request.query);
    const accounts = dependencies.runtime.listEmailAccounts();
    if (accounts.length === 0) return [];
    const accountId = query.accountId ?? accounts[0]!.id;
    try {
      return dependencies.runtime.listEmailThreads(accountId, {
        limit: query.limit ?? 50,
        unreadOnly: query.unreadOnly === 'true',
      });
    } catch (error) {
      if (error instanceof RuntimeValidationError) {
        return reply.code(400).send({ error: 'invalid_email_account', details: error.message });
      }
      throw error;
    }
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

  app.get('/v1/email/digest', async (request, reply) => {
    const query = z.object({ accountId: z.string().optional() }).parse(request.query);
    const accounts = dependencies.runtime.listEmailAccounts();
    if (accounts.length === 0) return null;
    const accountId = query.accountId ?? accounts[0]!.id;
    try {
      return dependencies.runtime.getEmailDigest(accountId);
    } catch (error) {
      if (error instanceof RuntimeValidationError) {
        return reply.code(400).send({ error: 'invalid_email_account', details: error.message });
      }
      throw error;
    }
  });

  app.get('/v1/email/search', async (request, reply) => {
    const query = z.object({
      query: z.string().min(1).max(1000),
      accountId: z.string().optional(),
      limit: z.coerce.number().int().positive().max(100).optional(),
    }).parse(request.query);
    try {
      return dependencies.runtime.searchEmail({
        query: query.query,
        accountId: query.accountId,
        limit: query.limit ?? 20,
      });
    } catch (error) {
      if (error instanceof RuntimeValidationError) {
        return reply.code(400).send({ error: 'invalid_email_account', details: error.message });
      }
      throw error;
    }
  });

  app.post('/v1/email/accounts', async (request, reply) => {
    const body = EmailAccountRegistrationInputSchema.parse(request.body);
    try {
      return dependencies.runtime.registerEmailAccount(body);
    } catch (error) {
      if (error instanceof RuntimeValidationError) {
        return reply.code(400).send({ error: 'invalid_email_account', details: error.message });
      }
      throw error;
    }
  });

  app.post('/v1/email/sync', async (request, reply) => {
    const body = z.object({ accountId: z.string().min(1) }).parse(request.body);
    try {
      return dependencies.runtime.syncEmailAccount(body.accountId);
    } catch (error) {
      if (error instanceof RuntimeValidationError) {
        return reply.code(400).send({ error: 'invalid_email_sync', details: error.message });
      }
      throw error;
    }
  });

  app.post('/v1/email/digest', async (request, reply) => {
    const body = z.object({ accountId: z.string().optional() }).parse(request.body ?? {});
    try {
      return dependencies.runtime.triggerEmailDigest(body.accountId);
    } catch (error) {
      if (error instanceof RuntimeValidationError) {
        return reply.code(400).send({ error: 'invalid_email_digest', details: error.message });
      }
      throw error;
    }
  });

  app.get('/v1/email/providers', async () => {
    const { detectAvailableProviders } = await import('@popeye/cap-email');
    return detectAvailableProviders();
  });

  app.post('/v1/email/drafts', async (request, reply) => {
    const body = EmailDraftCreateInputSchema.parse(request.body);
    try {
      return await dependencies.runtime.createEmailDraft(body);
    } catch (error) {
      if (error instanceof RuntimeValidationError) {
        return reply.code(400).send({ error: 'invalid_email_draft', details: error.message });
      }
      if (error instanceof RuntimeConflictError) {
        return reply.code(409).send({ error: 'email_draft_requires_approval', details: error.message });
      }
      throw error;
    }
  });

  app.patch('/v1/email/drafts/:id', async (request, reply) => {
    const id = parseIdParam(request.params);
    const body = EmailDraftUpdateInputSchema.parse(request.body);
    try {
      return await dependencies.runtime.updateEmailDraft(id, body);
    } catch (error) {
      if (error instanceof RuntimeValidationError) {
        return reply.code(400).send({ error: 'invalid_email_draft_update', details: error.message });
      }
      if (error instanceof RuntimeConflictError) {
        return reply.code(409).send({ error: 'email_draft_requires_approval', details: error.message });
      }
      throw error;
    }
  });

  // --- GitHub routes ---

  app.get('/v1/github/accounts', async () => {
    return dependencies.runtime.listGithubAccounts();
  });

  app.get('/v1/github/repos', async (request, reply) => {
    const query = z.object({
      accountId: z.string().optional(),
      limit: z.coerce.number().int().positive().max(200).optional(),
    }).parse(request.query);
    const accounts = dependencies.runtime.listGithubAccounts();
    if (accounts.length === 0) return [];
    const accountId = query.accountId ?? accounts[0]!.id;
    try {
      return dependencies.runtime.listGithubRepos(accountId, { limit: query.limit });
    } catch (error) {
      if (error instanceof RuntimeValidationError) {
        return reply.code(400).send({ error: 'invalid_github_account', details: error.message });
      }
      throw error;
    }
  });

  app.get('/v1/github/prs', async (request, reply) => {
    const query = z.object({
      accountId: z.string().optional(),
      state: z.string().optional(),
      limit: z.coerce.number().int().positive().max(100).optional(),
    }).parse(request.query);
    const accounts = dependencies.runtime.listGithubAccounts();
    if (accounts.length === 0) return [];
    const accountId = query.accountId ?? accounts[0]!.id;
    try {
      return dependencies.runtime.listGithubPullRequests(accountId, {
        state: query.state,
        limit: query.limit ?? 50,
      });
    } catch (error) {
      if (error instanceof RuntimeValidationError) {
        return reply.code(400).send({ error: 'invalid_github_account', details: error.message });
      }
      throw error;
    }
  });

  app.get('/v1/github/prs/:id', async (request, reply) => {
    const id = parseIdParam(request.params);
    const pr = dependencies.runtime.getGithubPullRequest(id);
    if (!pr) return reply.code(404).send({ error: 'pull request not found' });
    return pr;
  });

  app.get('/v1/github/issues', async (request, reply) => {
    const query = z.object({
      accountId: z.string().optional(),
      state: z.string().optional(),
      assigned: z.enum(['true', 'false']).optional(),
      limit: z.coerce.number().int().positive().max(100).optional(),
    }).parse(request.query);
    const accounts = dependencies.runtime.listGithubAccounts();
    if (accounts.length === 0) return [];
    const accountId = query.accountId ?? accounts[0]!.id;
    try {
      return dependencies.runtime.listGithubIssues(accountId, {
        state: query.state,
        limit: query.limit ?? 50,
        assignedOnly: query.assigned === 'true',
      });
    } catch (error) {
      if (error instanceof RuntimeValidationError) {
        return reply.code(400).send({ error: 'invalid_github_account', details: error.message });
      }
      throw error;
    }
  });

  app.get('/v1/github/issues/:id', async (request, reply) => {
    const id = parseIdParam(request.params);
    const issue = dependencies.runtime.getGithubIssue(id);
    if (!issue) return reply.code(404).send({ error: 'issue not found' });
    return issue;
  });

  app.get('/v1/github/notifications', async (request, reply) => {
    const query = z.object({
      accountId: z.string().optional(),
      limit: z.coerce.number().int().positive().max(100).optional(),
    }).parse(request.query);
    const accounts = dependencies.runtime.listGithubAccounts();
    if (accounts.length === 0) return [];
    const accountId = query.accountId ?? accounts[0]!.id;
    try {
      return dependencies.runtime.listGithubNotifications(accountId, {
        unreadOnly: true,
        limit: query.limit ?? 50,
      });
    } catch (error) {
      if (error instanceof RuntimeValidationError) {
        return reply.code(400).send({ error: 'invalid_github_account', details: error.message });
      }
      throw error;
    }
  });

  app.get('/v1/github/digest', async (request, reply) => {
    const query = z.object({ accountId: z.string().optional() }).parse(request.query);
    const accounts = dependencies.runtime.listGithubAccounts();
    if (accounts.length === 0) return null;
    const accountId = query.accountId ?? accounts[0]!.id;
    try {
      return dependencies.runtime.getGithubDigest(accountId);
    } catch (error) {
      if (error instanceof RuntimeValidationError) {
        return reply.code(400).send({ error: 'invalid_github_account', details: error.message });
      }
      throw error;
    }
  });

  app.get('/v1/github/search', async (request, reply) => {
    const query = z.object({
      query: z.string().min(1).max(1000),
      accountId: z.string().optional(),
      entityType: z.enum(['pr', 'issue', 'all']).optional(),
      limit: z.coerce.number().int().positive().max(100).optional(),
    }).parse(request.query);
    try {
      return dependencies.runtime.searchGithub({
        query: query.query,
        accountId: query.accountId,
        entityType: query.entityType,
        limit: query.limit ?? 20,
      });
    } catch (error) {
      if (error instanceof RuntimeValidationError) {
        return reply.code(400).send({ error: 'invalid_github_account', details: error.message });
      }
      throw error;
    }
  });

  app.post('/v1/github/sync', async (request, reply) => {
    const body = z.object({ accountId: z.string().min(1) }).parse(request.body);
    try {
      return await dependencies.runtime.syncGithubAccount(body.accountId);
    } catch (error) {
      if (error instanceof RuntimeValidationError) {
        return reply.code(400).send({ error: 'invalid_github_sync', details: error.message });
      }
      throw error;
    }
  });

  app.post('/v1/github/comments', async (request, reply) => {
    const body = GithubCommentCreateInputSchema.parse(request.body);
    try {
      return await dependencies.runtime.createGithubComment(body);
    } catch (error) {
      if (error instanceof RuntimeValidationError) {
        return reply.code(400).send({ error: 'invalid_github_comment', details: error.message });
      }
      if (error instanceof RuntimeConflictError) {
        return reply.code(409).send({ error: 'github_comment_requires_approval', details: error.message });
      }
      throw error;
    }
  });

  app.post('/v1/github/notifications/mark-read', async (request, reply) => {
    const body = GithubNotificationMarkReadInputSchema.parse(request.body);
    try {
      return await dependencies.runtime.markGithubNotificationRead(body);
    } catch (error) {
      if (error instanceof RuntimeNotFoundError) {
        return reply.code(404).send({ error: 'github_notification_not_found', details: error.message });
      }
      if (error instanceof RuntimeValidationError) {
        return reply.code(400).send({ error: 'invalid_github_notification', details: error.message });
      }
      if (error instanceof RuntimeConflictError) {
        return reply.code(409).send({ error: 'github_notification_requires_approval', details: error.message });
      }
      throw error;
    }
  });

  // --- Calendar routes ---

  app.get('/v1/calendar/accounts', async () => {
    return dependencies.runtime.listCalendarAccounts();
  });

  app.get('/v1/calendar/events', async (request, reply) => {
    const query = z.object({
      accountId: z.string().optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      limit: z.coerce.number().int().positive().max(200).optional(),
    }).parse(request.query);
    const accounts = dependencies.runtime.listCalendarAccounts();
    if (accounts.length === 0) return [];
    const accountId = query.accountId ?? accounts[0]!.id;
    try {
      return dependencies.runtime.listCalendarEvents(accountId, {
        limit: query.limit,
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
      });
    } catch (error) {
      if (error instanceof RuntimeValidationError) {
        return reply.code(400).send({ error: 'invalid_calendar_account', details: error.message });
      }
      throw error;
    }
  });

  app.get('/v1/calendar/events/:id', async (request, reply) => {
    const id = parseIdParam(request.params);
    const event = dependencies.runtime.getCalendarEvent(id);
    if (!event) return reply.code(404).send({ error: 'calendar event not found' });
    return event;
  });

  app.get('/v1/calendar/search', async (request, reply) => {
    const query = z.object({
      query: z.string().min(1).max(1000),
      accountId: z.string().optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      limit: z.coerce.number().int().positive().max(100).optional(),
    }).parse(request.query);
    try {
      return dependencies.runtime.searchCalendar({
        query: query.query,
        accountId: query.accountId,
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
        limit: query.limit ?? 20,
      });
    } catch (error) {
      if (error instanceof RuntimeValidationError) {
        return reply.code(400).send({ error: 'invalid_calendar_account', details: error.message });
      }
      throw error;
    }
  });

  app.get('/v1/calendar/digest', async (request, reply) => {
    const query = z.object({ accountId: z.string().optional() }).parse(request.query);
    const accounts = dependencies.runtime.listCalendarAccounts();
    if (accounts.length === 0) return null;
    const accountId = query.accountId ?? accounts[0]!.id;
    try {
      return dependencies.runtime.getCalendarDigest(accountId);
    } catch (error) {
      if (error instanceof RuntimeValidationError) {
        return reply.code(400).send({ error: 'invalid_calendar_account', details: error.message });
      }
      throw error;
    }
  });

  app.get('/v1/calendar/availability', async (request, reply) => {
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
    try {
      return dependencies.runtime.getCalendarAvailability(
        accountId,
        query.date,
        query.startHour ?? 9,
        query.endHour ?? 17,
        query.slotMinutes ?? 30,
      );
    } catch (error) {
      if (error instanceof RuntimeValidationError) {
        return reply.code(400).send({ error: 'invalid_calendar_account', details: error.message });
      }
      throw error;
    }
  });

  app.post('/v1/calendar/accounts', async (request, reply) => {
    const body = CalendarAccountRegistrationInputSchema.parse(request.body);
    try {
      return dependencies.runtime.registerCalendarAccount(body);
    } catch (error) {
      if (error instanceof RuntimeValidationError) {
        return reply.code(400).send({ error: 'invalid_calendar_account', details: error.message });
      }
      throw error;
    }
  });

  app.post('/v1/calendar/sync', async (request, reply) => {
    const body = z.object({ accountId: z.string().min(1) }).parse(request.body);
    try {
      return dependencies.runtime.syncCalendarAccount(body.accountId);
    } catch (error) {
      if (error instanceof RuntimeValidationError) {
        return reply.code(400).send({ error: 'invalid_calendar_sync', details: error.message });
      }
      throw error;
    }
  });

  app.post('/v1/calendar/events', async (request, reply) => {
    const body = CalendarEventCreateInputSchema.parse(request.body);
    try {
      return await dependencies.runtime.createCalendarEvent(body);
    } catch (error) {
      if (error instanceof RuntimeValidationError) {
        return reply.code(400).send({ error: 'invalid_calendar_event', details: error.message });
      }
      if (error instanceof RuntimeConflictError) {
        return reply.code(409).send({ error: 'calendar_event_requires_approval', details: error.message });
      }
      throw error;
    }
  });

  app.patch('/v1/calendar/events/:id', async (request, reply) => {
    const id = parseIdParam(request.params);
    const body = CalendarEventUpdateInputSchema.parse(request.body);
    try {
      return await dependencies.runtime.updateCalendarEvent(id, body);
    } catch (error) {
      if (error instanceof RuntimeNotFoundError) {
        return reply.code(404).send({ error: 'calendar_event_not_found', details: error.message });
      }
      if (error instanceof RuntimeValidationError) {
        return reply.code(400).send({ error: 'invalid_calendar_event_update', details: error.message });
      }
      if (error instanceof RuntimeConflictError) {
        return reply.code(409).send({ error: 'calendar_event_requires_approval', details: error.message });
      }
      throw error;
    }
  });

  // --- Todos routes ---

  app.get('/v1/todos/accounts', async () => {
    return dependencies.runtime.listTodoAccounts();
  });

  app.get('/v1/todos/items', async (request, reply) => {
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
    try {
      return dependencies.runtime.listTodos(accountId, {
        status: query.status,
        priority: query.priority,
        projectName: query.project,
        limit: query.limit ?? 50,
      });
    } catch (error) {
      if (error instanceof RuntimeValidationError) {
        return reply.code(400).send({ error: 'invalid_todo_account', details: error.message });
      }
      throw error;
    }
  });

  app.get('/v1/todos/items/:id', async (request, reply) => {
    const id = parseIdParam(request.params);
    const todo = dependencies.runtime.getTodo(id);
    if (!todo) return reply.code(404).send({ error: 'todo not found' });
    return todo;
  });

  app.get('/v1/todos/search', async (request, reply) => {
    const query = z.object({
      query: z.string().min(1).max(1000),
      accountId: z.string().optional(),
      status: z.enum(['pending', 'completed', 'all']).optional(),
      limit: z.coerce.number().int().positive().max(100).optional(),
    }).parse(request.query);
    try {
      return dependencies.runtime.searchTodos({
        query: query.query,
        accountId: query.accountId,
        status: query.status,
        limit: query.limit ?? 20,
      });
    } catch (error) {
      if (error instanceof RuntimeValidationError) {
        return reply.code(400).send({ error: 'invalid_todo_account', details: error.message });
      }
      throw error;
    }
  });

  app.get('/v1/todos/digest', async (request, reply) => {
    const query = z.object({ accountId: z.string().optional() }).parse(request.query);
    const accounts = dependencies.runtime.listTodoAccounts();
    if (accounts.length === 0) return null;
    const accountId = query.accountId ?? accounts[0]!.id;
    try {
      return dependencies.runtime.getTodoDigest(accountId);
    } catch (error) {
      if (error instanceof RuntimeValidationError) {
        return reply.code(400).send({ error: 'invalid_todo_account', details: error.message });
      }
      throw error;
    }
  });

  app.post('/v1/todos/items', async (request, reply) => {
    const body = TodoCreateInputSchema.parse(request.body);
    try {
      return dependencies.runtime.createTodo(body);
    } catch (error) {
      if (error instanceof RuntimeValidationError) {
        return reply.code(400).send({ error: 'invalid_todo_item', details: error.message });
      }
      throw error;
    }
  });

  app.post('/v1/todos/items/:id/complete', async (request, reply) => {
    const id = parseIdParam(request.params);
    let result;
    try {
      result = dependencies.runtime.completeTodo(id);
    } catch (error) {
      if (error instanceof RuntimeValidationError) {
        return reply.code(400).send({ error: 'invalid_todo_item', details: error.message });
      }
      throw error;
    }
    if (!result) return reply.code(404).send({ error: 'todo not found' });
    return result;
  });

  app.post('/v1/todos/accounts', async (request, reply) => {
    const body = TodoAccountRegistrationInputSchema.parse(request.body);
    try {
      return dependencies.runtime.registerTodoAccount(body);
    } catch (error) {
      if (error instanceof RuntimeValidationError) {
        return reply.code(400).send({ error: 'invalid_todo_account', details: error.message });
      }
      throw error;
    }
  });

  app.post('/v1/todos/connect', async (request, reply) => {
    const body = TodoistConnectInputSchema.parse(request.body);
    try {
      return dependencies.runtime.connectTodoist(body);
    } catch (error) {
      if (error instanceof RuntimeValidationError) {
        return reply.code(400).send({ error: 'invalid_todoist_connection', details: error.message });
      }
      throw error;
    }
  });

  app.post('/v1/todos/sync', async (request, reply) => {
    const body = z.object({ accountId: z.string().min(1) }).parse(request.body);
    try {
      return dependencies.runtime.syncTodoAccount(body.accountId);
    } catch (error) {
      if (error instanceof RuntimeValidationError) {
        return reply.code(400).send({ error: 'invalid_todo_sync', details: error.message });
      }
      throw error;
    }
  });

  app.post('/v1/todos/items/:id/reprioritize', async (request, reply) => {
    const id = parseIdParam(request.params);
    const body = z.object({ priority: z.number().int().min(1).max(4) }).parse(request.body);
    try {
      const result = dependencies.runtime.reprioritizeTodo(id, body.priority);
      if (!result) return reply.code(404).send({ error: 'todo not found' });
      return result;
    } catch (error) {
      if (error instanceof RuntimeValidationError) {
        return reply.code(400).send({ error: 'invalid_todo_item', details: error.message });
      }
      throw error;
    }
  });

  app.post('/v1/todos/items/:id/reschedule', async (request, reply) => {
    const id = parseIdParam(request.params);
    const body = z.object({ dueDate: z.string().min(1), dueTime: z.string().nullable().optional() }).parse(request.body);
    try {
      const result = dependencies.runtime.rescheduleTodo(id, body.dueDate, body.dueTime);
      if (!result) return reply.code(404).send({ error: 'todo not found' });
      return result;
    } catch (error) {
      if (error instanceof RuntimeValidationError) {
        return reply.code(400).send({ error: 'invalid_todo_item', details: error.message });
      }
      throw error;
    }
  });

  app.post('/v1/todos/items/:id/move', async (request, reply) => {
    const id = parseIdParam(request.params);
    const body = z.object({ projectName: z.string().min(1) }).parse(request.body);
    try {
      const result = dependencies.runtime.moveTodo(id, body.projectName);
      if (!result) return reply.code(404).send({ error: 'todo not found' });
      return result;
    } catch (error) {
      if (error instanceof RuntimeValidationError) {
        return reply.code(400).send({ error: 'invalid_todo_item', details: error.message });
      }
      throw error;
    }
  });

  app.post('/v1/todos/reconcile', async (request, reply) => {
    const body = z.object({ accountId: z.string().min(1) }).parse(request.body);
    try {
      return dependencies.runtime.reconcileTodos(body.accountId);
    } catch (error) {
      if (error instanceof RuntimeValidationError) {
        return reply.code(400).send({ error: 'invalid_todo_reconcile', details: error.message });
      }
      throw error;
    }
  });

  app.get('/v1/todos/projects', async (request, reply) => {
    const query = z.object({ accountId: z.string().min(1) }).parse(request.query);
    try {
      return dependencies.runtime.listTodoProjects(query.accountId);
    } catch (error) {
      if (error instanceof RuntimeValidationError) {
        return reply.code(400).send({ error: 'invalid_todo_account', details: error.message });
      }
      throw error;
    }
  });

  // --- People routes ---

  app.get('/v1/people', async () => {
    return dependencies.runtime.listPeople();
  });

  app.get('/v1/people/search', async (request) => {
    const query = z.object({
      query: z.string().min(1).max(1000),
      limit: z.coerce.number().int().positive().max(100).optional(),
    }).parse(request.query);
    return dependencies.runtime.searchPeople({
      query: query.query,
      limit: query.limit ?? 20,
    });
  });

  app.get('/v1/people/:id', async (request, reply) => {
    const id = parseIdParam(request.params);
    const person = dependencies.runtime.getPerson(id);
    if (!person) return reply.code(404).send({ error: 'person not found' });
    return person;
  });

  app.patch('/v1/people/:id', async (request, reply) => {
    const id = parseIdParam(request.params);
    const body = PersonUpdateInputSchema.parse(request.body);
    const person = dependencies.runtime.updatePerson(id, body);
    if (!person) return reply.code(404).send({ error: 'person not found' });
    return person;
  });

  app.post('/v1/people/merge', async (request, reply) => {
    const body = PersonMergeInputSchema.parse(request.body);
    try {
      return dependencies.runtime.mergePeople(body);
    } catch (error) {
      if (error instanceof Error) {
        return reply.code(400).send({ error: 'invalid_people_merge', details: error.message });
      }
      throw error;
    }
  });

  app.post('/v1/people/:id/split', async (request, reply) => {
    const id = parseIdParam(request.params);
    const body = PersonSplitInputSchema.parse(request.body);
    try {
      return dependencies.runtime.splitPerson(id, body);
    } catch (error) {
      if (error instanceof Error) {
        return reply.code(400).send({ error: 'invalid_people_split', details: error.message });
      }
      throw error;
    }
  });

  app.post('/v1/people/identities/attach', async (request, reply) => {
    const body = PersonIdentityAttachInputSchema.parse(request.body);
    try {
      return dependencies.runtime.attachPersonIdentity(body);
    } catch (error) {
      if (error instanceof Error) {
        return reply.code(400).send({ error: 'invalid_people_identity', details: error.message });
      }
      throw error;
    }
  });

  app.post('/v1/people/identities/:id/detach', async (request, reply) => {
    const id = parseIdParam(request.params);
    const body = PersonIdentityDetachInputSchema.parse(request.body);
    try {
      return dependencies.runtime.detachPersonIdentity(id, body);
    } catch (error) {
      if (error instanceof Error) {
        return reply.code(400).send({ error: 'invalid_people_identity', details: error.message });
      }
      throw error;
    }
  });

  // --- People merge events, suggestions, activity ---

  app.get('/v1/people/:id/merge-events', async (request) => {
    const id = parseIdParam(request.params);
    return dependencies.runtime.listPersonMergeEvents(id);
  });

  app.get('/v1/people/merge-suggestions', async () => {
    return dependencies.runtime.getPersonMergeSuggestions();
  });

  app.get('/v1/people/:id/activity', async (request) => {
    const id = parseIdParam(request.params);
    return dependencies.runtime.getPersonActivityRollups(id);
  });

  // --- Finance routes ---

  app.get('/v1/finance/imports', async () => {
    return dependencies.runtime.listFinanceImports();
  });

  app.get('/v1/finance/imports/:id', async (request, reply) => {
    const id = parseIdParam(request.params);
    const record = dependencies.runtime.getFinanceImport(id);
    if (!record) return reply.code(404).send({ error: 'finance import not found' });
    return record;
  });

  app.get('/v1/finance/transactions', async (request) => {
    const query = z.object({
      importId: z.string().optional(),
      category: z.string().optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      limit: z.coerce.number().int().positive().max(200).optional(),
    }).parse(request.query);
    const txOpts: { category?: string; dateFrom?: string; dateTo?: string; limit?: number } = {};
    if (query.category) txOpts.category = query.category;
    if (query.dateFrom) txOpts.dateFrom = query.dateFrom;
    if (query.dateTo) txOpts.dateTo = query.dateTo;
    if (query.limit) txOpts.limit = query.limit;
    return dependencies.runtime.listFinanceTransactions(query.importId, txOpts);
  });

  app.get('/v1/finance/documents', async (request) => {
    const query = z.object({
      importId: z.string().optional(),
    }).parse(request.query);
    return dependencies.runtime.listFinanceDocuments(query.importId);
  });

  app.get('/v1/finance/search', async (request, reply) => {
    const query = z.object({
      query: z.string().min(1),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      category: z.string().optional(),
      limit: z.coerce.number().int().positive().max(100).optional(),
    }).parse(request.query);
    if (!query.query) return reply.code(400).send({ error: 'query parameter is required' });
    return dependencies.runtime.searchFinance({
      query: query.query,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
      category: query.category,
      limit: query.limit ?? 20,
    });
  });

  app.get('/v1/finance/digest', async (request) => {
    const query = z.object({
      period: z.string().optional(),
    }).parse(request.query);
    return dependencies.runtime.getFinanceDigest(query.period);
  });

  app.post('/v1/finance/imports', async (request) => {
    const body = z.object({
      vaultId: z.string().min(1),
      importType: z.enum(['csv', 'ofx', 'qfx', 'document']).default('csv'),
      fileName: z.string().min(1),
    }).parse(request.body);
    return dependencies.runtime.createFinanceImport(body);
  });

  app.post('/v1/finance/transactions', async (request) => {
    const body = z.object({
      importId: z.string().min(1),
      date: z.string().min(1),
      description: z.string().min(1),
      amount: z.number(),
      currency: z.string().default('USD'),
      category: z.string().nullable().default(null),
      merchantName: z.string().nullable().default(null),
      accountLabel: z.string().nullable().default(null),
      redactedSummary: z.string().default(''),
    }).parse(request.body);
    return dependencies.runtime.insertFinanceTransaction(body);
  });

  app.post('/v1/finance/transactions/batch', async (request) => {
    const body = z.object({
      importId: z.string().min(1),
      transactions: z.array(z.object({
        date: z.string().min(1),
        description: z.string().min(1),
        amount: z.number(),
        currency: z.string().default('USD'),
        category: z.string().nullable().default(null),
        merchantName: z.string().nullable().default(null),
        accountLabel: z.string().nullable().default(null),
        redactedSummary: z.string().default(''),
      })).max(5000),
    }).parse(request.body);
    return dependencies.runtime.insertFinanceTransactionBatch(body);
  });

  app.post('/v1/finance/imports/:id/status', async (request) => {
    const id = parseIdParam(request.params);
    const body = z.object({
      status: z.enum(['pending', 'processing', 'completed', 'failed']),
      recordCount: z.number().int().nonnegative().optional(),
    }).parse(request.body);
    dependencies.runtime.updateFinanceImportStatus(id, body.status, body.recordCount);
    return { ok: true };
  });

  // --- Medical routes ---

  app.get('/v1/medical/imports', async () => {
    return dependencies.runtime.listMedicalImports();
  });

  app.get('/v1/medical/imports/:id', async (request, reply) => {
    const id = parseIdParam(request.params);
    const record = dependencies.runtime.getMedicalImport(id);
    if (!record) return reply.code(404).send({ error: 'medical import not found' });
    return record;
  });

  app.get('/v1/medical/appointments', async (request) => {
    const query = z.object({
      importId: z.string().optional(),
      limit: z.coerce.number().int().positive().max(200).optional(),
    }).parse(request.query);
    const apptOpts: { limit?: number } = {};
    if (query.limit) apptOpts.limit = query.limit;
    return dependencies.runtime.listMedicalAppointments(query.importId, apptOpts);
  });

  app.get('/v1/medical/medications', async (request) => {
    const query = z.object({
      importId: z.string().optional(),
    }).parse(request.query);
    return dependencies.runtime.listMedicalMedications(query.importId);
  });

  app.get('/v1/medical/documents', async (request) => {
    const query = z.object({
      importId: z.string().optional(),
    }).parse(request.query);
    return dependencies.runtime.listMedicalDocuments(query.importId);
  });

  app.get('/v1/medical/search', async (request, reply) => {
    const query = z.object({
      query: z.string().min(1),
      limit: z.coerce.number().int().positive().max(100).optional(),
    }).parse(request.query);
    if (!query.query) return reply.code(400).send({ error: 'query parameter is required' });
    return dependencies.runtime.searchMedical(query.query, query.limit);
  });

  app.get('/v1/medical/digest', async (request) => {
    const query = z.object({
      period: z.string().optional(),
    }).parse(request.query);
    return dependencies.runtime.getMedicalDigest(query.period);
  });

  app.post('/v1/medical/imports', async (request) => {
    const body = z.object({
      vaultId: z.string().min(1),
      importType: z.enum(['pdf', 'document', 'operator_note']).default('pdf'),
      fileName: z.string().min(1),
    }).parse(request.body);
    return dependencies.runtime.createMedicalImport(body);
  });

  app.post('/v1/medical/appointments', async (request) => {
    const body = z.object({
      importId: z.string().min(1),
      date: z.string().min(1),
      provider: z.string().min(1),
      specialty: z.string().nullable().default(null),
      location: z.string().nullable().default(null),
      redactedSummary: z.string().default(''),
    }).parse(request.body);
    return dependencies.runtime.insertMedicalAppointment(body);
  });

  app.post('/v1/medical/medications', async (request) => {
    const body = z.object({
      importId: z.string().min(1),
      name: z.string().min(1),
      dosage: z.string().nullable().default(null),
      frequency: z.string().nullable().default(null),
      prescriber: z.string().nullable().default(null),
      startDate: z.string().nullable().default(null),
      endDate: z.string().nullable().default(null),
      redactedSummary: z.string().default(''),
    }).parse(request.body);
    return dependencies.runtime.insertMedicalMedication(body);
  });

  app.post('/v1/medical/imports/:id/status', async (request) => {
    const id = parseIdParam(request.params);
    const body = z.object({
      status: z.enum(['pending', 'processing', 'completed', 'failed']),
    }).parse(request.body);
    dependencies.runtime.updateMedicalImportStatus(id, body.status);
    return { ok: true };
  });

  // --- File write-intent routes ---

  app.post('/v1/files/write-intents', async (request, reply) => {
    const body = FileWriteIntentCreateInputSchema.parse(request.body);
    try {
      return dependencies.runtime.createFileWriteIntent(body);
    } catch (error) {
      if (error instanceof RuntimeValidationError) {
        return reply.code(400).send({ error: 'invalid_write_intent', details: error.message });
      }
      throw error;
    }
  });

  app.get('/v1/files/write-intents', async (request) => {
    const query = z.object({
      rootId: z.string().optional(),
      status: z.enum(['pending', 'applied', 'rejected']).optional(),
    }).parse(request.query);
    return dependencies.runtime.listFileWriteIntents(query.rootId, query.status);
  });

  app.get('/v1/files/write-intents/:id', async (request, reply) => {
    const id = parseIdParam(request.params);
    const intent = dependencies.runtime.getFileWriteIntent(id);
    if (!intent) return reply.code(404).send({ error: 'write intent not found' });
    return intent;
  });

  app.post('/v1/files/write-intents/:id/review', async (request, reply) => {
    const id = parseIdParam(request.params);
    const body = FileWriteIntentReviewInputSchema.parse(request.body);
    try {
      const result = dependencies.runtime.reviewFileWriteIntent(id, body);
      if (!result) return reply.code(404).send({ error: 'write intent not found' });
      return result;
    } catch (error) {
      if (error instanceof RuntimeValidationError) {
        return reply.code(400).send({ error: 'invalid_review', details: error.message });
      }
      throw error;
    }
  });

  return app;
}
