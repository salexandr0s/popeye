import { useState, useEffect, useCallback } from 'react';
import { useApi } from './provider';

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

// --- Domain types for API responses ---

export interface DaemonStatus {
  ok: boolean;
  runningJobs: number;
  queuedJobs: number;
  openInterventions: number;
  activeLeases: number;
  engineKind: string;
  schedulerRunning: boolean;
  startedAt: string;
  lastShutdownAt: string | null;
}

export interface RunRecord {
  id: string;
  jobId: string;
  taskId: string;
  workspaceId: string;
  sessionRootId: string;
  engineSessionRef: string | null;
  state: string;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
}

export interface RunEventRecord {
  id: string;
  runId: string;
  type: string;
  payload: string;
  createdAt: string;
}

export interface JobRecord {
  id: string;
  taskId: string;
  workspaceId: string;
  status: string;
  retryCount: number;
  availableAt: string;
  lastRunId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskRecord {
  id: string;
  workspaceId: string;
  projectId: string | null;
  title: string;
  prompt: string;
  source: string;
  status: string;
  createdAt: string;
}

export interface ReceiptRecord {
  id: string;
  runId: string;
  jobId: string;
  taskId: string;
  workspaceId: string;
  status: string;
  summary: string;
  details: string;
  usage: {
    provider: string;
    model: string;
    tokensIn: number;
    tokensOut: number;
    estimatedCostUsd: number;
  };
  createdAt: string;
}

export interface InterventionRecord {
  id: string;
  code: string;
  runId: string | null;
  status: string;
  reason: string;
  createdAt: string;
  resolvedAt: string | null;
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

export interface UsageSummary {
  runs: number;
  tokensIn: number;
  tokensOut: number;
  estimatedCostUsd: number;
}

export interface SchedulerStatus {
  running: boolean;
  activeLeases: number;
  activeRuns: number;
  nextHeartbeatDueAt: string | null;
}

export interface SecurityAuditFinding {
  code: string;
  severity: string;
  message: string;
}

export interface HealthResponse {
  ok: boolean;
}

// --- Hooks ---

export function useDaemonStatus() {
  return usePolling<DaemonStatus>('/v1/status', 5000);
}

export function useRuns() {
  return usePolling<RunRecord[]>('/v1/runs', 3000);
}

export function useRun(id: string) {
  return useFetch<RunRecord>(`/v1/runs/${id}`);
}

export function useRunEvents(runId: string) {
  return useFetch<RunEventRecord[]>(`/v1/runs/${runId}/events`);
}

export function useJobs() {
  return usePolling<JobRecord[]>('/v1/jobs', 3000);
}

export function useReceipts() {
  return usePolling<ReceiptRecord[]>('/v1/receipts', 5000);
}

export function useReceipt(id: string) {
  return useFetch<ReceiptRecord>(`/v1/receipts/${id}`);
}

export function useInterventions() {
  return usePolling<InterventionRecord[]>('/v1/interventions', 5000);
}

export function useTasks() {
  return useFetch<TaskRecord[]>('/v1/tasks');
}

export function useSchedulerStatus() {
  return useFetch<SchedulerStatus>('/v1/daemon/scheduler');
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
