import type { AgentGoal } from './types.js';

export class GoalStore {
  private goal: AgentGoal | undefined;
  private version = 0;

  public get current(): AgentGoal | undefined {
    return this.goal;
  }

  public set(text: string): AgentGoal {
    const normalized = text.trim();
    if (!normalized || normalized.length > 500) {
      throw new Error('Goal must contain 1-500 non-whitespace characters');
    }
    this.version += 1;
    this.goal = { text: normalized, version: this.version, createdAt: Date.now() };
    return this.goal;
  }

  public clear(): void {
    this.version += 1;
    this.goal = undefined;
  }
}
