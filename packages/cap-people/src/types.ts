export { type CapabilityDb, prepareGet, prepareAll, prepareRun } from '@popeye/cap-common';
import type { CapabilityDb } from '@popeye/cap-common';

export interface PersonRow {
  id: string;
  display_name: string;
  pronouns: string | null;
  tags_json: string;
  notes: string;
  canonical_email: string | null;
  github_login: string | null;
  activity_summary: string;
  created_at: string;
  updated_at: string;
}

export interface PersonIdentityRow {
  id: string;
  person_id: string;
  provider: string;
  external_id: string;
  display_name: string | null;
  handle: string | null;
  created_at: string;
  updated_at: string;
}

export interface PersonContactMethodRow {
  id: string;
  person_id: string;
  type: string;
  value: string;
  label: string | null;
  source: string;
  created_at: string;
  updated_at: string;
}

export interface PersonPolicyRow {
  person_id: string;
  relationship_label: string | null;
  reminder_routing: string | null;
  approval_notes: string | null;
  updated_at: string;
}

export interface PersonActivityRollupRow {
  person_id: string;
  summary: string;
  updated_at: string;
}

/** @deprecated Use CapabilityDb from @popeye/cap-common */
export type PeopleCapabilityDb = CapabilityDb;
