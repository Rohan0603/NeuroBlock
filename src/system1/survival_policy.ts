import type { Action, StrategicDirective } from '../core/types.js';

interface PrimitiveState {
  readonly objective?: { readonly steps?: readonly string[] };
  readonly escapeDigCount?: number;
  readonly world?: { readonly onGround?: boolean; readonly safeOpenGround?: boolean };
  readonly navigation?: { readonly state?: string; readonly lastFault?: string };
  readonly surroundings?: readonly { readonly solid?: boolean }[];
  readonly checkpoint?: { readonly name?: string };
}

const ESCAPE_DIG_LIMIT = 12;

export function chooseSurvivalAction(
  state: string,
  directive: StrategicDirective | undefined,
  available: readonly Action[],
): Action | undefined {
  let observation: PrimitiveState;
  try {
    observation = JSON.parse(state) as PrimitiveState;
  } catch (error) {
    throw new Error(`System 1 observation parse failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  const steps = observation.objective?.steps ?? directive?.objective.steps ?? [];
  if (steps[0] === 'escape') {
    if (observation.world?.safeOpenGround) {
      if (observation.checkpoint?.name === 'gather_seeds' && available.includes('collect')) return 'collect';
      if (observation.checkpoint?.name === 'craft_hoe' && available.includes('craft')) return 'craft';
      return available.includes('move') ? 'move' : undefined;
    }
    if (observation.navigation?.lastFault && observation.surroundings?.length &&
      (observation.escapeDigCount ?? 0) < ESCAPE_DIG_LIMIT && available.includes('mine')) return 'mine';
    if (observation.escapeDigCount !== undefined && observation.escapeDigCount >= ESCAPE_DIG_LIMIT &&
      available.includes('jump')) return 'jump';
    const action = (observation.escapeDigCount ?? 0) < ESCAPE_DIG_LIMIT
      ? observation.surroundings?.length ? 'mine' : observation.world?.onGround === false ? 'jump' : 'move'
      : 'move';
    return available.includes(action) ? action : undefined;
  }
  if (observation.checkpoint?.name === 'gather_seeds' && available.includes('collect')) return 'collect';
  if (observation.checkpoint?.name === 'craft_hoe' && available.includes('craft')) return 'craft';
  return undefined;
}
