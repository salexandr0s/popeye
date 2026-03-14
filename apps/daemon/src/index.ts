import { randomBytes } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import fastifyStatic from '@fastify/static';

import { cleanStalePiTempDirs } from '@popeye/engine-pi';
import { createControlApi } from '@popeye/control-api';
import { createLogger, redactText } from '@popeye/observability';
import {
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

const config = loadAppConfig(configPath);
const log = createLogger('daemon', config.security.redactionPatterns);
ensureRuntimePaths(config);
const cleanedTempDirs = cleanStalePiTempDirs();
if (cleanedTempDirs > 0) {
  log.info(`Cleaned ${cleanedTempDirs} stale Pi temp directories`, { count: cleanedTempDirs });
}
const runtime = createRuntimeService(config);
runtime.startScheduler();
const cspNonce = randomBytes(16).toString('base64');
const webBootstrap = new WebBootstrapNonceStore();
const app = await createControlApi({
  runtime,
  cspNonce,
  authExemptPaths: new Set(['/v1/auth/exchange']),
  validateAuthExchangeNonce: (nonce) => webBootstrap.consume(nonce),
  useSecureCookies: config.security.useSecureCookies,
});

// Serve web inspector static files
const webInspectorDist = resolve(
  import.meta.dirname ?? __dirname,
  '../../web-inspector/dist',
);
if (existsSync(webInspectorDist)) {
  const rawHtml = readFileSync(
    resolve(webInspectorDist, 'index.html'),
    'utf8',
  );
  const htmlTemplate = rawHtml.replace(/<script/g, `<script nonce="${cspNonce}"`);
  const renderWebInspector = () => htmlTemplate.replace(
    '__POPEYE_BOOTSTRAP_NONCE__',
    webBootstrap.issue(),
  );

  app.get('/', async (_request, reply) => (
    reply.code(200).type('text/html').send(renderWebInspector())
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
    return reply.code(200).type('text/html').send(renderWebInspector());
  });
}

let shuttingDown = false;
let telegramBridge: Awaited<ReturnType<typeof startTelegramBridge>> | null = null;
const shutdown = async (code = 0) => {
  if (shuttingDown) return;
  shuttingDown = true;
  await telegramBridge?.stop();
  await app.close();
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

await app.listen({
  host: config.security.bindHost,
  port: config.security.bindPort,
});
telegramBridge = await startTelegramBridge(config);
