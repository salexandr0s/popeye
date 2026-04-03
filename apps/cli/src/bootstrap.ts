import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  AppConfigSchema,
  BootstrapStatusResponseSchema,
  CsrfTokenResponseSchema,
  NativeAppSessionCreateResponseSchema,
  type AppConfig,
} from '@popeye/contracts';
import {
  DEFAULT_RUNTIME_DATA_DIR,
  daemonStatus,
  defaultAssistantWorkspacePath,
  defaultAuthFilePath,
  ensureRuntimePaths,
  initAuthStore,
  installLaunchAgent,
  loadAppConfig,
  loadLaunchAgent,
  readAuthStore,
  restartLaunchAgent,
} from '@popeye/runtime-core';

const DEFAULT_CONFIG_PATH = join(homedir(), 'Library', 'Application Support', 'Popeye', 'config.json');
const DEFAULT_BASE_URL = 'http://127.0.0.1:3210';
const BOOTSTRAP_USER_AGENT = 'pop-bootstrap/0.1';

export interface LaunchdDaemonSpec {
  daemonEntryPoint: string;
  workingDirectory: string;
  programArguments: string[];
}

export interface BootstrapCommandDependencies {
  resolveLaunchdDaemonSpec: (configPath: string) => LaunchdDaemonSpec;
}

interface LocalStatus {
  configPath: string;
  baseURL: string;
  configExists: boolean;
  configValid: boolean;
  daemonInstalled: boolean;
  daemonLoaded: boolean;
  daemonReachable: boolean;
  authStoreReady: boolean;
  nativeAppSessionsSupported: boolean;
  needsLocalSetup: boolean;
  needsDaemonStart: boolean;
  canGrantNativeSession: boolean;
  error: string | null;
}

function resolveConfigPath(): string {
  return process.env['POPEYE_CONFIG_PATH'] ?? DEFAULT_CONFIG_PATH;
}

function deriveBaseURL(config: AppConfig | null): string {
  if (!config) {
    return DEFAULT_BASE_URL;
  }
  return `http://${config.security.bindHost}:${config.security.bindPort}`;
}

function loadConfigIfPresent(configPath: string): { config: AppConfig | null; error: string | null } {
  if (!existsSync(configPath)) {
    return { config: null, error: null };
  }
  try {
    return { config: loadAppConfig(configPath), error: null };
  } catch (error) {
    return {
      config: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function fetchBootstrapStatus(baseURL: string): Promise<{ reachable: boolean; authStoreReady: boolean; nativeAppSessionsSupported: boolean }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1_500);
  try {
    const response = await fetch(`${baseURL}/v1/bootstrap/status`, {
      headers: {
        accept: 'application/json',
        'user-agent': BOOTSTRAP_USER_AGENT,
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      return { reachable: false, authStoreReady: false, nativeAppSessionsSupported: false };
    }
    const parsed = BootstrapStatusResponseSchema.parse(await response.json());
    return {
      reachable: parsed.daemonReady,
      authStoreReady: parsed.authStoreReady,
      nativeAppSessionsSupported: parsed.nativeAppSessionsSupported,
    };
  } catch {
    return { reachable: false, authStoreReady: false, nativeAppSessionsSupported: false };
  } finally {
    clearTimeout(timeout);
  }
}

async function readLocalStatus(): Promise<LocalStatus> {
  const configPath = resolveConfigPath();
  const daemon = daemonStatus();
  const loaded = loadConfigIfPresent(configPath);
  const baseURL = deriveBaseURL(loaded.config);
  const bootstrap = loaded.error
    ? { reachable: false, authStoreReady: false, nativeAppSessionsSupported: false }
    : await fetchBootstrapStatus(baseURL);

  return {
    configPath,
    baseURL,
    configExists: existsSync(configPath),
    configValid: existsSync(configPath) ? loaded.error === null : true,
    daemonInstalled: daemon.installed,
    daemonLoaded: daemon.loaded,
    daemonReachable: bootstrap.reachable,
    authStoreReady: bootstrap.authStoreReady,
    nativeAppSessionsSupported: bootstrap.nativeAppSessionsSupported,
    needsLocalSetup: !existsSync(configPath),
    needsDaemonStart: existsSync(configPath) && !bootstrap.reachable,
    canGrantNativeSession: bootstrap.reachable && bootstrap.authStoreReady && bootstrap.nativeAppSessionsSupported,
    error: loaded.error,
  };
}

function buildDefaultConfig(): AppConfig {
  const runtimeDataDir = DEFAULT_RUNTIME_DATA_DIR;
  return AppConfigSchema.parse({
    runtimeDataDir,
    authFile: defaultAuthFilePath(runtimeDataDir),
    security: {
      bindHost: '127.0.0.1',
      bindPort: 3210,
      redactionPatterns: [],
      promptScanQuarantinePatterns: [],
      promptScanSanitizePatterns: [],
    },
    telegram: {
      enabled: false,
    },
    embeddings: {
      provider: 'disabled',
      allowedClassifications: ['embeddable'],
    },
    engine: {
      kind: 'fake',
    },
    workspaces: [{
      id: 'default',
      name: 'Default workspace',
      rootPath: defaultAssistantWorkspacePath(),
      heartbeatEnabled: true,
      heartbeatIntervalSeconds: 3600,
      projects: [],
      fileRoots: [],
    }],
  });
}

function writeConfig(configPath: string, config: AppConfig): void {
  mkdirSync(dirname(configPath), { recursive: true, mode: 0o700 });
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  chmodSync(configPath, 0o600);
}

async function ensureLocalSetup(): Promise<LocalStatus & { createdConfig: boolean; initializedAuthStore: boolean }> {
  const configPath = resolveConfigPath();
  const existed = existsSync(configPath);
  if (!existed) {
    const config = buildDefaultConfig();
    writeConfig(configPath, config);
  }

  const loaded = loadConfigIfPresent(configPath);
  if (!loaded.config) {
    throw new Error(loaded.error ?? 'Unable to load local Popeye config');
  }

  ensureRuntimePaths(loaded.config);
  initAuthStore(loaded.config.authFile);

  const status = await readLocalStatus();
  return {
    ...status,
    createdConfig: !existed,
    initializedAuthStore: true,
  };
}

async function waitForDaemon(baseURL: string, timeoutMs = 8_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await fetchBootstrapStatus(baseURL);
    if (status.reachable) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

async function startDaemon(dependencies: BootstrapCommandDependencies): Promise<LocalStatus & { action: 'installed_and_loaded' | 'loaded' | 'restarted'; output: string }> {
  const configPath = resolveConfigPath();
  const loaded = loadConfigIfPresent(configPath);
  if (!loaded.config) {
    throw new Error('Local setup is missing. Run bootstrap ensure-local first.');
  }

  const spec = dependencies.resolveLaunchdDaemonSpec(configPath);
  const daemon = daemonStatus();
  let action: 'installed_and_loaded' | 'loaded' | 'restarted';
  let output: string;

  if (!daemon.installed) {
    installLaunchAgent({
      configPath,
      daemonEntryPoint: spec.daemonEntryPoint,
      workingDirectory: spec.workingDirectory,
      programArguments: spec.programArguments,
    });
    const loadedAgent = loadLaunchAgent();
    if (!loadedAgent.ok) {
      throw new Error(loadedAgent.output || 'Failed to load Popeye launch agent');
    }
    action = 'installed_and_loaded';
    output = loadedAgent.output;
  } else if (!daemon.loaded) {
    const loadedAgent = loadLaunchAgent();
    if (!loadedAgent.ok) {
      throw new Error(loadedAgent.output || 'Failed to load Popeye launch agent');
    }
    action = 'loaded';
    output = loadedAgent.output;
  } else {
    const restarted = restartLaunchAgent();
    if (!restarted.ok) {
      throw new Error(restarted.output || 'Failed to restart Popeye launch agent');
    }
    action = 'restarted';
    output = restarted.output;
  }

  const baseURL = deriveBaseURL(loaded.config);
  const reachable = await waitForDaemon(baseURL);
  if (!reachable) {
    throw new Error('Popeye daemon did not become reachable after launchd start');
  }

  const status = await readLocalStatus();
  return {
    ...status,
    action,
    output,
  };
}

async function fetchJson<T>(input: string, init: RequestInit, parse: (value: unknown) => T): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3_000);
  try {
    const response = await fetch(input, {
      ...init,
      signal: controller.signal,
    });
    const json = await response.json().catch(() => null);
    if (!response.ok) {
      const message = json && typeof json === 'object' && 'error' in json && typeof (json as { error?: unknown }).error === 'string'
        ? (json as { error: string }).error
        : `HTTP ${response.status}`;
      throw new Error(message);
    }
    return parse(json);
  } finally {
    clearTimeout(timeout);
  }
}

async function issueNativeSession(clientName: string): Promise<{ baseURL: string; sessionToken: string; expiresAt: string }> {
  const configPath = resolveConfigPath();
  const loaded = loadConfigIfPresent(configPath);
  if (!loaded.config) {
    throw new Error('Local setup is missing. Run bootstrap ensure-local first.');
  }

  const baseURL = deriveBaseURL(loaded.config);
  const bootstrap = await fetchBootstrapStatus(baseURL);
  if (!bootstrap.reachable) {
    throw new Error('Popeye daemon is not reachable');
  }

  const operatorToken = readAuthStore(loaded.config.authFile, 'operator').current.token;
  const csrf = await fetchJson(
    `${baseURL}/v1/security/csrf-token`,
    {
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${operatorToken}`,
        'user-agent': BOOTSTRAP_USER_AGENT,
      },
    },
    (value) => CsrfTokenResponseSchema.parse(value),
  );

  const session = await fetchJson(
    `${baseURL}/v1/bootstrap/native-app-session`,
    {
      method: 'POST',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${operatorToken}`,
        'content-type': 'application/json',
        'x-popeye-csrf': csrf.token,
        'sec-fetch-site': 'none',
        'user-agent': BOOTSTRAP_USER_AGENT,
      },
      body: JSON.stringify({ clientName }),
    },
    (value) => NativeAppSessionCreateResponseSchema.parse(value),
  );

  return {
    baseURL,
    sessionToken: session.sessionToken,
    expiresAt: session.expiresAt,
  };
}

export async function handleBootstrapCommand(
  subcommand: string | undefined,
  dependencies: BootstrapCommandDependencies,
): Promise<number> {
  try {
    switch (subcommand) {
      case 'status':
        console.info(JSON.stringify(await readLocalStatus(), null, 2));
        return 0;
      case 'ensure-local':
        console.info(JSON.stringify(await ensureLocalSetup(), null, 2));
        return 0;
      case 'start-daemon':
        console.info(JSON.stringify(await startDaemon(dependencies), null, 2));
        return 0;
      case 'issue-native-session': {
        const clientNameIdx = process.argv.indexOf('--client-name');
        const clientName = clientNameIdx >= 0
          ? (process.argv[clientNameIdx + 1] ?? 'PopeyeMac')
          : 'PopeyeMac';
        console.info(JSON.stringify(await issueNativeSession(clientName), null, 2));
        return 0;
      }
      default:
        throw new Error('Unknown bootstrap subcommand');
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
