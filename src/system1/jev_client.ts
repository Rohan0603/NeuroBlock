import { choice, TypeSafeClient } from '@typesafe-ai/sdk';
import type { Action, Direction, Intent } from '../core/types.js';
import { CAPABILITIES } from '../core/capabilities.js';

const MIN_ACTION_CONFIDENCE = 0.6;

export interface JevClientOptions {
  readonly model?: string;
  readonly client?: TypeSafeClient;
  readonly onOutcome?: (outcome: 'unavailable' | 'low_confidence') => void;
}

export class JevClient {
  private readonly client: TypeSafeClient;
  private readonly model: string;
  private readonly onOutcome?: JevClientOptions['onOutcome'];

  public constructor(options: JevClientOptions = {}) {
    this.client = options.client ?? new TypeSafeClient();
    this.model = options.model ?? process.env.JEV_MODEL ?? 'jev-latest';
    this.onOutcome = options.onOutcome;
  }

  public async requestIntent(state: string, stateVersion: number, actions: readonly Action[], candidateIds: readonly string[] = []): Promise<Intent | null> {
    if (!process.env.TYPESAFE_API_KEY && !process.env.JEV_API_KEY) {
      this.onOutcome?.('unavailable');
      return null;
    }
    if (actions.length === 0) return null;
    const criteria = Object.fromEntries(actions.map((action) => [
      action,
      this.capabilityPrompt(action)
        ?? `Choose ${action} only when safe and valid for supplied state.`,
    ]));
    const questions = {
      action: choice('Which single action should the Minecraft agent execute next?', criteria),
      targetHint: choice('Which cardinal direction should runtime prefer for this action?', {
        north: 'Prefer north.',
        south: 'Prefer south.',
        east: 'Prefer east.',
        west: 'Prefer west.',
      }),
      ...(candidateIds.length > 0 ? {
        candidateId: choice('Which verified escape candidate should runtime use?', Object.fromEntries(candidateIds.map((id) => [id, `Select verified candidate ${id}.`]))),
      } : {}),
    };
    const result = await this.client.systemOne({
      model: this.model,
      state,
      questions,
    });
    const actionAnswer = result.answers.action as { choice?: unknown; confidence?: unknown };
    if (typeof actionAnswer.confidence === 'number' && actionAnswer.confidence < MIN_ACTION_CONFIDENCE) {
      this.onOutcome?.('low_confidence');
      return null;
    }
    const selected = actionAnswer.choice;
    if (!actions.includes(selected as Action)) return null;
    const directionAnswer = result.answers.targetHint as { choice?: unknown } | undefined;
    const direction = directionAnswer?.choice;
    const candidateAnswer = result.answers.candidateId as { choice?: unknown } | undefined;
    return {
      action: selected as Action,
      ...(typeof direction === 'string' && ['north', 'south', 'east', 'west'].includes(direction)
        ? { targetHint: { kind: 'direction', direction: direction as Direction, distance: 3 } }
        : {}),
      ...(typeof candidateAnswer?.choice === 'string' && candidateIds.includes(candidateAnswer.choice)
        ? { candidateId: candidateAnswer.choice }
        : {}),
      state_version: stateVersion,
    };
  }

  private capabilityPrompt(action: Action): string | undefined {
    const capability = CAPABILITIES.find((candidate) => candidate.action === action);
    if (!capability) return undefined;
    const preconditions = capability.preconditions?.join('; ');
    const failures = capability.failureCodes?.join(', ');
    const recovery = capability.recoveryActions?.join(', ');
    return [
      capability.description,
      preconditions ? `Preconditions: ${preconditions}.` : '',
      failures ? `Failure codes: ${failures}.` : '',
      recovery ? `Recover with: ${recovery}.` : '',
    ].filter(Boolean).join(' ');
  }
}
