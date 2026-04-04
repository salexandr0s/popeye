import { basename, dirname, resolve } from 'node:path';

export interface BundledRuntimeLayout {
  kind: 'repo-dist' | 'legacy-install' | 'mac-app-bootstrap';
  daemonEntryPoint: string;
  workingDirectory: string;
  environmentVariables?: Record<string, string>;
}

export function resolveBundledRuntimeLayout(selfPath: string, configPath?: string): BundledRuntimeLayout | null {
  const scriptName = basename(selfPath);
  const scriptDirectory = dirname(selfPath);
  const parentDirectory = dirname(scriptDirectory);
  const grandparentDirectory = dirname(parentDirectory);
  const buildKnowledgeEnvironment = (rootDirectory: string): Record<string, string> => {
    const shimsDirectory = resolve(rootDirectory, 'knowledge-python-shims');
    return {
      POPEYE_KNOWLEDGE_SHIMS: shimsDirectory,
      POPEYE_KNOWLEDGE_PYTHON: resolve(shimsDirectory, 'python3'),
      POPEYE_KNOWLEDGE_MARKITDOWN: resolve(shimsDirectory, 'markitdown'),
    };
  };

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
      environmentVariables: buildKnowledgeEnvironment(resolve(scriptDirectory, '..')),
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
      environmentVariables: buildKnowledgeEnvironment(scriptDirectory),
    };
  }

  return null;
}
