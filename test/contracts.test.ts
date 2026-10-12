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
import { Telemetry } from '../src/core/telemetry.js';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { ACTIONS, inferRelevantCapabilities } from '../src/core/capabilities.js';
import { chooseSurvivalAction } from '../src/system1/survival_policy.js';
import { configuredWorldIdentity, parseLocraw } from '../src/core/world_identity.js';
import { TaskController } from '../src/core/task_controller.js';

test('world identity parses locraw and falls back to local configuration', () => {
  assert.deepEqual(parseLocraw('{"server":"mini1","gametype":"BEDWARS","lobbyname":"BW Lobby 1","map":"Orchestra"}'), {
    server: 'mini1', gametype: 'BEDWARS', lobbyName: 'BW Lobby 1', map: 'Orchestra', source: 'locraw',
  });
  assert.equal(parseLocraw('not-json'), undefined);
  assert.deepEqual(configuredWorldIdentity({ WORLD_SERVER: 'paper-dev', WORLD_GAMETYPE: 'survival', WORLD_MAP: 'world' }), {
    server: 'paper-dev', gametype: 'survival', map: 'world', source: 'config',
  });
});

test('firewall accepts only the strict intent shape', () => {
  assert.deepEqual(validateLLMIntent({ action: 'move', state_version: 2 }), { action: 'move', state_version: 2 });
  assert.deepEqual(validateLLMIntent({ action: 'move', targetHint: { kind: 'direction', direction: 'south', distance: 3 }, state_version: 2 }), { action: 'move', targetHint: { kind: 'direction', direction: 'south', distance: 3 }, state_version: 2 });
  assert.deepEqual(validateLLMIntent({ action: 'move', candidateId: 'east-2-1', state_version: 2 }), { action: 'move', candidateId: 'east-2-1', state_version: 2 });
  assert.equal(validateLLMIntent({ action: 'move', state_version: 2, extra: true }), null);
  assert.equal(validateLLMIntent({ action: 'fly', state_version: 2 }), null);
  assert.equal(validateLLMIntent({ action: 'place', state_version: 2, target: '{}' }), null);
  assert.deepEqual(validateLLMIntent({ action: 'place', state_version: 2, target: { kind: 'place', block: 'oak_planks', reference: { x: 0, y: 64, z: 0 }, face: { x: 0, y: 1, z: 0 } } }), { action: 'place', state_version: 2, target: { kind: 'place', block: 'oak_planks', reference: { x: 0, y: 64, z: 0 }, face: { x: 0, y: 1, z: 0 } } });
});

test('capability registry narrows relevant actions and preserves safe fallback', async () => {
  assert.deepEqual(inferRelevantCapabilities('Attack the nearby zombie'), ['attack', 'idle']);
  assert.deepEqual(inferRelevantCapabilities('Escape the mine and build a wheat farm'), ['jump', 'mine', 'eat', 'place', 'flee', 'move', 'collect', 'craft', 'idle']);
  assert.deepEqual(inferRelevantCapabilities('Locate a village'), ACTIONS);

  const strategy = new StrategicLoop(async () => 'Gather wood', 60_000);
  await strategy.run();
  assert.deepEqual(strategy.latest?.relevantCapabilities, ['collect', 'idle']);
  assert.deepEqual(strategy.latest?.objective, { kind: 'collect', text: 'Gather wood', constraints: [] });
});

test('strategic loop accepts only bounded structured task plans', async () => {
  const strategy = new StrategicLoop(async () => JSON.stringify({
    objective: 'escape',
    steps: [{ step: 'escape', purpose: 'Reach clear open ground' }],
  }), 60_000);
  await strategy.run();
  assert.deepEqual(strategy.latest?.plan, {
    objective: 'escape',
    steps: [{ step: 'escape', purpose: 'Reach clear open ground' }],
  });

  const invalid = new StrategicLoop(async () => '{"objective":"escape","steps":[{"step":"fly","purpose":"unsafe"}]}', 60_000);
  await invalid.run();
  assert.equal(invalid.latest?.plan, undefined);
});

test('System 1 survival policy sequences escape and farm preparation from primitive state', () => {
  const escapeState = JSON.stringify({
    objective: { steps: ['escape', 'gather', 'farm'] },
    escapeDigCount: 0,
    world: { onGround: true },
    surroundings: [{ solid: true }],
  });
  assert.equal(chooseSurvivalAction(escapeState, undefined, ACTIONS), 'mine');
  assert.equal(chooseSurvivalAction(JSON.stringify({
    objective: { steps: ['escape', 'gather', 'farm'] },
    world: { safeOpenGround: true },
    checkpoint: { name: 'gather_seeds' },
  }), undefined, ACTIONS), 'collect');
  assert.equal(chooseSurvivalAction(JSON.stringify({
    objective: { steps: ['escape', 'gather', 'farm'] },
    escapeDigCount: 3,
    world: { onGround: true },
    surroundings: [],
  }), undefined, ACTIONS), 'move');
  assert.equal(chooseSurvivalAction(JSON.stringify({
    objective: { steps: ['escape', 'gather', 'farm'] },
    escapeDigCount: 12,
    navigation: { lastFault: 'noPath' },
  }), undefined, ACTIONS), 'jump');
  assert.equal(chooseSurvivalAction(JSON.stringify({ checkpoint: { name: 'gather_seeds' } }), undefined, ACTIONS), 'collect');
  assert.equal(chooseSurvivalAction(JSON.stringify({ checkpoint: { name: 'craft_hoe' } }), undefined, ACTIONS), 'craft');
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

test('telemetry reports malformed persisted records', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'voxelcortex-'));
  const path = join(directory, 'telemetry.jsonl');
  await writeFile(path, '{"time":1,"type":"ok"}\nnot-json\n');
  try {
    const telemetry = new Telemetry(path);
    assert.equal((await telemetry.read()).length, 1);
    assert.equal(telemetry.malformedCount, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
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

test('task controller exposes bounded completion and failure states', () => {
  const tasks = new TaskController();
  assert.equal(tasks.start('Escape the pit', 1, 'escape', 1000).status, 'active');
  assert.equal(tasks.checkDeadline(1000)?.step, 'escape');
  assert.equal(tasks.complete(2000)?.status, 'complete');
  assert.equal(tasks.complete(3000)?.completedAt, 2000);

  tasks.start('Escape again', 2, 'escape', 1000);
  assert.equal(tasks.checkDeadline(121001)?.failure, 'task deadline exceeded');
  assert.equal(tasks.current?.status, 'failed');
});

test('System 0 delegates movement to Mineflayer pathfinder once per target', () => {
  const goals: unknown[] = [];
  const bot = {
    entity: { position: { x: 0, y: 64, z: 0 } },
    pathfinder: { setGoal: (goal: unknown) => goals.push(goal) },
  } as unknown as Bot;
  const kernel = new ExecutionKernel(bot);
  const intent = {
    action: 'move' as const,
    state_version: 0,
    target: { kind: 'near', x: 3.5, y: 65, z: -2.5 } as const,
  };

  kernel.execute(intent);
  kernel.execute(intent);

  assert.equal(goals.length, 1);
});

test('System 0 rejects loaded overhead blocks as Pathfinder stand targets', () => {
  const goals: unknown[] = [];
  const blocks = new Map([
    ['0,64,0', { boundingBox: 'block' }],
    ['0,65,0', { boundingBox: 'block' }],
    ['0,66,0', { boundingBox: 'block' }],
  ]);
  const bot = {
    entity: { position: { x: 0, y: 64, z: 0 } },
    blockAt: (position: { x: number; y: number; z: number }) => blocks.get(`${position.x},${position.y},${position.z}`),
    pathfinder: { setGoal: (goal: unknown) => goals.push(goal) },
  } as unknown as Bot;
  const kernel = new ExecutionKernel(bot);
  kernel.execute({
    action: 'move',
    state_version: 0,
    target: { kind: 'near', x: 0, y: 65, z: 0 },
  });
  assert.equal(goals.length, 0);
});

test('System 0 jump pulse moves forward while jumping', () => {
  const calls: string[] = [];
  const bot = {
    setControlState: (control: string, value: boolean) => calls.push(`${control}:${value}`),
    clearControlStates: () => {},
  } as unknown as Bot;
  const kernel = new ExecutionKernel(bot);
  kernel.execute({ action: 'jump', state_version: 0 });
  assert.deepEqual(calls.slice(0, 2), ['forward:true', 'jump:true']);
  kernel.execute({ action: 'idle', state_version: 0 });
});

test('System 0 cancels an in-flight dig via bot.stopDigging() on idle fail-safe', async () => {
  let stopped = false;
  let resolveDig: (() => void) | undefined;
  const bot = {
    entity: { position: { x: 0, y: 64, z: 0, offset: (x: number, y: number, z: number) => ({ x, y, z }) } },
    blockAt: () => ({ type: 7 }),
    canDigBlock: () => true,
    dig: () => new Promise<void>((resolve) => { resolveDig = resolve; }),
    stopDigging: () => { stopped = true; },
    clearControlStates: () => {},
  } as unknown as Bot;
  const kernel = new ExecutionKernel(bot);

  kernel.execute({ action: 'mine', state_version: 0, target: { kind: 'block', type: 7 } });
  assert.equal(stopped, false);

  kernel.execute({ action: 'idle', state_version: 0 });
  assert.equal(stopped, true);

  resolveDig?.();
});

test('System 0 digs a validated Mineflayer block target', async () => {
  let dug: unknown;
  const block = { type: 7 };
  const bot = {
    blockAt: () => block,
    canDigBlock: () => true,
    dig: async (value: unknown) => { dug = value; },
    entity: { position: { offset: () => ({}) } },
  } as unknown as Bot;
  new ExecutionKernel(bot).execute({
    action: 'mine',
    state_version: 0,
    target: { kind: 'block', type: 7, x: 1, y: 63, z: 2 },
  });
  await Promise.resolve();
  assert.equal(dug, block);
});

test('System 0 equips optional tool plugin and reports dig result', async () => {
  let equipped = false;
  let result: { ok: boolean; action: string } | undefined;
  const block = { type: 7, position: new Vec3(1, 63, 2) };
  const bot = {
    blockAt: () => block,
    canDigBlock: () => true,
    tool: { equipForBlock: async () => { equipped = true; } },
    dig: async () => {},
  } as unknown as Bot;
  new ExecutionKernel(bot, undefined, undefined, (value) => { result = value; }).execute({
    action: 'mine',
    state_version: 0,
    target: { kind: 'block', type: 7, x: 1, y: 63, z: 2 },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(equipped, true);
  assert.deepEqual(result && { ok: result.ok, action: result.action }, { ok: true, action: 'mine' });
});

test('System 0 delegates resource collection to mineflayer-collectblock', async () => {
  let collected: unknown;
  const oakLog = { name: 'oak_log', type: 17 };
  const bot = {
    findBlock: () => oakLog,
    collectBlock: { collect: async (block: unknown) => { collected = block; } },
  } as unknown as Bot;
  new ExecutionKernel(bot).execute({
    action: 'collect',
    state_version: 0,
    target: { kind: 'collect', names: ['oak_log'], maxDistance: 32 },
  });
  await Promise.resolve();
  assert.equal(collected, oakLog);
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
    target: { kind: 'place', block: 'oak_planks', reference: { x: 0, y: 64, z: 0 }, face: { x: 0, y: 1, z: 0 } },
  });
  assert.equal(placed, true);
});

test('System 0 flee reuses move() with sprint toward an away point', () => {
  const goals: unknown[] = [];
  const bot = {
    entity: { position: { x: 0, y: 64, z: 0 } },
    pathfinder: { setGoal: (goal: unknown) => goals.push(goal) },
  } as unknown as Bot;
  new ExecutionKernel(bot).execute({
    action: 'flee',
    state_version: 0,
    target: { kind: 'near', x: -4, y: 64, z: 0 },
  });
  assert.equal(goals.length, 1);
});

test('System 0 drops a named junk item via bot.tossStack', async () => {
  let tossed: unknown;
  const rottenFlesh = { name: 'rotten_flesh' };
  const bot = {
    inventory: { items: () => [rottenFlesh] },
    tossStack: async (item: unknown) => { tossed = item; },
  } as unknown as Bot;
  new ExecutionKernel(bot).execute({ action: 'drop', state_version: 0, target: { kind: 'item', name: 'rotten_flesh' } });
  await Promise.resolve();
  assert.equal(tossed, rottenFlesh);
});

test('System 0 equips an armor piece to its named destination', () => {
  let equipped: { item: number; destination: string } | undefined;
  const helmet = { name: 'iron_helmet', type: 42 };
  const bot = {
    inventory: { items: () => [helmet] },
    equip: async (item: number, destination: string) => { equipped = { item, destination }; },
  } as unknown as Bot;
  new ExecutionKernel(bot).execute({
    action: 'equip',
    state_version: 0,
    target: { kind: 'equip', item: 'iron_helmet', destination: 'head' },
  });
  assert.deepEqual(equipped, { item: 42, destination: 'head' });
});

test('System 0 sleeps on the nearest bed and skips during daytime', () => {
  let sleptOn: unknown;
  const bed = { name: 'red_bed' };
  const bot = {
    isSleeping: false,
    time: { isDay: false },
    isABed: (block: unknown) => block === bed,
    findBlock: () => bed,
    sleep: async (block: unknown) => { sleptOn = block; },
  } as unknown as Bot;
  new ExecutionKernel(bot).execute({ action: 'sleep', state_version: 0 });
  assert.equal(sleptOn, bed);

  sleptOn = undefined;
  (bot as unknown as { time: { isDay: boolean } }).time.isDay = true;
  new ExecutionKernel(bot).execute({ action: 'sleep', state_version: 0 });
  assert.equal(sleptOn, undefined);
});

test('System 0 activates a door block at the validated target position', async () => {
  let activated: unknown;
  const door = { name: 'oak_door' };
  const bot = {
    blockAt: () => door,
    activateBlock: async (block: unknown) => { activated = block; },
  } as unknown as Bot;
  new ExecutionKernel(bot).execute({
    action: 'activate',
    state_version: 0,
    target: { kind: 'activate', x: 1, y: 64, z: 2 },
  });
  await Promise.resolve();
  assert.equal(activated, door);
});

test('control API accepts goals and lifecycle controls, never direct actions', async () => {
  const goals = new GoalStore();
  let paused = false;
  const control = new ControlServer({
    port: 18789,
    goals,
    status: () => ({ connected: true, paused, emergencyStopped: false, stateVersion: 0, decisionCount: 0, telemetryEvents: 0 }),
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
  const runtime = new AgentRuntime(bot, { controlPort: 0, strategy, enableNavigation: false });
  runtime.goals.set('Find a village');
  await runtime.activateForTest();
  try {
    await runtime.runDecisionCycle();
    runtime.tickOnceForTest();
    assert.equal(calls.some((call) => call === 'system2:Find a village'), true);
    assert.equal(runtime.status().lastAction, 'move');
  } finally {
    await runtime.stop();
  }
});

test('attack intent falls back to move when survival policy has no answer', async () => {
  const attacked: unknown[] = [];
  const zombie = { id: 42, type: 'mob', displayName: 'Zombie', position: { distanceTo: () => 3 } };
  const player = { id: 7, type: 'player', displayName: 'Steve', position: { distanceTo: () => 1 } };
  const bot = {
    health: 20, food: 20,
    entity: { position: { x: 0, y: 64, z: 0, offset: (x: number, y: number, z: number) => ({ x, y, z }) } },
    entities: { 42: zombie, 7: player }, inventory: { items: () => [] },
    blockAt: () => ({ name: 'grass_block', type: 1 }),
    setControlState: () => {},
    clearControlStates: () => {},
    nearestEntity: (match: (entity: unknown) => boolean) => [zombie, player].find(match) ?? null,
    attack: (target: unknown) => { attacked.push(target); },
  } as unknown as Bot;
  const strategy = new StrategicLoop(async () => 'Defend the camp', 60_000);
  const runtime = new AgentRuntime(bot, { controlPort: 0, strategy, enableNavigation: false });
  runtime.goals.set('Explore the nearby world');
  await runtime.activateForTest();
  try {
    await runtime.runDecisionCycle();
    runtime.tickOnceForTest();
    assert.equal(runtime.status().lastAction, 'move');
  } finally {
    await runtime.stop();
  }
});

test('flee intent falls back to move when survival policy has no answer', async () => {
  const zombie = { id: 9, type: 'mob', displayName: 'Zombie', position: new Vec3(4, 64, 0) };
  const bot = {
    health: 20, food: 20,
    entity: { position: new Vec3(0, 64, 0) },
    entities: {}, inventory: { items: () => [] },
    blockAt: () => ({ name: 'grass_block', type: 1 }),
    setControlState: () => {},
    clearControlStates: () => {},
    nearestEntity: (match: (entity: unknown) => boolean) => [zombie].find(match) ?? null,
  } as unknown as Bot;
  const strategy = new StrategicLoop(async () => 'Flee the zombie', 60_000);
  const runtime = new AgentRuntime(bot, { controlPort: 0, strategy, enableNavigation: false });
  runtime.goals.set('Explore the nearby world');
  await runtime.activateForTest();
  try {
    await runtime.runDecisionCycle();
    runtime.tickOnceForTest();
    assert.equal(runtime.status().lastAction, 'move');
  } finally {
    await runtime.stop();
  }
});

test('drop intent falls back to move when survival policy has no answer', async () => {
  const rottenFlesh = { name: 'rotten_flesh', count: 3 };
  let tossed: unknown;
  const bot = {
    health: 20, food: 20,
    entity: { position: new Vec3(0, 64, 0) },
    entities: {}, inventory: { items: () => [rottenFlesh] },
    blockAt: () => ({ name: 'grass_block', type: 1 }),
    setControlState: () => {},
    clearControlStates: () => {},
    tossStack: async (item: unknown) => { tossed = item; },
  } as unknown as Bot;
  const strategy = new StrategicLoop(async () => 'Clean the inventory', 60_000);
  const runtime = new AgentRuntime(bot, { controlPort: 0, strategy, enableNavigation: false });
  runtime.goals.set('Explore the nearby world');
  await runtime.activateForTest();
  try {
    await runtime.runDecisionCycle();
    runtime.tickOnceForTest();
    await Promise.resolve();
    assert.equal(runtime.status().lastAction, 'move');
  } finally {
    await runtime.stop();
  }
});

test('equip intent falls back to move when survival policy has no answer', async () => {
  const helmet = { name: 'iron_helmet', type: 42, count: 1 };
  let equipped: { item: number; destination: string } | undefined;
  const bot = {
    health: 20, food: 20,
    entity: { position: new Vec3(0, 64, 0) },
    entities: {}, inventory: { items: () => [helmet] },
    blockAt: () => ({ name: 'grass_block', type: 1 }),
    setControlState: () => {},
    clearControlStates: () => {},
    equip: async (item: number, destination: string) => { equipped = { item, destination }; },
  } as unknown as Bot;
  const strategy = new StrategicLoop(async () => 'Gear up for danger', 60_000);
  const runtime = new AgentRuntime(bot, { controlPort: 0, strategy, enableNavigation: false });
  runtime.goals.set('Explore the nearby world');
  await runtime.activateForTest();
  try {
    await runtime.runDecisionCycle();
    runtime.tickOnceForTest();
    assert.equal(runtime.status().lastAction, 'move');
  } finally {
    await runtime.stop();
  }
});

test('activate intent falls back to move when survival policy has no answer', async () => {
  const door = { name: 'oak_door', position: new Vec3(1, 64, 2) };
  let activated: unknown;
  const bot = {
    health: 20, food: 20,
    entity: { position: new Vec3(0, 64, 0) },
    entities: {}, inventory: { items: () => [] },
    blockAt: () => door,
    setControlState: () => {},
    clearControlStates: () => {},
    findBlock: () => door,
    activateBlock: async (block: unknown) => { activated = block; },
  } as unknown as Bot;
  const strategy = new StrategicLoop(async () => 'Open the door', 60_000);
  const runtime = new AgentRuntime(bot, { controlPort: 0, strategy, enableNavigation: false });
  runtime.goals.set('Explore the nearby world');
  await runtime.activateForTest();
  try {
    await runtime.runDecisionCycle();
    runtime.tickOnceForTest();
    assert.equal(runtime.status().lastAction, 'move');
  } finally {
    await runtime.stop();
  }
});
