process.stdin.setEncoding('utf8');
let input = '';
process.stdin.on('data', (chunk) => {
  input += chunk;
});
process.stdin.on('end', () => {
  const request = JSON.parse(input.trim());
  const shouldFail = request.input.includes('fail');
  const malformed = request.input.includes('malformed');
  const lines = malformed
    ? ['{not-json}']
    : [
        JSON.stringify({ type: 'started', payload: { requestId: request.requestId } }),
        JSON.stringify({ type: 'session', payload: { sessionRef: `pi-session:${request.requestId}` } }),
        JSON.stringify({ type: shouldFail ? 'failed' : 'completed', payload: shouldFail ? { failureClassification: 'transient_failure', message: 'temporary' } : { output: `ok:${request.input}` } }),
        JSON.stringify({ type: 'usage', payload: { provider: 'pi', model: 'fixture-engine', tokensIn: request.input.length, tokensOut: request.input.length + 3, estimatedCostUsd: 0 } }),
      ];
  for (const line of lines) {
    process.stdout.write(`${line}\n`);
  }
  process.exit(shouldFail ? 1 : 0);
});
