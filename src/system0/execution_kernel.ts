import type { Bot } from 'mineflayer';
import type { Action, Intent, IntentTarget } from '../core/types.js';
import { Vec3 } from 'vec3';
import type { Recipe } from 'prismarine-recipe';
import pathfinderModule from 'mineflayer-pathfinder';
const { goals } = pathfinderModule;

export class ExecutionKernel {
  private digging = false;
  private crafting = false;
  private collecting = false;
  private placing = false;
  private sleeping = false;
  private rescuing = false;
  private rescueTimer: NodeJS.Timeout | undefined;
  private jumping = false;
  private jumpTimer: NodeJS.Timeout | undefined;
  private lastGoalAt = 0;
  private lastGoalTarget: string | undefined;
  private readonly handlers: Readonly<Record<Action, (intent: Intent) => void>>;
  public constructor(
    private readonly bot: Bot,
    private readonly onError?: (error: unknown) => void,
    private readonly event?: (type: string, data?: Record<string, unknown>) => void,
  ) {
    this.handlers = {
      move: (intent) => this.move(intent),
      jump: () => this.jump(),
      attack: (intent) => { if (intent.target) this.attack(intent.target); },
      mine: (intent) => { if (intent.target?.kind === 'block') this.dig(intent.target.type); },
      collect: (intent) => { if (intent.target?.kind === 'collect') void this.collect(intent.target); },
      eat: () => this.eat(),
      craft: (intent) => { if (intent.target?.kind === 'craft') void this.craft(intent.target.item); },
      place: (intent) => { if (intent.target?.kind === 'place') this.place(intent.target); },
      flee: (intent) => this.move(intent),
      drop: (intent) => { if (intent.target?.kind === 'item') void this.drop(intent.target.name); },
      equip: (intent) => { if (intent.target?.kind === 'equip') this.equip(intent.target); },
      sleep: () => this.sleep(),
      activate: (intent) => { if (intent.target?.kind === 'activate') this.activate(intent.target); },
      idle: () => this.resetToIdle(),
    };
  }

  public move(intent: Intent): void {
    if (!intent.target) return;
    try {
      const target = intent.target;
      if (target.kind !== 'near') return;
      if (this.bot.pathfinder && typeof this.bot.pathfinder.isMoving === 'function' && this.bot.pathfinder.isMoving()) return;
      if (Date.now() - this.lastGoalAt < 1000) return;
      const targetKey = `${target.x},${target.y},${target.z},${target.range ?? 1}`;
      if (this.lastGoalTarget === targetKey) return;
      this.lastGoalTarget = targetKey;
      this.lastGoalAt = Date.now();
      if (!this.bot.pathfinder) {
        this.onError?.(new Error('Mineflayer pathfinder plugin is not loaded'));
        return;
      }

      this.bot.pathfinder.setGoal(new goals.GoalNear(target.x, target.y, target.z, target.range ?? 1));
    } catch (error) {
      this.onError?.(error);
    }

  }

  public rescueFromEmbedded(target?: { x: number; y: number; z: number }): void {
    if (this.rescuing) return;
    this.rescuing = true;
    this.bot.pathfinder?.stop();
    this.bot.clearControlStates();
    this.bot.setControlState('jump', true);
    this.rescueTimer = setTimeout(() => {
      this.bot.setControlState('jump', false);
      if (target && this.bot.pathfinder) {
        this.bot.pathfinder.setGoal(new goals.GoalNear(target.x, target.y, target.z, 1));
      }
      this.rescuing = false;
      this.rescueTimer = undefined;
    }, 500);
    this.rescueTimer.unref();
  }

  public jump(): void {
    if (this.jumping) return;
    this.jumping = true;
    this.bot.setControlState('jump', true);
    this.jumpTimer = setTimeout(() => {
      this.bot.setControlState('jump', false);
      this.jumping = false;
      this.jumpTimer = undefined;
    }, 350);
    this.jumpTimer.unref();
  }

  public attack(target: IntentTarget): void {
    if (target.kind !== 'entity') return;
    const entity = this.bot.entities[target.id];
    if (entity) this.bot.attack(entity);
  }

  public dig(blockId: number): void {
    if (this.digging) return;
    const block = this.bot.blockAt(this.bot.entity.position.offset(0, -1, 0));
    if (!block || block.type !== blockId || !this.bot.canDigBlock(block)) return;
    this.digging = true;
    void this.bot.dig(block).then(() => this.event?.('system0.dig.completed', { blockId }))
      .catch((error) => this.onError?.(error)).finally(() => { this.digging = false; });
  }

  public eat(): void {
    if (this.bot.food >= 20 || !this.bot.heldItem) return;
    void this.bot.consume();
  }

  public async craft(itemName: string): Promise<void> {
    if (this.crafting) return;
    const item = this.bot.registry.itemsByName[itemName];
    if (!item) return;
    this.crafting = true;
    try {
      for (const recipe of this.craftPlan(item.id, 6, new Set<number>())) await this.bot.craft(recipe, 1, undefined);
    } catch (error) {
      this.onError?.(error);
    } finally {
      this.crafting = false;
    }
  }

  public async collect(target: Extract<IntentTarget, { kind: 'collect' }>): Promise<void> {
    if (this.collecting) return;
    const block = this.bot.findBlock({
      matching: (candidate) => target.names.includes(candidate.name),
      maxDistance: target.maxDistance,
    });
    if (!block) return;
    if (!this.bot.collectBlock) {
      this.onError?.(new Error('Mineflayer collectblock plugin is not loaded'));
      return;
    }
    this.collecting = true;
    try {
      await this.bot.collectBlock.collect(block);
      this.event?.('system0.collect.completed', { block: block.name });
    } catch (error) {
      this.onError?.(error);
    } finally {
      this.collecting = false;
    }
  }

  private craftPlan(itemId: number, depth: number, visiting: Set<number>): readonly Recipe[] {
    if (depth <= 0) return [];
    const recipe = this.bot.recipesFor(itemId, null, 1, null)[0];
    if (!recipe || visiting.has(itemId)) return [];
    visiting.add(itemId);
    const inventory = new Map<number, number>();
    for (const stack of this.bot.inventory.items()) inventory.set(stack.type, (inventory.get(stack.type) ?? 0) + stack.count);
    const prerequisites: Recipe[] = [];
    for (const ingredient of recipe.ingredients) {
      if ((inventory.get(ingredient.id) ?? 0) >= ingredient.count) continue;
      prerequisites.push(...this.craftPlan(ingredient.id, depth - 1, visiting));
    }
    visiting.delete(itemId);
    return [...prerequisites, recipe];
  }

  public place(value: Extract<IntentTarget, { kind: 'place' }>): void {
    if (this.placing) return;
    const item = this.bot.registry.itemsByName[value.block];
    const reference = this.bot.blockAt(new Vec3(value.reference.x, value.reference.y, value.reference.z));
    const face = value.face;
    if (!item || !reference) return;
    this.placing = true;
    const place = async (): Promise<void> => {
      if (!this.bot.heldItem || this.bot.heldItem.type !== item.id) await this.bot.equip(item.id, 'hand');
      await this.bot.placeBlock(reference, new Vec3(face.x, face.y, face.z));
    };
    void place().then(() => this.event?.('system0.place.completed', { block: value.block }))
      .catch((error) => this.onError?.(error))
      .finally(() => { this.placing = false; });
  }

  public async drop(itemName: string): Promise<void> {
    const item = this.bot.inventory.items().find((stack) => stack.name === itemName);
    if (!item) return;
    try {
      await this.bot.tossStack(item);
      this.event?.('system0.drop.completed', { item: itemName });
    } catch (error) {
      this.onError?.(error);
    }
  }

  public equip(value: Extract<IntentTarget, { kind: 'equip' }>): void {
      const item = this.bot.inventory.items().find((stack) => stack.name === value.item);
      if (!item) return;
      void this.bot.equip(item.type, value.destination)
        .then(() => this.event?.('system0.equip.completed', { item: value.item, destination: value.destination }))
        .catch((error) => this.onError?.(error));
  }

  public sleep(): void {
    if (this.sleeping || this.bot.isSleeping || this.bot.time.isDay) return;
    const bed = this.bot.findBlock({ matching: (block) => this.bot.isABed(block), maxDistance: 16 });
    if (!bed) return;
    this.sleeping = true;
    void this.bot.sleep(bed).then(() => this.event?.('system0.sleep.completed', {}))
      .catch((error) => this.onError?.(error)).finally(() => { this.sleeping = false; });
  }

  public activate(value: Extract<IntentTarget, { kind: 'activate' }>): void {
      const block = this.bot.blockAt(new Vec3(value.x, value.y, value.z));
      if (!block) return;
      void this.bot.activateBlock(block)
        .then(() => this.event?.('system0.activate.completed', { x: value.x, y: value.y, z: value.z }))
        .catch((error) => this.onError?.(error));
  }

  private resetToIdle(): void {
    this.lastGoalTarget = undefined;
    this.lastGoalAt = 0;
    this.bot.pathfinder?.setGoal(null);
    this.bot.clearControlStates();
    if (this.jumpTimer) clearTimeout(this.jumpTimer);
    this.jumpTimer = undefined;
    this.jumping = false;
    if (this.rescueTimer) clearTimeout(this.rescueTimer);
    this.rescueTimer = undefined;
    this.rescuing = false;
    if (this.digging) this.bot.stopDigging();
    if (this.bot.isSleeping) void this.bot.wake().catch((error) => this.onError?.(error));
  }

  public execute(intent: Intent): void {
    this.handlers[intent.action](intent);
  }
}
