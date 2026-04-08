#!/usr/bin/env tsx
/**
 * Generates Swift Codable models from @popeye/contracts Zod schemas.
 * Usage: tsx scripts/generate-swift-models.ts
 * Output: generated/swift/PopeyeModels.swift
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { z } from 'zod';

import {
  ApprovalRecordSchema,
  DaemonStateRecordSchema,
  DaemonStatusResponseSchema,
  GithubAccountRecordSchema,
  GithubCommentCreateInputSchema,
  GithubCommentRecordSchema,
  GithubDigestRecordSchema,
  GithubIssueRecordSchema,
  GithubNotificationMarkReadInputSchema,
  GithubNotificationRecordSchema,
  GithubPullRequestRecordSchema,
  GithubRepoRecordSchema,
  GithubSearchQuerySchema,
  GithubSearchResultSchema,
  GithubSyncResultSchema,
  InterventionCodeSchema,
  InterventionRecordSchema,
  JobLeaseRecordSchema,
  JobRecordSchema,
  JobStateSchema,
  MessageIngressDecisionCodeSchema,
  MessageIngressResponseSchema,
  MessageRecordSchema,
  MutationReceiptRecordSchema,
  RecallDetailSchema,
  RecallSearchResponseSchema,
  RecallSourceKindSchema,
  ReceiptRecordSchema,
  RunEventRecordSchema,
  RunRecordSchema,
  RunStateSchema,
  SchedulerStatusResponseSchema,
  SecurityAuditFindingSchema,
  SecurityPolicyResponseSchema,
  SseEventEnvelopeSchema,
  TaskCreateInputSchema,
  TaskRecordSchema,
  TaskSideEffectProfileSchema,
  PlaybookDetailSchema,
  PlaybookEffectivenessSchema,
  PlaybookFrontMatterSchema,
  PlaybookProposalEvidenceMetricsSchema,
  PlaybookProposalEvidenceSchema,
  PlaybookProposalKindSchema,
  PlaybookProposalRecordSchema,
  PlaybookProposalSourceSchema,
  PlaybookProposalStatusSchema,
  PlaybookRecommendationSchema,
  PlaybookRecordSchema,
  PlaybookRevisionRecordSchema,
  PlaybookScopeSchema,
  PlaybookSearchResultSchema,
  PlaybookStaleCandidateSchema,
  PlaybookStatusSchema,
  PlaybookUsageRunRecordSchema,
  AppliedPlaybookSchema,
  ResolvedPlaybookSchema,
  UsageMetricsSchema,
  UsageSummarySchema,
  VaultRecordSchema,
  KnowledgeSourceTypeSchema,
  KnowledgeConversionAdapterSchema,
  KnowledgeConverterStatusSchema,
  KnowledgeConverterIdSchema,
  KnowledgeAssetStatusSchema,
  KnowledgeImportOutcomeSchema,
  KnowledgeSourceStatusSchema,
  KnowledgeDocumentKindSchema,
  KnowledgeDocumentStatusSchema,
  KnowledgeRevisionStatusSchema,
  KnowledgeLinkKindSchema,
  KnowledgeLinkStatusSchema,
  KnowledgeCompileJobStatusSchema,
  KnowledgeSourceRecordSchema,
  KnowledgeConverterAvailabilitySchema,
  KnowledgeDocumentRecordSchema,
  KnowledgeDocumentDetailSchema,
  KnowledgeSourceSnapshotRecordSchema,
  KnowledgeBetaReportRowSchema,
  KnowledgeBetaGateCheckSchema,
  KnowledgeBetaGateStatusSchema,
  KnowledgeBetaGateSchema,
  KnowledgeBetaRunRecordSchema,
  KnowledgeBetaRunDetailSchema,
  KnowledgeBetaRunCreateInputSchema,
  KnowledgeBetaRunListQuerySchema,
  KnowledgeDocumentRevisionRecordSchema,
  KnowledgeRevisionRejectResultSchema,
  KnowledgeLinkRecordSchema,
  KnowledgeCompileJobRecordSchema,
  KnowledgeAuditReportSchema,
  KnowledgeImportInputSchema,
  KnowledgeImportResultSchema,
  KnowledgeDocumentRevisionProposalInputSchema,
  KnowledgeDocumentRevisionApplyInputSchema,
  KnowledgeRevisionApplyResultSchema,
  KnowledgeLinkCreateInputSchema,
  KnowledgeDocumentQuerySchema,
  KnowledgeNeighborhoodSchema,
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
  ['RecallSourceKind', RecallSourceKindSchema],
  ['PlaybookScope', PlaybookScopeSchema],
  ['PlaybookStatus', PlaybookStatusSchema],
  ['PlaybookProposalKind', PlaybookProposalKindSchema],
  ['PlaybookProposalStatus', PlaybookProposalStatusSchema],
  ['PlaybookProposalSource', PlaybookProposalSourceSchema],
  ['KnowledgeSourceType', KnowledgeSourceTypeSchema],
  ['KnowledgeConversionAdapter', KnowledgeConversionAdapterSchema],
  ['KnowledgeConverterStatus', KnowledgeConverterStatusSchema],
  ['KnowledgeConverterId', KnowledgeConverterIdSchema],
  ['KnowledgeAssetStatus', KnowledgeAssetStatusSchema],
  ['KnowledgeImportOutcome', KnowledgeImportOutcomeSchema],
  ['KnowledgeSourceStatus', KnowledgeSourceStatusSchema],
  ['KnowledgeDocumentKind', KnowledgeDocumentKindSchema],
  ['KnowledgeDocumentStatus', KnowledgeDocumentStatusSchema],
  ['KnowledgeRevisionStatus', KnowledgeRevisionStatusSchema],
  ['KnowledgeLinkKind', KnowledgeLinkKindSchema],
  ['KnowledgeLinkStatus', KnowledgeLinkStatusSchema],
  ['KnowledgeCompileJobStatus', KnowledgeCompileJobStatusSchema],
  ['KnowledgeBetaGateStatus', KnowledgeBetaGateStatusSchema],
];

// Struct schemas
const structs: Array<[string, z.ZodObject<z.ZodRawShape>]> = [
  ['TaskRecord', TaskRecordSchema as z.ZodObject<z.ZodRawShape>],
  ['JobRecord', JobRecordSchema as z.ZodObject<z.ZodRawShape>],
  ['RunRecord', RunRecordSchema as z.ZodObject<z.ZodRawShape>],
  ['RunEventRecord', RunEventRecordSchema as z.ZodObject<z.ZodRawShape>],
  ['ReceiptRecord', ReceiptRecordSchema as z.ZodObject<z.ZodRawShape>],
  ['RecallSearchResponse', RecallSearchResponseSchema as z.ZodObject<z.ZodRawShape>],
  ['RecallDetail', RecallDetailSchema as z.ZodObject<z.ZodRawShape>],
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
  [
    'ApprovalRecord',
    ApprovalRecordSchema as z.ZodObject<z.ZodRawShape>,
  ],
  [
    'SecurityPolicyResponse',
    SecurityPolicyResponseSchema as z.ZodObject<z.ZodRawShape>,
  ],
  [
    'VaultRecord',
    VaultRecordSchema as z.ZodObject<z.ZodRawShape>,
  ],
  [
    'GithubAccountRecord',
    GithubAccountRecordSchema as z.ZodObject<z.ZodRawShape>,
  ],
  [
    'GithubRepoRecord',
    GithubRepoRecordSchema as z.ZodObject<z.ZodRawShape>,
  ],
  [
    'GithubPullRequestRecord',
    GithubPullRequestRecordSchema as z.ZodObject<z.ZodRawShape>,
  ],
  [
    'GithubIssueRecord',
    GithubIssueRecordSchema as z.ZodObject<z.ZodRawShape>,
  ],
  [
    'GithubNotificationRecord',
    GithubNotificationRecordSchema as z.ZodObject<z.ZodRawShape>,
  ],
  [
    'GithubDigestRecord',
    GithubDigestRecordSchema as z.ZodObject<z.ZodRawShape>,
  ],
  [
    'GithubSearchQuery',
    GithubSearchQuerySchema as z.ZodObject<z.ZodRawShape>,
  ],
  [
    'GithubSearchResult',
    GithubSearchResultSchema as z.ZodObject<z.ZodRawShape>,
  ],
  [
    'GithubSyncResult',
    GithubSyncResultSchema as z.ZodObject<z.ZodRawShape>,
  ],
  [
    'GithubCommentRecord',
    GithubCommentRecordSchema as z.ZodObject<z.ZodRawShape>,
  ],
  [
    'GithubCommentCreateInput',
    GithubCommentCreateInputSchema as z.ZodObject<z.ZodRawShape>,
  ],
  [
    'GithubNotificationMarkReadInput',
    GithubNotificationMarkReadInputSchema as z.ZodObject<z.ZodRawShape>,
  ],
  [
    'PlaybookEffectiveness',
    PlaybookEffectivenessSchema as z.ZodObject<z.ZodRawShape>,
  ],
  [
    'PlaybookProposalEvidenceMetrics',
    PlaybookProposalEvidenceMetricsSchema as z.ZodObject<z.ZodRawShape>,
  ],
  [
    'PlaybookProposalEvidence',
    PlaybookProposalEvidenceSchema as z.ZodObject<z.ZodRawShape>,
  ],
  [
    'PlaybookFrontMatter',
    PlaybookFrontMatterSchema as z.ZodObject<z.ZodRawShape>,
  ],
  [
    'ResolvedPlaybook',
    ResolvedPlaybookSchema as z.ZodObject<z.ZodRawShape>,
  ],
  [
    'AppliedPlaybook',
    AppliedPlaybookSchema as z.ZodObject<z.ZodRawShape>,
  ],
  [
    'PlaybookRecord',
    PlaybookRecordSchema as z.ZodObject<z.ZodRawShape>,
  ],
  [
    'PlaybookSearchResult',
    PlaybookSearchResultSchema as z.ZodObject<z.ZodRawShape>,
  ],
  [
    'PlaybookRecommendation',
    PlaybookRecommendationSchema as z.ZodObject<z.ZodRawShape>,
  ],
  [
    'PlaybookRevisionRecord',
    PlaybookRevisionRecordSchema as z.ZodObject<z.ZodRawShape>,
  ],
  [
    'PlaybookDetail',
    PlaybookDetailSchema as z.ZodObject<z.ZodRawShape>,
  ],
  [
    'PlaybookUsageRunRecord',
    PlaybookUsageRunRecordSchema as z.ZodObject<z.ZodRawShape>,
  ],
  [
    'PlaybookStaleCandidate',
    PlaybookStaleCandidateSchema as z.ZodObject<z.ZodRawShape>,
  ],
  [
    'PlaybookProposalRecord',
    PlaybookProposalRecordSchema as z.ZodObject<z.ZodRawShape>,
  ],
  [
    'KnowledgeConverterAvailability',
    KnowledgeConverterAvailabilitySchema as z.ZodObject<z.ZodRawShape>,
  ],
  [
    'KnowledgeSourceRecord',
    KnowledgeSourceRecordSchema as z.ZodObject<z.ZodRawShape>,
  ],
  [
    'KnowledgeDocumentRecord',
    KnowledgeDocumentRecordSchema as z.ZodObject<z.ZodRawShape>,
  ],
  [
    'KnowledgeDocumentDetail',
    KnowledgeDocumentDetailSchema as z.ZodObject<z.ZodRawShape>,
  ],
  [
    'KnowledgeSourceSnapshotRecord',
    KnowledgeSourceSnapshotRecordSchema as z.ZodObject<z.ZodRawShape>,
  ],
  [
    'KnowledgeBetaReportRow',
    KnowledgeBetaReportRowSchema as z.ZodObject<z.ZodRawShape>,
  ],
  [
    'KnowledgeBetaGateCheck',
    KnowledgeBetaGateCheckSchema as z.ZodObject<z.ZodRawShape>,
  ],
  [
    'KnowledgeBetaGate',
    KnowledgeBetaGateSchema as z.ZodObject<z.ZodRawShape>,
  ],
  [
    'KnowledgeBetaRunRecord',
    KnowledgeBetaRunRecordSchema as z.ZodObject<z.ZodRawShape>,
  ],
  [
    'KnowledgeBetaRunDetail',
    KnowledgeBetaRunDetailSchema as z.ZodObject<z.ZodRawShape>,
  ],
  [
    'KnowledgeBetaRunCreateInput',
    KnowledgeBetaRunCreateInputSchema as z.ZodObject<z.ZodRawShape>,
  ],
  [
    'KnowledgeBetaRunListQuery',
    KnowledgeBetaRunListQuerySchema as z.ZodObject<z.ZodRawShape>,
  ],
  [
    'KnowledgeDocumentRevisionRecord',
    KnowledgeDocumentRevisionRecordSchema as z.ZodObject<z.ZodRawShape>,
  ],
  [
    'KnowledgeRevisionRejectResult',
    KnowledgeRevisionRejectResultSchema as z.ZodObject<z.ZodRawShape>,
  ],
  [
    'KnowledgeLinkRecord',
    KnowledgeLinkRecordSchema as z.ZodObject<z.ZodRawShape>,
  ],
  [
    'KnowledgeCompileJobRecord',
    KnowledgeCompileJobRecordSchema as z.ZodObject<z.ZodRawShape>,
  ],
  [
    'KnowledgeAuditReport',
    KnowledgeAuditReportSchema as z.ZodObject<z.ZodRawShape>,
  ],
  [
    'KnowledgeNeighborhood',
    KnowledgeNeighborhoodSchema as z.ZodObject<z.ZodRawShape>,
  ],
  [
    'KnowledgeImportInput',
    KnowledgeImportInputSchema as z.ZodObject<z.ZodRawShape>,
  ],
  [
    'KnowledgeImportResult',
    KnowledgeImportResultSchema as z.ZodObject<z.ZodRawShape>,
  ],
  [
    'KnowledgeDocumentRevisionProposalInput',
    KnowledgeDocumentRevisionProposalInputSchema as z.ZodObject<z.ZodRawShape>,
  ],
  [
    'KnowledgeDocumentRevisionApplyInput',
    KnowledgeDocumentRevisionApplyInputSchema as z.ZodObject<z.ZodRawShape>,
  ],
  [
    'KnowledgeRevisionApplyResult',
    KnowledgeRevisionApplyResultSchema as z.ZodObject<z.ZodRawShape>,
  ],
  [
    'KnowledgeLinkCreateInput',
    KnowledgeLinkCreateInputSchema as z.ZodObject<z.ZodRawShape>,
  ],
  [
    'KnowledgeDocumentQuery',
    KnowledgeDocumentQuerySchema as z.ZodObject<z.ZodRawShape>,
  ],
  [
    'MutationReceiptRecord',
    MutationReceiptRecordSchema as z.ZodObject<z.ZodRawShape>,
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
const rendered = output.join('\n');
const checkOnly = process.argv.includes('--check');
const existing = existsSync(outputPath) ? readFileSync(outputPath, 'utf8') : null;

if (checkOnly) {
  if (existing !== rendered) {
    console.error(`Generated Swift models are out of date: ${outputPath}`);
    process.exit(1);
  }
  console.info(`Verified ${outputPath}`);
} else {
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, rendered);
  console.info(
    `Generated ${outputPath} (${enums.length} enums, ${structs.length} structs)`,
  );
}
