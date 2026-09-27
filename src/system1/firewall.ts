import { Ajv, type ValidateFunction } from 'ajv';
import { Type, type Static } from '@sinclair/typebox';
import type { Intent } from '../core/types.js';

export const IntentSchema = Type.Object({
  action: Type.Union([
    Type.Literal('move'),
    Type.Literal('attack'),
    Type.Literal('mine'),
    Type.Literal('eat'),
    Type.Literal('craft'),
    Type.Literal('place'),
    Type.Literal('idle'),
  ]),
  target: Type.Optional(Type.String()),
  state_version: Type.Integer({ minimum: 0 }),
}, { additionalProperties: false });

type ValidIntent = Static<typeof IntentSchema>;
const validator: ValidateFunction<ValidIntent> = new Ajv({ allErrors: false }).compile(IntentSchema);

export function validateLLMIntent(value: unknown): Intent | null {
  return validator(value) ? value as Intent : null;
}
