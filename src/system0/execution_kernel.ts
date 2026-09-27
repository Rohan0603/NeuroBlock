import type { Bot } from 'mineflayer';
import type { Intent } from '../core/types.js';
import { Vec3 } from 'vec3';
import type { Recipe } from 'prismarine-recipe';

export class ExecutionKernel {
  public constructor(private readonly bot: Bot) {}

  public move(intent: Intent): void {
    this.bot.setControlState('forward', intent.action === 'move');
  }

  public attack(targetId: string): void {
    const target = this.bot.entities[Number(targetId)];
    if (target) this.bot.attack(target);
  }

  public dig(blockId: number): void {
    const block = this.bot.blockAt(this.bot.entity.position.offset(0, -1, 0));
    if (block && block.type === blockId && this.bot.canDigBlock(block)) void this.bot.dig(block);
  }

  public eat(): void {
    if (this.bot.food >= 20 || !this.bot.heldItem) return;
    void this.bot.consume();
  }

  public async craft(itemName: string): Promise<void> {
    const item = this.bot.registry.itemsByName[itemName];
    if (!item) return;
    for (const recipe of this.craftPlan(item.id, 6, new Set<number>())) await this.bot.craft(recipe, 1, undefined);
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
      if (!item || !reference || !this.bot.heldItem || this.bot.heldItem.type !== item.id) return;
      void this.bot.placeBlock(reference, new Vec3(value.face.x, value.face.y, value.face.z));
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
