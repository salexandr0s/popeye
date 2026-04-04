import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CommandContext } from '../formatters.js';
import { handleKnowledge } from './memory.js';

function makeCtx(client: object, subcommand: string, arg1?: string): CommandContext {
  return {
    client: client as CommandContext['client'],
    subcommand,
    arg1,
    arg2: undefined,
    jsonFlag: false,
    positionalArgs: [],
  };
}

describe('knowledge CLI commands', () => {
  const originalArgv = process.argv.slice();

  afterEach(() => {
    process.argv = originalArgv.slice();
    vi.restoreAllMocks();
  });

  it('searches knowledge documents through the Knowledge API', async () => {
    process.argv = ['node', 'pop', 'knowledge', 'search', 'optimization', '--workspace', 'default'];
    const listKnowledgeDocuments = vi.fn().mockResolvedValue([{ id: 'doc-1', title: 'Compiler Notes' }]);
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    await handleKnowledge(makeCtx({ listKnowledgeDocuments }, 'search', 'optimization'));

    expect(listKnowledgeDocuments).toHaveBeenCalledWith({
      workspaceId: 'default',
      kind: undefined,
      q: 'optimization',
    });
    expect(info).toHaveBeenCalled();
  });

  it('imports a knowledge source from CLI flags', async () => {
    process.argv = [
      'node',
      'pop',
      'knowledge',
      'import',
      'Compiler Notes',
      '--workspace',
      'default',
      '--type',
      'website',
      '--uri',
      'https://example.com/post',
    ];
    const importKnowledgeSource = vi.fn().mockResolvedValue({ outcome: 'created' });

    await handleKnowledge(makeCtx({ importKnowledgeSource }, 'import', 'Compiler Notes'));

    expect(importKnowledgeSource).toHaveBeenCalledWith({
      workspaceId: 'default',
      sourceType: 'website',
      title: 'Compiler Notes',
      sourceUri: 'https://example.com/post',
      sourcePath: undefined,
      sourceText: undefined,
    });
  });

  it('shows converter readiness', async () => {
    process.argv = ['node', 'pop', 'knowledge', 'converters'];
    const listKnowledgeConverters = vi.fn().mockResolvedValue([{ id: 'markitdown', status: 'ready' }]);
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    await handleKnowledge(makeCtx({ listKnowledgeConverters }, 'converters'));

    expect(listKnowledgeConverters).toHaveBeenCalled();
    expect(info).toHaveBeenCalled();
  });
});
