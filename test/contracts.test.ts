import test from 'node:test';
import assert from 'node:assert/strict';
import { validateLLMIntent } from '../src/system1/firewall.js';
import { CircuitBreaker } from '../src/system1/circuit_breaker.js';
import { RingBuffer } from '../src/system0/ring_buffer.js';
import { OpenCodeZenClient } from '../src/system2/opencode_client.js';
import { GoalStore } from '../src/core/goal_store.js';
import { ControlServer } from '../src/control/control_server.js';
import { AgentRuntime } from '../src/runtime/agent_runtime.js';
import { StrategicLoop } from '../src/system2/strategic_loop.js';
import { ExecutionKernel } from '../src/system0/execution_kernel.js';
import type { Bot } from 'mineflayer';

test('firewall accepts only the strict intent shape', () => {
  assert.deepEqual(validateLLMIntent({ action: 'move', state_version: 2 }), { action: 'move', state_version: 2 });
  assert.equal(validateLLMIntent({ action: 'move', state_version: 2, extra: true }), null);
  assert.equal(validateLLMIntent({ action: 'fly', state_version: 2 }), null);
  assert.deepEqual(validateLLMIntent({ action: 'place', state_version: 2, target: '{}' }), { action: 'place', state_version: 2, target: '{}' });
});

test('circuit breaker opens after three failures and permits a later probe', () => {
  let now = 0;
  const breaker = new CircuitBreaker(5000, () => now);
  breaker.failure(); breaker.failure(); breaker.failure();
  assert.equal(breaker.currentState, 'OPEN');
  assert.equal(breaker.allow(), false);
  now = 5000;
  assert.equal(breaker.allow(), true);
  assert.equal(breaker.currentState, 'HALF_OPEN');
  breaker.success();
  assert.equal(breaker.currentState, 'CLOSED');
});

test('ring buffer retains the newest fixed-size window', () => {
  const buffer = new RingBuffer<number>(2);
  buffer.push(1); buffer.push(2); buffer.push(3);
  assert.deepEqual(buffer.snapshot(), [2, 3]);
});

test('OpenCode Zen client sends bearer auth and extracts Responses API text', async () => {
  let request: Request | undefined;
  const client = new OpenCodeZenClient({
    apiKey: 'test-key',
    model: 'gpt-5.5',
    fetcher: async (_input, init) => {
      request = new Request('https://opencode.ai/zen/v1/responses', init);
      return new Response(JSON.stringify({ output: [{ content: [{ text: 'Find iron.' }] }] }), { status: 200 });
    },
  });
  assert.equal(await client.requestDirective('Inventory is empty.'), 'Find iron.');
  assert.equal(request?.headers.get('authorization'), 'Bearer test-key');
  assert.match(await request?.text() ?? '', /gpt-5\.5/);
});

test('goal store replaces and clears human goals', () => {
  const goals = new GoalStore();
  assert.equal(goals.set('Find a village').text, 'Find a village');
  goals.clear();
  assert.equal(goals.current, undefined);
  assert.throws(() => goals.set(' '));
});

test('System 0 places a held block from a validated placement target', () => {
  let placed = false;
  const bot = {
    registry: { itemsByName: { oak_planks: { id: 5 } } },
    heldItem: { type: 5 },
    blockAt: () => ({ type: 1 }),
    placeBlock: async () => { placed = true; },
  } as unknown as Bot;
  new ExecutionKernel(bot).execute({
    action: 'place',
    state_version: 0,
    target: JSON.stringify({ block: 'oak_planks', reference: { x: 0, y: 64, z: 0 }, face: { x: 0, y: 1, z: 0 } }),
  });
  assert.equal(placed, true);
});

test('control API accepts goals and lifecycle controls, never direct actions', async () => {
  const goals = new GoalStore();
  let paused = false;
  const control = new ControlServer({
    port: 18789,
    goals,
    status: () => ({ connected: true, paused, emergencyStopped: false, stateVersion: 0, decisionCount: 0, pathLength: 0, telemetryEvents: 0 }),
    pause: () => { paused = true; },
    resume: () => { paused = false; },
    emergencyStop: () => { paused = true; },
  });

  await control.start();
  try {
    const response = await fetch('http://127.0.0.1:18789/goal', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ goal: 'Build a shelter' }),
    });
    assert.equal(response.status, 200);
    assert.equal(goals.current?.text, 'Build a shelter');
    await fetch('http://127.0.0.1:18789/pause', { method: 'POST' });
    assert.equal(paused, true);
    assert.equal((await fetch('http://127.0.0.1:18789/action')).status, 404);
  } finally {
    await control.stop();
  }
});

test('complete goal-to-action flow crosses System 2, System 1, and System 0', async () => {
  const calls: string[] = [];
  const bot = {
    health: 20, food: 20,
    entity: { position: { x: 0, y: 64, z: 0, offset: (x: number, y: number, z: number) => ({ x, y, z }) } },
    entities: {}, inventory: { items: () => [] },
    blockAt: () => ({ name: 'grass_block', type: 1 }),
    setControlState: (control: string, value: boolean) => { calls.push(`system0:${control}:${value}`); },
    clearControlStates: () => { calls.push('system0:idle'); },
  } as unknown as Bot;
  const strategy = new StrategicLoop(async (goal) => { calls.push(`system2:${goal}`); return 'Locate village'; }, 60_000);
  const jev = {
    requestIntent: async (state: string) => {
      calls.push(`system1:${state.includes('Locate village')}`);
      return { action: 'move' as const, state_version: 0 };
    },
  };
  const runtime = new AgentRuntime(bot, { controlPort: 0, strategy, jev, enableNavigation: false });
  runtime.goals.set('Find a village');
  await runtime.activateForTest();
  try {
    await runtime.runDecisionCycle();
    runtime.tickOnceForTest();
    assert.equal(calls.some((call) => call === 'system2:Find a village'), true);
    assert.equal(calls.includes('system1:true'), true);
    assert.equal(calls.includes('system0:forward:true'), true);
    assert.equal(runtime.status().lastAction, 'move');
  } finally {
    await runtime.stop();
  }
});
