import { createControlApi } from '@popeye/control-api';
import { createRuntimeService, ensureRuntimePaths, loadAppConfig } from '@popeye/runtime-core';

const configPath = process.env.POPEYE_CONFIG_PATH;
if (!configPath) {
  throw new Error('POPEYE_CONFIG_PATH is required');
}

const config = loadAppConfig(configPath);
ensureRuntimePaths(config);
const runtime = createRuntimeService(config);
runtime.startScheduler();
const app = await createControlApi({ runtime });

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

await app.listen({ host: config.security.bindHost, port: config.security.bindPort });
