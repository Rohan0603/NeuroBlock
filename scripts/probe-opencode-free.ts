import { performance } from 'node:perf_hooks';
import { OpenCodeZenClient } from '../src/system2/opencode_client.js';

const base = 'https://opencode.ai/zen/v1';
const candidates = [
  { model: 'big-pickle', endpoint: `${base}/chat/completions` },
  { model: 'space-bunny-free', endpoint: `${base}/chat/completions` },
  { model: 'mimo-v2.6-flash-free', endpoint: `${base}/chat/completions` },
  { model: 'mimo-v2.5-free', endpoint: `${base}/chat/completions` },
  { model: 'ling-3.0-flash-fin-free', endpoint: `${base}/chat/completions` },
  { model: 'nemotron-3-ultra-free', endpoint: `${base}/chat/completions` },
  { model: 'nemotron-3.5-lightning-free', endpoint: `${base}/chat/completions` },
  { model: 'muse-spark-1.3-contributor-free', endpoint: `${base}/responses` },
] as const;

const results: Array<Record<string, unknown>> = [];
for (const candidate of candidates) {
  const started = performance.now();
  try {
    const directive = await new OpenCodeZenClient({
      endpoint: candidate.endpoint,
      model: candidate.model,
    }).requestDirective('Connection diagnostic. Keep the safe Minecraft agent idle.');
    results.push({
      model: candidate.model,
      endpoint: candidate.endpoint,
      ok: Boolean(directive),
      latencyMs: Math.round((performance.now() - started) * 100) / 100,
      ...(directive ? { sample: directive.slice(0, 160) } : {}),
    });
  } catch (error) {
    results.push({
      model: candidate.model,
      endpoint: candidate.endpoint,
      ok: false,
      latencyMs: Math.round((performance.now() - started) * 100) / 100,
      error: error instanceof Error ? error.message : 'Unknown provider error',
    });
  }
}

const successful = results.filter((result) => result.ok);
const best = successful.sort((left, right) => Number(left.latencyMs) - Number(right.latencyMs))[0];
console.log(JSON.stringify({
  provider: 'opencode-zen',
  tested: results.length,
  successful: successful.length,
  recommendedModel: best?.model ?? null,
  results,
}, null, 2));

if (!best) process.exitCode = 1;
