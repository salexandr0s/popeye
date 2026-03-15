import { z } from 'zod';
import { EngineKindSchema } from './engine.js';

export const DataClassificationSchema = z.enum(['secret', 'sensitive', 'internal', 'embeddable']);
export type DataClassification = z.infer<typeof DataClassificationSchema>;

export const EmbeddingEligibilitySchema = z.enum(['allow', 'deny']);
export type EmbeddingEligibility = z.infer<typeof EmbeddingEligibilitySchema>;

export const SecurityConfigSchema = z.object({
  bindHost: z.literal('127.0.0.1'),
  bindPort: z.number().int().min(1).max(65535).default(3210),
  redactionPatterns: z.array(z.string()).default([]),
  promptScanQuarantinePatterns: z.array(z.string()).default([]),
  promptScanSanitizePatterns: z.array(z.object({ pattern: z.string(), replacement: z.string() })).default([]),
  useSecureCookies: z.boolean().default(false),
  tokenRotationDays: z.number().int().positive().default(30),
});
export type SecurityConfig = z.infer<typeof SecurityConfigSchema>;

export const TelegramConfigSchema = z.object({
  enabled: z.boolean().default(false),
  allowedUserId: z.string().min(1).optional(),
  maxMessagesPerMinute: z.number().int().positive().default(10),
  globalMaxMessagesPerMinute: z.number().int().positive().default(30),
  rateLimitWindowSeconds: z.number().int().positive().default(60),
  maxConcurrentPreparations: z.number().int().positive().min(1).max(16).default(4),
}).superRefine((data, ctx) => {
  if (data.enabled && !data.allowedUserId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'allowedUserId is required when telegram is enabled',
      path: ['allowedUserId'],
    });
  }
});
export type TelegramConfig = z.infer<typeof TelegramConfigSchema>;

export const EmbeddingConfigSchema = z.object({
  provider: z.enum(['disabled', 'openai']).default('disabled'),
  model: z.string().default('text-embedding-3-small'),
  dimensions: z.number().int().positive().default(1536),
  allowedClassifications: z.array(DataClassificationSchema).default(['embeddable']),
});
export type EmbeddingConfig = z.infer<typeof EmbeddingConfigSchema>;

export const EngineConfigSchema = z.object({
  kind: EngineKindSchema.default('fake'),
  piPath: z.string().optional(),
  piVersion: z.string().optional(),
  command: z.string().default('node'),
  args: z.array(z.string()).default([]),
  timeoutMs: z.number().int().positive().default(300_000),
  runtimeToolTimeoutMs: z.number().int().positive().default(30_000),
});
export type EngineConfig = z.infer<typeof EngineConfigSchema>;

export const ProjectConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  path: z.string().nullable().default(null),
  workspaceId: z.string().min(1).optional(),
});
export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;

export const WorkspaceConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  rootPath: z.string().nullable().default(null),
  projects: z.array(ProjectConfigSchema).default([]),
  heartbeatEnabled: z.boolean().default(true),
  heartbeatIntervalSeconds: z.number().int().positive().default(3600),
});
export type WorkspaceConfig = z.infer<typeof WorkspaceConfigSchema>;

export const BudgetAllocationConfigSchema = z.object({
  enabled: z.boolean().default(false),
  minPerType: z.number().int().nonnegative().default(1),
  maxPerType: z.number().int().positive().default(10),
});
export type BudgetAllocationConfig = z.infer<typeof BudgetAllocationConfigSchema>;

export const MemoryConfigSchema = z.object({
  confidenceHalfLifeDays: z.number().positive().default(30),
  archiveThreshold: z.number().min(0).max(1).default(0.1),
  consolidationEnabled: z.boolean().default(true),
  compactionFlushConfidence: z.number().min(0).max(1).default(0.7),
  dailySummaryHour: z.number().int().min(0).max(23).default(2),
  docIndexEnabled: z.boolean().default(true),
  docIndexIntervalHours: z.number().int().positive().default(6),
  budgetAllocation: BudgetAllocationConfigSchema.default({}),
  qualitySweepEnabled: z.boolean().default(false),
});
export type MemoryConfig = z.infer<typeof MemoryConfigSchema>;

export const AppConfigSchema = z.object({
  runtimeDataDir: z.string().min(1),
  authFile: z.string().min(1),
  security: SecurityConfigSchema,
  telegram: TelegramConfigSchema,
  embeddings: EmbeddingConfigSchema,
  engine: EngineConfigSchema.default({ kind: 'fake', command: 'node', args: [] }),
  memory: MemoryConfigSchema.default({}),
  workspaces: z.array(WorkspaceConfigSchema).default([
    {
      id: 'default',
      name: 'Default workspace',
      heartbeatEnabled: true,
      heartbeatIntervalSeconds: 3600,
    },
  ]),
});
export type AppConfig = z.infer<typeof AppConfigSchema>;

export const WorkspaceRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  rootPath: z.string().nullable().default(null),
  createdAt: z.string(),
});
export type WorkspaceRecord = z.infer<typeof WorkspaceRecordSchema>;

export const RuntimePathsSchema = z.object({
  runtimeDataDir: z.string(),
  configDir: z.string(),
  stateDir: z.string(),
  appDbPath: z.string(),
  memoryDbPath: z.string(),
  logsDir: z.string(),
  runLogsDir: z.string(),
  receiptsDir: z.string(),
  receiptsByRunDir: z.string(),
  receiptsByDayDir: z.string(),
  backupsDir: z.string(),
  memoryDailyDir: z.string(),
});
export type RuntimePaths = z.infer<typeof RuntimePathsSchema>;
