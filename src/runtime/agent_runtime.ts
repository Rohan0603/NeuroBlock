import type { Bot } from 'mineflayer';
import type { Action, AgentStatus, Intent, IntentEpoch } from '../core/types.js';
import { GoalStore } from '../core/goal_store.js';
import { BrainstemTick, type IntentSource } from '../system0/brainstem_tick.js';
import { ExecutionKernel } from '../system0/execution_kernel.js';
import { JevClient } from '../system1/jev_client.js';
import { OpenCodeZenClient } from '../system2/opencode_client.js';
import { StrategicLoop } from '../system2/strategic_loop.js';
import { ControlServer } from '../control/control_server.js';
import { WorkerManager } from '../workers/worker_manager.js';
import { extractLocalGrid } from '../workers/grid_extractor.js';
import { Telemetry } from '../core/telemetry.js';

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
  private workers: WorkerManager | undefined;
  private pathLength = 0;
  private navigationTarget: { x: number; y: number; z: number } | undefined;
  private repeatedAction = 0;
  private previousAction: Action | undefined;

  public constructor(private readonly bot: Bot, options: AgentRuntimeOptions = {}) {
    this.kernel = new ExecutionKernel(bot);
    this.enableNavigation = options.enableNavigation !== false;
    this.brainstem = new BrainstemTick(bot, this.source, (type, data) => this.telemetry.record(type, data));
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
      pause: () => { this.paused = true; this.kernel.execute({ action: 'idle', state_version: this.stateVersion }); },
      resume: () => { if (!this.emergencyStopped) this.paused = false; },
      emergencyStop: () => { this.emergencyStopped = true; this.paused = true; this.kernel.execute({ action: 'idle', state_version: this.stateVersion }); },
      telemetry: () => this.telemetry.read(),
    });
  }

  public async start(): Promise<void> {
    if (this.timer) return;
    this.connected = true;
    this.telemetry.record('runtime.started');
    await this.control.start();
    this.brainstem.start();
    this.strategy.start();
    if (this.enableNavigation) {
      this.workers = new WorkerManager();
      void this.refreshNavigation();
    }
    void this.refreshStrategy().catch((error) => console.error('Strategic directive failed', error));
    this.timer = setInterval(() => { void this.decide(); }, 750);
    this.timer.unref();
    console.log('VoxelCortex active runtime control: http://127.0.0.1:8787/status');
  }

  public async activateForTest(): Promise<void> {
    this.connected = true;
    await this.refreshStrategy();
  }

  public tickOnceForTest(): void { this.brainstem.tick(); }

  private observe(): string {
    const position = this.bot.entity?.position;
    const inventory = this.bot.inventory?.items().slice(0, 12).map((item) => `${item.name}:${item.count}`).join(', ') ?? '';
    return JSON.stringify({
      directive: this.strategy.latest?.text ?? 'Explore and survive.',
      health: this.bot.health,
      food: this.bot.food,
      position: position ? { x: Math.round(position.x), y: Math.round(position.y), z: Math.round(position.z) } : null,
      inventory,
      nearbyEntities: Object.values(this.bot.entities).filter((entity) => entity !== this.bot.entity).slice(0, 8).map((entity) => entity.name ?? entity.type),
      capabilities: ['move', 'attack', 'mine', 'eat', 'craft', 'place'],
    });
  }

  public async runDecisionCycle(): Promise<void> {
    if (!this.connected || !this.bot.entity || this.paused || this.emergencyStopped) return;
    try {
      if ((this.goals.current?.version ?? 0) !== this.lastGoalVersion) await this.refreshStrategy();
      const directive = this.strategy.latest?.text ?? 'Explore the nearby world and improve survival.';
      this.telemetry.record('system1.request', { directive });
      const providerIntent = await this.jev.requestIntent(JSON.stringify({
        directive,
        state: this.observe(),
        capabilities: ['move', 'attack', 'mine', 'eat', 'craft', 'place'],
        role: 'Convert the strategic directive into one immediate validated action.',
      }), this.stateVersion, ['move', 'attack', 'mine', 'eat', 'craft', 'place', 'idle']);
      const intent = this.completeIntent(providerIntent ?? { action: 'move', state_version: this.stateVersion }, directive);
      this.source.latest = { intent, stateVersion: this.stateVersion, requestId: Date.now() };
      this.telemetry.record('system1.intent', { action: this.source.latest.intent.action, target: this.source.latest.intent.target });
      this.lastAction = this.source.latest.intent.action;
      this.decisionCount += 1;
      this.telemetry.record('decision', { action: this.lastAction, stateVersion: this.stateVersion });
      this.lastError = undefined;
      if (intent.action === 'move' && this.workers) void this.refreshNavigation();
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
      return { action: 'craft', target: 'oak_planks', state_version: intent.state_version };
    }
    const repeated = this.previousAction === intent.action;
    this.repeatedAction = repeated ? this.repeatedAction + 1 : 1;
    this.previousAction = intent.action;
    if (intent.target) return intent;
    if (intent.action === 'move' && this.navigationTarget) {
      return { ...intent, target: JSON.stringify(this.navigationTarget) };
    }
    if (intent.action === 'mine' && repeated && this.repeatedAction >= 4 && goal.includes('build')) {
      return { action: 'craft', target: 'oak_planks', state_version: intent.state_version };
    }
    if (intent.action === 'mine') {
      const block = this.bot.blockAt(this.bot.entity.position.offset(0, -1, 0));
      return block && block.type > 0 ? { ...intent, target: String(block.type) } : { action: 'move', state_version: intent.state_version };
    }
    if (intent.action === 'craft') {
      const target = goal.includes('farm') ? 'wooden_hoe' : 'oak_planks';
      return { ...intent, target };
    }
    if (intent.action === 'place') {
      const target = this.placementTarget();
      return target ? { ...intent, target } : intent;
    }
    return intent;
  }

  private placementTarget(): string | undefined {
    const candidates = this.bot.inventory.items().find((item) => /planks|cobblestone|stone|dirt|bricks/.test(item.name));
    if (!candidates) return undefined;
    const position = this.bot.entity.position;
    return JSON.stringify({
      block: candidates.name,
      reference: { x: Math.floor(position.x), y: Math.floor(position.y - 1), z: Math.floor(position.z) },
      face: { x: 0, y: 1, z: 0 },
    });
  }

  private async refreshStrategy(): Promise<void> {
    await this.strategy.run(this.goals.current?.text);
    this.lastGoalVersion = this.goals.current?.version ?? 0;
    this.telemetry.record('system2.directive', {
      goal: this.goals.current?.text,
      directive: this.strategy.latest?.text,
    });
  }

  private async refreshNavigation(): Promise<void> {
    if (!this.workers || !this.bot.entity) return;
    try {
      const snapshot = extractLocalGrid(this.bot);
      const path = await this.workers.findPath(snapshot);
      this.pathLength = path.length;
      const next = path[1];
      this.navigationTarget = next ? {
        x: snapshot.origin.x + next.x + 0.5,
        y: snapshot.origin.y + next.y,
        z: snapshot.origin.z + next.z + 0.5,
      } : undefined;
    } catch (error) {
      this.lastError = error instanceof Error ? `Navigation: ${error.message}` : 'Navigation failed';
    }
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
      pathLength: this.pathLength,
      telemetryEvents: this.telemetry.size,
    };
  }

  public async stop(): Promise<void> {
    this.connected = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.brainstem.stop();
    this.strategy.stop();
    await this.control.stop();
    await this.workers?.close();
    this.kernel.execute({ action: 'idle', state_version: this.stateVersion });
  }
}
