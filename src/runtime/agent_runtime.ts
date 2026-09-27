import type { Bot } from 'mineflayer';
import type { Entity } from 'prismarine-entity';
import type { Action, AgentStatus, Intent, IntentEpoch, IntentTarget } from '../core/types.js';
import { GoalStore } from '../core/goal_store.js';
import { BrainstemTick, type IntentSource } from '../system0/brainstem_tick.js';
import { ExecutionKernel } from '../system0/execution_kernel.js';
import { JevClient } from '../system1/jev_client.js';
import { OpenCodeZenClient } from '../system2/opencode_client.js';
import { StrategicLoop } from '../system2/strategic_loop.js';
import { ControlServer } from '../control/control_server.js';
import { Telemetry } from '../core/telemetry.js';
import { ACTIONS, NON_IDLE_ACTIONS } from '../core/capabilities.js';
import pathfinderModule from 'mineflayer-pathfinder';
import collectBlockPlugin from 'mineflayer-collectblock';
import { Vec3 } from 'vec3';
const { Movements, pathfinder } = pathfinderModule;

export interface AgentRuntimeOptions {
  readonly controlPort?: number;
  readonly jev?: IntentProvider;
  readonly strategy?: StrategicLoop;
  readonly enableNavigation?: boolean;
}

export interface IntentProvider {
  requestIntent(state: string, stateVersion: number, actions: readonly Action[]): Promise<import('../core/types.js').Intent | null>;
}

export class AgentRuntime {
  public readonly goals = new GoalStore();
  private readonly source: IntentSource = { latest: undefined };
  private readonly brainstem: BrainstemTick;
  private readonly strategy: StrategicLoop;
  private readonly jev: IntentProvider;
  private readonly control: ControlServer;
  private readonly kernel: ExecutionKernel;
  private readonly enableNavigation: boolean;
  private readonly telemetry = new Telemetry();
  private timer: NodeJS.Timeout | undefined;
  private stateVersion = 0;
  private lastGoalVersion = 0;
  private lastAction: Action | undefined;
  private connected = false;
  private paused = false;
  private emergencyStopped = false;
  private decisionCount = 0;
  private lastError: string | undefined;
  private navigationState: 'idle' | 'planning' | 'moving' | 'stalled' = 'idle';
  private navigationGoal: { x: number; y: number; z: number } | undefined;
  private navigationLastPathStatus: 'success' | 'partial' | 'timeout' | 'noPath' | undefined;
  private navigationRecoveryCount = 0;
  private navigationLastFault: string | undefined;
  private navigationInitialized = false;
  private collectionInitialized = false;
  private embeddedRecoveryAt = 0;
  private repeatedAction = 0;
  private previousAction: Action | undefined;
  private recoveryDecisionActive = false;

  public constructor(private readonly bot: Bot, options: AgentRuntimeOptions = {}) {
    this.kernel = new ExecutionKernel(bot, (error) => this.recordKernelError(error), (type, data) => this.telemetry.record(type, data));
    this.enableNavigation = options.enableNavigation !== false;
    this.brainstem = new BrainstemTick(bot, this.source, (type, data) => {
      if (type === 'system0.error' && typeof data?.error === 'string') this.lastError = `System 0: ${data.error}`;
      this.telemetry.record(type, data);
    });
    this.jev = options.jev ?? new JevClient();
    this.strategy = options.strategy ?? new StrategicLoop(async () => {
      const goal = this.goals.current?.text ?? 'Explore the nearby world and improve survival.';
      return await new OpenCodeZenClient().requestDirective(JSON.stringify({
        goal,
        state: this.observe(),
        role: 'Convert the human goal into one safe, prioritized strategic directive for System 1.',
      })) ?? goal;
    }, 30000, () => this.goals.current?.text);
    this.control = new ControlServer({
      port: options.controlPort ?? Number(process.env.CONTROL_PORT ?? 8787),
      goals: this.goals,
      status: () => this.status(),
      pause: () => { this.paused = true; this.idle(); },
      resume: () => { if (!this.emergencyStopped) this.paused = false; },
      emergencyStop: () => { this.emergencyStopped = true; this.paused = true; this.idle(); },
      telemetry: () => this.telemetry.read(),
    });
  }

  public async start(): Promise<void> {
    if (this.timer) return;
    this.initializePlugins();
    this.connected = true;
    this.telemetry.record('runtime.started');
    this.bindLifecycleSafety();
    this.bot.on('physicsTick', () => this.monitorEmbeddedBot());
    await this.control.start();
    this.brainstem.start();
    this.strategy.start();
    void this.refreshStrategy().catch((error) => console.error('Strategic directive failed', error));
    this.timer = setInterval(() => { void this.decide(); }, 750);
    this.timer.unref();
    console.log('VoxelCortex active runtime control: http://127.0.0.1:8787/status');
  }

  private initializePlugins(): void {
    if (this.enableNavigation && !this.navigationInitialized) {
      if (!this.bot.pathfinder) this.bot.loadPlugin(pathfinder);
      this.bindNavigationEvents();
      const movements = new Movements(this.bot);
      movements.canDig = false;
      movements.allowParkour = false;
      movements.allowFreeMotion = false;
      movements.allowSprinting = false;
      movements.allow1by1towers = false;
      movements.maxDropDown = 2;
      if (this.bot.registry.blocksByName.vine) movements.climbables.add(this.bot.registry.blocksByName.vine.id);
      this.bot.pathfinder.setMovements(movements);
      this.bot.pathfinder.thinkTimeout = 250;
      this.bot.pathfinder.tickTimeout = 10;
      Object.assign(this.bot.pathfinder, { searchRadius: 16 });
      this.navigationInitialized = true;
    }
    if (!this.collectionInitialized) {
      this.bot.loadPlugin(collectBlockPlugin.plugin);
      this.collectionInitialized = true;
    }
  }

  private monitorEmbeddedBot(): void {
      if (!this.connected || this.paused || this.emergencyStopped || !this.bot.entity) return;
      const position = this.bot.entity.position.floored();
      const feet = this.bot.blockAt(position);
      const head = this.bot.blockAt(position.offset(0, 1, 0));
      if (feet?.boundingBox !== 'block' && head?.boundingBox !== 'block') return;
      const now = Date.now();
      if (now - this.embeddedRecoveryAt < 1000) return;
      this.embeddedRecoveryAt = now;
      this.navigationRecoveryCount += 1;
      this.navigationState = 'planning';
      this.navigationLastFault = 'embedded';
      const safe = this.findSafeStand(position);
      const target = safe ? { x: safe.x, y: safe.y + 1, z: safe.z } : undefined;
      this.navigationGoal = target;
      this.telemetry.record('navigation.embedded', { position, target, recoveryCount: this.navigationRecoveryCount });
      if (this.navigationRecoveryCount > 3) {
        this.paused = true;
        this.lastError = 'Bot remains embedded after 3 rescue attempts';
        this.idle();
        return;
      }
      this.kernel.rescueFromEmbedded(target);
    }

  private findSafeStand(origin: Vec3): Vec3 | undefined {
      const points = this.bot.findBlocks({
        matching: (block) => {
          if (block.boundingBox !== 'block') return false;
          const above = this.bot.blockAt(block.position.offset(0, 1, 0));
          const head = this.bot.blockAt(block.position.offset(0, 2, 0));
          return above?.type === 0 && head?.type === 0;
        },
        maxDistance: 8,
        count: 32,
      });
      return points.sort((left, right) => left.distanceTo(origin) - right.distanceTo(origin))[0];
  }

  public async activateForTest(): Promise<void> {
    this.connected = true;
    await this.refreshStrategy();
  }

  public tickOnceForTest(): void { this.brainstem.tick(); }

  private observe(): string {
    const position = this.bot.entity?.position;
    const blockPosition = position
      ? typeof position.floored === 'function'
        ? position.floored()
        : new Vec3(Math.floor(position.x), Math.floor(position.y), Math.floor(position.z))
      : undefined;
    const feetBlock = blockPosition ? this.bot.blockAt(blockPosition) : undefined;
    const headBlock = blockPosition ? this.bot.blockAt(blockPosition.offset(0, 1, 0)) : undefined;
    const inventory = this.bot.inventory?.items().slice(0, 12).map((item) => `${item.name}:${item.count}`).join(', ') ?? '';
    return JSON.stringify({
      directive: this.strategy.latest?.text ?? 'Explore and survive.',
      objective: this.strategy.latest?.objective ?? null,
      health: this.bot.health,
      food: this.bot.food,
      position: position ? { x: Math.round(position.x), y: Math.round(position.y), z: Math.round(position.z) } : null,
      inventory,
      nearbyEntities: Object.values(this.bot.entities)
        .filter((entity) => entity !== this.bot.entity)
        .slice(0, 8)
        .map((entity) => ({
          id: entity.id,
          name: entity.name ?? entity.type,
          type: entity.type,
          distance: position ? Number(entity.position.distanceTo(position).toFixed(1)) : null,
          position: { x: Math.floor(entity.position.x), y: Math.floor(entity.position.y), z: Math.floor(entity.position.z) },
        })),
      world: {
        version: this.bot.version,
        dimension: this.bot.game?.dimension,
        onGround: this.bot.entity?.onGround,
        yaw: this.bot.entity?.yaw,
        timeOfDay: this.bot.time?.timeOfDay,
        heldItem: this.bot.heldItem?.name ?? null,
        feetBlock: feetBlock?.name ?? null,
        headBlock: headBlock?.name ?? null,
        embedded: feetBlock?.boundingBox === 'block' || headBlock?.boundingBox === 'block',
      },
      navigation: {
        state: this.navigationState,
        goal: this.navigationGoal,
        recoveryCount: this.navigationRecoveryCount,
        lastFault: this.navigationLastFault,
      },
      surroundings: this.surroundingBlocks(blockPosition),
      terrain: this.terrain(blockPosition),
      capabilities: NON_IDLE_ACTIONS,
    });
  }

  public async runDecisionCycle(): Promise<void> {
    if (!this.connected || !this.bot.entity || this.paused || this.emergencyStopped) return;
    try {
      if (this.paused || this.emergencyStopped) return;
      if ((this.goals.current?.version ?? 0) !== this.lastGoalVersion) await this.refreshStrategy();
      const directive = this.strategy.latest?.text ?? 'Explore the nearby world and improve survival.';
      this.telemetry.record('system1.request', { directive });
      const recovery = this.navigationState === 'stalled' && this.navigationRecoveryCount > 0;
      const actions = recovery ? ACTIONS : (this.strategy.latest?.relevantCapabilities ?? ACTIONS);
      const providerIntent = await this.jev.requestIntent(JSON.stringify({
        directive,
        state: this.observe(),
        capabilities: actions,
        recovery,
        role: recovery
          ? 'Navigation is stuck. Use supplied world and surrounding data to choose the safest recovery action.'
          : 'Convert the strategic directive into one immediate validated action.',
      }), this.stateVersion, actions);
      const intent = this.completeIntent(providerIntent ?? { action: 'move', state_version: this.stateVersion }, directive);
      this.source.latest = { intent, stateVersion: this.stateVersion, requestId: Date.now() };
      this.telemetry.record('system1.intent', { action: this.source.latest.intent.action, target: this.source.latest.intent.target });
      this.lastAction = this.source.latest.intent.action;
      this.decisionCount += 1;
      this.telemetry.record('decision', { action: this.lastAction, stateVersion: this.stateVersion });
      this.lastError = undefined;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : 'Decision cycle failed';
      this.source.latest = undefined;
      this.lastAction = 'idle';
      this.telemetry.record('decision.failed', { error: this.lastError });
    }
  }

  private async decide(): Promise<void> { await this.runDecisionCycle(); }

  private completeIntent(intent: Intent, directive: string): Intent {
    const goal = `${this.goals.current?.text ?? ''} ${directive}`.toLowerCase();
    const building = /build|home|shelter|house|farm/.test(goal);
    const inventory = this.bot.inventory.items();
    const hasPlanks = inventory.some((item) => /planks/.test(item.name) && item.count > 0);
    const hasLogs = inventory.some((item) => /log/.test(item.name) && item.count > 0);
    if (building && hasPlanks && (intent.action === 'move' || intent.action === 'mine' || intent.action === 'place')) {
      const target = this.placementTarget();
      if (target) return { action: 'place', target, state_version: intent.state_version };
    }
    if (building && hasLogs && intent.action === 'mine') {
      return { action: 'craft', target: { kind: 'craft', item: 'oak_planks' }, state_version: intent.state_version };
    }
    const repeated = this.previousAction === intent.action;
    this.repeatedAction = repeated ? this.repeatedAction + 1 : 1;
    this.previousAction = intent.action;
    if (!this.goals.current && intent.action === 'move') {
      return { action: 'idle', state_version: intent.state_version };
    }
    if (intent.target) return intent;
    if ((intent.action === 'move' || intent.action === 'flee') && this.enableNavigation) {
      if (!intent.target) {
        const target = this.explorationGoal();
        this.navigationGoal = target;
        this.navigationState = 'planning';
        return { ...intent, target: { kind: 'near', ...target } };
      }
    }
    if (intent.action === 'mine' && repeated && this.repeatedAction >= 4 && goal.includes('build')) {
      return { action: 'craft', target: { kind: 'craft', item: 'oak_planks' }, state_version: intent.state_version };
    }
    if (intent.action === 'mine') {
      const block = this.bot.blockAt(this.bot.entity.position.offset(0, -1, 0));
      return block && block.type > 0 ? { ...intent, target: { kind: 'block', type: block.type } } : { action: 'move', state_version: intent.state_version };
    }
    if (intent.action === 'collect') {
      const names = goal.includes('wood') || goal.includes('log') ? ['oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'mangrove_log', 'cherry_log'] : ['stone', 'coal_ore', 'iron_ore'];
      return { ...intent, target: { kind: 'collect', names, maxDistance: 32 } };
    }
    if (intent.action === 'craft') {
      const target = goal.includes('farm') ? 'wooden_hoe' : 'oak_planks';
      return { ...intent, target: { kind: 'craft', item: target } };
    }
    if (intent.action === 'attack') {
      const entity = this.nearestThreat(4);
      return entity ? { ...intent, target: { kind: 'entity', id: entity.id } } : { action: 'move', state_version: intent.state_version };
    }
    if (intent.action === 'flee') {
      const threat = this.nearestThreat(8);
      if (!threat) return { action: 'idle', state_version: intent.state_version };
      const position = this.bot.entity.position;
      const away = position.plus(position.minus(threat.position).unit().scaled(4));
      return { action: 'flee', target: { kind: 'near', x: away.x, y: Math.floor(position.y), z: away.z }, state_version: intent.state_version };
    }
    if (intent.action === 'drop') {
      const junk = this.bot.inventory.items().find((item) => /rotten_flesh|poisonous_potato|spider_eye/.test(item.name));
      return junk ? { ...intent, target: { kind: 'item', name: junk.name } } : { action: 'idle', state_version: intent.state_version };
    }
    if (intent.action === 'equip') {
      const target = this.armorTarget();
      return target ? { ...intent, target } : { action: 'idle', state_version: intent.state_version };
    }
    if (intent.action === 'activate') {
      const target = this.activateTarget();
      return target ? { ...intent, target } : { action: 'move', state_version: intent.state_version };
    }
    if (intent.action === 'place') {
      const target = this.placementTarget();
      return target ? { ...intent, target } : { action: 'idle', state_version: intent.state_version };
    }
    return intent;
  }

  private nearestThreat(maxDistance: number): Entity | null {
    const position = this.bot.entity.position;
    return this.bot.nearestEntity((candidate) =>
      candidate !== this.bot.entity &&
      (candidate.type === 'mob' || candidate.type === 'hostile') &&
      candidate.displayName !== 'Armor Stand' &&
      candidate.position.distanceTo(position) <= maxDistance);
  }

  private armorTarget(): IntentTarget | undefined {
    const slotByPiece: Record<string, string> = { helmet: 'head', chestplate: 'torso', leggings: 'legs', boots: 'feet' };
    for (const [piece, destination] of Object.entries(slotByPiece)) {
      const item = this.bot.inventory.items().find((stack) => stack.name.endsWith(`_${piece}`));
      if (item) return { kind: 'equip', item: item.name, destination: destination as 'head' | 'torso' | 'legs' | 'feet' };
    }
    return undefined;
  }

  private activateTarget(): IntentTarget | undefined {
    const block = this.bot.findBlock({ matching: (candidate) => /door|trapdoor|chest|lever|button|gate/.test(candidate.name), maxDistance: 4 });
    return block ? { kind: 'activate', x: block.position.x, y: block.position.y, z: block.position.z } : undefined;
  }

  private placementTarget(): IntentTarget | undefined {
    const candidates = this.bot.inventory.items().find((item) => /planks|cobblestone|stone|dirt|bricks/.test(item.name));
    if (!candidates) return undefined;
    const position = this.bot.entity.position;
    const below = this.bot.blockAt(new Vec3(Math.floor(position.x), Math.floor(position.y) - 1, Math.floor(position.z)));
    const supports = [
      ...(below ? [below] : []),
      ...this.bot.findBlocks({
      matching: (block) => block.boundingBox === 'block' && Boolean(block.position) && block.position.y <= Math.floor(position.y),
      maxDistance: 4,
      count: 32,
      }).map((point) => this.bot.blockAt(point)).filter((block): block is NonNullable<typeof block> => Boolean(block?.position)),
    ];
    const reference = supports
      .filter((block) => this.bot.blockAt(block.position.offset(0, 1, 0))?.type === 0)
      .sort((left, right) => right.position.y - left.position.y)[0];
    if (!reference) return undefined;
    return {
      kind: 'place',
      block: candidates.name,
      reference: { x: reference.position.x, y: reference.position.y, z: reference.position.z },
      face: { x: 0, y: 1, z: 0 },
    };
  }

  private async refreshStrategy(): Promise<void> {
    await this.strategy.run(this.goals.current?.text);
    this.lastGoalVersion = this.goals.current?.version ?? 0;
    this.telemetry.record('system2.directive', {
      goal: this.goals.current?.text,
      directive: this.strategy.latest?.text,
    });
  }

  private explorationGoal(): { x: number; y: number; z: number } {
    const position = this.bot.entity.position;
    const yaw = this.bot.entity.yaw;
    return { x: Math.floor(position.x - Math.sin(yaw) * 8), y: Math.floor(position.y), z: Math.floor(position.z - Math.cos(yaw) * 8) };
  }

  private bindNavigationEvents(): void {
    this.bot.on('goal_reached', () => {
      this.navigationState = 'idle';
      this.navigationGoal = undefined;
      this.navigationRecoveryCount = 0;
      this.navigationLastFault = undefined;
    });
    this.bot.on('path_update', (result) => {
      this.navigationLastPathStatus = result.status as 'success' | 'partial' | 'timeout' | 'noPath';
      if (result.status === 'noPath') {
        this.handleNavigationFailure('noPath');
        return;
      }
      this.navigationState = 'moving';
    });
    this.bot.on('path_reset', (reason) => {
      if (reason === 'stuck' || reason === 'no_scaffolding_blocks' || reason === 'dig_error' || reason === 'place_error') {
        this.handleNavigationFailure(reason);
      } else {
        this.navigationLastFault = reason;
        this.navigationState = 'planning';
      }
    });
  }

  private handleNavigationFailure(reason: string): void {
    this.navigationRecoveryCount += 1;
    this.navigationLastFault = reason;
    this.navigationState = 'stalled';
    this.telemetry.record('navigation.failed', { reason, recoveryCount: this.navigationRecoveryCount });
    if (this.navigationRecoveryCount > 3) {
      this.paused = true;
      this.lastError = `Navigation failed after ${this.navigationRecoveryCount} attempts: ${reason}`;
      this.idle();
      return;
    }
    if (!this.recoveryDecisionActive) {
      this.recoveryDecisionActive = true;
      void this.runDecisionCycle().finally(() => { this.recoveryDecisionActive = false; });
    }
  }

  private surroundingBlocks(origin: Vec3 | undefined): readonly Record<string, unknown>[] {
    if (!origin || typeof this.bot.findBlocks !== 'function') return [];
    const points = this.bot.findBlocks({
      matching: (block) => block.boundingBox === 'block',
      maxDistance: 6,
      count: 24,
    });
    return points.map((point) => {
      const block = this.bot.blockAt(point);
      return {
        name: block?.name ?? 'unknown',
        x: point.x,
        y: point.y,
        z: point.z,
      };
    });
  }

  private terrain(origin: Vec3 | undefined): readonly Record<string, unknown>[] {
    if (!origin) return [];
    const cells: Record<string, unknown>[] = [];
    for (let x = -2; x <= 2; x += 1) {
      for (let z = -2; z <= 2; z += 1) {
        for (let y = -2; y <= 3; y += 1) {
          const point = origin.offset(x, y, z);
          const block = this.bot.blockAt(point);
          cells.push({ x: point.x, y: point.y, z: point.z, name: block?.name ?? 'unknown', solid: block?.boundingBox === 'block' });
        }
      }
    }
    return cells;
  }

  private recordKernelError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.lastError = `System 0: ${message}`;
    this.telemetry.record('system0.error', { error: message });
  }

  private idle(): void {
    this.source.latest = undefined;
    this.kernel.execute({ action: 'idle', state_version: this.stateVersion });
  }

  private bindLifecycleSafety(): void {
    const stop = (event: 'death' | 'kicked' | 'end' | 'error', detail?: string): void => {
      this.paused = true;
      this.emergencyStopped = true;
      this.navigationState = 'stalled';
      this.navigationLastFault = event;
      this.lastError = `Mineflayer ${event}${detail ? `: ${detail}` : ''}`;
      this.navigationGoal = undefined;
      this.idle();
      this.telemetry.record('runtime.lifecycle-failure', { event, ...(detail ? { detail } : {}) });
    };
    this.bot.once('death', () => stop('death'));
    this.bot.once('kicked', (reason) => stop('kicked', reason));
    this.bot.once('end', (reason) => stop('end', reason));
    this.bot.once('error', (error) => stop('error', error.message));
  }

  public status(): AgentStatus {
    return {
      connected: this.connected,
      paused: this.paused,
      emergencyStopped: this.emergencyStopped,
      ...(this.goals.current ? { goal: this.goals.current } : {}),
      ...(this.strategy.latest ? { directive: this.strategy.latest } : {}),
      ...(this.lastAction ? { lastAction: this.lastAction } : {}),
      stateVersion: this.stateVersion,
      ...(this.lastError ? { lastError: this.lastError } : {}),
      decisionCount: this.decisionCount,
      telemetryEvents: this.telemetry.size,
      ...(this.telemetry.malformedCount > 0 ? { telemetryMalformedRecords: this.telemetry.malformedCount } : {}),
      ...(this.telemetry.lastWriteError ? { telemetryWriteError: this.telemetry.lastWriteError } : {}),
      navigation: {
        state: this.navigationState,
        ...(this.navigationGoal ? { goal: this.navigationGoal } : {}),
        ...(this.navigationLastPathStatus ? { lastPathStatus: this.navigationLastPathStatus } : {}),
        recoveryCount: this.navigationRecoveryCount,
        ...(this.navigationLastFault ? { lastFault: this.navigationLastFault } : {}),
      },
    };
  }

  public async stop(): Promise<void> {
    this.connected = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.brainstem.stop();
    this.strategy.stop();
    await this.control.stop();
    this.idle();
  }
}
