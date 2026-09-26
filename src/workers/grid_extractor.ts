import type { Bot } from 'mineflayer';
import type { GridSnapshot } from '../core/types.js';

const SIZE = 16;

export function extractLocalGrid(bot: Bot, radius = 8): GridSnapshot {
  const position = bot.entity.position;
  const origin = { x: Math.floor(position.x) - radius, y: Math.floor(position.y) - radius, z: Math.floor(position.z) - radius };
  const blocks = new Uint16Array(SIZE * SIZE * SIZE);
  let index = 0;
  for (let y = 0; y < SIZE; y += 1) for (let z = 0; z < SIZE; z += 1) for (let x = 0; x < SIZE; x += 1) {
    const block = bot.blockAt(bot.entity.position.offset(origin.x + x - position.x, origin.y + y - position.y, origin.z + z - position.z));
    blocks[index++] = block?.type ?? 0;
  }
  return { blocks, origin, size: SIZE };
}
