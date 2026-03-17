import { z } from 'zod';

export const DomainKindSchema = z.enum(['general', 'email', 'calendar', 'todos', 'github', 'files', 'people', 'finance', 'medical']);
export type DomainKind = z.infer<typeof DomainKindSchema>;

export const SensitivityLevelSchema = z.enum(['internal', 'personal', 'restricted']);
export type SensitivityLevel = z.infer<typeof SensitivityLevelSchema>;

export const EmbeddingPolicySchema = z.enum(['none', 'derived_only', 'full']);
export type EmbeddingPolicy = z.infer<typeof EmbeddingPolicySchema>;

export const ContextReleasePolicySchema = z.enum(['none', 'summary', 'excerpt', 'full']);
export type ContextReleasePolicy = z.infer<typeof ContextReleasePolicySchema>;

export const DomainPolicySchema = z.object({
  domain: DomainKindSchema,
  sensitivity: SensitivityLevelSchema,
  embeddingPolicy: EmbeddingPolicySchema,
  contextReleasePolicy: ContextReleasePolicySchema,
});
export type DomainPolicy = z.infer<typeof DomainPolicySchema>;

export const DOMAIN_POLICY_DEFAULTS: Record<DomainKind, DomainPolicy> = {
  general:  { domain: 'general',  sensitivity: 'internal',   embeddingPolicy: 'full',         contextReleasePolicy: 'full' },
  email:    { domain: 'email',    sensitivity: 'personal',   embeddingPolicy: 'derived_only', contextReleasePolicy: 'summary' },
  calendar: { domain: 'calendar', sensitivity: 'personal',   embeddingPolicy: 'derived_only', contextReleasePolicy: 'summary' },
  todos:    { domain: 'todos',    sensitivity: 'personal',   embeddingPolicy: 'derived_only', contextReleasePolicy: 'summary' },
  github:   { domain: 'github',   sensitivity: 'personal',   embeddingPolicy: 'derived_only', contextReleasePolicy: 'summary' },
  files:    { domain: 'files',    sensitivity: 'personal',   embeddingPolicy: 'derived_only', contextReleasePolicy: 'summary' },
  people:   { domain: 'people',   sensitivity: 'personal',   embeddingPolicy: 'derived_only', contextReleasePolicy: 'summary' },
  finance:  { domain: 'finance',  sensitivity: 'restricted', embeddingPolicy: 'none',         contextReleasePolicy: 'none' },
  medical:  { domain: 'medical',  sensitivity: 'restricted', embeddingPolicy: 'none',         contextReleasePolicy: 'none' },
};
