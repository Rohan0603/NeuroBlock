import type { Bot } from 'mineflayer';
import type { Intent } from '../core/types.js';

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

  public craft(itemName: string): void {
    const item = this.bot.registry.itemsByName[itemName];
    if (!item) return;
    const recipes = this.bot.recipesFor(item.id, null, 1, null);
    const recipe = recipes[0];
    if (recipe) void this.bot.craft(recipe, 1, undefined);
  }

  public execute(intent: Intent): void {
    switch (intent.action) {
      case 'move': this.move(intent); break;
      case 'attack': if (intent.target) this.attack(intent.target); break;
      case 'mine': if (intent.target) this.dig(Number(intent.target)); break;
      case 'eat': this.eat(); break;
      case 'craft': if (intent.target) this.craft(intent.target); break;
      case 'idle': this.bot.clearControlStates(); break;
    }
  }
}
