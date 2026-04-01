import { z } from 'zod';
import { AppliedPlaybookSchema } from './playbooks.js';

export const InstructionSourceSchema = z.object({
  precedence: z.number().int().min(1).max(10),
  type: z.enum([
    'pi_base',
    'popeye_base',
    'global_operator',
    'context_compat',
    'context_native',
    'workspace',
    'project',
    'playbook',
    'identity',
    'soul',
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
  playbooks: z.array(AppliedPlaybookSchema).default([]),
  compiledText: z.string(),
  bundleHash: z.string(),
  warnings: z.array(z.string()),
  createdAt: z.string(),
});
export type CompiledInstructionBundle = z.infer<typeof CompiledInstructionBundleSchema>;
