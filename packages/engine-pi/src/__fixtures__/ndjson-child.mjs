import process from 'node:process';

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  raw += chunk;
});

function write(event) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

process.on('SIGTERM', () => {
  write({ type: 'failed', payload: { classification: 'cancelled', message: 'cancelled by signal' } });
  process.exit(0);
});

process.stdin.on('end', async () => {
  const request = JSON.parse(raw || '{}');
  const input = request.prompt ?? '';

  if (input === 'malformed') {
    process.stdout.write('not-json\n');
    process.exit(0);
    return;
  }

  if (input === 'startup-fail') {
    process.stderr.write('boot failure');
    process.exit(2);
    return;
  }

  write({ type: 'started', payload: { requestId: request.requestId ?? 'missing' } });
  write({ type: 'session', payload: { engineSessionRef: 'pi:test-session' } });

  if (input === 'cancel-me') {
    setInterval(() => {}, 1_000);
    return;
  }

  if (input === 'retry-me') {
    write({ type: 'failed', payload: { classification: 'transient_failure', message: 'temporary issue' } });
    process.exit(0);
    return;
  }

  write({ type: 'message', payload: { text: `processed:${input}` } });
  write({ type: 'usage', payload: { provider: 'pi', model: 'fixture', tokensIn: '3', tokensOut: '5', estimatedCostUsd: '0.02' } });
  write({ type: 'completed', payload: { output: `done:${input}` } });
  process.exit(0);
});
