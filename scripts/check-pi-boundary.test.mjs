import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { findPiBoundaryViolations } from './check-pi-boundary.mjs';

function createRepo() {
  const root = mkdtempSync(join(tmpdir(), 'popeye-pi-boundary-'));
  mkdirSync(join(root, 'packages', 'engine-pi', 'src'), { recursive: true });
  mkdirSync(join(root, 'packages', 'runtime-core', 'src'), { recursive: true });
  mkdirSync(join(root, 'apps', 'cli', 'src'), { recursive: true });
  mkdirSync(join(root, 'scripts'), { recursive: true });
  return root;
}

describe('check-pi-boundary', () => {
  it('allows Pi details inside @popeye/engine-pi', () => {
    const root = createRepo();
    writeFileSync(join(root, 'packages', 'engine-pi', 'src', 'index.ts'), 'const path = "../pi/packages/coding-agent/dist/cli.js";\n');

    expect(findPiBoundaryViolations(root)).toEqual([]);
  });

  it('rejects Pi checkout paths outside @popeye/engine-pi', () => {
    const root = createRepo();
    writeFileSync(join(root, 'packages', 'runtime-core', 'src', 'index.ts'), 'const path = "../pi/packages/coding-agent/dist/cli.js";\n');

    expect(findPiBoundaryViolations(root)).toEqual([
      expect.objectContaining({
        file: 'packages/runtime-core/src/index.ts',
        line: 1,
        snippet: '../pi',
      }),
      expect.objectContaining({
        file: 'packages/runtime-core/src/index.ts',
        line: 1,
        snippet: 'packages/coding-agent',
      }),
    ]);
  });

  it('rejects Pi RPC bridge details outside @popeye/engine-pi', () => {
    const root = createRepo();
    writeFileSync(join(root, 'packages', 'runtime-core', 'src', 'bridge.ts'), 'const detail = "extension_ui_request";\n');

    expect(findPiBoundaryViolations(root)).toEqual([
      expect.objectContaining({
        file: 'packages/runtime-core/src/bridge.ts',
        line: 1,
        snippet: 'extension_ui_request',
      }),
    ]);
  });

  it('rejects Pi leakage from app source', () => {
    const root = createRepo();
    writeFileSync(join(root, 'apps', 'cli', 'src', 'index.ts'), 'const path = "../pi/bin/pi.js";\n');

    expect(findPiBoundaryViolations(root)).toEqual([
      expect.objectContaining({
        file: 'apps/cli/src/index.ts',
        line: 1,
        snippet: '../pi',
      }),
      expect.objectContaining({
        file: 'apps/cli/src/index.ts',
        line: 1,
        snippet: 'bin/pi.js',
      }),
    ]);
  });

  it('rejects Pi leakage from non-engine test files', () => {
    const root = createRepo();
    writeFileSync(join(root, 'packages', 'runtime-core', 'src', 'index.test.ts'), 'const path = "../pi/packages/coding-agent/dist/cli.js";\n');

    expect(findPiBoundaryViolations(root)).toEqual([
      expect.objectContaining({
        file: 'packages/runtime-core/src/index.test.ts',
        line: 1,
        snippet: '../pi',
      }),
      expect.objectContaining({
        file: 'packages/runtime-core/src/index.test.ts',
        line: 1,
        snippet: 'packages/coding-agent',
      }),
    ]);
  });

  it('rejects Pi leakage from package metadata and config outside src', () => {
    const root = createRepo();
    writeFileSync(join(root, 'packages', 'runtime-core', 'package.json'), JSON.stringify({ piPath: '../pi' }, null, 2));
    writeFileSync(join(root, 'apps', 'cli', 'tsconfig.json'), JSON.stringify({ references: [{ path: '../external-pi' }] }, null, 2));

    expect(findPiBoundaryViolations(root)).toEqual([
      expect.objectContaining({
        file: 'packages/runtime-core/package.json',
        snippet: '../pi',
      }),
      expect.objectContaining({
        file: 'apps/cli/tsconfig.json',
        snippet: '../external-pi"',
      }),
    ]);
  });

  it('rejects Pi leakage from top-level helper scripts', () => {
    const root = createRepo();
    writeFileSync(join(root, 'scripts', 'helper.mjs'), 'const path = join(root, "external-pi");\n');

    expect(findPiBoundaryViolations(root)).toEqual([
      expect.objectContaining({
        file: 'scripts/helper.mjs',
        snippet: 'join(root, "external-pi"',
      }),
    ]);
  });

  it('does not flag unrelated external-pi strings without path context', () => {
    const root = createRepo();
    writeFileSync(join(root, 'packages', 'runtime-core', 'src', 'receipt.test.ts'), 'const model = "external-pi";\n');

    expect(findPiBoundaryViolations(root)).toEqual([]);
  });
});
