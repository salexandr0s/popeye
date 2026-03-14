import {
  InterventionRecordSchema,
  SessionRootKindSchema,
  SessionRootRecordSchema,
} from '@popeye/contracts';
import { z } from 'zod';

const SessionRootRowSchema = z.object({
  id: z.string(),
  kind: SessionRootKindSchema,
  scope: z.string(),
  created_at: z.string(),
});

const InterventionRowSchema = z.object({
  id: z.string(),
  code: z.enum([
    'needs_credentials',
    'needs_policy_decision',
    'needs_instruction_fix',
    'needs_workspace_fix',
    'needs_operator_input',
    'retry_budget_exhausted',
    'auth_failure',
    'prompt_injection_quarantined',
    'failed_final',
  ]),
  run_id: z.string().nullable(),
  status: z.enum(['open', 'resolved']),
  reason: z.string(),
  created_at: z.string(),
  resolved_at: z.string().nullable(),
});

export function mapSessionRootRow(row: unknown) {
  const parsed = SessionRootRowSchema.parse(row);
  return SessionRootRecordSchema.parse({
    id: parsed.id,
    kind: parsed.kind,
    scope: parsed.scope,
    createdAt: parsed.created_at,
  });
}

export function mapInterventionRow(row: unknown) {
  const parsed = InterventionRowSchema.parse(row);
  return InterventionRecordSchema.parse({
    id: parsed.id,
    code: parsed.code,
    runId: parsed.run_id,
    status: parsed.status,
    reason: parsed.reason,
    createdAt: parsed.created_at,
    resolvedAt: parsed.resolved_at,
  });
}
