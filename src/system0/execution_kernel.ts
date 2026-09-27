import type { Bot } from 'mineflayer';
import type { Intent } from '../core/types.js';
import { Vec3 } from 'vec3';
import type { Recipe } from 'prismarine-recipe';

export class ExecutionKernel {
  private digging = false;
  private crafting = false;
  public constructor(private readonly bot: Bot, private readonly onError?: (error: unknown) => void) {}

  public move(intent: Intent): void {
    if (intent.target) {
      try {
        const target = JSON.parse(intent.target) as { x?: number; y?: number; z?: number };
        if (typeof target.x === 'number' && typeof target.y === 'number' && typeof target.z === 'number') {
          const position = this.bot.entity.position;
          const yaw = Math.atan2(-(target.x - position.x), target.z - position.z);
          void this.bot.look(yaw, 0, true).catch((error) => this.onError?.(error));
        }
      } catch (error) {
        this.onError?.(error);
      }
    }
    this.bot.setControlState('forward', intent.action === 'move');
  }

  public attack(targetId: string): void {
    const target = this.bot.entities[Number(targetId)];
    if (target) this.bot.attack(target);
  }

  public dig(blockId: number): void {
    if (this.digging) return;
    const block = this.bot.blockAt(this.bot.entity.position.offset(0, -1, 0));
    if (!block || block.type !== blockId || !this.bot.canDigBlock(block)) return;
    this.digging = true;
    void this.bot.dig(block).catch((error) => this.onError?.(error)).finally(() => { this.digging = false; });
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

  public place(target: string): void {
    try {
      const value = JSON.parse(target) as { block?: string; reference?: { x: number; y: number; z: number }; face?: { x: number; y: number; z: number } };
      if (!value.block || !value.reference || !value.face) return;
      const item = this.bot.registry.itemsByName[value.block];
      const reference = this.bot.blockAt(new Vec3(value.reference.x, value.reference.y, value.reference.z));
      const face = value.face;
      if (!item || !reference || !face) return;
      const place = async (): Promise<void> => {
        if (!this.bot.heldItem || this.bot.heldItem.type !== item.id) await this.bot.equip(item.id, 'hand');
        await this.bot.placeBlock(reference, new Vec3(face.x, face.y, face.z));
      };
      void place().catch((error) => this.onError?.(error));
    } catch {
      return;
    }
  }

  public execute(intent: Intent): void {
    switch (intent.action) {
      case 'move': this.move(intent); break;
      case 'attack': if (intent.target) this.attack(intent.target); break;
      case 'mine': if (intent.target) this.dig(Number(intent.target)); break;
      case 'eat': this.eat(); break;
      case 'craft': if (intent.target) void this.craft(intent.target); break;
      case 'place': if (intent.target) this.place(intent.target); break;
      case 'idle': this.bot.clearControlStates(); break;
    }
  }
}
