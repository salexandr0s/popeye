import type { CapabilityContext } from '@popeye/contracts';

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

export type PeopleCapabilityDb = CapabilityContext['appDb'];

interface PreparedStatement<TRow> {
  get(...args: unknown[]): TRow | undefined;
  all(...args: unknown[]): TRow[];
  run(...args: unknown[]): { changes: number; lastInsertRowid: number | bigint };
}

export function prepareGet<TRow>(db: PeopleCapabilityDb, sql: string): (...args: unknown[]) => TRow | undefined {
  const stmt = (db.prepare as (input: string) => PreparedStatement<TRow>)(sql);
  return (...args: unknown[]) => stmt.get(...args);
}

export function prepareAll<TRow>(db: PeopleCapabilityDb, sql: string): (...args: unknown[]) => TRow[] {
  const stmt = (db.prepare as (input: string) => PreparedStatement<TRow>)(sql);
  return (...args: unknown[]) => stmt.all(...args);
}

export function prepareRun(db: PeopleCapabilityDb, sql: string): (...args: unknown[]) => { changes: number } {
  const stmt = (db.prepare as (input: string) => PreparedStatement<never>)(sql);
  return (...args: unknown[]) => ({ changes: stmt.run(...args).changes });
}
