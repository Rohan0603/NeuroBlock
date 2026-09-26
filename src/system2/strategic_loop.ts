import type { StrategicDirective } from '../core/types.js';

export class StrategicLoop {
  private directive: StrategicDirective | undefined;
  private timer: NodeJS.Timeout | undefined;
  public constructor(
    private readonly decide: (goal?: string) => Promise<string>,
    private readonly intervalMs = 30000,
    private readonly goal?: () => string | undefined,
  ) {}
  public get latest(): StrategicDirective | undefined { return this.directive; }
  public start(): void { if (this.timer) return; this.timer = setInterval(() => { void this.run(); }, this.intervalMs); this.timer.unref(); }
  public async run(goalOverride?: string): Promise<void> {
    const text = await this.decide(goalOverride ?? this.goal?.());
    this.directive = { text, createdAt: Date.now() };
  }
  public stop(): void { if (this.timer) clearInterval(this.timer); this.timer = undefined; }
}
