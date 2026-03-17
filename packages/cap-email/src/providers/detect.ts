/**
 * Detect available email provider backends.
 * Used by CLI and API to show which providers are ready for connection.
 */

import { execFile } from 'node:child_process';
import { createConnection } from 'node:net';

const DEFAULT_PROTON_HOST = '127.0.0.1';
const DEFAULT_PROTON_PORT = 1143;
const DETECT_TIMEOUT_MS = 5_000;

export interface GwsDetectionResult {
  available: boolean;
  path: string;
  authenticated: boolean;
  error?: string | undefined;
}

export interface ProtonBridgeDetectionResult {
  available: boolean;
  host: string;
  imapPort: number;
  error?: string | undefined;
}

export interface ProviderDetectionResult {
  gws: GwsDetectionResult;
  protonBridge: ProtonBridgeDetectionResult;
}

/** Detect if the gws CLI is installed and authenticated. */
export async function detectGws(gwsPath = 'gws'): Promise<GwsDetectionResult> {
  const result: GwsDetectionResult = { available: false, path: gwsPath, authenticated: false };

  try {
    // Check if binary exists
    const version = await execAsync(gwsPath, ['--version'], DETECT_TIMEOUT_MS);
    if (!version.trim()) {
      result.error = 'gws binary found but returned empty version';
      return result;
    }
    result.available = true;

    // Check auth status by trying a lightweight API call
    try {
      await execAsync(gwsPath, ['gmail', 'users', 'getProfile'], DETECT_TIMEOUT_MS);
      result.authenticated = true;
    } catch (err) {
      result.error = `gws installed but not authenticated: ${err instanceof Error ? err.message : String(err)}`;
    }
  } catch {
    result.error = 'gws CLI not found on PATH';
  }

  return result;
}

/** Detect if Proton Bridge is running by attempting an IMAP connection. */
export async function detectProtonBridge(
  host = DEFAULT_PROTON_HOST,
  port = DEFAULT_PROTON_PORT,
): Promise<ProtonBridgeDetectionResult> {
  const result: ProtonBridgeDetectionResult = { available: false, host, imapPort: port };

  try {
    await checkTcpPort(host, port, DETECT_TIMEOUT_MS);
    result.available = true;
  } catch {
    result.error = `Proton Bridge not detected on ${host}:${port}`;
  }

  return result;
}

/** Detect all available providers. */
export async function detectAvailableProviders(): Promise<ProviderDetectionResult> {
  const [gws, protonBridge] = await Promise.all([
    detectGws(),
    detectProtonBridge(),
  ]);
  return { gws, protonBridge };
}

// --- Helpers ---

function execAsync(command: string, args: string[], timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });
}

function checkTcpPort(host: string, port: number, timeout: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port, timeout }, () => {
      socket.destroy();
      resolve();
    });
    socket.on('error', (err) => {
      socket.destroy();
      reject(err);
    });
    socket.on('timeout', () => {
      socket.destroy();
      reject(new Error('Connection timeout'));
    });
  });
}
