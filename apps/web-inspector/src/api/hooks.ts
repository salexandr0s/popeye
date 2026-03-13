import { useState, useEffect, useCallback } from 'react';
import { useApi } from './provider';

import type {
  DaemonStatusResponse,
  RunRecord,
  RunEventRecord,
  JobRecord,
  TaskRecord,
  ReceiptRecord,
  InterventionRecord,
  UsageSummary,
  SchedulerStatusResponse,
  SecurityAuditFinding,
  HealthResponse,
} from '@popeye/contracts';

// Re-export contract types for view convenience
export type { RunRecord, RunEventRecord, JobRecord, TaskRecord, ReceiptRecord, InterventionRecord, SecurityAuditFinding };

// Local types — diverge from contracts (API returns memoryId/memoryType, not id/type)
export interface MemorySearchResult {
  memoryId: string;
  description: string;
  content: string | null;
  memoryType: string;
  confidence: number;
  effectiveConfidence: number;
  scope: string;
  sourceType: string;
  createdAt: string;
  lastReinforcedAt: string | null;
  score: number;
  scoreBreakdown: {
    relevance: number;
    recency: number;
    confidence: number;
    scopeMatch: number;
  };
}

export interface MemorySearchResponse {
  results: MemorySearchResult[];
  query: string;
  totalCandidates: number;
  latencyMs: number;
  searchMode: string;
}

export interface InstructionBundle {
  id: string;
  sources: Array<{
    precedence: number;
    type: string;
    path?: string;
    contentHash: string;
    content: string;
  }>;
  compiledText: string;
  bundleHash: string;
  warnings: string[];
  createdAt: string;
}

interface PollingResult<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  refetch: () => void;
}

function usePolling<T>(path: string, intervalMs: number): PollingResult<T> {
  const api = useApi();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const result = await api.get<T>(path);
      setData(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [api, path]);

  useEffect(() => {
    void fetchData();
    const timer = setInterval(() => void fetchData(), intervalMs);
    return () => clearInterval(timer);
  }, [fetchData, intervalMs]);

  return { data, error, loading, refetch: fetchData };
}

function useFetch<T>(path: string | null): PollingResult<T> {
  const api = useApi();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!path) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const result = await api.get<T>(path);
      setData(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [api, path]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  return { data, error, loading, refetch: fetchData };
}

// --- Hooks ---

export function useDaemonStatus() {
  return usePolling<DaemonStatusResponse>('/v1/status', 5000);
}

export function useRuns() {
  return usePolling<RunRecord[]>('/v1/runs', 3000);
}

export function useRun(id: string | undefined) {
  return useFetch<RunRecord>(id ? `/v1/runs/${id}` : null);
}

export function useRunEvents(runId: string | undefined) {
  return useFetch<RunEventRecord[]>(runId ? `/v1/runs/${runId}/events` : null);
}

export function useJobs() {
  return usePolling<JobRecord[]>('/v1/jobs', 3000);
}

export function useReceipts() {
  return usePolling<ReceiptRecord[]>('/v1/receipts', 5000);
}

export function useReceipt(id: string | undefined) {
  return useFetch<ReceiptRecord>(id ? `/v1/receipts/${id}` : null);
}

export function useInterventions() {
  return usePolling<InterventionRecord[]>('/v1/interventions', 5000);
}

export function useTasks() {
  return useFetch<TaskRecord[]>('/v1/tasks');
}

export function useSchedulerStatus() {
  return useFetch<SchedulerStatusResponse>('/v1/daemon/scheduler');
}

export function useUsageSummary() {
  return useFetch<UsageSummary>('/v1/usage/summary');
}

export function useSecurityAudit() {
  return useFetch<SecurityAuditFinding[]>('/v1/security/audit');
}

export function useHealth() {
  return usePolling<HealthResponse>('/v1/health', 10000);
}
