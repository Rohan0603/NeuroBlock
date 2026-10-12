import type { TaskState, TaskStep } from './types.js';

const DEFAULT_DEADLINE_MS = 120_000;
const MAX_ATTEMPTS = 12;

export class TaskController {
  private task: TaskState | undefined;

  public get current(): TaskState | undefined {
    return this.task;
  }

  public start(goal: string, goalVersion: number, step: TaskStep, now = Date.now(), deadlineMs = DEFAULT_DEADLINE_MS): TaskState {
    this.task = {
      goal,
      goalVersion,
      step,
      status: 'active',
      attempts: 0,
      startedAt: now,
      deadlineAt: now + deadlineMs,
    };
    return this.task;
  }

  public attempt(now = Date.now()): TaskState | undefined {
    if (!this.task || this.task.status !== 'active') return this.task;
    const attempts = this.task.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) return this.fail('retry limit reached', now);
    this.task = { ...this.task, attempts };
    return this.task;
  }

  public checkDeadline(now = Date.now()): TaskState | undefined {
    if (!this.task || this.task.status !== 'active' || now < this.task.deadlineAt) return this.task;
    return this.fail('task deadline exceeded', now);
  }

  public transition(step: TaskStep): TaskState | undefined {
    if (!this.task || this.task.status !== 'active') return this.task;
    const { stableSince: _stableSince, ...current } = this.task;
    this.task = { ...current, step, attempts: 0 };
    return this.task;
  }

  public markStable(now = Date.now()): TaskState | undefined {
    if (!this.task || this.task.status !== 'active') return this.task;
    if (this.task.stableSince !== undefined) return this.task;
    this.task = { ...this.task, stableSince: now };
    return this.task;
  }

  public resetStable(): TaskState | undefined {
    if (!this.task || this.task.status !== 'active' || this.task.stableSince === undefined) return this.task;
    const { stableSince: _stableSince, ...current } = this.task;
    this.task = current;
    return this.task;
  }

  public complete(now = Date.now()): TaskState | undefined {
    if (!this.task || this.task.status !== 'active') return this.task;
    this.task = { ...this.task, step: 'complete', status: 'complete', completedAt: now };
    return this.task;
  }

  public fail(reason: string, now = Date.now()): TaskState | undefined {
    if (!this.task || this.task.status !== 'active') return this.task;
    this.task = { ...this.task, step: 'failed', status: 'failed', failure: reason, completedAt: now };
    return this.task;
  }

  public clear(): void {
    this.task = undefined;
  }
}
