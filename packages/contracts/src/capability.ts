import { z } from 'zod';
import type { DomainKind } from './domain.js';
import type { RuntimePaths } from './config.js';

// --- Capability Descriptor ---

export const CapabilityDescriptorSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  domain: z.string().min(1),
  dependencies: z.array(z.string()).default([]),
});
export type CapabilityDescriptor = z.infer<typeof CapabilityDescriptorSchema>;

// --- Capability Context ---

/** Generic database handle — avoids coupling contracts to better-sqlite3. */
export interface CapabilityDbHandle {
  prepare(sql: string): unknown;
  exec(sql: string): void;
  transaction<T>(fn: () => T): () => T;
}

/** Sandboxed context passed to capabilities during initialization. */
export interface CapabilityContext {
  readonly appDb: CapabilityDbHandle;
  readonly memoryDb: CapabilityDbHandle;
  readonly paths: RuntimePaths;
  readonly config: Record<string, unknown>;
  readonly log: {
    info: (msg: string, meta?: Record<string, unknown>) => void;
    warn: (msg: string, meta?: Record<string, unknown>) => void;
    error: (msg: string, meta?: Record<string, unknown>) => void;
    debug: (msg: string, meta?: Record<string, unknown>) => void;
  };
  readonly auditCallback: (event: {
    eventType: string;
    details: Record<string, unknown>;
    severity: string;
  }) => void;
  readonly memoryInsert: (input: {
    description: string;
    classification: 'secret' | 'sensitive' | 'internal' | 'embeddable';
    sourceType: string;
    content: string;
    confidence: number;
    scope: string;
    memoryType?: string;
    sourceRef?: string;
    sourceRefType?: string;
    domain?: DomainKind;
    contextReleasePolicy?: string;
    dedupKey?: string;
  }) => { memoryId: string; embedded: boolean; rejected?: boolean; rejectionReason?: string };
  readonly approvalRequest: (input: {
    scope: string;
    domain: DomainKind;
    riskClass: string;
    resourceType: string;
    resourceId: string;
    requestedBy: string;
    payloadPreview?: string;
  }) => { id: string; status: string };
  readonly contextReleaseRecord: (input: {
    domain: DomainKind;
    sourceRef: string;
    releaseLevel: string;
    runId?: string;
    tokenEstimate?: number;
    redacted?: boolean;
  }) => { id: string };
  readonly events: {
    emit: (event: string, payload: unknown) => void;
  };
  /** Resolve an email adapter for a given connection. Provided by runtime for sync timer. */
  readonly resolveEmailAdapter?: ((connectionId: string) => Promise<{
    adapter: unknown;
    account: { id: string; connectionId: string; emailAddress: string };
  } | null>) | undefined;
}

// --- Capability Lifecycle ---

export interface CapabilityLifecycle {
  initialize(ctx: CapabilityContext): void | Promise<void>;
  shutdown(): void | Promise<void>;
  healthCheck(): { healthy: boolean; details?: Record<string, unknown> };
}

// --- Capability Tool Provider ---

export interface CapabilityToolDescriptor {
  name: string;
  label: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (params: unknown) => Promise<{
    content: Array<{ type: string; text: string }>;
    details?: Record<string, unknown>;
  }>;
}

export interface CapabilityToolProvider {
  getRuntimeTools(taskContext: { workspaceId: string; runId?: string }): CapabilityToolDescriptor[];
}

// --- Capability Timer Provider ---

export interface CapabilityTimerDescriptor {
  id: string;
  intervalMs: number;
  immediate: boolean;
  handler: () => void | Promise<void>;
}

export interface CapabilityTimerProvider {
  getTimers(): CapabilityTimerDescriptor[];
}

// --- Capability Migration Provider ---

export interface CapabilityMigration {
  id: string;
  db: 'app' | 'memory';
  statements: string[];
}

export interface CapabilityMigrationProvider {
  getMigrations(): CapabilityMigration[];
}

// --- Capability Module (composite) ---

export interface CapabilityModule extends CapabilityLifecycle {
  readonly descriptor: CapabilityDescriptor;
  getRuntimeTools?(taskContext: { workspaceId: string; runId?: string }): CapabilityToolDescriptor[];
  getTimers?(): CapabilityTimerDescriptor[];
  getMigrations?(): CapabilityMigration[];
}
