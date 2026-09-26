import { choice, TypeSafeClient } from '@typesafe-ai/sdk';
import type { Action, Intent } from '../core/types.js';

export interface JevClientOptions {
  readonly model?: string;
  readonly client?: TypeSafeClient;
}

export class JevClient {
  private readonly client: TypeSafeClient;
  private readonly model: string;

  public constructor(options: JevClientOptions = {}) {
    this.client = options.client ?? new TypeSafeClient();
    this.model = options.model ?? process.env.JEV_MODEL ?? 'jev-latest';
  }

  public async requestIntent(state: string, stateVersion: number, actions: readonly Action[]): Promise<Intent | null> {
    if (!process.env.TYPESAFE_API_KEY && !process.env.JEV_API_KEY) return null;
    if (actions.length === 0) return null;
    const criteria = Object.fromEntries(actions.map((action) => [
      action,
      `Choose the ${action} action only when it is safe and valid for the supplied state.`,
    ]));
    const result = await this.client.systemOne({
      model: this.model,
      state,
      questions: {
        action: choice('Which single action should the Minecraft agent execute next?', criteria),
      },
    });
    const selected = result.answers.action.choice;
    if (!actions.includes(selected as Action)) return null;
    return { action: selected as Action, state_version: stateVersion };
  }
}
