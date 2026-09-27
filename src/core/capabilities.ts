import type { Action } from './types.js';

export interface CapabilityDefinition {
  readonly action: Action;
  readonly description: string;
  readonly tags: readonly string[];
}

export const CAPABILITIES: readonly CapabilityDefinition[] = [
  { action: 'move', description: 'Use bot.pathfinder with a GoalNear target.', tags: ['move', 'travel', 'explore', 'go', 'approach', 'navigate'] },
  { action: 'jump', description: 'Pulse bot.setControlState jump briefly to climb or escape a shallow pit.', tags: ['jump', 'climb', 'pit', 'stuck', 'escape'] },
  { action: 'attack', description: 'Use bot.attack against a nearby hostile mob selected by bot.nearestEntity.', tags: ['attack', 'fight', 'danger', 'hostile', 'mob', 'threat', 'defend'] },
  { action: 'mine', description: 'Use bot.canDigBlock and bot.dig on a validated block.', tags: ['mine', 'dig'] },
  { action: 'collect', description: 'Use bot.collectBlock to find, pathfind to, mine, and collect a nearby resource block.', tags: ['collect', 'gather', 'resource', 'wood', 'ore', 'stone', 'logs'] },
  { action: 'eat', description: 'Use bot.consume on the currently held food item.', tags: ['eat', 'food', 'hunger', 'starving'] },
  { action: 'craft', description: 'Use bot.recipesFor and bot.craft for a needed inventory item.', tags: ['craft', 'make', 'tool', 'recipe'] },
  { action: 'place', description: 'Use bot.placeBlock with a held block and validated reference face.', tags: ['place', 'build', 'shelter', 'house', 'wall', 'farm'] },
  { action: 'flee', description: 'Use bot.pathfinder with a GoalNear target away from the nearest threat.', tags: ['flee', 'retreat', 'run', 'escape', 'evade'] },
  { action: 'drop', description: 'Use bot.tossStack to discard a junk inventory item.', tags: ['drop', 'discard', 'toss', 'unload', 'junk'] },
  { action: 'equip', description: 'Use bot.equip to wear an armor piece from inventory in its matching slot.', tags: ['equip', 'wear', 'armor', 'gear up', 'protect'] },
  { action: 'sleep', description: 'Use bot.isABed/bot.findBlock and bot.sleep on a nearby bed at night.', tags: ['sleep', 'night', 'bed', 'rest'] },
  { action: 'activate', description: 'Use bot.activateBlock to open a nearby door, chest, or lever.', tags: ['open', 'door', 'chest', 'lever', 'activate', 'interact'] },
  { action: 'idle', description: 'Take no action when no action is safe or useful.', tags: [] },
];

export const ACTIONS: readonly Action[] = CAPABILITIES.map(({ action }) => action);
export const NON_IDLE_ACTIONS: readonly Action[] = ACTIONS.filter((action) => action !== 'idle');

export function inferRelevantCapabilities(text: string): readonly Action[] {
  const normalized = text.toLowerCase();
  const matched = CAPABILITIES
    .filter(({ tags }) => tags.some((tag) => normalized.includes(tag)))
    .map(({ action }) => action);
  return matched.length > 0 ? Array.from(new Set<Action>([...matched, 'idle'])) : ACTIONS;
}
