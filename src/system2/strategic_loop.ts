import type { StrategicDirective, StrategicObjective, StrategicObjectiveKind } from '../core/types.js';
import { inferRelevantCapabilities } from '../core/capabilities.js';

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
    this.directive = {
      text,
      objective: toObjective(text),
      createdAt: Date.now(),
      relevantCapabilities: inferRelevantCapabilities(text),
    };
  }
  public stop(): void { if (this.timer) clearInterval(this.timer); this.timer = undefined; }
}

function toObjective(text: string): StrategicObjective {
  const normalized = text.toLowerCase();
  const kind: StrategicObjectiveKind =
    /farm|crop|plant/.test(normalized) ? 'farm' :
    /build|house|shelter|tower/.test(normalized) ? 'build' :
    /collect|gather|\bwood\b|\bore\b|resource/.test(normalized) ? 'collect' :
    /attack|fight|defend|combat|threat/.test(normalized) ? 'combat' :
    /survive|food|heal|sleep/.test(normalized) ? 'survive' :
    /home|safe/.test(normalized) ? 'shelter' : 'explore';
  return { kind, text, constraints: [] };
}
