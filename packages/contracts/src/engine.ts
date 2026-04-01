import { z } from 'zod';

export const EngineKindSchema = z.enum(['fake', 'pi']);

export const EngineHostToolModeSchema = z.enum(['none', 'native', 'bridge', 'native_with_fallback']);

export const EngineCancellationModeSchema = z.enum(['none', 'cooperative', 'rpc_abort', 'rpc_abort_with_signal_fallback']);

export const EngineCapabilitiesSchema = z.object({
  engineKind: EngineKindSchema,
  persistentSessionSupport: z.boolean(),
  resumeBySessionRefSupport: z.boolean(),
  hostToolMode: EngineHostToolModeSchema,
  compactionEventSupport: z.boolean(),
  cancellationMode: EngineCancellationModeSchema,
  acceptedRequestMetadata: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
});
export type EngineCapabilities = z.infer<typeof EngineCapabilitiesSchema>;

export const EngineFailureClassificationSchema = z.enum([
  'none',
  'startup_failure',
  'transient_failure',
  'permanent_failure',
  'auth_failure',
  'policy_failure',
  'cancelled',
  'protocol_error',
]);
export type EngineFailureClassification = z.infer<typeof EngineFailureClassificationSchema>;

export const NormalizedEngineEventSchema = z.object({
  type: z.enum([
    'started',
    'session',
    'message',
    'tool_call',
    'tool_result',
    'completed',
    'failed',
    'usage',
    'compaction',
    'model_routing',
    'model_attempt',
    'model_fallback',
    'budget_warning',
    'budget_exhausted',
    'delegation_started',
    'delegation_completed',
  ]),
  payload: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
  raw: z.string().optional(),
});
export type NormalizedEngineEvent = z.infer<typeof NormalizedEngineEventSchema>;

export const UsageMetricsSchema = z.object({
  provider: z.string(),
  model: z.string(),
  tokensIn: z.number().int().nonnegative(),
  tokensOut: z.number().int().nonnegative(),
  estimatedCostUsd: z.number().nonnegative(),
});
export type UsageMetrics = z.infer<typeof UsageMetricsSchema>;
