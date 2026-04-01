import { z } from 'zod';
import { EngineKindSchema } from './engine.js';
import { ApprovalPolicyConfigSchema } from './approval.js';
import { VaultConfigSchema } from './vault.js';
import { FileRootPermissionSchema } from './file-roots.js';

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
  tokenExpiryDays: z.number().int().positive().default(90),
});

export const TelegramConfigSchema = z.object({
  enabled: z.boolean().default(false),
  allowedUserId: z.string().min(1).optional(),
  secretRefId: z.string().min(1).optional(),
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

export const EmbeddingConfigSchema = z.object({
  provider: z.enum(['disabled', 'openai']).default('disabled'),
  model: z.string().default('text-embedding-3-small'),
  dimensions: z.number().int().positive().default(1536),
  allowedClassifications: z.array(DataClassificationSchema).default(['embeddable']),
});

export const ModelRoutingConfigSchema = z.object({
  enabled: z.boolean().default(false),
  simpleModel: z.string().optional(),
  standardModel: z.string().optional(),
  complexModel: z.string().optional(),
});
export type ModelRoutingConfig = z.infer<typeof ModelRoutingConfigSchema>;

export const EngineConfigSchema = z.object({
  kind: EngineKindSchema.default('fake'),
  piPath: z.string().optional(),
  piVersion: z.string().optional(),
  command: z.string().default('node'),
  args: z.array(z.string()).default([]),
  timeoutMs: z.number().int().positive().default(300_000),
  runtimeToolTimeoutMs: z.number().int().positive().default(30_000),
  allowRuntimeToolBridgeFallback: z.boolean().default(true),
  modelRouting: ModelRoutingConfigSchema.default({ enabled: false }),
  defaultModel: z.string().min(1).optional(),
  fallbackModels: z.array(z.string().min(1)).default([]),
  autoFailoverEnabled: z.boolean().default(false),
  maxIterationsPerRun: z.number().int().positive().default(200),
  budgetWarningThreshold: z.number().min(0).max(1).default(0.8),
  defaultCacheRetention: z.enum(['none', 'short', 'long']).default('short'),
  maxDelegationDepth: z.number().int().positive().default(3),
});

export const OAuthClientConfigSchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
});
export type OAuthClientConfig = z.infer<typeof OAuthClientConfigSchema>;

export const ProviderAuthConfigSchema = z.object({
  google: OAuthClientConfigSchema.partial().default({}),
  github: OAuthClientConfigSchema.partial().default({}),
});
export type ProviderAuthConfig = z.infer<typeof ProviderAuthConfigSchema>;

const DEFAULT_ENGINE_CONFIG = {
  kind: 'fake' as const,
  command: 'node',
  args: [] as string[],
  timeoutMs: 300_000,
  runtimeToolTimeoutMs: 30_000,
  allowRuntimeToolBridgeFallback: true,
  modelRouting: { enabled: false },
  fallbackModels: [] as string[],
  autoFailoverEnabled: false,
  maxIterationsPerRun: 200,
  budgetWarningThreshold: 0.8,
  defaultCacheRetention: 'short' as const,
  maxDelegationDepth: 3,
};

export const ProjectConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  path: z.string().nullable().default(null),
  workspaceId: z.string().min(1).optional(),
});
export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;

export const FileRootConfigSchema = z.object({
  label: z.string().min(1),
  rootPath: z.string().min(1),
  permission: FileRootPermissionSchema.default('index'),
  filePatterns: z.array(z.string()).default(['**/*.md', '**/*.txt']),
  excludePatterns: z.array(z.string()).default([]),
  maxFileSizeBytes: z.number().int().positive().default(1_048_576),
});
export type FileRootConfig = z.infer<typeof FileRootConfigSchema>;

export const WorkspaceConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  rootPath: z.string().nullable().default(null),
  projects: z.array(ProjectConfigSchema).default([]),
  heartbeatEnabled: z.boolean().default(true),
  heartbeatIntervalSeconds: z.number().int().positive().default(3600),
  fileRoots: z.array(FileRootConfigSchema).default([]),
});
export type WorkspaceConfig = z.infer<typeof WorkspaceConfigSchema>;

const DEFAULT_WORKSPACES = [
  {
    id: 'default',
    name: 'Default workspace',
    rootPath: null,
    projects: [],
    heartbeatEnabled: true,
    heartbeatIntervalSeconds: 3600,
    fileRoots: [],
  },
];

export const BudgetAllocationConfigSchema = z.object({
  enabled: z.boolean().default(false),
  minPerType: z.number().int().nonnegative().default(1),
  maxPerType: z.number().int().positive().default(10),
});
export type BudgetAllocationConfig = z.infer<typeof BudgetAllocationConfigSchema>;

const DEFAULT_BUDGET_ALLOCATION_CONFIG = {
  enabled: false,
  minPerType: 1,
  maxPerType: 10,
};

export const MemoryConfigSchema = z.object({
  confidenceHalfLifeDays: z.number().positive().default(30),
  archiveThreshold: z.number().min(0).max(1).default(0.1),
  consolidationEnabled: z.boolean().default(true),
  compactionFlushConfidence: z.number().min(0).max(1).default(0.7),
  dailySummaryHour: z.number().int().min(0).max(23).default(2),
  docIndexEnabled: z.boolean().default(true),
  docIndexIntervalHours: z.number().int().positive().default(6),
  budgetAllocation: BudgetAllocationConfigSchema.default(DEFAULT_BUDGET_ALLOCATION_CONFIG),
  qualitySweepEnabled: z.boolean().default(false),
  compactionFanout: z.number().int().positive().default(8),
  compactionFreshTailCount: z.number().int().nonnegative().default(4),
  compactionMaxLeafTokens: z.number().int().positive().default(2000),
  compactionMaxCondensedTokens: z.number().int().positive().default(4000),
  compactionMaxRetries: z.number().int().nonnegative().default(1),
  expandTokenCap: z.number().int().positive().default(8000),
});
export type MemoryConfig = z.infer<typeof MemoryConfigSchema>;

const DEFAULT_MEMORY_CONFIG = {
  confidenceHalfLifeDays: 30,
  archiveThreshold: 0.1,
  consolidationEnabled: true,
  compactionFlushConfidence: 0.7,
  dailySummaryHour: 2,
  docIndexEnabled: true,
  docIndexIntervalHours: 6,
  budgetAllocation: DEFAULT_BUDGET_ALLOCATION_CONFIG,
  qualitySweepEnabled: false,
  compactionFanout: 8,
  compactionFreshTailCount: 4,
  compactionMaxLeafTokens: 2000,
  compactionMaxCondensedTokens: 4000,
  compactionMaxRetries: 1,
  expandTokenCap: 8000,
};

export const LogLevelSchema = z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']);
export type LogLevel = z.infer<typeof LogLevelSchema>;

export const LoggingConfigSchema = z.object({
  level: LogLevelSchema.default('info'),
});
export type LoggingConfig = z.infer<typeof LoggingConfigSchema>;

const DEFAULT_LOGGING_CONFIG = {
  level: 'info' as const,
};

const DEFAULT_APPROVAL_POLICY_CONFIG = {
  rules: [],
  defaultRiskClass: 'ask' as const,
  pendingExpiryMinutes: 60,
};

const DEFAULT_VAULT_CONFIG = {
  restrictedVaultDir: 'vaults',
  capabilityStoreDir: 'capabilities',
  backupEncryptedVaults: true,
};

const DEFAULT_PROVIDER_AUTH_CONFIG = {
  google: {},
  github: {},
};

export const AppConfigSchema = z.object({
  runtimeDataDir: z.string().min(1),
  authFile: z.string().min(1),
  security: SecurityConfigSchema,
  telegram: TelegramConfigSchema,
  embeddings: EmbeddingConfigSchema,
  engine: EngineConfigSchema.default(DEFAULT_ENGINE_CONFIG),
  logging: LoggingConfigSchema.default(DEFAULT_LOGGING_CONFIG),
  memory: MemoryConfigSchema.default(DEFAULT_MEMORY_CONFIG),
  workspaces: z.array(WorkspaceConfigSchema).default(DEFAULT_WORKSPACES),
  approvalPolicy: ApprovalPolicyConfigSchema.default(DEFAULT_APPROVAL_POLICY_CONFIG),
  providerAuth: ProviderAuthConfigSchema.default(DEFAULT_PROVIDER_AUTH_CONFIG),
  vaults: VaultConfigSchema.default(DEFAULT_VAULT_CONFIG),
  plugins: z.object({
    enabled: z.boolean().default(false),
    directory: z.string().optional(),
  }).default({ enabled: false }),
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
  capabilityStoresDir: z.string(),
  vaultsDir: z.string(),
  pluginsDir: z.string(),
});
export type RuntimePaths = z.infer<typeof RuntimePathsSchema>;
