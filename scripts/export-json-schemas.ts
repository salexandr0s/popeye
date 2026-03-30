#!/usr/bin/env tsx
/**
 * Exports public Popeye contract schemas as JSON Schema.
 * Usage: tsx scripts/export-json-schemas.ts [--check]
 * Output: generated/json-schema/popeye-contracts.json
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { zodToJsonSchema } from 'zod-to-json-schema';

import {
  ApprovalRecordSchema,
  ApprovalResolveInputSchema,
  AuthExchangeRequestSchema,
  AuthExchangeResponseSchema,
  CalendarAccountResponseSchema,
  CalendarAvailabilitySlotSchema,
  CalendarDigestResponseSchema,
  CalendarEventResponseSchema,
  ConnectionRecordSchema,
  ContextReleasePreviewRequestSchema,
  ContextReleasePreviewResponseSchema,
  CsrfTokenResponseSchema,
  DaemonStateRecordSchema,
  DaemonStatusResponseSchema,
  EmailAccountResponseSchema,
  EmailDigestResponseSchema,
  EmailMessageResponseSchema,
  EmailThreadResponseSchema,
  EngineCapabilitiesResponseSchema,
  ExecutionEnvelopeResponseSchema,
  FileDocumentResponseSchema,
  FileRootResponseSchema,
  FileSearchApiResponseSchema,
  GithubAccountResponseSchema,
  GithubDigestResponseSchema,
  GithubIssueResponseSchema,
  GithubNotificationRecordSchema,
  GithubPullRequestResponseSchema,
  GithubRepoRecordSchema,
  HealthResponseSchema,
  MemoryAuditResponseSchema,
  MemoryRecordSchema,
  MemorySearchResponseSchema,
  RecallDetailResponseSchema,
  RecallSearchResponseApiSchema,
  ReceiptRecordSchema,
  RunEventRecordSchema,
  RunRecordSchema,
  RunReplySchema,
  SchedulerStatusResponseSchema,
  SecurityAuditResponseSchema,
  SecurityPolicyResponseSchema,
  SessionRootRecordSchema,
  TaskCreateInputSchema,
  TaskCreateResponseSchema,
  TaskRecordSchema,
  TodoAccountResponseSchema,
  TodoDigestResponseSchema,
  TodoItemResponseSchema,
  TodoProjectRecordSchema,
  UsageSummarySchema,
  VaultCreateRequestSchema,
  VaultOpenRequestSchema,
  VaultRecordSchema,
  WorkspaceListItemSchema,
} from '@popeye/contracts';

const outputPath = 'generated/json-schema/popeye-contracts.json';
const checkOnly = process.argv.includes('--check');

const publicSchemas = {
  AuthExchangeRequest: AuthExchangeRequestSchema,
  AuthExchangeResponse: AuthExchangeResponseSchema,
  CsrfTokenResponse: CsrfTokenResponseSchema,
  HealthResponse: HealthResponseSchema,
  DaemonStatusResponse: DaemonStatusResponseSchema,
  SchedulerStatusResponse: SchedulerStatusResponseSchema,
  DaemonStateRecord: DaemonStateRecordSchema,
  EngineCapabilitiesResponse: EngineCapabilitiesResponseSchema,
  ExecutionEnvelopeResponse: ExecutionEnvelopeResponseSchema,
  TaskCreateInput: TaskCreateInputSchema,
  TaskCreateResponse: TaskCreateResponseSchema,
  TaskRecord: TaskRecordSchema,
  RunRecord: RunRecordSchema,
  RunEventRecord: RunEventRecordSchema,
  RunReply: RunReplySchema,
  ReceiptRecord: ReceiptRecordSchema,
  SessionRootRecord: SessionRootRecordSchema,
  UsageSummary: UsageSummarySchema,
  SecurityAuditResponse: SecurityAuditResponseSchema,
  SecurityPolicyResponse: SecurityPolicyResponseSchema,
  ApprovalRecord: ApprovalRecordSchema,
  ApprovalResolveInput: ApprovalResolveInputSchema,
  ConnectionRecord: ConnectionRecordSchema,
  ContextReleasePreviewRequest: ContextReleasePreviewRequestSchema,
  ContextReleasePreviewResponse: ContextReleasePreviewResponseSchema,
  VaultRecord: VaultRecordSchema,
  VaultCreateRequest: VaultCreateRequestSchema,
  VaultOpenRequest: VaultOpenRequestSchema,
  WorkspaceListItem: WorkspaceListItemSchema,
  MemoryRecord: MemoryRecordSchema,
  MemorySearchResponse: MemorySearchResponseSchema,
  MemoryAuditResponse: MemoryAuditResponseSchema,
  RecallSearchResponse: RecallSearchResponseApiSchema,
  RecallDetailResponse: RecallDetailResponseSchema,
  FileRootResponse: FileRootResponseSchema,
  FileDocumentResponse: FileDocumentResponseSchema,
  FileSearchApiResponse: FileSearchApiResponseSchema,
  EmailAccountResponse: EmailAccountResponseSchema,
  EmailThreadResponse: EmailThreadResponseSchema,
  EmailMessageResponse: EmailMessageResponseSchema,
  EmailDigestResponse: EmailDigestResponseSchema,
  GithubAccountResponse: GithubAccountResponseSchema,
  GithubRepoResponse: GithubRepoRecordSchema,
  GithubPullRequestResponse: GithubPullRequestResponseSchema,
  GithubIssueResponse: GithubIssueResponseSchema,
  GithubNotificationResponse: GithubNotificationRecordSchema,
  GithubDigestResponse: GithubDigestResponseSchema,
  CalendarAccountResponse: CalendarAccountResponseSchema,
  CalendarEventResponse: CalendarEventResponseSchema,
  CalendarDigestResponse: CalendarDigestResponseSchema,
  CalendarAvailabilitySlot: CalendarAvailabilitySlotSchema,
  TodoAccountResponse: TodoAccountResponseSchema,
  TodoItemResponse: TodoItemResponseSchema,
  TodoProjectResponse: TodoProjectRecordSchema,
  TodoDigestResponse: TodoDigestResponseSchema,
} as const;

const rendered = JSON.stringify({
  $schema: 'https://json-schema.org/draft-07/schema#',
  title: 'PopeyeContracts',
  schemas: Object.fromEntries(
    Object.entries(publicSchemas).map(([name, schema]) => [
      name,
      zodToJsonSchema(schema, name),
    ]),
  ),
}, null, 2) + '\n';

const existing = existsSync(outputPath) ? readFileSync(outputPath, 'utf8') : null;

if (checkOnly) {
  if (existing !== rendered) {
    console.error(`Generated JSON Schemas are out of date: ${outputPath}`);
    process.exit(1);
  }
  console.info(`Verified ${outputPath}`);
} else {
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, rendered);
  console.info(`Generated ${outputPath} (${Object.keys(publicSchemas).length} schemas)`);
}
