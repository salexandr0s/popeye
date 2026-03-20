#!/usr/bin/env tsx
/**
 * Generates a TypeScript model bundle from @popeye/contracts.
 * Usage: tsx scripts/generate-typescript-models.ts
 * Output: generated/typescript/PopeyeModels.ts
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const models = [
  'ApprovalRecord',
  'ApprovalRecordSchema',
  'DaemonStateRecord',
  'DaemonStateRecordSchema',
  'DaemonStatusResponse',
  'DaemonStatusResponseSchema',
  'InterventionCode',
  'InterventionCodeSchema',
  'InterventionRecord',
  'InterventionRecordSchema',
  'JobLeaseRecord',
  'JobLeaseRecordSchema',
  'JobRecord',
  'JobRecordSchema',
  'JobState',
  'JobStateSchema',
  'MessageIngressDecisionCode',
  'MessageIngressDecisionCodeSchema',
  'MessageIngressResponse',
  'MessageIngressResponseSchema',
  'MessageRecord',
  'MessageRecordSchema',
  'ReceiptRecord',
  'ReceiptRecordSchema',
  'RunEventRecord',
  'RunEventRecordSchema',
  'RunRecord',
  'RunRecordSchema',
  'RunState',
  'RunStateSchema',
  'SchedulerStatusResponse',
  'SchedulerStatusResponseSchema',
  'SecurityAuditFinding',
  'SecurityAuditFindingSchema',
  'SecurityPolicyResponse',
  'SecurityPolicyResponseSchema',
  'SseEventEnvelope',
  'SseEventEnvelopeSchema',
  'TaskCreateInput',
  'TaskCreateInputSchema',
  'TaskRecord',
  'TaskRecordSchema',
  'TaskSideEffectProfile',
  'TaskSideEffectProfileSchema',
  'UsageMetrics',
  'UsageMetricsSchema',
  'UsageSummary',
  'UsageSummarySchema',
  'VaultRecord',
  'VaultRecordSchema',
] as const;

const output = [
  '// Auto-generated from @popeye/contracts — do not edit',
  `// Generated: ${new Date().toISOString().split('T')[0]}`,
  '',
  "export {",
  ...models.map((name) => `  ${name},`),
  "} from '@popeye/contracts';",
  '',
].join('\n');

const outputPath = 'generated/typescript/PopeyeModels.ts';
const checkOnly = process.argv.includes('--check');
const existing = existsSync(outputPath) ? readFileSync(outputPath, 'utf8') : null;

if (checkOnly) {
  if (existing !== output) {
    console.error(`Generated TypeScript models are out of date: ${outputPath}`);
    process.exit(1);
  }
  console.info(`Verified ${outputPath}`);
} else {
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, output);
  console.info(`Generated ${outputPath} (${models.length} exports)`);
}
