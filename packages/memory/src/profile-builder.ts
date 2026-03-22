import type Database from 'better-sqlite3';
import type { DataClassification, DomainKind, MemorySynthesisRecord } from '@popeye/contracts';

import { createSynthesis } from './synthesis.js';

export interface BuildProfileInput {
  scope: string;
  workspaceId?: string | null | undefined;
  projectId?: string | null | undefined;
  namespaceId: string;
  classification: DataClassification;
  domain?: DomainKind | undefined;
}

interface FactRow {
  id: string;
  fact_kind: string;
  text: string;
  confidence: number;
}

/** Minimum interval between profile refreshes (ms). */
const REFRESH_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

/** Maximum durable facts to include in a static profile. */
const MAX_STATIC_FACTS = 50;

/** Maximum recent facts to include in a dynamic profile. */
const MAX_DYNAMIC_FACTS = 30;

/** Dynamic profile time window (ms). */
const DYNAMIC_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Build a static profile synthesis from durable identity, preference, and procedure facts.
 * Returns null if no qualifying facts exist.
 */
export function buildProfileStatic(db: Database.Database, input: BuildProfileInput): MemorySynthesisRecord | null {
  const facts = db.prepare(
    `SELECT id, fact_kind, text, confidence
     FROM memory_facts
     WHERE scope = ? AND is_latest = 1 AND archived_at IS NULL AND durable = 1
       AND fact_kind IN ('identity', 'preference', 'procedure')
     ORDER BY confidence DESC
     LIMIT ?`,
  ).all(input.scope, MAX_STATIC_FACTS) as FactRow[];

  if (facts.length === 0) return null;

  const text = renderStaticProfileText(facts);
  const avgConfidence = facts.reduce((sum, f) => sum + f.confidence, 0) / facts.length;

  return createSynthesis(db, {
    namespaceId: input.namespaceId,
    scope: input.scope,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    classification: input.classification,
    synthesisKind: 'profile_static',
    title: 'Static Profile',
    text,
    confidence: avgConfidence,
    refreshPolicy: 'on_durable_change',
    sourceFacts: facts.map((f) => ({ id: f.id })),
    domain: input.domain,
    subjectKind: 'workspace',
    subjectId: input.workspaceId,
    qualityScore: avgConfidence,
  });
}

/**
 * Build a dynamic profile synthesis from recent event, state, and observation facts.
 * Returns null if no qualifying facts exist.
 */
export function buildProfileDynamic(db: Database.Database, input: BuildProfileInput): MemorySynthesisRecord | null {
  const cutoff = new Date(Date.now() - DYNAMIC_WINDOW_MS).toISOString();

  const facts = db.prepare(
    `SELECT id, fact_kind, text, confidence
     FROM memory_facts
     WHERE scope = ? AND is_latest = 1 AND archived_at IS NULL
       AND fact_kind IN ('event', 'state', 'observation')
       AND created_at > ?
     ORDER BY created_at DESC
     LIMIT ?`,
  ).all(input.scope, cutoff, MAX_DYNAMIC_FACTS) as FactRow[];

  if (facts.length === 0) return null;

  const text = renderDynamicProfileText(facts);
  const avgConfidence = facts.reduce((sum, f) => sum + f.confidence, 0) / facts.length;
  const refreshDueAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24h from now

  return createSynthesis(db, {
    namespaceId: input.namespaceId,
    scope: input.scope,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    classification: input.classification,
    synthesisKind: 'profile_dynamic',
    title: 'Dynamic Profile',
    text,
    confidence: avgConfidence,
    refreshPolicy: 'automatic_daily',
    sourceFacts: facts.map((f) => ({ id: f.id })),
    domain: input.domain,
    subjectKind: 'workspace',
    subjectId: input.workspaceId,
    refreshDueAt,
    qualityScore: avgConfidence,
  });
}

/**
 * Check whether a profile synthesis should be refreshed.
 * Returns true if no synthesis exists, refresh is overdue, or cooldown has passed.
 */
export function shouldRefreshProfile(
  db: Database.Database,
  scope: string,
  synthesisKind: 'profile_static' | 'profile_dynamic',
): boolean {
  const existing = db.prepare(
    `SELECT updated_at, refresh_due_at
     FROM memory_syntheses
     WHERE scope = ? AND synthesis_kind = ? AND archived_at IS NULL
     LIMIT 1`,
  ).get(scope, synthesisKind) as { updated_at: string; refresh_due_at: string | null } | undefined;

  if (!existing) return true;

  const now = Date.now();
  const lastUpdated = new Date(existing.updated_at).getTime();

  // Respect cooldown — don't refresh more than once per hour
  if (now - lastUpdated < REFRESH_COOLDOWN_MS) return false;

  // If refresh_due_at is set and has passed, refresh
  if (existing.refresh_due_at && new Date(existing.refresh_due_at).getTime() < now) {
    return true;
  }

  // For static profiles (no refresh_due_at), only refresh when triggered by durable fact changes
  // The caller checks this condition before calling shouldRefreshProfile
  if (synthesisKind === 'profile_static') return true;

  return false;
}

function renderStaticProfileText(facts: FactRow[]): string {
  const grouped = new Map<string, string[]>();
  for (const fact of facts) {
    const kind = fact.fact_kind;
    const existing = grouped.get(kind) ?? [];
    existing.push(fact.text);
    grouped.set(kind, existing);
  }

  const sections: string[] = [];
  for (const [kind, texts] of grouped) {
    const heading = kind.charAt(0).toUpperCase() + kind.slice(1);
    sections.push(`## ${heading}\n${texts.map((t) => `- ${t}`).join('\n')}`);
  }
  return sections.join('\n\n');
}

function renderDynamicProfileText(facts: FactRow[]): string {
  return facts.map((f) => `- [${f.fact_kind}] ${f.text}`).join('\n');
}
