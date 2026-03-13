import type { EngineAdapter, EngineRunHandle } from '@popeye/engine-pi';

class FakeHandle implements EngineRunHandle {
  async cancel(): Promise<void> {
    return Promise.resolve();
  }
}

export class FakeEngineAdapter implements EngineAdapter {
  async run(input: string) {
    return {
      handle: new FakeHandle(),
      events: [
        { type: 'started', payload: { input } },
        { type: 'completed', payload: { output: `echo:${input}` } },
      ],
    };
  }
}
