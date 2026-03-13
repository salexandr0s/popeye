import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import fastifyStatic from '@fastify/static';

import { createControlApi } from '@popeye/control-api';
import {
  createRuntimeService,
  ensureRuntimePaths,
  loadAppConfig,
  readAuthStore,
} from '@popeye/runtime-core';

const configPath = process.env.POPEYE_CONFIG_PATH;
if (!configPath) {
  throw new Error('POPEYE_CONFIG_PATH is required');
}

const config = loadAppConfig(configPath);
ensureRuntimePaths(config);
const runtime = createRuntimeService(config);
runtime.startScheduler();
const app = await createControlApi({ runtime });

// Serve web inspector static files
const webInspectorDist = resolve(
  import.meta.dirname ?? __dirname,
  '../../web-inspector/dist',
);
if (existsSync(webInspectorDist)) {
  const authStore = readAuthStore(config.authFile);
  const rawHtml = readFileSync(
    resolve(webInspectorDist, 'index.html'),
    'utf8',
  );
  const injectedHtml = rawHtml.replace(
    '__POPEYE_AUTH_TOKEN__',
    authStore.current.token,
  );

  await app.register(fastifyStatic, {
    root: webInspectorDist,
    prefix: '/',
    decorateReply: false,
    wildcard: false,
  });

  app.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith('/v1/')) {
      return reply.code(404).send({ error: 'not_found' });
    }
    return reply.code(200).type('text/html').send(injectedHtml);
  });
}

let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  await app.close();
  await runtime.close();
  process.exit(0);
};

process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
process.on('unhandledRejection', (error) => {
  console.error('unhandledRejection', error);
  void shutdown();
});
process.on('uncaughtException', (error) => {
  console.error('uncaughtException', error);
  void shutdown();
});

await app.listen({
  host: config.security.bindHost,
  port: config.security.bindPort,
});
