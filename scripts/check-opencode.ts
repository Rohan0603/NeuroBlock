import { performance } from 'node:perf_hooks';
import { OpenCodeZenClient } from '../src/system2/opencode_client.js';

const started = performance.now();
const result = {
  provider: 'opencode-zen',
  ok: false,
  latencyMs: 0,
  directive: undefined as string | undefined,
  error: undefined as string | undefined,
};

try {
  const client = new OpenCodeZenClient();
  const directive = await client.requestDirective(
    'Connection diagnostic. The Minecraft agent is safe, healthy, and should remain idle.',
  );
  if (!directive) throw new Error('OpenCode Zen returned an empty directive');
  result.directive = directive;
  result.ok = true;
} catch (error) {
  result.error = error instanceof Error ? error.message : 'Unknown OpenCode Zen diagnostic failure';
} finally {
  result.latencyMs = Math.round((performance.now() - started) * 100) / 100;
}

console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
