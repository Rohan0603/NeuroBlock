import type { Bot } from 'mineflayer';
import type { Entity } from 'prismarine-entity';
import type { Action, ActionResult, AgentStatus, GoalCheckpoint, HomeStatus, Intent, IntentEpoch, IntentTarget, NamedLocation, TaskStep } from '../core/types.js';
import { configuredWorldIdentity, parseLocraw, type WorldIdentity } from '../core/world_identity.js';
import { GoalStore } from '../core/goal_store.js';
import { TaskController } from '../core/task_controller.js';
import { hasNamedItem, safeOpenGround } from '../core/task_predicates.js';
import { BrainstemTick, type IntentSource } from '../system0/brainstem_tick.js';
import { ExecutionKernel } from '../system0/execution_kernel.js';
import { OpenCodeZenClient } from '../system2/opencode_client.js';
import { StrategicLoop } from '../system2/strategic_loop.js';
import { chooseSurvivalAction } from '../system1/survival_policy.js';
import { ControlServer } from '../control/control_server.js';
import { Telemetry } from '../core/telemetry.js';
import { ACTIONS, NON_IDLE_ACTIONS } from '../core/capabilities.js';
import pathfinderModule from 'mineflayer-pathfinder';
import collectBlockPlugin from 'mineflayer-collectblock';
import { Vec3 } from 'vec3';
const { Movements, pathfinder } = pathfinderModule;
const HOME_BLOCKS = 24;

interface EscapeCandidate {
  readonly id: string;
  readonly target: { x: number; y: number; z: number };
  readonly block?: NonNullable<ReturnType<Bot['blockAt']>>;
  readonly clearance: number;
  readonly verticalGain: number;
}

export interface AgentRuntimeOptions {
  readonly controlPort?: number;
  readonly jev?: IntentProvider;
  readonly strategy?: StrategicLoop;
  readonly enableNavigation?: boolean;
}

export interface IntentProvider {
  requestIntent(state: string, stateVersion: number, actions: readonly Action[], candidateIds?: readonly string[]): Promise<import('../core/types.js').Intent | null>;
}

export class AgentRuntime {
  public readonly goals = new GoalStore();
  private readonly source: IntentSource = { latest: undefined };
  private readonly brainstem: BrainstemTick;
  private readonly strategy: StrategicLoop;
  private readonly control: ControlServer;
  private readonly kernel: ExecutionKernel;
  private readonly enableNavigation: boolean;
  private readonly telemetry = new Telemetry();
  private lastExecution: ActionResult | undefined;
  private readonly failedTargets = new Map<string, number>();
  private readonly locations = new Map<string, NamedLocation>();
  private escapeGoalVersion = 0;
  private escapeDigCount = 0;
  private escapeReplanTarget: { x: number; y: number; z: number } | undefined;
  private readonly attemptedMineTargets = new Set<string>();
  private readonly failedEscapeTargets = new Set<string>();
  private worldIdentity: WorldIdentity = configuredWorldIdentity();
  private homeAnchor: { x: number; y: number; z: number } | undefined;
  private voidRecoverySent = false;
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
  private decisionActive = false;
  private readonly task = new TaskController();
  private stateVersion = 0;
  private lastGoalVersion = 0;
  private lastAction: Action | undefined;
  private connected = false;
  private paused = false;
  private emergencyStopped = false;
  private decisionCount = 0;
  private timer: NodeJS.Timeout | undefined;
  private readonly jevMetrics = { used: 0, timeout: 0, lowConfidence: 0, actionChanged: 0, actionApplied: 0 };

  public constructor(private readonly bot: Bot, options: AgentRuntimeOptions = {}) {
    this.kernel = new ExecutionKernel(bot, (error) => this.recordKernelError(error), (type, data) => this.telemetry.record(type, data));
    this.enableNavigation = options.enableNavigation !== false;
    this.brainstem = new BrainstemTick(bot, this.source, (type, data) => {
      if (type === 'system0.error' && typeof data?.error === 'string') this.lastError = `System 0: ${data.error}`;
      this.telemetry.record(type, data);
    }, (result) => this.recordExecutionResult(result));
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
    if (this.bot.entity) this.rememberLocation('spawn', this.bot.entity.position);
    if (this.bot.entity && this.bot.entity.position.y < -50) {
      this.telemetry.record('runtime.recovery', { reason: 'void-respawn', y: this.bot.entity.position.y });
      this.bot.chat('/kill');
    }
    this.telemetry.record('runtime.started');
    this.bindLifecycleSafety();
    this.bindWorldIdentity();
    this.bot.on('physicsTick', () => this.monitorEmbeddedBot());
    this.bot.on('spawn', () => {
      this.voidRecoverySent = false;
      if (this.bot.entity.position.y < -50) this.bot.chat('/kill');
    });
    await this.control.start();
    this.brainstem.start();
    this.strategy.start();
    void this.refreshStrategy().catch((error) => console.error('Strategic directive failed', error));
    this.timer = setInterval(() => { void this.decide(); }, 750);
    this.timer.unref();
    console.log('VoxelCortex active runtime control: http://127.0.0.1:8787/status');
  }

  private bindWorldIdentity(): void {
    this.bot.on('messagestr', (message) => {
      const identity = parseLocraw(message);
      if (identity) this.worldIdentity = identity;
    });
    if (process.env.WORLD_IDENTITY_MODE === 'locraw') this.bot.chat('/locraw');
  }

  private initializePlugins(): void {
    if (this.enableNavigation && !this.navigationInitialized) {
      if (!this.bot.pathfinder) this.bot.loadPlugin(pathfinder);
      this.bindNavigationEvents();
      const movements = new Movements(this.bot);
      movements.canDig = true;
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
      if (this.bot.entity.position.y < -50) {
        if (!this.voidRecoverySent) {
          this.voidRecoverySent = true;
          this.telemetry.record('runtime.recovery', { reason: 'void-respawn', y: this.bot.entity.position.y });
          this.bot.chat('/kill');
        }
        return;
      }
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
      const obstruction = this.findEmbeddedObstruction(position);
      if (obstruction) {
        this.telemetry.record('navigation.embedded-dig', {
          x: obstruction.x,
          y: obstruction.y,
          z: obstruction.z,
          type: obstruction.type,
        });
        this.kernel.dig(obstruction);
        return;
      }
      this.kernel.rescueFromEmbedded(target);
    }

  private findEmbeddedObstruction(position: Vec3): Extract<import('../core/types.js').IntentTarget, { kind: 'block' }> | undefined {
    const directions: readonly [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const candidates = [
      this.bot.blockAt(position),
      this.bot.blockAt(position.offset(0, 1, 0)),
      ...directions.flatMap(([x, z]) => [
        this.bot.blockAt(position.offset(x, 0, z)),
        this.bot.blockAt(position.offset(x, 1, z)),
      ]),
    ];
    const block = candidates.find((candidate) => candidate && candidate.boundingBox === 'block' && this.bot.canDigBlock(candidate));
    return block
      ? { kind: 'block', type: block.type, x: block.position.x, y: block.position.y, z: block.position.z }
      : undefined;
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
      const safe = points.sort((left, right) => left.distanceTo(origin) - right.distanceTo(origin))[0];
      if (safe) this.rememberLocation('last_safe_stand', safe);
      return safe;
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
        identity: this.worldIdentity,
        version: this.bot.version,
        dimension: this.bot.game?.dimension,
        onGround: this.bot.entity?.onGround,
        safeOpenGround: this.safeOpenGround(blockPosition),
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
        ...this.navigationContext(position),
      },
      escapeDigCount: this.escapeDigCount,
      escapeCandidates: position
        ? this.escapeCandidates(position).map(({ id, target, clearance, verticalGain, block }) => ({
          id, target, clearance, verticalGain, mineRequired: Boolean(block),
        }))
        : [],
      lastExecution: this.lastExecution ?? null,
      checkpoint: this.currentCheckpoint(),
      locations: [...this.locations.values()],
      surroundings: this.surroundingBlocks(blockPosition),
      terrain: this.terrain(blockPosition),
      capabilities: NON_IDLE_ACTIONS,
    });
  }

  public async runDecisionCycle(): Promise<void> {
    const homeGoal = /build|home|shelter|house/.test((this.goals.current?.text ?? '').toLowerCase());
    if (!this.connected || !this.bot.entity || this.paused || this.emergencyStopped || (this.decisionActive && !homeGoal)) return;
    this.decisionActive = true;
    try {
      if (this.paused || this.emergencyStopped) return;
      if (this.goals.current && (this.goals.current?.version ?? 0) !== this.lastGoalVersion) await this.refreshStrategy();
      this.syncTask();
      const task = this.task.checkDeadline();
      if (task?.status === 'failed' || task?.status === 'complete') {
        this.idle();
        return;
      }
      if (this.updateTaskProgress()) return;
      const directive = this.strategy.latest?.text ?? 'Explore the nearby world and improve survival.';
      this.telemetry.record('system1.request', { directive });
      const recovery = this.navigationState === 'stalled' && this.navigationRecoveryCount > 0;
      const actions = recovery ? ACTIONS : (this.strategy.latest?.relevantCapabilities ?? ACTIONS);
      const state = this.observe();
      const policyAction = chooseSurvivalAction(state, this.strategy.latest, actions);
      this.telemetry.record('system1.decision', {
        source: policyAction ? 'survival-policy' : 'move-fallback',
        action: policyAction ?? 'move',
        objective: this.strategy.latest?.objective ?? null,
      });
      const intent = this.completeIntent(policyAction
        ? {
          action: policyAction,
          state_version: this.stateVersion,
        }
        : { action: 'move', state_version: this.stateVersion }, directive);
      this.source.latest = { intent, stateVersion: this.stateVersion, requestId: Date.now() };
      this.telemetry.record('system1.intent', {
        action: this.source.latest.intent.action,
        target: this.source.latest.intent.target,
        targetHint: this.source.latest.intent.targetHint,
        candidateId: this.source.latest.intent.candidateId,
        source: policyAction ? 'survival-policy' : 'move-fallback',
      });
      this.lastAction = this.source.latest.intent.action;
      this.decisionCount += 1;
      this.telemetry.record('decision', { action: this.lastAction, stateVersion: this.stateVersion });
      this.lastError = undefined;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : 'Decision cycle failed';
      this.source.latest = undefined;
      this.lastAction = 'idle';
      this.telemetry.record('decision.failed', { error: this.lastError });
    } finally {
      this.decisionActive = false;
    }
  }

  private async decide(): Promise<void> { await this.runDecisionCycle(); }

  private completeIntent(intent: Intent, directive: string): Intent {
    const goal = `${this.goals.current?.text ?? ''} ${directive}`.toLowerCase();
    const building = /build|home|shelter|house/.test(goal);
    const homeTask = this.task.current?.step;
    const escapeRequested = this.task.current?.step === 'escape' && !building
      || /get out|escape|leave the mine|safe open ground/.test(goal)
      || (building && !this.homeGround(this.bot.entity.position.floored()));
    const goalVersion = this.goals.current?.version ?? 0;
    if (goalVersion !== this.escapeGoalVersion) {
      this.escapeGoalVersion = goalVersion;
      this.escapeDigCount = 0;
      this.failedEscapeTargets.clear();
      this.attemptedMineTargets.clear();
    }
    const inventory = this.bot.inventory.items();
    if (escapeRequested && (building ? this.homeGround(this.bot.entity.position.floored()) : this.safeOpenGround(this.bot.entity.position.floored()))) return intent;
    if (escapeRequested) this.escapeReplanTarget = undefined;
    if (escapeRequested && this.escapeDigCount < 12) {
      const candidates = this.escapeCandidates(this.bot.entity.position, intent.targetHint?.direction);
      const candidate = (intent.candidateId ? candidates.find(({ id }) => id === intent.candidateId) : undefined)
        ?? candidates.find(({ block }) => Boolean(block))
        ;
      const block = candidate?.block;
      if (!candidate) return { action: 'jump', state_version: intent.state_version };
      const distance = Math.hypot(
        this.bot.entity.position.x - candidate.target.x,
        this.bot.entity.position.y - candidate.target.y,
        this.bot.entity.position.z - candidate.target.z,
      );
      if (block && distance <= 4.5) {
        if (block.position) {
          this.attemptedMineTargets.add(this.blockKey(block.position.x, block.position.y, block.position.z));
        }
        return { action: 'mine', state_version: intent.state_version, target: { kind: 'block', type: block.type, x: block.position.x, y: block.position.y, z: block.position.z } };
      }
      this.navigationGoal = candidate.target;
      this.navigationState = 'planning';
      return { action: 'move', state_version: intent.state_version, target: { kind: 'near', ...candidate.target, range: 1 } };
    }
    if (building && homeTask === 'gather') {
      const block = this.bot.findBlock({
        matching: (candidate) => candidate.boundingBox === 'block' && candidate.name !== 'bedrock',
        maxDistance: 3,
        point: this.bot.entity.position,
        count: 1,
      });
      if (block) return {
        action: 'mine',
        state_version: intent.state_version,
        target: { kind: 'block', type: block.type, x: block.position.x, y: block.position.y, z: block.position.z },
      };
      return { action: 'idle', state_version: intent.state_version };
    }
    if (building && homeTask === 'craft') {
      return { action: 'craft', state_version: intent.state_version, target: { kind: 'craft', item: 'oak_planks' } };
    }
    if (building && homeTask === 'build') {
      const target = this.homePlacementTarget();
      if (target) return { action: 'place', target, state_version: intent.state_version };
      if (this.homeAnchor) {
        const next = this.homeTargets().find(({ target: position }) => this.bot.blockAt(new Vec3(position.x, position.y, position.z))?.type === 0);
        if (next) return {
          action: 'move',
          state_version: intent.state_version,
          target: { kind: 'near', x: next.target.x, y: next.target.y, z: next.target.z, range: 1 },
        };
      }
      return { action: 'idle', state_version: intent.state_version };
    }
    if (escapeRequested && intent.action !== 'idle' && intent.action !== 'move' && intent.action !== 'jump') {
      const target = this.explorationGoal();
      this.navigationGoal = target;
      this.navigationState = 'planning';
      return { action: 'move', state_version: intent.state_version, target: { kind: 'near', ...target } };
    }
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
      const block = this.bot.findBlock({
        matching: (candidate) => candidate.type > 0 && candidate.boundingBox === 'block',
        maxDistance: 3,
        point: this.bot.entity.position,
        count: 1,
      });
      return block
        ? { ...intent, target: { kind: 'block', type: block.type, x: block.position.x, y: block.position.y, z: block.position.z } }
        : { action: 'jump', state_version: intent.state_version };
    }
    if (intent.action === 'collect') {
      const names = goal.includes('farm') || goal.includes('wheat')
        ? ['grass', 'tall_grass']
        : goal.includes('wood') || goal.includes('log')
          ? ['oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'mangrove_log', 'cherry_log']
          : ['stone', 'coal_ore', 'iron_ore'];
      return { ...intent, target: { kind: 'collect', names, maxDistance: 8 } };
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

  private escapeCandidates(origin: Vec3, preferredDirection?: string): readonly EscapeCandidate[] {
    const base = typeof origin.floored === 'function'
      ? origin.floored()
      : new Vec3(Math.floor(origin.x), Math.floor(origin.y), Math.floor(origin.z));
    const directions = [
      { x: 0, z: 0, name: 'up' },
      { x: 1, z: 0, name: 'east' },
      { x: -1, z: 0, name: 'west' },
      { x: 0, z: 1, name: 'south' },
      { x: 0, z: -1, name: 'north' },
    ].sort((left, right) => Number(right.name === preferredDirection) - Number(left.name === preferredDirection));
    const candidates: EscapeCandidate[] = [];
    for (const direction of directions) {
      for (let distance = direction.name === 'up' ? 0 : 1; distance <= 3; distance += 1) {
        for (let verticalGain = 0; verticalGain <= 1; verticalGain += 1) {
          const target = {
            x: base.x + direction.x * distance,
            y: base.y + verticalGain,
            z: base.z + direction.z * distance,
          };
          const feet = this.bot.blockAt(new Vec3(target.x, target.y, target.z));
          const head = this.bot.blockAt(new Vec3(target.x, target.y + 1, target.z));
          const support = this.bot.blockAt(new Vec3(target.x, target.y - 1, target.z));
          if (!support || support.boundingBox !== 'block') continue;
          const feetBlocked = feet?.boundingBox === 'block';
          const headBlocked = head?.boundingBox === 'block';
          if (feetBlocked || headBlocked) continue;
          const adjacent = [
                new Vec3(target.x, target.y + 2, target.z),
                new Vec3(target.x + 1, target.y, target.z),
            new Vec3(target.x - 1, target.y, target.z),
            new Vec3(target.x, target.y, target.z + 1),
            new Vec3(target.x, target.y, target.z - 1),
            new Vec3(target.x + 1, target.y + 1, target.z),
            new Vec3(target.x - 1, target.y + 1, target.z),
            new Vec3(target.x, target.y + 1, target.z + 1),
            new Vec3(target.x, target.y + 1, target.z - 1),
          ];
          const block = adjacent
            .map((position) => this.bot.blockAt(position))
            .find((candidate) => candidate
              && candidate.boundingBox === 'block'
              && Boolean(candidate.position)
              && this.bot.canDigBlock(candidate)
              && !this.attemptedMineTargets.has(this.blockKey(candidate.position.x, candidate.position.y, candidate.position.z)));
          const id = `${direction.name}-${distance}-${verticalGain}`;
          if (this.failedEscapeTargets.has(this.blockKey(target.x, target.y, target.z))) continue;
          candidates.push({ id, target, ...(block ? { block } : {}), clearance: Number(!feetBlocked) + Number(!headBlocked), verticalGain });
        }
      }
    }
    return candidates.sort((left, right) => right.verticalGain - left.verticalGain || right.clearance - left.clearance);
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

  private homeTargets(): readonly { target: { x: number; y: number; z: number } }[] {
    if (!this.homeAnchor) return [];
    const { x, y, z } = this.homeAnchor;
    const targets: { target: { x: number; y: number; z: number } }[] = [];
    for (const level of [0, 1]) {
      for (const dx of [-1, 0, 1]) {
        for (const dz of [-1, 0, 1]) {
          if (level === 0 && dx === 0 && dz === -1) continue;
          if (Math.abs(dx) !== 1 && Math.abs(dz) !== 1) continue;
          targets.push({ target: { x: x + dx, y: y + level, z: z + dz } });
        }
      }
    }
    for (const dx of [-1, 0, 1]) for (const dz of [-1, 0, 1]) targets.push({ target: { x: x + dx, y: y + 2, z: z + dz } });
    return targets;
  }

  private homePlacementTarget(): IntentTarget | undefined {
    if (!this.homeAnchor) return undefined;
    const item = this.bot.inventory.items().find((stack) => /planks|cobblestone|stone|dirt|bricks/.test(stack.name) && stack.count > 0);
    if (!item) return undefined;
    const next = this.homeTargets().find(({ target }) => this.bot.blockAt(new Vec3(target.x, target.y, target.z))?.type === 0);
    if (!next) return undefined;
    const reference = this.bot.blockAt(new Vec3(next.target.x, next.target.y - 1, next.target.z));
    if (!reference || reference.boundingBox !== 'block') return undefined;
    return {
      kind: 'place',
      block: item.name,
      reference: { x: reference.position.x, y: reference.position.y, z: reference.position.z },
      face: { x: 0, y: 1, z: 0 },
    };
  }

  private homeStatus(): HomeStatus | undefined {
    if (!this.homeAnchor) return undefined;
    const placedBlocks = this.homeTargets().filter(({ target }) => this.bot.blockAt(new Vec3(target.x, target.y, target.z))?.type !== 0).length;
    return { anchor: this.homeAnchor, requiredBlocks: HOME_BLOCKS, placedBlocks, complete: placedBlocks === HOME_BLOCKS };
  }

  private async refreshStrategy(): Promise<void> {
    if (!this.goals.current) return;
    await this.strategy.run(this.goals.current?.text);
    this.lastGoalVersion = this.goals.current?.version ?? 0;
    this.telemetry.record('system2.directive', {
      goal: this.goals.current?.text,
      directive: this.strategy.latest?.text,
    });
  }

  private explorationGoal(): { x: number; y: number; z: number } {
    const position = this.bot.entity.position;
    const origin = position.floored();
    const surface = this.bot.findBlocks({
      matching: (block) => {
        if (block.boundingBox !== 'block' || !block.position) return false;
        return this.safeOpenGround(block.position.offset(0, 1, 0));
      },
      maxDistance: 16,
      count: 64,
    }).sort((left, right) => right.y - left.y || left.distanceTo(origin) - right.distanceTo(origin))[0];
    if (surface) return { x: surface.x, y: surface.y + 1, z: surface.z };
    const yaw = this.bot.entity.yaw;
    return {
      x: Math.floor(position.x - Math.sin(yaw) * 8),
      y: Math.floor(position.y + 8),
      z: Math.floor(position.z - Math.cos(yaw) * 8),
    };
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
    if (this.task.current?.step === 'escape' && this.navigationGoal) {
      this.failedEscapeTargets.add(this.blockKey(
        this.navigationGoal.x,
        this.navigationGoal.y,
        this.navigationGoal.z,
      ));
      this.escapeReplanTarget = undefined;
      this.navigationGoal = undefined;
    }
    this.navigationRecoveryCount += 1;
    this.navigationLastFault = reason;
    this.navigationState = 'stalled';
    this.task.attempt();
    this.telemetry.record('navigation.failed', { reason, recoveryCount: this.navigationRecoveryCount });
    const escapeRecovery = this.task.current?.step === 'escape';
    if ((!escapeRecovery && this.navigationRecoveryCount > 3)
      || (escapeRecovery && this.escapeDigCount >= 12)) {
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
        dx: origin ? point.x - Math.floor(origin.x) : point.x,
        dy: origin ? point.y - Math.floor(origin.y) : point.y,
        dz: origin ? point.z - Math.floor(origin.z) : point.z,
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
          cells.push({
            x: point.x,
            y: point.y,
            z: point.z,
            dx: x,
            dy: y,
            dz: z,
            name: block?.name ?? 'unknown',
            solid: block?.boundingBox === 'block',
          });
        }

      }
    }
    return cells;
  }

  private navigationContext(position: Vec3 | undefined): Record<string, unknown> {
    if (!position || !this.navigationGoal) return {};
    const dx = this.navigationGoal.x - Math.floor(position.x);
    const dy = this.navigationGoal.y - Math.floor(position.y);
    const dz = this.navigationGoal.z - Math.floor(position.z);
    const horizontalDistance = Math.hypot(dx, dz);
    const direction = Math.abs(dx) >= Math.abs(dz)
      ? dx >= 0 ? 'east' : 'west'
      : dz >= 0 ? 'south' : 'north';
    return {
      delta: { x: dx, y: dy, z: dz },
      distance: Math.hypot(horizontalDistance, dy),
      horizontalDistance,
      verticalDistance: Math.abs(dy),
      direction,
    };
  }

  private safeOpenGround(position: Vec3 | undefined): boolean {
    return safeOpenGround(this.bot, position);
  }

  private recordKernelError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.lastError = `System 0: ${message}`;
    this.telemetry.record('system0.error', { error: message });
  }

  private recordExecutionResult(result: ActionResult): void {
    this.lastExecution = result;
    if (result.ok && result.action === 'mine' && this.goals.current?.version === this.escapeGoalVersion) {
      this.escapeDigCount += 1;
      const candidate = this.escapeCandidates(this.bot.entity.position).find(({ block }) => !block)
        ?? this.escapeCandidates(this.bot.entity.position)[0];
      this.escapeReplanTarget = undefined;
      this.navigationGoal = undefined;
      this.navigationState = 'idle';
      this.telemetry.record('navigation.escape-replan', {
        candidateId: candidate?.id,
        target: candidate?.target,
        digCount: this.escapeDigCount,
      });
    }
    if (result.action === 'mine' && result.target?.kind === 'block' &&
      result.target.x !== undefined && result.target.y !== undefined && result.target.z !== undefined) {
      this.attemptedMineTargets.add(this.blockKey(result.target.x, result.target.y, result.target.z));
      while (this.attemptedMineTargets.size > 32) this.attemptedMineTargets.delete(this.attemptedMineTargets.values().next().value as string);
    }
    const target = result.target && 'kind' in result.target ? JSON.stringify(result.target) : result.action;
    if (result.ok) {
      this.failedTargets.delete(target);
      this.lastError = undefined;
    } else if (result.errorCode === 'DIG_TARGET_CHANGED') {
      this.failedTargets.delete(target);
      this.lastError = 'DIG_TARGET_CHANGED: selecting another nearby block';
    } else {
      const retries = (this.failedTargets.get(target) ?? 0) + 1;
      this.failedTargets.set(target, retries);
      this.lastError = `${result.errorCode ?? 'ACTION_FAILED'}: ${result.message ?? result.action}`;
      if (retries >= 3) {
        this.failTask(`${result.errorCode ?? 'ACTION_FAILED'}: retry limit reached`);
        this.paused = true;
        this.idle();
        this.lastError = `${this.lastError} (retry limit reached)`;
      }
    }
    this.telemetry.record(result.ok ? 'system0.result.completed' : 'system0.result.failed', { ...result });
  }

  private currentCheckpoint(): GoalCheckpoint | undefined {
    const goal = this.goals.current?.text.toLowerCase();
    if (!goal || !/farm|wheat/.test(goal)) return undefined;
    const inventory = this.bot.inventory.items();
    if (!inventory.some((item) => /seed/.test(item.name))) return { name: 'gather_seeds', completed: false };
    if (!inventory.some((item) => item.name.endsWith('_hoe'))) return { name: 'craft_hoe', completed: false };
    return { name: 'prepare_and_plant', completed: false };
  }

  private syncTask(): void {
    const goal = this.goals.current;
    if (!goal) {
      this.task.clear();
      return;
    }
    if (this.task.current?.goalVersion === goal.version) return;
    const objective = this.strategy.latest?.objective;
    const plannedStep = this.strategy.latest?.plan?.steps[0]?.step;
    const lowerGoal = goal.text.toLowerCase();
    const building = /build|home|shelter|house/.test(lowerGoal);
    if (building && !this.homeAnchor && this.homeGround(this.bot.entity.position.floored())) {
      const position = this.bot.entity.position.floored();
      this.homeAnchor = { x: position.x, y: position.y, z: position.z };
      this.telemetry.record('home.anchor.selected', { anchor: this.homeAnchor });
    }
    const escape = (building && !this.homeGround(this.bot.entity.position.floored()))
      || plannedStep === 'escape'
      || objective?.steps?.[0] === 'escape'
      || /escape|pit|leave the mine|get out/.test(lowerGoal);
    const step = escape ? 'escape'
      : building ? this.homeNextStep()
        : plannedStep
        ?? (/craft|make|wooden planks/.test(lowerGoal) ? 'craft'
          : /gather|collect|wood|log/.test(lowerGoal) ? 'gather' : 'navigate');
    const task = this.task.start(goal.text, goal.version, step, Date.now(), building ? 600_000 : undefined);
    this.telemetry.record('task.started', { goal: task.goal, step: task.step, goalVersion: task.goalVersion });
  }

  private completeTask(): void {
    const task = this.task.complete();
    if (!task) return;
    this.navigationGoal = undefined;
    this.navigationState = 'idle';
    this.telemetry.record('task.completed', { step: task.step, goal: task.goal });
    this.idle();
  }

  private failTask(reason: string): void {
    const previous = this.task.current;
    const task = this.task.fail(reason);
    if (!task || previous?.status !== 'active') return;
    this.telemetry.record('task.failed', { reason, goal: task.goal });
  }

  private updateTaskProgress(): boolean {
    const task = this.task.current;
    if (!task || task.status !== 'active') return false;
    if (task.step === 'escape') {
      if (!this.safeOpenGround(this.bot.entity.position.floored())) {
        this.task.resetStable();
        return false;
      }
      const stable = this.task.markStable();
      if (stable?.stableSince !== undefined && Date.now() - stable.stableSince >= 1000) {
        if (this.isHomeGoal()) this.transitionTask(this.homeNextStep());
        else this.completeTask();
      } else {
        this.idle();
      }
      if (this.isHomeGoal()) {
        const homeStep = this.task.current?.step;
        if (homeStep === 'gather' || homeStep === 'craft') {
          const next = this.homeNextStep();
          if (next !== homeStep) this.transitionTask(next);
          return true;
        }
        if (homeStep === 'build') {
          const home = this.homeStatus();
          this.telemetry.record('home.progress', home ? { ...home } : undefined);
          if (home?.complete) this.transitionTask('verify');
          return true;
        }
        if (homeStep === 'verify') {
          const home = this.homeStatus();
          if (home?.complete) {
            this.telemetry.record('home.verified', { ...home });
            this.completeTask();
          }
          return true;
        }
      }
      return true;
    }
    if (task.step === 'gather') {
      const buildingBlocks = this.bot.inventory.items()
        .filter((item) => /planks|cobblestone|stone|dirt|bricks/.test(item.name))
        .reduce((total, item) => total + item.count, 0);
      if (buildingBlocks >= HOME_BLOCKS) {
        this.transitionTask('build');
        return true;
      }
      return false;
    }
    if (task.step === 'craft' && hasNamedItem(this.bot, /_planks$/)) {
      this.transitionTask('verify');
      return true;
    }
    if (task.step === 'verify') {
      this.completeTask();
      return true;
    }
    return false;
  }

  private transitionTask(step: TaskStep): void {
    const task = this.task.transition(step);
    if (task) this.telemetry.record('task.transition', { step, goal: task.goal });
  }

  private isHomeGoal(): boolean {
    return /build|home|shelter|house/.test(this.goals.current?.text.toLowerCase() ?? '');
  }

  private homeNextStep(): TaskStep {
    if (!this.homeGround(this.bot.entity.position.floored())) return 'escape';
    if (this.homeStatus()?.complete) return 'verify';
    const buildingBlocks = this.bot.inventory.items()
      .filter((item) => /planks|cobblestone|stone|dirt|bricks/.test(item.name))
      .reduce((total, item) => total + item.count, 0);
    if (buildingBlocks >= HOME_BLOCKS) return 'build';
    if (this.bot.inventory.items().some((item) => /log/.test(item.name) && item.count > 0)) return 'craft';
    return 'gather';
  }

  private homeGround(position: Vec3): boolean {
    const feet = this.bot.blockAt(position);
    const head = this.bot.blockAt(position.offset(0, 1, 0));
    const below = this.bot.blockAt(position.offset(0, -1, 0));
    return below?.boundingBox === 'block'
      && !/leaves|ice|glass/.test(below.name)
      && feet?.boundingBox !== 'block'
      && head?.boundingBox !== 'block';
  }

  private blockKey(x: number, y: number, z: number): string {
    return `${x},${y},${z}`;
  }

  private rememberLocation(name: string, position: { x: number; y: number; z: number }): void {
    this.locations.set(name, {
      name,
      x: Math.floor(position.x),
      y: Math.floor(position.y),
      z: Math.floor(position.z),
    });
    while (this.locations.size > 8) {
      const oldest = this.locations.keys().next().value;
      if (typeof oldest !== 'string') break;
      this.locations.delete(oldest);
    }
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
      this.failTask(this.lastError);
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
    this.syncTask();
    const checkpoint = this.currentCheckpoint();
    const home = this.homeStatus();
    return {
      connected: this.connected,
      paused: this.paused,
      emergencyStopped: this.emergencyStopped,
      ...(this.goals.current ? { goal: this.goals.current } : {}),
      ...(this.task.current ? { task: this.task.current } : {}),
      ...(this.strategy.latest ? { directive: this.strategy.latest } : {}),
      ...(this.lastAction ? { lastAction: this.lastAction } : {}),
      stateVersion: this.stateVersion,
      ...(this.lastError ? { lastError: this.lastError } : {}),
      decisionCount: this.decisionCount,
      telemetryEvents: this.telemetry.size,
      ...(this.telemetry.malformedCount > 0 ? { telemetryMalformedRecords: this.telemetry.malformedCount } : {}),
      ...(this.telemetry.lastWriteError ? { telemetryWriteError: this.telemetry.lastWriteError } : {}),
      worldIdentity: this.worldIdentity,
      ...(this.bot.entity?.position ? {
        position: {
          x: this.bot.entity.position.x,
          y: this.bot.entity.position.y,
          z: this.bot.entity.position.z,
        },
      } : {}),
      ...(this.bot.entity?.position ? {
        world: {
          ...(() => {
            const base = new Vec3(
              Math.floor(this.bot.entity.position.x),
              Math.floor(this.bot.entity.position.y),
              Math.floor(this.bot.entity.position.z),
            );
            const above = Array.from({ length: 16 }, (_, index) => this.bot.blockAt(base.offset(0, index + 1, 0)));
            return {
              safeOpenGround: this.safeOpenGround(base),
              supportBlock: this.bot.blockAt(base.offset(0, -1, 0))?.name ?? 'unknown',
              blockedAbove: above.filter((block) => block?.boundingBox === 'block').length,
              blockedAboveAt: above.flatMap((block, index) => block?.boundingBox === 'block' ? [index + 1] : []),
            };
          })(),
          onGround: this.bot.entity.onGround,
          feetBlock: this.bot.blockAt(new Vec3(
            Math.floor(this.bot.entity.position.x),
            Math.floor(this.bot.entity.position.y),
            Math.floor(this.bot.entity.position.z),
          ))?.name ?? 'unknown',
          headBlock: this.bot.blockAt(new Vec3(
            Math.floor(this.bot.entity.position.x),
            Math.floor(this.bot.entity.position.y) + 1,
            Math.floor(this.bot.entity.position.z),
          ))?.name ?? 'unknown',
        },
      } : {}),
      navigation: {
        state: this.navigationState,
        ...(this.navigationGoal ? { goal: this.navigationGoal } : {}),
        ...(this.navigationLastPathStatus ? { lastPathStatus: this.navigationLastPathStatus } : {}),
        recoveryCount: this.navigationRecoveryCount,
        ...(this.navigationLastFault ? { lastFault: this.navigationLastFault } : {}),
      },
      ...(home ? { home } : {}),
      ...(this.lastExecution ? { lastExecution: this.lastExecution } : {}),
      ...(checkpoint ? { checkpoint } : {}),
      locations: [...this.locations.values()],
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
