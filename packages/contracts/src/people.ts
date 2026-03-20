import { z } from 'zod';

export const PersonIdentityProviderSchema = z.enum(['email', 'calendar', 'github']);
export type PersonIdentityProvider = z.infer<typeof PersonIdentityProviderSchema>;

export const PersonContactMethodTypeSchema = z.enum(['email', 'github']);
export type PersonContactMethodType = z.infer<typeof PersonContactMethodTypeSchema>;

export const PersonIdentityRecordSchema = z.object({
  id: z.string(),
  personId: z.string(),
  provider: PersonIdentityProviderSchema,
  externalId: z.string(),
  displayName: z.string().nullable().default(null),
  handle: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PersonIdentityRecord = z.infer<typeof PersonIdentityRecordSchema>;

export const PersonContactMethodRecordSchema = z.object({
  id: z.string(),
  personId: z.string(),
  type: PersonContactMethodTypeSchema,
  value: z.string(),
  label: z.string().nullable().default(null),
  source: z.enum(['derived', 'manual']).default('derived'),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PersonContactMethodRecord = z.infer<typeof PersonContactMethodRecordSchema>;

export const PersonPolicyRecordSchema = z.object({
  personId: z.string(),
  relationshipLabel: z.string().nullable().default(null),
  reminderRouting: z.string().nullable().default(null),
  approvalNotes: z.string().nullable().default(null),
  updatedAt: z.string(),
});
export type PersonPolicyRecord = z.infer<typeof PersonPolicyRecordSchema>;

export const PersonRecordSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  pronouns: z.string().nullable().default(null),
  tags: z.array(z.string()).default([]),
  notes: z.string().default(''),
  canonicalEmail: z.string().nullable().default(null),
  githubLogin: z.string().nullable().default(null),
  activitySummary: z.string().default(''),
  identityCount: z.number().int().nonnegative().default(0),
  contactMethodCount: z.number().int().nonnegative().default(0),
  policy: PersonPolicyRecordSchema.nullable().default(null),
  identities: z.array(PersonIdentityRecordSchema).default([]),
  contactMethods: z.array(PersonContactMethodRecordSchema).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PersonRecord = z.infer<typeof PersonRecordSchema>;

export const PersonListItemSchema = PersonRecordSchema;
export type PersonListItem = z.infer<typeof PersonListItemSchema>;

export const PersonSearchResultSchema = z.object({
  personId: z.string(),
  displayName: z.string(),
  canonicalEmail: z.string().nullable(),
  githubLogin: z.string().nullable(),
  score: z.number(),
});
export type PersonSearchResult = z.infer<typeof PersonSearchResultSchema>;

export const PersonUpdateInputSchema = z.object({
  displayName: z.string().min(1).optional(),
  pronouns: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  notes: z.string().optional(),
  relationshipLabel: z.string().nullable().optional(),
  reminderRouting: z.string().nullable().optional(),
  approvalNotes: z.string().nullable().optional(),
  addContactMethods: z.array(z.object({
    type: PersonContactMethodTypeSchema,
    value: z.string().min(1),
    label: z.string().nullable().optional(),
  })).optional(),
});
export type PersonUpdateInput = z.infer<typeof PersonUpdateInputSchema>;

export const PersonSearchQuerySchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().positive().max(100).default(20),
});
export type PersonSearchQuery = z.infer<typeof PersonSearchQuerySchema>;

export const PersonMergeInputSchema = z.object({
  sourcePersonId: z.string().min(1),
  targetPersonId: z.string().min(1),
  requestedBy: z.string().min(1).default('operator'),
});
export type PersonMergeInput = z.infer<typeof PersonMergeInputSchema>;

export const PersonSplitInputSchema = z.object({
  identityIds: z.array(z.string().min(1)).min(1),
  displayName: z.string().min(1).optional(),
  requestedBy: z.string().min(1).default('operator'),
});
export type PersonSplitInput = z.infer<typeof PersonSplitInputSchema>;

export const PersonIdentityAttachInputSchema = z.object({
  personId: z.string().min(1),
  provider: PersonIdentityProviderSchema,
  externalId: z.string().min(1),
  displayName: z.string().nullable().optional(),
  handle: z.string().nullable().optional(),
  requestedBy: z.string().min(1).default('operator'),
});
export type PersonIdentityAttachInput = z.infer<typeof PersonIdentityAttachInputSchema>;

export const PersonIdentityDetachInputSchema = z.object({
  requestedBy: z.string().min(1).default('operator'),
});
export type PersonIdentityDetachInput = z.infer<typeof PersonIdentityDetachInputSchema>;

// --- Merge events, merge suggestions, activity rollups ---

export const PersonMergeEventTypeSchema = z.enum(['merge', 'split', 'attach', 'detach']);
export type PersonMergeEventType = z.infer<typeof PersonMergeEventTypeSchema>;

export const PersonMergeEventRecordSchema = z.object({
  id: z.string(),
  eventType: PersonMergeEventTypeSchema,
  sourcePersonId: z.string().nullable(),
  targetPersonId: z.string().nullable(),
  identityId: z.string().nullable(),
  requestedBy: z.string(),
  createdAt: z.string(),
});
export type PersonMergeEventRecord = z.infer<typeof PersonMergeEventRecordSchema>;

export const PersonMergeSuggestionSchema = z.object({
  sourcePersonId: z.string(),
  targetPersonId: z.string(),
  sourceDisplayName: z.string(),
  targetDisplayName: z.string(),
  reason: z.string(),
  confidence: z.number().min(0).max(1),
});
export type PersonMergeSuggestion = z.infer<typeof PersonMergeSuggestionSchema>;

export const PersonActivityRollupSchema = z.object({
  personId: z.string(),
  domain: z.string(),
  summary: z.string(),
  count: z.number().int().nonnegative(),
  lastSeenAt: z.string(),
});
export type PersonActivityRollup = z.infer<typeof PersonActivityRollupSchema>;

// --- Extended policy fields ---

export const PersonEmailSendPolicySchema = z.enum(['allowed', 'approval_required', 'blocked']).default('approval_required');
export type PersonEmailSendPolicy = z.infer<typeof PersonEmailSendPolicySchema>;
