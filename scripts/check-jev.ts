import { performance } from 'node:perf_hooks';
import { JevClient } from '../src/system1/jev_client.js';

const started = performance.now();
const result = {
  provider: 'jev',
  ok: false,
  latencyMs: 0,
  error: undefined as string | undefined,
};

try {
  const client = new JevClient({ model: process.env.JEV_MODEL ?? 'jev-latest' });
  const intent = await client.requestIntent(
    'Connection diagnostic. The agent is safe, healthy, and has no urgent target.',
    0,
    ['idle'],
  );
  if (!intent || intent.action !== 'idle') throw new Error('Jev returned no valid diagnostic intent');
  result.ok = true;
} catch (error) {
  result.error = error instanceof Error ? error.message : 'Unknown Jev diagnostic failure';
} finally {
  result.latencyMs = Math.round((performance.now() - started) * 100) / 100;
}

console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
