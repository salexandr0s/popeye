import { z } from 'zod';
import { EngineKindSchema } from './engine.js';
import { TaskRecordSchema, JobRecordSchema, RunRecordSchema, ProjectRecordSchema, AgentProfileRecordSchema } from './execution.js';
import { SecurityAuditFindingSchema } from './security.js';
import { WorkspaceRecordSchema } from './config.js';

export const TaskCreateInputSchema = z.object({
  workspaceId: z.string().default('default'),
  projectId: z.string().nullable().default(null),
  title: z.string(),
  prompt: z.string(),
  source: z.enum(['manual', 'heartbeat', 'schedule', 'telegram', 'api']).default('manual'),
  coalesceKey: z.string().nullable().default(null),
  autoEnqueue: z.boolean().default(true),
});
export type TaskCreateInput = z.infer<typeof TaskCreateInputSchema>;

export const SseEventEnvelopeSchema = z.object({
  event: z.string(),
  data: z.string(),
});
export type SseEventEnvelope = z.infer<typeof SseEventEnvelopeSchema>;

export const CsrfTokenResponseSchema = z.object({
  token: z.string(),
});
export type CsrfTokenResponse = z.infer<typeof CsrfTokenResponseSchema>;

export const UsageSummarySchema = z.object({
  runs: z.number().int().nonnegative(),
  tokensIn: z.number().int().nonnegative(),
  tokensOut: z.number().int().nonnegative(),
  estimatedCostUsd: z.number().nonnegative(),
});
export type UsageSummary = z.infer<typeof UsageSummarySchema>;

export const DaemonStatusResponseSchema = z.object({
  ok: z.boolean(),
  runningJobs: z.number().int().nonnegative(),
  queuedJobs: z.number().int().nonnegative(),
  openInterventions: z.number().int().nonnegative(),
  activeLeases: z.number().int().nonnegative(),
  engineKind: EngineKindSchema,
  schedulerRunning: z.boolean(),
  startedAt: z.string(),
  lastShutdownAt: z.string().nullable(),
});
export type DaemonStatusResponse = z.infer<typeof DaemonStatusResponseSchema>;

export const SchedulerStatusResponseSchema = z.object({
  running: z.boolean(),
  activeLeases: z.number().int().nonnegative(),
  activeRuns: z.number().int().nonnegative(),
  nextHeartbeatDueAt: z.string().nullable(),
});
export type SchedulerStatusResponse = z.infer<typeof SchedulerStatusResponseSchema>;

export const DaemonStateRecordSchema = z.object({
  schedulerRunning: z.boolean(),
  activeWorkers: z.number().int().nonnegative(),
  lastSchedulerTickAt: z.string().nullable(),
  lastLeaseSweepAt: z.string().nullable(),
  lastShutdownAt: z.string().nullable(),
});
export type DaemonStateRecord = z.infer<typeof DaemonStateRecordSchema>;

export const HealthResponseSchema = z.object({
  ok: z.boolean(),
  startedAt: z.string(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const TaskCreateResponseSchema = z.object({
  task: TaskRecordSchema,
  job: JobRecordSchema.nullable(),
  run: RunRecordSchema.nullable(),
});
export type TaskCreateResponse = z.infer<typeof TaskCreateResponseSchema>;

export const SecurityAuditResponseSchema = z.object({
  findings: z.array(SecurityAuditFindingSchema),
});
export type SecurityAuditResponse = z.infer<typeof SecurityAuditResponseSchema>;

export const ErrorResponseSchema = z.object({
  error: z.string(),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

export const WorkspaceListItemSchema = WorkspaceRecordSchema;
export type WorkspaceListItem = z.infer<typeof WorkspaceListItemSchema>;

export const ProjectListItemSchema = ProjectRecordSchema;
export type ProjectListItem = z.infer<typeof ProjectListItemSchema>;

export const AgentProfileListItemSchema = AgentProfileRecordSchema;
export type AgentProfileListItem = z.infer<typeof AgentProfileListItemSchema>;

/** Simple FTS search result (used by /v1/memory/search-simple). */
export const MemorySearchResultItemSchema = z.object({
  id: z.string(),
  description: z.string(),
  confidence: z.number(),
  scope: z.string(),
  sourceType: z.string(),
  createdAt: z.string(),
  snippet: z.string(),
});
export type MemorySearchResultItem = z.infer<typeof MemorySearchResultItemSchema>;

export const MemorySearchApiResponseSchema = z.object({
  query: z.string(),
  results: z.array(MemorySearchResultItemSchema),
});
export type MemorySearchApiResponse = z.infer<typeof MemorySearchApiResponseSchema>;

export const PathIdParamSchema = z.object({
  id: z.string().min(1).max(100),
});
export type PathIdParam = z.infer<typeof PathIdParamSchema>;

export const MemoryPromotionProposalRequestSchema = z.object({
  targetPath: z.string().min(1),
});
export type MemoryPromotionProposalRequest = z.infer<typeof MemoryPromotionProposalRequestSchema>;

export const MemoryPromotionResponseSchema = z.object({
  memoryId: z.string(),
  targetPath: z.string(),
  diff: z.string(),
  approved: z.boolean(),
  promoted: z.boolean(),
});
export type MemoryPromotionResponse = z.infer<typeof MemoryPromotionResponseSchema>;

export const MemoryPromotionExecuteRequestSchema = MemoryPromotionResponseSchema.omit({
  memoryId: true,
});
export type MemoryPromotionExecuteRequest = z.infer<typeof MemoryPromotionExecuteRequestSchema>;

export const WorkspaceRegistrationInputSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  rootPath: z.string().nullable().default(null),
});
export type WorkspaceRegistrationInput = z.infer<typeof WorkspaceRegistrationInputSchema>;

export const ProjectRegistrationInputSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  path: z.string().nullable().default(null),
  workspaceId: z.string().min(1),
});
export type ProjectRegistrationInput = z.infer<typeof ProjectRegistrationInputSchema>;

export const InstructionResolutionContextSchema = z.object({
  workspaceId: z.string().min(1),
  projectId: z.string().min(1).optional(),
  identity: z.string().min(1).optional(),
  taskBrief: z.string().optional(),
  triggerOverlay: z.string().optional(),
  runtimeNotes: z.string().optional(),
});
export type InstructionResolutionContext = z.infer<typeof InstructionResolutionContextSchema>;
