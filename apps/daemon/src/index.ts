import { randomBytes } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import fastifyStatic from '@fastify/static';

import { createControlApi } from '@popeye/control-api';
import { createLogger, redactText } from '@popeye/observability';
import {
  cleanStalePiTempDirs,
  createRuntimeService,
  ensureRuntimePaths,
  loadAppConfig,
} from '@popeye/runtime-core';
import { WebBootstrapNonceStore } from './web-bootstrap.js';
import { startTelegramBridge } from './telegram-bridge.js';

const configPath = process.env.POPEYE_CONFIG_PATH;
if (!configPath) {
  throw new Error('POPEYE_CONFIG_PATH is required');
}

const DAEMON_VERSION = process.env['POPEYE_VERSION'] ?? '0.1.0-dev';
const DAEMON_GIT_SHA = process.env['POPEYE_GIT_SHA'] ?? '';
const DAEMON_BUILD_DATE = process.env['POPEYE_BUILD_DATE'] ?? '';

const config = loadAppConfig(configPath);
const log = createLogger('daemon', {
  customPatterns: config.security.redactionPatterns,
  level: config.logging.level,
});
log.info('daemon starting', {
  version: DAEMON_VERSION,
  ...(DAEMON_GIT_SHA && { gitSha: DAEMON_GIT_SHA }),
  ...(DAEMON_BUILD_DATE && { buildDate: DAEMON_BUILD_DATE }),
});
ensureRuntimePaths(config);
const cleanedTempDirs = cleanStalePiTempDirs();
if (cleanedTempDirs > 0) {
  log.info(`Cleaned ${cleanedTempDirs} stale Pi temp directories`, { count: cleanedTempDirs });
}
const runtime = createRuntimeService(config);
runtime.startScheduler();
const generateCspNonce = () => randomBytes(16).toString('base64');
const webBootstrap = new WebBootstrapNonceStore();
const currentModuleDir = (): string => {
  const invokedPath = process.argv[1];
  if (typeof invokedPath === 'string' && invokedPath.length > 0) {
    return dirname(resolve(invokedPath));
  }
  if (typeof __dirname === 'string') {
    return __dirname;
  }
  throw new Error('Unable to determine daemon entrypoint path');
};

// Serve web inspector static files
let shuttingDown = false;
let telegramBridge: Awaited<ReturnType<typeof startTelegramBridge>> | null = null;
let app: Awaited<ReturnType<typeof createControlApi>> | null = null;
const shutdown = async (code = 0) => {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info('daemon shutting down');
  await telegramBridge?.stop();
  await app?.close();
  await runtime.close();
  process.exit(code);
};

process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
process.on('unhandledRejection', (error) => {
  const msg = error instanceof Error ? error.stack ?? error.message : String(error);
  const redacted = redactText(msg, config.security.redactionPatterns);
  log.error('unhandledRejection', { detail: redacted.text });
  void shutdown(1);
});
process.on('uncaughtException', (error) => {
  const msg = error instanceof Error ? error.stack ?? error.message : String(error);
  const redacted = redactText(msg, config.security.redactionPatterns);
  log.error('uncaughtException', { detail: redacted.text });
  process.exit(1);
});

async function main(): Promise<void> {
  app = await createControlApi({
    runtime,
    generateCspNonce,
    validateAuthExchangeNonce: (nonce) => webBootstrap.consume(nonce),
    useSecureCookies: config.security.useSecureCookies,
    logger: log.child({}),
  });

  const webInspectorDist = resolve(
    currentModuleDir(),
    '../../web-inspector/dist',
  );
  if (existsSync(webInspectorDist)) {
    const rawHtml = readFileSync(
      resolve(webInspectorDist, 'index.html'),
      'utf8',
    );
    const renderWebInspector = (nonce: string) => rawHtml
      .replaceAll('__POPEYE_CSP_NONCE__', nonce)
      .replaceAll('__POPEYE_BOOTSTRAP_NONCE__', webBootstrap.issue());

    app.get('/', async (request, reply) => (
      reply.code(200).type('text/html').send(renderWebInspector(request.popeyeCspNonce ?? generateCspNonce()))
    ));

    await app.register(fastifyStatic, {
      root: webInspectorDist,
      prefix: '/',
      decorateReply: false,
      wildcard: false,
      index: false,
    });

    app.setNotFoundHandler(async (request, reply) => {
      if (request.url.startsWith('/v1/')) {
        return reply.code(404).send({ error: 'not_found' });
      }
      return reply.code(200).type('text/html').send(renderWebInspector(request.popeyeCspNonce ?? generateCspNonce()));
    });
  }

  await app.listen({
    host: config.security.bindHost,
    port: config.security.bindPort,
  });
  log.info('control api listening', { host: config.security.bindHost, port: config.security.bindPort });
  telegramBridge = await startTelegramBridge(config);
  if (telegramBridge) {
    log.info('telegram bridge started');
  }
}

void main().catch((error) => {
  const msg = error instanceof Error ? error.stack ?? error.message : String(error);
  const redacted = redactText(msg, config.security.redactionPatterns);
  log.error('daemon bootstrap failed', { detail: redacted.text });
  void shutdown(1);
});
