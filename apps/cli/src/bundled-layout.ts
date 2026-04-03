import { basename, dirname, resolve } from 'node:path';

export interface BundledRuntimeLayout {
  kind: 'repo-dist' | 'legacy-install' | 'mac-app-bootstrap';
  daemonEntryPoint: string;
  workingDirectory: string;
}

export function resolveBundledRuntimeLayout(selfPath: string, configPath?: string): BundledRuntimeLayout | null {
  const scriptName = basename(selfPath);
  const scriptDirectory = dirname(selfPath);
  const parentDirectory = dirname(scriptDirectory);
  const grandparentDirectory = dirname(parentDirectory);

  if (scriptName === 'index.cjs' && basename(scriptDirectory) === 'dist' && basename(parentDirectory) === 'cli') {
    return {
      kind: 'repo-dist',
      daemonEntryPoint: resolve(scriptDirectory, '..', '..', 'daemon', 'dist', 'index.cjs'),
      workingDirectory: resolve(scriptDirectory, '..', '..', '..'),
    };
  }

  if (scriptName === 'pop.cjs' && basename(scriptDirectory) === 'cli' && basename(parentDirectory) === 'popeye') {
    return {
      kind: 'legacy-install',
      daemonEntryPoint: resolve(scriptDirectory, '..', 'daemon', 'popeyed.cjs'),
      workingDirectory: configPath ? dirname(configPath) : resolve(scriptDirectory, '..'),
    };
  }

  if ((scriptName === 'pop' || scriptName === 'pop.cjs')
    && basename(scriptDirectory) === 'Bootstrap'
    && basename(parentDirectory) === 'Resources'
    && basename(grandparentDirectory) === 'Contents') {
    return {
      kind: 'mac-app-bootstrap',
      daemonEntryPoint: resolve(scriptDirectory, 'popeyed.cjs'),
      workingDirectory: configPath ? dirname(configPath) : parentDirectory,
    };
  }

  return null;
}
