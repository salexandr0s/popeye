#!/usr/bin/env tsx
/**
 * Generates Swift Codable models from @popeye/contracts Zod schemas.
 * Usage: tsx scripts/generate-swift-models.ts
 * Output: generated/swift/PopeyeModels.swift
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { z } from 'zod';

import {
  DaemonStateRecordSchema,
  DaemonStatusResponseSchema,
  InterventionCodeSchema,
  InterventionRecordSchema,
  JobLeaseRecordSchema,
  JobRecordSchema,
  JobStateSchema,
  MessageIngressDecisionCodeSchema,
  MessageIngressResponseSchema,
  MessageRecordSchema,
  ReceiptRecordSchema,
  RunEventRecordSchema,
  RunRecordSchema,
  RunStateSchema,
  SchedulerStatusResponseSchema,
  SecurityAuditFindingSchema,
  SseEventEnvelopeSchema,
  TaskCreateInputSchema,
  TaskRecordSchema,
  TaskSideEffectProfileSchema,
  UsageMetricsSchema,
  UsageSummarySchema,
} from '@popeye/contracts';

type ZodDef = z.ZodTypeDef;
type AnyZod = z.ZodTypeAny;

function zodToSwiftType(schema: AnyZod): string {
  const def = schema._def as ZodDef & {
    typeName?: string;
    innerType?: AnyZod;
    type?: AnyZod;
    schema?: AnyZod;
  };

  switch (def.typeName) {
    case 'ZodString':
      return 'String';
    case 'ZodNumber': {
      const checks = (def as unknown as { checks?: Array<{ kind: string }> })
        .checks ?? [];
      return checks.some((c) => c.kind === 'int') ? 'Int' : 'Double';
    }
    case 'ZodBoolean':
      return 'Bool';
    case 'ZodEnum':
      return 'String';
    case 'ZodArray': {
      const itemType = zodToSwiftType(def.type!);
      return `[${itemType}]`;
    }
    case 'ZodNullable':
      return `${zodToSwiftType(def.innerType!)}?`;
    case 'ZodOptional':
      return `${zodToSwiftType(def.innerType!)}?`;
    case 'ZodDefault':
      return zodToSwiftType(def.innerType!);
    case 'ZodObject':
      return 'JSONObject';
    case 'ZodRecord':
      return '[String: String]';
    case 'ZodEffects':
      return zodToSwiftType(def.schema!);
    default:
      return 'String';
  }
}

function generateSwiftEnum(
  name: string,
  schema: z.ZodEnum<[string, ...string[]]>,
): string {
  const values = schema.options as string[];
  const lines = [`public enum ${name}: String, Codable, Sendable {`];
  for (const value of values) {
    const caseName = value.replace(
      /[_-](\w)/g,
      (_: string, c: string) => c.toUpperCase(),
    );
    lines.push(`    case ${caseName} = "${value}"`);
  }
  lines.push('}');
  return lines.join('\n');
}

function generateSwiftStruct(
  name: string,
  schema: z.ZodObject<z.ZodRawShape>,
): string {
  const shape = schema.shape as Record<string, AnyZod>;
  const lines = [`public struct ${name}: Codable, Sendable {`];

  for (const [key, fieldSchema] of Object.entries(shape)) {
    const swiftType = zodToSwiftType(fieldSchema);
    const def = fieldSchema._def as ZodDef & { typeName?: string };
    const isDefault = def.typeName === 'ZodDefault';
    const optionalSuffix =
      isDefault && !swiftType.endsWith('?') ? '?' : '';
    lines.push(
      `    public let ${key}: ${swiftType}${optionalSuffix}`,
    );
  }

  lines.push('}');
  return lines.join('\n');
}

// Enum schemas
const enums: Array<[string, z.ZodEnum<[string, ...string[]]>]> = [
  ['JobState', JobStateSchema],
  ['RunState', RunStateSchema],
  ['InterventionCode', InterventionCodeSchema],
  ['TaskSideEffectProfile', TaskSideEffectProfileSchema],
  ['MessageIngressDecisionCode', MessageIngressDecisionCodeSchema],
];

// Struct schemas
const structs: Array<[string, z.ZodObject<z.ZodRawShape>]> = [
  ['TaskRecord', TaskRecordSchema as z.ZodObject<z.ZodRawShape>],
  ['JobRecord', JobRecordSchema as z.ZodObject<z.ZodRawShape>],
  ['RunRecord', RunRecordSchema as z.ZodObject<z.ZodRawShape>],
  ['RunEventRecord', RunEventRecordSchema as z.ZodObject<z.ZodRawShape>],
  ['ReceiptRecord', ReceiptRecordSchema as z.ZodObject<z.ZodRawShape>],
  [
    'InterventionRecord',
    InterventionRecordSchema as z.ZodObject<z.ZodRawShape>,
  ],
  ['MessageRecord', MessageRecordSchema as z.ZodObject<z.ZodRawShape>],
  [
    'MessageIngressResponse',
    MessageIngressResponseSchema as z.ZodObject<z.ZodRawShape>,
  ],
  [
    'JobLeaseRecord',
    JobLeaseRecordSchema as z.ZodObject<z.ZodRawShape>,
  ],
  ['UsageMetrics', UsageMetricsSchema as z.ZodObject<z.ZodRawShape>],
  ['UsageSummary', UsageSummarySchema as z.ZodObject<z.ZodRawShape>],
  [
    'SecurityAuditFinding',
    SecurityAuditFindingSchema as z.ZodObject<z.ZodRawShape>,
  ],
  [
    'DaemonStatusResponse',
    DaemonStatusResponseSchema as z.ZodObject<z.ZodRawShape>,
  ],
  [
    'SchedulerStatusResponse',
    SchedulerStatusResponseSchema as z.ZodObject<z.ZodRawShape>,
  ],
  [
    'DaemonStateRecord',
    DaemonStateRecordSchema as z.ZodObject<z.ZodRawShape>,
  ],
  [
    'SseEventEnvelope',
    SseEventEnvelopeSchema as z.ZodObject<z.ZodRawShape>,
  ],
  [
    'TaskCreateInput',
    TaskCreateInputSchema as z.ZodObject<z.ZodRawShape>,
  ],
];

const output: string[] = [
  '// Auto-generated from @popeye/contracts — do not edit',
  '// Generated: ' + new Date().toISOString().split('T')[0],
  'import Foundation',
  '',
  '// MARK: - Enums',
  '',
];

for (const [name, schema] of enums) {
  output.push(generateSwiftEnum(name, schema));
  output.push('');
}

output.push('// MARK: - Models');
output.push('');

for (const [name, schema] of structs) {
  output.push(generateSwiftStruct(name, schema));
  output.push('');
}

const outputPath = 'generated/swift/PopeyeModels.swift';
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, output.join('\n'));
console.info(
  `Generated ${outputPath} (${enums.length} enums, ${structs.length} structs)`,
);
