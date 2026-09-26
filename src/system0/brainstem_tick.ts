import type { Bot } from 'mineflayer';
import type { IntentEpoch } from '../core/types.js';
import { ExecutionKernel } from './execution_kernel.js';
import { SafetyFSM } from './safety_fsm.js';

export interface IntentSource { latest: IntentEpoch | undefined; }

export class BrainstemTick {
  private readonly kernel: ExecutionKernel;
  private readonly safety = new SafetyFSM();
  private timer: NodeJS.Timeout | undefined;
  private stateVersion = 0;

  public constructor(private readonly bot: Bot, private readonly source: IntentSource) {
    this.kernel = new ExecutionKernel(bot);
  }

  public start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), 50);
    this.timer.unref();
  }

  public tick(): void {
    const safety = this.safety.evaluate(this.bot);
    const epoch = this.source.latest;
    if (safety !== 'SAFE' || !epoch || epoch.stateVersion !== this.stateVersion) {
      this.kernel.execute({ action: 'idle', state_version: this.stateVersion });
      return;
    }
    this.kernel.execute(epoch.intent);
  }

  public advanceState(): void { this.stateVersion += 1; }
  public stop(): void { if (this.timer) clearInterval(this.timer); this.timer = undefined; }
}
