import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export interface WebInspectorAssets {
  distDir: string;
  indexPath: string;
}

export function resolveWebInspectorAssets(moduleDir: string): WebInspectorAssets | null {
  const distDir = resolve(moduleDir, '../../web-inspector/dist');
  const indexPath = resolve(distDir, 'index.html');
  if (!existsSync(indexPath)) {
    return null;
  }
  return { distDir, indexPath };
}
