import { z } from 'zod';

// --- Todo Account Record ---

export const TodoProviderKindSchema = z.enum(['local', 'todoist']);
export type TodoProviderKind = z.infer<typeof TodoProviderKindSchema>;

export const TodoAccountRecordSchema = z.object({
  id: z.string(),
  connectionId: z.string().nullable().default(null),
  providerKind: TodoProviderKindSchema,
  displayName: z.string(),
  syncCursorSince: z.string().nullable().default(null),
  lastSyncAt: z.string().nullable().default(null),
  todoCount: z.number().int().nonnegative().default(0),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type TodoAccountRecord = z.infer<typeof TodoAccountRecordSchema>;

// --- Todo Account Registration Input ---

export const TodoAccountRegistrationInputSchema = z.object({
  connectionId: z.string().optional(),
  providerKind: TodoProviderKindSchema,
  displayName: z.string().min(1),
});
export type TodoAccountRegistrationInput = z.infer<typeof TodoAccountRegistrationInputSchema>;

export const TodoistConnectInputSchema = z.object({
  apiToken: z.string().min(1),
  displayName: z.string().min(1).default('Todoist'),
  label: z.string().min(1).default('Todoist'),
  mode: z.enum(['read_only', 'read_write']).default('read_write'),
  syncIntervalSeconds: z.number().int().positive().default(900),
});
export type TodoistConnectInput = z.infer<typeof TodoistConnectInputSchema>;

export const TodoistConnectResultSchema = z.object({
  connectionId: z.string(),
  account: TodoAccountRecordSchema,
});
export type TodoistConnectResult = z.infer<typeof TodoistConnectResultSchema>;

// --- Todo Item Record ---

export const TodoStatusSchema = z.enum(['pending', 'completed', 'cancelled']);
export type TodoStatus = z.infer<typeof TodoStatusSchema>;

export const TodoItemRecordSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  externalId: z.string().nullable().default(null),
  title: z.string(),
  description: z.string().default(''),
  priority: z.number().int().min(1).max(4).default(4),
  status: TodoStatusSchema.default('pending'),
  dueDate: z.string().nullable().default(null),
  dueTime: z.string().nullable().default(null),
  labels: z.array(z.string()).default([]),
  projectName: z.string().nullable().default(null),
  parentId: z.string().nullable().default(null),
  completedAt: z.string().nullable().default(null),
  createdAtExternal: z.string().nullable().default(null),
  updatedAtExternal: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type TodoItemRecord = z.infer<typeof TodoItemRecordSchema>;

// --- Todo Project Record ---

export const TodoProjectRecordSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  externalId: z.string().nullable().default(null),
  name: z.string(),
  color: z.string().nullable().default(null),
  todoCount: z.number().int().nonnegative().default(0),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type TodoProjectRecord = z.infer<typeof TodoProjectRecordSchema>;

// --- Todo Digest Record ---

export const TodoDigestRecordSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  workspaceId: z.string(),
  date: z.string(),
  pendingCount: z.number().int().nonnegative(),
  overdueCount: z.number().int().nonnegative(),
  completedTodayCount: z.number().int().nonnegative(),
  summaryMarkdown: z.string(),
  generatedAt: z.string(),
});
export type TodoDigestRecord = z.infer<typeof TodoDigestRecordSchema>;

// --- Todo Search ---

export const TodoSearchQuerySchema = z.object({
  query: z.string().min(1),
  accountId: z.string().optional(),
  limit: z.number().int().positive().max(100).default(20),
  status: z.enum(['pending', 'completed', 'all']).optional(),
});
export type TodoSearchQuery = z.infer<typeof TodoSearchQuerySchema>;

export const TodoSearchResultSchema = z.object({
  todoId: z.string(),
  title: z.string(),
  priority: z.number().int(),
  status: z.string(),
  dueDate: z.string().nullable(),
  projectName: z.string().nullable(),
  score: z.number(),
});
export type TodoSearchResult = z.infer<typeof TodoSearchResultSchema>;

// --- Todo Sync Result ---

export const TodoSyncResultSchema = z.object({
  accountId: z.string(),
  todosSynced: z.number().int().nonnegative(),
  todosUpdated: z.number().int().nonnegative(),
  errors: z.array(z.string()),
});
export type TodoSyncResult = z.infer<typeof TodoSyncResultSchema>;

// --- Todo Create/Update Input ---

export const TodoCreateInputSchema = z.object({
  accountId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  priority: z.number().int().min(1).max(4).optional(),
  dueDate: z.string().optional(),
  dueTime: z.string().optional(),
  labels: z.array(z.string()).optional(),
  projectName: z.string().optional(),
});
export type TodoCreateInput = z.infer<typeof TodoCreateInputSchema>;

export const TodoUpdateInputSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  priority: z.number().int().min(1).max(4).optional(),
  status: TodoStatusSchema.optional(),
  dueDate: z.string().nullable().optional(),
  dueTime: z.string().nullable().optional(),
  labels: z.array(z.string()).optional(),
  projectName: z.string().nullable().optional(),
});
export type TodoUpdateInput = z.infer<typeof TodoUpdateInputSchema>;

// --- Todo mutation inputs ---

export const TodoReprioritizeInputSchema = z.object({
  todoId: z.string().min(1),
  priority: z.number().int().min(1).max(4),
});
export type TodoReprioritizeInput = z.infer<typeof TodoReprioritizeInputSchema>;

export const TodoRescheduleInputSchema = z.object({
  todoId: z.string().min(1),
  dueDate: z.string().min(1),
  dueTime: z.string().nullable().optional(),
});
export type TodoRescheduleInput = z.infer<typeof TodoRescheduleInputSchema>;

export const TodoMoveInputSchema = z.object({
  todoId: z.string().min(1),
  projectName: z.string().min(1),
});
export type TodoMoveInput = z.infer<typeof TodoMoveInputSchema>;

export const TodoReconcileResultSchema = z.object({
  accountId: z.string(),
  added: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  removed: z.number().int().nonnegative(),
  errors: z.array(z.string()),
});
export type TodoReconcileResult = z.infer<typeof TodoReconcileResultSchema>;

export const TodoProjectListQuerySchema = z.object({
  accountId: z.string().min(1),
});
export type TodoProjectListQuery = z.infer<typeof TodoProjectListQuerySchema>;
