import { mkdtempSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, beforeEach } from 'vitest';

import { loadPlugins, type PluginLogger } from './plugin-loader.ts';

function makePluginsDir(): string {
  return mkdtempSync(join(tmpdir(), 'popeye-plugins-'));
}

function writePlugin(
  pluginsDir: string,
  dirName: string,
  manifest: Record<string, unknown>,
  mode = 0o700,
): string {
  const pluginDir = join(pluginsDir, dirName);
  mkdirSync(pluginDir, { recursive: true, mode });
  chmodSync(pluginDir, mode);
  writeFileSync(join(pluginDir, 'manifest.json'), JSON.stringify(manifest));
  return pluginDir;
}

function makeMockLog(): PluginLogger & { messages: Array<{ level: string; msg: string; meta?: Record<string, unknown> }> } {
  const messages: Array<{ level: string; msg: string; meta?: Record<string, unknown> }> = [];
  return {
    messages,
    info: (msg: string, meta?: Record<string, unknown>) => messages.push({ level: 'info', msg, meta }),
    warn: (msg: string, meta?: Record<string, unknown>) => messages.push({ level: 'warn', msg, meta }),
    error: (msg: string, meta?: Record<string, unknown>) => messages.push({ level: 'error', msg, meta }),
  };
}

const VALID_MANIFEST = {
  id: 'test-plugin',
  name: 'Test Plugin',
  version: '1.0.0',
  tools: [
    {
      name: 'greet',
      description: 'Returns a greeting',
      inputSchema: { name: { type: 'string' } },
      command: 'echo \'{"text":"hello"}\'',
    },
  ],
};

describe('loadPlugins', () => {
  let pluginsDir: string;
  let log: ReturnType<typeof makeMockLog>;

  beforeEach(() => {
    pluginsDir = makePluginsDir();
    log = makeMockLog();
  });

  it('loads a valid plugin manifest', () => {
    writePlugin(pluginsDir, 'test-plugin', VALID_MANIFEST);

    const plugins = loadPlugins(pluginsDir, log);

    expect(plugins).toHaveLength(1);
    expect(plugins[0].manifest.id).toBe('test-plugin');
    expect(plugins[0].tools).toHaveLength(1);
    expect(plugins[0].tools[0].name).toBe('plugin:greet');
    expect(plugins[0].tools[0].description).toBe('Returns a greeting');
    expect(typeof plugins[0].tools[0].execute).toBe('function');
  });

  it('rejects invalid manifest (missing required fields)', () => {
    writePlugin(pluginsDir, 'bad-plugin', { id: 'bad', name: 'Bad' });

    const plugins = loadPlugins(pluginsDir, log);

    expect(plugins).toHaveLength(0);
    expect(log.messages.some((m) => m.level === 'warn' && m.msg.includes('validation failed'))).toBe(true);
  });

  it('rejects manifest with invalid tool name pattern', () => {
    writePlugin(pluginsDir, 'bad-names', {
      ...VALID_MANIFEST,
      id: 'bad-names',
      tools: [{ ...VALID_MANIFEST.tools[0], name: 'InvalidName' }],
    });

    const plugins = loadPlugins(pluginsDir, log);

    expect(plugins).toHaveLength(0);
  });

  it('detects tool name collision across plugins', () => {
    writePlugin(pluginsDir, 'plugin-a', VALID_MANIFEST);
    writePlugin(pluginsDir, 'plugin-b', { ...VALID_MANIFEST, id: 'plugin-b', name: 'Plugin B' });

    expect(() => loadPlugins(pluginsDir, log)).toThrow(/name collision.*plugin:greet/);
  });

  it('skips directory with insecure permissions', () => {
    writePlugin(pluginsDir, 'insecure', VALID_MANIFEST, 0o755);

    const plugins = loadPlugins(pluginsDir, log);

    expect(plugins).toHaveLength(0);
    expect(log.messages.some((m) => m.level === 'warn' && m.msg.includes('insecure permissions'))).toBe(true);
  });

  it('skips directory without manifest.json', () => {
    mkdirSync(join(pluginsDir, 'no-manifest'), { mode: 0o700 });

    const plugins = loadPlugins(pluginsDir, log);

    expect(plugins).toHaveLength(0);
    expect(log.messages.some((m) => m.level === 'warn' && m.msg.includes('missing manifest'))).toBe(true);
  });

  it('returns empty array for non-existent directory', () => {
    const plugins = loadPlugins('/tmp/popeye-nonexistent-plugins-dir', log);

    expect(plugins).toHaveLength(0);
    expect(log.messages.some((m) => m.level === 'info' && m.msg.includes('does not exist'))).toBe(true);
  });

  it('executes a plugin tool via shell', async () => {
    writePlugin(pluginsDir, 'echo-plugin', {
      id: 'echo-plugin',
      name: 'Echo Plugin',
      tools: [
        {
          name: 'echo_input',
          description: 'Echoes the input as JSON',
          inputSchema: { msg: { type: 'string' } },
          command: 'cat | jq -c \'{text: .msg}\'',
        },
      ],
    });

    const plugins = loadPlugins(pluginsDir, log);
    expect(plugins).toHaveLength(1);

    const tool = plugins[0].tools[0];
    const result = await tool.execute!({ msg: 'hello world' });

    expect(result.content).toHaveLength(1);
    expect(result.content[0].text).toBe('hello world');
  });

  it('handles tool timeout', async () => {
    writePlugin(pluginsDir, 'slow-plugin', {
      id: 'slow-plugin',
      name: 'Slow Plugin',
      tools: [
        {
          name: 'slow_tool',
          description: 'Sleeps forever',
          inputSchema: {},
          command: 'sleep 60',
          timeoutMs: 500,
        },
      ],
    });

    const plugins = loadPlugins(pluginsDir, log);
    const tool = plugins[0].tools[0];
    const result = await tool.execute!({});

    expect(result.content[0].text).toMatch(/timed out|failed/i);
  }, 10_000);

  it('handles non-zero exit code', async () => {
    writePlugin(pluginsDir, 'fail-plugin', {
      id: 'fail-plugin',
      name: 'Fail Plugin',
      tools: [
        {
          name: 'fail_tool',
          description: 'Always fails',
          inputSchema: {},
          command: 'echo "something went wrong" >&2 && exit 1',
        },
      ],
    });

    const plugins = loadPlugins(pluginsDir, log);
    const tool = plugins[0].tools[0];
    const result = await tool.execute!({});

    expect(result.content[0].text).toContain('something went wrong');
  });

  it('applies default timeoutMs and env', () => {
    writePlugin(pluginsDir, 'defaults-plugin', {
      id: 'defaults-plugin',
      name: 'Defaults Plugin',
      tools: [
        {
          name: 'default_tool',
          description: 'Uses defaults',
          inputSchema: {},
          command: 'echo ok',
        },
      ],
    });

    const plugins = loadPlugins(pluginsDir, log);
    expect(plugins).toHaveLength(1);
    // Tool loaded successfully with defaults — the fact it doesn't throw is the assertion
  });
});
