import { z } from 'zod';

export const InstructionSourceSchema = z.object({
  precedence: z.number().int().min(1).max(9),
  type: z.enum([
    'pi_base',
    'popeye_base',
    'global_operator',
    'workspace',
    'project',
    'identity',
    'task_brief',
    'trigger_overlay',
    'runtime_notes',
  ]),
  path: z.string().optional(),
  inlineId: z.string().optional(),
  contentHash: z.string(),
  content: z.string(),
});
export type InstructionSource = z.infer<typeof InstructionSourceSchema>;

export const CompiledInstructionBundleSchema = z.object({
  id: z.string(),
  sources: z.array(InstructionSourceSchema),
  compiledText: z.string(),
  bundleHash: z.string(),
  warnings: z.array(z.string()),
  createdAt: z.string(),
});
export type CompiledInstructionBundle = z.infer<typeof CompiledInstructionBundleSchema>;
