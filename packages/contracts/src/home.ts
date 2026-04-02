import { z } from 'zod';

import { AutomationRecordSchema } from './automations.js';
import { CalendarDigestRecordSchema, CalendarEventRecordSchema } from './calendar.js';
import { MutationReceiptRecordSchema } from './control-plane.js';
import { DaemonStatusResponseSchema, SchedulerStatusResponseSchema } from './api.js';
import { EngineCapabilitiesSchema } from './engine.js';
import { MemoryRecordSchema } from './memory.js';
import { TodoDigestRecordSchema, TodoItemRecordSchema } from './todos.js';

export const HomeSetupSummarySchema = z.object({
  supportedProviderCount: z.number().int().nonnegative().default(0),
  healthyProviderCount: z.number().int().nonnegative().default(0),
  attentionProviderCount: z.number().int().nonnegative().default(0),
  telegramStatusLabel: z.string().default('Not configured'),
  telegramEffectiveWorkspaceId: z.string().nullable().default(null),
});
export type HomeSetupSummary = z.infer<typeof HomeSetupSummarySchema>;

export const HomeSummarySchema = z.object({
  workspaceId: z.string(),
  workspaceName: z.string().nullable().default(null),
  status: DaemonStatusResponseSchema,
  scheduler: SchedulerStatusResponseSchema,
  capabilities: EngineCapabilitiesSchema,
  setup: HomeSetupSummarySchema,
  automationAttention: z.array(AutomationRecordSchema).default([]),
  automationDueSoon: z.array(AutomationRecordSchema).default([]),
  upcomingEvents: z.array(CalendarEventRecordSchema).default([]),
  calendarDigest: CalendarDigestRecordSchema.nullable().default(null),
  upcomingTodos: z.array(TodoItemRecordSchema).default([]),
  todoDigest: TodoDigestRecordSchema.nullable().default(null),
  recentMemories: z.array(MemoryRecordSchema).default([]),
  controlChanges: z.array(MutationReceiptRecordSchema).default([]),
  pendingApprovalCount: z.number().int().nonnegative().default(0),
});
export type HomeSummary = z.infer<typeof HomeSummarySchema>;
