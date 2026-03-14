import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';

import { createLogger } from './logger.js';

function createCapture(): { stream: Writable; lines: () => Record<string, unknown>[] } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  return {
    stream,
    lines: () =>
      chunks
        .join('')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Record<string, unknown>),
  };
}

describe('createLogger', () => {
  it('produces JSON with component, msg, level, and time', () => {
    const { stream, lines } = createCapture();
    const logger = createLogger('test-component', { destination: stream });
    logger.info('hello world');
    const output = lines();
    expect(output).toHaveLength(1);
    expect(output[0]).toHaveProperty('name', 'test-component');
    expect(output[0]).toHaveProperty('msg', 'hello world');
    expect(output[0]).toHaveProperty('level', 30);
    expect(output[0]).toHaveProperty('time');
  });

  it('child() adds correlation IDs to output', () => {
    const { stream, lines } = createCapture();
    const logger = createLogger('test-component', { destination: stream });
    const child = logger.child({ workspaceId: 'ws-1' });
    child.info('with workspace');
    const output = lines();
    expect(output[0]).toHaveProperty('workspaceId', 'ws-1');
    expect(output[0]).toHaveProperty('msg', 'with workspace');
  });

  it('nested child() merges parent and child IDs', () => {
    const { stream, lines } = createCapture();
    const logger = createLogger('test-component', { destination: stream });
    const child = logger.child({ workspaceId: 'ws-1' });
    const grandchild = child.child({ runId: 'run-42' });
    grandchild.info('nested');
    const output = lines();
    expect(output[0]).toHaveProperty('workspaceId', 'ws-1');
    expect(output[0]).toHaveProperty('runId', 'run-42');
  });

  it('redacts sensitive content in messages', () => {
    const { stream, lines } = createCapture();
    const logger = createLogger('test-component', { destination: stream });
    logger.info('key is sk-ant-api03-abcdefghijklmnopqrst'); // secret-scan: allow
    const output = lines();
    expect(output[0].msg).toContain('[REDACTED:anthropic-key]');
    expect(String(output[0].msg)).not.toContain('sk-ant-api03');
  });

  it('includes details object in output', () => {
    const { stream, lines } = createCapture();
    const logger = createLogger('test-component', { destination: stream });
    logger.warn('disk full', { usedPct: 99 });
    const output = lines();
    expect(output[0]).toHaveProperty('msg', 'disk full');
    expect(output[0]).toHaveProperty('usedPct', 99);
  });
});
