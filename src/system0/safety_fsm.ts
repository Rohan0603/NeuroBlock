import type { Bot } from 'mineflayer';

export type SafetyState = 'SAFE' | 'DANGER' | 'TURTLE';

export class SafetyFSM {
  public evaluate(bot: Bot): SafetyState {
    if (bot.health <= 0) return 'TURTLE';
    const block = bot.blockAt(bot.entity.position.offset(0, -1, 0));
    if (block?.name.includes('lava')) return 'DANGER';
    return 'SAFE';
  }
}
