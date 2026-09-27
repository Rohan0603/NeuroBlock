import type { Bot } from 'mineflayer';
import type { IntentEpoch } from '../core/types.js';
import { ExecutionKernel } from './execution_kernel.js';
import { SafetyFSM } from './safety_fsm.js';

export interface IntentSource { latest: IntentEpoch | undefined; }
export type BrainstemEvent = (type: string, data?: Record<string, unknown>) => void;

export class BrainstemTick {
  private readonly kernel: ExecutionKernel;
  private readonly safety = new SafetyFSM();
  private timer: NodeJS.Timeout | undefined;
  private stateVersion = 0;
  private lastLogAt = 0;
  private lastSafety: string | undefined;
  private lastAction: string | undefined;

  public constructor(private readonly bot: Bot, private readonly source: IntentSource, private readonly event?: BrainstemEvent) {
    this.kernel = new ExecutionKernel(bot, (error) => this.event?.('system0.error', {
      error: error instanceof Error ? error.message : String(error),
    }));
  }

  public start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), 50);
    this.timer.unref();
  }

  public tick(): void {
    const safety = this.safety.evaluate(this.bot);
    const epoch = this.source.latest;
    const now = Date.now();
    const logSafety = safety !== this.lastSafety || now - this.lastLogAt >= 250;
    if (logSafety) {
      this.event?.('system0.safety', { result: safety, hasIntent: Boolean(epoch) });
      this.lastSafety = safety;
      this.lastLogAt = now;
    }
    if (safety !== 'SAFE' || !epoch || epoch.stateVersion !== this.stateVersion) {
      this.kernel.execute({ action: 'idle', state_version: this.stateVersion });
      if (this.lastAction !== 'idle' || logSafety) {
        this.event?.('system0.execution', { action: 'idle', reason: safety !== 'SAFE' ? 'unsafe' : 'missing-or-stale-intent' });
        this.lastAction = 'idle';
      }
      return;
    }
    this.kernel.execute(epoch.intent);
    if (this.lastAction !== epoch.intent.action || logSafety) {
      this.event?.('system0.execution', { action: epoch.intent.action, target: epoch.intent.target });
      this.lastAction = epoch.intent.action;
    }
  }

  public advanceState(): void { this.stateVersion += 1; }
  public stop(): void { if (this.timer) clearInterval(this.timer); this.timer = undefined; }
}
