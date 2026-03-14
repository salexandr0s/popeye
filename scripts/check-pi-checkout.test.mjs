import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { inspectPiCheckout, readPiExpectation, verifyPiCheckout } from './check-pi-checkout.mjs';

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2));
}

function createConfig(root, piVersion = '0.57.1', piPath = '../pi') {
  const configPath = join(root, 'config.json');
  writeJson(configPath, {
    engine: {
      piVersion,
      piPath,
    },
  });
  return configPath;
}

function createPiCheckout(root, version = '0.57.1', withCli = true) {
  const piPath = join(root, 'pi');
  mkdirSync(join(piPath, 'packages', 'coding-agent', 'dist'), { recursive: true });
  writeJson(join(piPath, 'packages', 'coding-agent', 'package.json'), {
    name: '@fake/coding-agent',
    version,
  });
  if (withCli) {
    writeFileSync(join(piPath, 'packages', 'coding-agent', 'dist', 'cli.js'), 'console.log("ok");\n');
  }
  return piPath;
}

describe('check-pi-checkout', () => {
  it('reads Pi version expectation from config', () => {
    const root = mkdtempSync(join(tmpdir(), 'popeye-pi-config-'));
    const configPath = createConfig(root, '0.57.1', '../pi');

    expect(readPiExpectation(configPath)).toEqual({
      configPath,
      piVersion: '0.57.1',
      piPath: '../pi',
    });
  });

  it('accepts a matching Pi checkout with built CLI', () => {
    const root = mkdtempSync(join(tmpdir(), 'popeye-pi-checkout-'));
    const piPath = createPiCheckout(root, '0.57.1');

    expect(inspectPiCheckout(piPath, '0.57.1')).toEqual(
      expect.objectContaining({
        ok: true,
        actualVersion: '0.57.1',
        expectedVersion: '0.57.1',
      }),
    );
  });

  it('accepts a custom non-node command without requiring the default Pi CLI path', () => {
    const root = mkdtempSync(join(tmpdir(), 'popeye-pi-checkout-'));
    const piPath = createPiCheckout(root, '0.57.1', false);

    expect(inspectPiCheckout(piPath, '0.57.1', { command: 'bun', args: ['run', 'pi'] })).toEqual(
      expect.objectContaining({
        ok: true,
        requiredLaunchPath: null,
      }),
    );
  });

  it('accepts a custom node entrypoint without requiring the default Pi CLI path', () => {
    const root = mkdtempSync(join(tmpdir(), 'popeye-pi-checkout-'));
    const piPath = join(root, 'pi');
    mkdirSync(join(piPath, 'packages', 'coding-agent'), { recursive: true });
    mkdirSync(join(piPath, 'custom'), { recursive: true });
    writeJson(join(piPath, 'packages', 'coding-agent', 'package.json'), {
      name: '@fake/coding-agent',
      version: '0.57.1',
    });
    writeFileSync(join(piPath, 'custom', 'launcher.js'), 'console.log("ok");\n');

    expect(inspectPiCheckout(piPath, '0.57.1', { command: 'node', args: ['custom/launcher.js'] })).toEqual(
      expect.objectContaining({
        ok: true,
        requiredLaunchPath: expect.stringContaining('custom/launcher.js'),
      }),
    );
  });

  it('reports version mismatches against coding-agent version', () => {
    const root = mkdtempSync(join(tmpdir(), 'popeye-pi-checkout-'));
    const piPath = createPiCheckout(root, '0.57.2');

    expect(inspectPiCheckout(piPath, '0.57.1')).toEqual(
      expect.objectContaining({
        ok: false,
        errors: ['Pi coding-agent version mismatch: expected 0.57.1, received 0.57.2'],
      }),
    );
  });

  it('reports missing built CLI', () => {
    const root = mkdtempSync(join(tmpdir(), 'popeye-pi-checkout-'));
    const piPath = createPiCheckout(root, '0.57.1', false);

    expect(inspectPiCheckout(piPath, '0.57.1')).toEqual(
      expect.objectContaining({
        ok: false,
        errors: [expect.stringContaining('Missing default Pi CLI')],
      }),
    );
  });

  it('verifies a checkout against config expectations', () => {
    const root = mkdtempSync(join(tmpdir(), 'popeye-pi-checkout-'));
    const piPath = createPiCheckout(root, '0.57.1');
    const configPath = createConfig(root, '0.57.1', piPath);

    expect(verifyPiCheckout({ configPath })).toEqual(
      expect.objectContaining({
        ok: true,
        expectedVersion: '0.57.1',
        actualVersion: '0.57.1',
      }),
    );
  });

  it('accepts pnpm-style argument forwarding for CLI usage', () => {
    const root = mkdtempSync(join(tmpdir(), 'popeye-pi-checkout-'));
    const piPath = createPiCheckout(root, '0.57.1');
    const configPath = createConfig(root, '0.57.1', piPath);
    const scriptPath = fileURLToPath(new URL('./check-pi-checkout.mjs', import.meta.url));

    const output = execFileSync(process.execPath, [scriptPath, '--', '--config', configPath], {
      encoding: 'utf8',
    });

    expect(output).toContain('Pi checkout verified');
  });

  it('accepts custom launch config forwarded via CLI usage', () => {
    const root = mkdtempSync(join(tmpdir(), 'popeye-pi-checkout-'));
    const piPath = createPiCheckout(root, '0.57.1', false);
    const configPath = createConfig(root, '0.57.1', piPath);
    const scriptPath = fileURLToPath(new URL('./check-pi-checkout.mjs', import.meta.url));

    const output = execFileSync(process.execPath, [scriptPath, '--', '--config', configPath, '--command', 'bun', '--args-json', '["run","pi"]'], {
      encoding: 'utf8',
    });

    expect(output).toContain('Verified launch command: bun');
  });
});
