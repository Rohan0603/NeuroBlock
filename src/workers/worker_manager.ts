import { Worker } from 'node:worker_threads';
import type { GridSnapshot } from '../core/types.js';

export class WorkerManager {
  private readonly worker = new Worker(new URL(import.meta.url.endsWith('.ts') ? './pathfinder.worker.ts' : './pathfinder.worker.js', import.meta.url), { execArgv: process.execArgv });
  public constructor() { this.worker.unref(); }

  public findPath(snapshot: GridSnapshot, start = { x: 8, y: 8, z: 8 }, goal = { x: 9, y: 8, z: 8 }): Promise<readonly { x: number; y: number; z: number }[]> {
    return new Promise((resolve, reject) => {
      const message = (value: readonly { x: number; y: number; z: number }[]) => { cleanup(); resolve(value); };
      const error = (reason: Error) => { cleanup(); reject(reason); };
      const cleanup = () => { this.worker.off('message', message); this.worker.off('error', error); };
      this.worker.once('message', message);
      this.worker.once('error', error);
      const buffer = snapshot.blocks.buffer as ArrayBuffer;
      this.worker.postMessage({ blocks: buffer, origin: snapshot.origin, size: snapshot.size, start, goal }, [buffer]);
    });
  }

  public async close(): Promise<void> { await this.worker.terminate(); }
}
