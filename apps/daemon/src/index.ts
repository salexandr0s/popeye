import { randomBytes } from 'node:crypto';
import { readFileSync, existsSync, realpathSync } from 'node:fs';
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
import { TelegramControlPlane } from './telegram-control.js';

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
const telegramControl = new TelegramControlPlane(configPath, config, runtime);
const generateCspNonce = () => randomBytes(16).toString('base64');
const webBootstrap = new WebBootstrapNonceStore();
const currentScriptDir = (): string => {
  if (typeof process.argv[1] === 'string' && process.argv[1].length > 0) {
    return dirname(realpathSync(process.argv[1]));
  }
  if (typeof __filename === 'string' && __filename.length > 0) {
    return dirname(realpathSync(__filename));
  }
  throw new Error('Unable to resolve current daemon script path');
};

let shuttingDown = false;
let app: Awaited<ReturnType<typeof createControlApi>> | null = null;
const shutdown = async (code = 0) => {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info('daemon shutting down');
  await telegramControl.stopCurrentBridge();
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

const start = async (): Promise<void> => {
  app = await createControlApi({
    runtime,
    generateCspNonce,
    validateAuthExchangeNonce: (nonce) => webBootstrap.consume(nonce),
    useSecureCookies: config.security.useSecureCookies,
    logger: log.child({}),
    telegramConfigControl: {
      getSnapshot: () => telegramControl.getSnapshot(),
      updateConfig: (input) => telegramControl.updateConfig(input),
      applyTelegramConfig: () => telegramControl.applyTelegramConfig(),
    },
    daemonControl: {
      getManagementStatus: () => ({
        managementMode: telegramControl.managementMode,
        restartSupported: telegramControl.restartSupported,
      }),
      restartDaemonNow: () => telegramControl.restartDaemonNow(),
    },
  });

  const webInspectorDist = resolve(
    currentScriptDir(),
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
  const startedBridge = await telegramControl.startInitialBridge();
  if (startedBridge) {
    log.info('telegram bridge started');
  }
};

void start().catch((error) => {
  const msg = error instanceof Error ? error.stack ?? error.message : String(error);
  const redacted = redactText(msg, config.security.redactionPatterns);
  log.error('startupFailure', { detail: redacted.text });
  process.exit(1);
});
