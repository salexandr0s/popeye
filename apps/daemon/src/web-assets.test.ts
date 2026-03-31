import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveWebInspectorAssets } from './web-assets.js';

describe('resolveWebInspectorAssets', () => {
  it('finds the web inspector bundle from the source-tree dist layout', () => {
    const root = mkdtempSync(join(tmpdir(), 'popeye-web-assets-'));
    const moduleDir = join(root, 'apps', 'daemon', 'dist');
    const distDir = join(root, 'apps', 'web-inspector', 'dist');
    mkdirSync(moduleDir, { recursive: true });
    mkdirSync(distDir, { recursive: true });
    writeFileSync(join(distDir, 'index.html'), '<html></html>');

    expect(resolveWebInspectorAssets(moduleDir)).toEqual({
      distDir,
      indexPath: join(distDir, 'index.html'),
    });
  });

  it('returns null when the dist directory exists but index.html is missing', () => {
    const root = mkdtempSync(join(tmpdir(), 'popeye-web-assets-missing-'));
    const moduleDir = join(root, 'apps', 'daemon', 'dist');
    const distDir = join(root, 'apps', 'web-inspector', 'dist');
    mkdirSync(moduleDir, { recursive: true });
    mkdirSync(distDir, { recursive: true });

    expect(resolveWebInspectorAssets(moduleDir)).toBeNull();
  });
});
