import { performance } from 'node:perf_hooks';
import { BrainstemTick } from '../src/system0/brainstem_tick.js';
import type { Bot } from 'mineflayer';

const bot = {
  health: 20,
  entity: { position: { x: 0, y: 64, z: 0, offset: () => ({}) } },
  blockAt: () => ({ name: 'stone' }),
  clearControlStates: () => undefined,
  setControlState: () => undefined,
} as unknown as Bot;
const source = { latest: undefined };
const tick = new BrainstemTick(bot, source);
const samples: number[] = [];
for (let i = 0; i < 1000; i += 1) {
  const start = performance.now();
  tick.tick();
  samples.push(performance.now() - start);
}
samples.sort((a, b) => a - b);
const p95 = samples[Math.floor(samples.length * 0.95)] ?? 0;
console.log(JSON.stringify({ samples: samples.length, p95Ms: Number(p95.toFixed(3)), budgetMs: 50, withinBudget: p95 <= 50 }));
if (p95 > 50) process.exitCode = 1;
