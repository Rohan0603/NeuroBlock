import { Ajv, type ValidateFunction } from 'ajv';
import { Type, type Static } from '@sinclair/typebox';
import type { Intent } from '../core/types.js';
import { CAPABILITIES } from '../core/capabilities.js';

export const IntentSchema = Type.Object({
  action: Type.Union(CAPABILITIES.map(({ action }) => Type.Literal(action))),
  target: Type.Optional(Type.Union([
    Type.Object({ kind: Type.Literal('near'), x: Type.Number(), y: Type.Number(), z: Type.Number(), range: Type.Optional(Type.Number({ minimum: 0 })) }, { additionalProperties: false }),
    Type.Object({ kind: Type.Literal('entity'), id: Type.Integer({ minimum: 0 }) }, { additionalProperties: false }),
    Type.Object({ kind: Type.Literal('block'), type: Type.Integer({ minimum: 0 }) }, { additionalProperties: false }),
    Type.Object({ kind: Type.Literal('collect'), names: Type.Array(Type.String(), { minItems: 1 }), maxDistance: Type.Number({ minimum: 0 }) }, { additionalProperties: false }),
    Type.Object({ kind: Type.Literal('item'), name: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
    Type.Object({ kind: Type.Literal('craft'), item: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
    Type.Object({ kind: Type.Literal('equip'), item: Type.String({ minLength: 1 }), destination: Type.Union(['hand', 'off-hand', 'head', 'torso', 'legs', 'feet'].map((value) => Type.Literal(value))) }, { additionalProperties: false }),
    Type.Object({ kind: Type.Literal('activate'), x: Type.Number(), y: Type.Number(), z: Type.Number() }, { additionalProperties: false }),
    Type.Object({ kind: Type.Literal('place'), block: Type.String({ minLength: 1 }), reference: Type.Object({ x: Type.Number(), y: Type.Number(), z: Type.Number() }), face: Type.Object({ x: Type.Number(), y: Type.Number(), z: Type.Number() }) }, { additionalProperties: false }),
  ])),
  state_version: Type.Integer({ minimum: 0 }),
}, { additionalProperties: false });

type ValidIntent = Static<typeof IntentSchema>;
const validator: ValidateFunction<ValidIntent> = new Ajv({ allErrors: false }).compile(IntentSchema);

export function validateLLMIntent(value: unknown): Intent | null {
  return validator(value) ? value as Intent : null;
}
