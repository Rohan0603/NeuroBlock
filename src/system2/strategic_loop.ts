import { Ajv } from 'ajv';
import { Type, type Static } from '@sinclair/typebox';
import type { StrategicDirective, StrategicObjective, StrategicObjectiveKind, TaskPlan } from '../core/types.js';
import { inferRelevantCapabilities } from '../core/capabilities.js';

const TaskPlanSchema = Type.Object({
  objective: Type.Union(['escape', 'navigate', 'gather', 'craft', 'build'].map((value) => Type.Literal(value))),
  steps: Type.Array(Type.Object({
    step: Type.Union(['escape', 'navigate', 'gather', 'craft', 'build', 'verify'].map((value) => Type.Literal(value))),
    purpose: Type.String({ minLength: 1, maxLength: 300 }),
  }, { additionalProperties: false }), { minItems: 1, maxItems: 8 }),
}, { additionalProperties: false });
type ValidTaskPlan = Static<typeof TaskPlanSchema>;
const validateTaskPlan = new Ajv({ allErrors: false }).compile<ValidTaskPlan>(TaskPlanSchema);

export class StrategicLoop {
  private directive: StrategicDirective | undefined;
  private timer: NodeJS.Timeout | undefined;
  public constructor(
    private readonly decide: (goal?: string) => Promise<string>,
    private readonly intervalMs = 30000,
    private readonly goal?: () => string | undefined,
  ) {}
  public get latest(): StrategicDirective | undefined { return this.directive; }
  public start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.run().catch((error) => console.error('Strategic loop failed', error));
    }, this.intervalMs);
    this.timer.unref();
  }
  public async run(goalOverride?: string): Promise<void> {
    const text = await this.decide(goalOverride ?? this.goal?.());
    const plan = parseTaskPlan(text);
    this.directive = {
      text,
      objective: toObjective(text),
      ...(plan ? { plan } : {}),
      createdAt: Date.now(),
      relevantCapabilities: inferRelevantCapabilities(text),
    };
  }
  public stop(): void { if (this.timer) clearInterval(this.timer); this.timer = undefined; }
}

function parseTaskPlan(text: string): TaskPlan | undefined {
  try {
    const candidate: unknown = JSON.parse(text);
    return validateTaskPlan(candidate) ? candidate as TaskPlan : undefined;
  } catch {
    return undefined;
  }
}

function toObjective(text: string): StrategicObjective {
  const normalized = text.toLowerCase();
  const kind: StrategicObjectiveKind =
    /escape|pit|leave the mine|get out/.test(normalized) ? 'survive' :
    /farm|crop|plant/.test(normalized) ? 'farm' :
    /build|house|shelter|tower/.test(normalized) ? 'build' :
    /collect|gather|\bwood\b|\bore\b|resource/.test(normalized) ? 'collect' :
    /attack|fight|defend|combat|threat/.test(normalized) ? 'combat' :
    /survive|food|heal|sleep/.test(normalized) ? 'survive' :
    /home|safe/.test(normalized) ? 'shelter' : 'explore';
  const steps = kind === 'farm' && /escape|mine|open ground|daylight/.test(normalized)
    ? ['escape', 'gather', 'farm']
    : kind === 'farm' ? ['gather', 'farm'] : undefined;
  return { kind, text, constraints: [], ...(steps ? { steps } : {}) };
}
