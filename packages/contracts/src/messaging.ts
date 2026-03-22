import { z } from 'zod';

export const TelegramChatTypeSchema = z.enum(['private', 'group', 'supergroup', 'channel']);
export type TelegramChatType = z.infer<typeof TelegramChatTypeSchema>;

export const MessageRecordSchema = z.object({
  id: z.string(),
  source: z.enum(['telegram', 'manual', 'api']),
  senderId: z.string(),
  body: z.string(),
  accepted: z.boolean(),
  relatedRunId: z.string().nullable(),
  createdAt: z.string(),
});
export type MessageRecord = z.infer<typeof MessageRecordSchema>;

export const MessageIngressDecisionCodeSchema = z.enum([
  'accepted',
  'duplicate_replayed',
  'telegram_disabled',
  'telegram_private_chat_required',
  'telegram_not_allowlisted',
  'telegram_rate_limited',
  'telegram_prompt_injection',
  'telegram_invalid_message',
  'prompt_injection_quarantined',
]);
export type MessageIngressDecisionCode = z.infer<typeof MessageIngressDecisionCodeSchema>;

export const MessageIngressRecordSchema = z.object({
  id: z.string(),
  source: z.enum(['telegram', 'manual', 'api']),
  senderId: z.string(),
  chatId: z.string().nullable(),
  chatType: TelegramChatTypeSchema.nullable(),
  telegramMessageId: z.number().int().nullable(),
  idempotencyKey: z.string().nullable(),
  workspaceId: z.string(),
  body: z.string(),
  accepted: z.boolean(),
  decisionCode: MessageIngressDecisionCodeSchema,
  decisionReason: z.string(),
  httpStatus: z.number().int(),
  messageId: z.string().nullable(),
  taskId: z.string().nullable(),
  jobId: z.string().nullable(),
  runId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type MessageIngressRecord = z.infer<typeof MessageIngressRecordSchema>;

const TelegramDeliveryStatusSchema = z.enum(['pending', 'sending', 'sent', 'uncertain', 'abandoned']);

export const TelegramDeliveryStateSchema = z.object({
  chatId: z.string(),
  telegramMessageId: z.number().int(),
  status: TelegramDeliveryStatusSchema,
});
export type TelegramDeliveryState = z.infer<typeof TelegramDeliveryStateSchema>;

export const MessageIngressResponseSchema = z.object({
  accepted: z.boolean(),
  duplicate: z.boolean(),
  httpStatus: z.number().int(),
  decisionCode: MessageIngressDecisionCodeSchema,
  decisionReason: z.string(),
  message: MessageRecordSchema.nullable(),
  taskId: z.string().nullable(),
  jobId: z.string().nullable(),
  runId: z.string().nullable(),
  telegramDelivery: TelegramDeliveryStateSchema.nullable().default(null),
});
export type MessageIngressResponse = z.infer<typeof MessageIngressResponseSchema>;

export const TelegramDeliveryRecordSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  chatId: z.string(),
  telegramMessageId: z.number().int(),
  messageIngressId: z.string(),
  taskId: z.string().nullable(),
  jobId: z.string().nullable(),
  runId: z.string().nullable(),
  status: TelegramDeliveryStatusSchema,
  sentAt: z.string().nullable(),
  sentTelegramMessageId: z.number().int().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type TelegramDeliveryRecord = z.infer<typeof TelegramDeliveryRecordSchema>;

const TelegramDeliveryResolutionActionSchema = z.enum(['confirm_sent', 'resend', 'abandon']);

export const TelegramDeliveryResolutionRequestSchema = z.object({
  workspaceId: z.string().min(1),
  action: TelegramDeliveryResolutionActionSchema,
  operatorNote: z.string().max(2000).optional(),
  sentTelegramMessageId: z.number().int().optional(),
});
export type TelegramDeliveryResolutionRequest = z.infer<typeof TelegramDeliveryResolutionRequestSchema>;

export const TelegramDeliveryResolutionRecordSchema = z.object({
  id: z.string(),
  deliveryId: z.string(),
  workspaceId: z.string(),
  action: TelegramDeliveryResolutionActionSchema,
  interventionId: z.string().nullable(),
  operatorNote: z.string().nullable(),
  sentTelegramMessageId: z.number().int().nullable(),
  previousStatus: z.string(),
  newStatus: z.string(),
  createdAt: z.string(),
});
export type TelegramDeliveryResolutionRecord = z.infer<typeof TelegramDeliveryResolutionRecordSchema>;

const TelegramSendAttemptOutcomeSchema = z.enum(['sent', 'retryable_failure', 'permanent_failure', 'ambiguous']);

export const TelegramSendAttemptRecordSchema = z.object({
  id: z.string(),
  deliveryId: z.string(),
  workspaceId: z.string(),
  attemptNumber: z.number().int(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  runId: z.string().nullable(),
  contentHash: z.string(),
  outcome: TelegramSendAttemptOutcomeSchema,
  sentTelegramMessageId: z.number().int().nullable(),
  errorSummary: z.string().nullable(),
  source: z.string(),
  createdAt: z.string(),
});
export type TelegramSendAttemptRecord = z.infer<typeof TelegramSendAttemptRecordSchema>;

export const IngestMessageInputSchema = z.object({
  source: z.enum(['telegram', 'manual', 'api']),
  senderId: z.string(),
  text: z.string(),
  chatId: z.string().optional(),
  chatType: TelegramChatTypeSchema.optional(),
  telegramMessageId: z.number().int().optional(),
  workspaceId: z.string().default('default'),
}).superRefine((value, ctx) => {
  if (value.source !== 'telegram') {
    return;
  }

  if (!value.chatId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'chatId is required for telegram ingress',
      path: ['chatId'],
    });
  }

  if (!value.chatType) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'chatType is required for telegram ingress',
      path: ['chatType'],
    });
  }

  if (typeof value.telegramMessageId !== 'number') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'telegramMessageId is required for telegram ingress',
      path: ['telegramMessageId'],
    });
  }
});
export type IngestMessageInput = z.infer<typeof IngestMessageInputSchema>;
