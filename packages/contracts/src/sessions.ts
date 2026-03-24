import { z } from 'zod';

export const SessionRootKindSchema = z.enum([
  'interactive_main',
  'system_heartbeat',
  'scheduled_task',
  'recovery',
  'telegram_user',
  'delegation',
]);
export type SessionRootKind = z.infer<typeof SessionRootKindSchema>;

export const SessionRootRecordSchema = z.object({
  id: z.string(),
  kind: SessionRootKindSchema,
  scope: z.string(),
  createdAt: z.string(),
});
export type SessionRootRecord = z.infer<typeof SessionRootRecordSchema>;
