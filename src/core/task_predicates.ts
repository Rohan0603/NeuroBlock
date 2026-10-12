import type { Bot } from 'mineflayer';
import type { Vec3 } from 'vec3';

export function safeOpenGround(bot: Bot, position: Vec3 | undefined): boolean {
  if (!position) return false;
  const feet = bot.blockAt(position);
  const below = bot.blockAt(position.offset(0, -1, 0));
  if (!below || below.boundingBox !== 'block' || feet?.boundingBox === 'block') return false;
  for (let height = 1; height <= 16; height += 1) {
    if (bot.blockAt(position.offset(0, height, 0))?.boundingBox === 'block') return false;
  }
  return true;
}

export function hasNamedItem(bot: Bot, pattern: RegExp): boolean {
  return bot.inventory.items().some((item) => pattern.test(item.name) && item.count > 0);
}
