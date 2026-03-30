import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';

import { PluginManifestSchema, type PluginManifest } from '@popeye/contracts';
import type { RuntimeToolDescriptor, RuntimeToolResult } from '@popeye/engine-pi';

export interface PluginLogger {
  info: (msg: string, meta?: Record<string, unknown>) => void;
  warn: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
}

export interface LoadedPlugin {
  manifest: PluginManifest;
  tools: RuntimeToolDescriptor[];
}

type StdinWriteError = Error & { code?: string };

function executePluginTool(command: string, timeoutMs: number, env: Record<string, string>): (params: unknown) => Promise<RuntimeToolResult> {
  return (params: unknown): Promise<RuntimeToolResult> => {
    return new Promise((resolve) => {
      const child = execFile('/bin/sh', ['-c', command], {
        timeout: timeoutMs,
        env: { ...process.env, ...env },
        maxBuffer: 1024 * 1024,
      }, (error, stdout, stderr) => {
        if (error) {
          const isTimeout = error.killed || ('code' in error && error.code === 'ERR_CHILD_PROCESS_STDIO_FINAL');
          const message = isTimeout
            ? `Plugin tool timed out after ${timeoutMs}ms`
            : `Plugin tool failed: ${stderr || error.message}`;
          resolve({ content: [{ type: 'text', text: message }] });
          return;
        }

        try {
          const parsed = JSON.parse(stdout) as Record<string, unknown>;
          const text = typeof parsed['text'] === 'string' ? parsed['text'] : JSON.stringify(parsed);
          resolve({ content: [{ type: 'text', text }] });
        } catch {
          resolve({ content: [{ type: 'text', text: stdout.trim() || '(no output)' }] });
        }
      });

      if (child.stdin) {
        child.stdin.on('error', (error: StdinWriteError) => {
          if (error.code === 'EPIPE' || error.code === 'ERR_STREAM_DESTROYED') {
            return;
          }
          child.kill();
        });
        child.stdin.end(JSON.stringify(params ?? {}));
      }
    });
  };
}

export function loadPlugins(pluginsDir: string, log?: PluginLogger): LoadedPlugin[] {
  if (!existsSync(pluginsDir)) {
    log?.info('plugins directory does not exist, skipping', { pluginsDir });
    return [];
  }

  const entries = readdirSync(pluginsDir, { withFileTypes: true });
  const plugins: LoadedPlugin[] = [];
  const seenToolNames = new Set<string>();

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const pluginDir = join(pluginsDir, entry.name);
    const manifestPath = join(pluginDir, 'manifest.json');

    if (!existsSync(manifestPath)) {
      log?.warn('plugin directory missing manifest.json, skipping', { pluginDir });
      continue;
    }

    // Verify directory permissions (700)
    const dirStat = statSync(pluginDir);
    const dirMode = dirStat.mode & 0o777;
    if (dirMode !== 0o700) {
      log?.warn('plugin directory has insecure permissions, skipping', {
        pluginDir,
        mode: dirMode.toString(8),
        expected: '700',
      });
      continue;
    }

    let rawManifest: unknown;
    try {
      rawManifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    } catch (err) {
      log?.warn('plugin manifest is not valid JSON, skipping', {
        manifestPath,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    const parseResult = PluginManifestSchema.safeParse(rawManifest);
    if (!parseResult.success) {
      log?.warn('plugin manifest validation failed, skipping', {
        manifestPath,
        errors: parseResult.error.issues.map((i) => i.message),
      });
      continue;
    }

    const manifest = parseResult.data;
    const tools: RuntimeToolDescriptor[] = [];

    for (const tool of manifest.tools) {
      const prefixedName = `plugin:${tool.name}`;
      if (seenToolNames.has(prefixedName)) {
        throw new Error(`Plugin tool name collision: "${prefixedName}" is defined by multiple plugins`);
      }
      seenToolNames.add(prefixedName);

      tools.push({
        name: prefixedName,
        description: tool.description,
        inputSchema: tool.inputSchema,
        execute: executePluginTool(tool.command, tool.timeoutMs, tool.env),
      });
    }

    plugins.push({ manifest, tools });
    log?.info('plugin loaded', { pluginId: manifest.id, toolCount: tools.length });
  }

  return plugins;
}
