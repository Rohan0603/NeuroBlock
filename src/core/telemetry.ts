import { appendFile, readFile } from 'node:fs/promises';

export interface TelemetryEvent {
  readonly time: number;
  readonly type: string;
  readonly data?: Record<string, unknown>;
}

export class Telemetry {
  private count = 0;
  private sequence = 0;
  private writes = Promise.resolve();
  public constructor(private readonly path = process.env.TELEMETRY_FILE ?? 'telemetry.jsonl') {}

  public get size(): number { return this.count; }

  public async read(limit = 500): Promise<readonly TelemetryEvent[]> {
    try {
      const text = await readFile(this.path, 'utf8');
      const lines = text.endsWith('\n') ? text.split('\n') : text.split('\n').slice(0, -1);
      const events = lines.filter(Boolean).flatMap((line) => {
        try {
          return [JSON.parse(line) as TelemetryEvent];
        } catch {
          return [];
        }
      });
      return events.slice(-Math.max(1, Math.min(limit, 5000)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }

  public record(type: string, data?: Record<string, unknown>): void {
    this.count += 1;
    this.sequence += 1;
    const event: TelemetryEvent = { time: Date.now(), type, data: { sequence: this.sequence, ...data } };
    this.writes = this.writes.then(() => appendFile(this.path, `${JSON.stringify(event)}\n`)).catch((error) => {
      console.error(`Telemetry write failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    });
  }
}
