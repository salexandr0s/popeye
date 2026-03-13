process.stdin.setEncoding('utf8');
let buffer = '';
process.stdin.on('data', (chunk) => {
  buffer += chunk;
});
process.stdin.on('end', () => {
  const input = JSON.parse(buffer.trim());
  const events = [
    { type: 'started', payload: { mode: 'fixture' } },
    { type: 'session', payload: { engineSessionRef: 'pi:fixture-session' } },
    { type: 'message', payload: { text: `received:${input.prompt}` } },
    { type: 'tool_call', payload: { name: 'echo' } },
    { type: 'tool_result', payload: { ok: true } },
    { type: 'completed', payload: { output: `done:${input.prompt}` } },
    { type: 'usage', payload: { provider: 'pi-fixture', model: 'fixture-model', tokensIn: 5, tokensOut: 7, estimatedCostUsd: 0 } },
  ];
  for (const event of events) {
    process.stdout.write(`${JSON.stringify(event)}\n`);
  }
});
