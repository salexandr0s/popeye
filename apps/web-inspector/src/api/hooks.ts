import { useState, useEffect, useCallback, useRef } from 'react';
import { useApi } from './provider';
import { readBootstrapNonce } from './bootstrap';

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
  SecurityAuditResponse,
  SecurityAuditFinding,
  HealthResponse,
  MemorySearchResult,
  MemorySearchResponse,
  CompiledInstructionBundle,
} from '@popeye/contracts';

// Re-export contract types for view convenience
export type { RunRecord, RunEventRecord, JobRecord, TaskRecord, ReceiptRecord, InterventionRecord, SecurityAuditFinding };
export type { MemorySearchResult, MemorySearchResponse };
export type InstructionBundle = CompiledInstructionBundle;

interface PollingResult<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  updatedAt: string | null;
  refetch: () => void;
}

export interface EventStreamFreshness {
  connected: boolean;
  error: string | null;
  lastEventAt: string | null;
}

export interface EventStreamEnvelope {
  event: string;
  data: string;
}

let bootstrapPromise: Promise<void> | null = null;

export function resetBrowserBootstrapForTests(): void {
  bootstrapPromise = null;
}

function ensureBrowserBootstrap(): Promise<void> {
  if (bootstrapPromise) return bootstrapPromise;
  const nonce = readBootstrapNonce();
  if (!nonce) {
    return Promise.reject(new Error('Missing bootstrap nonce'));
  }
  bootstrapPromise = fetch('/v1/auth/exchange', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ nonce }),
  }).then(async (response) => {
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
  }).catch((error: unknown) => {
    bootstrapPromise = null;
    throw error;
  });
  return bootstrapPromise;
}

function usePolling<T>(path: string, intervalMs: number): PollingResult<T> {
  const api = useApi();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const result = await api.get<T>(path);
      setData(result);
      setError(null);
      setUpdatedAt(new Date().toISOString());
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

  return { data, error, loading, updatedAt, refetch: fetchData };
}

function useFetch<T>(path: string | null): PollingResult<T> {
  const api = useApi();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

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
      setUpdatedAt(new Date().toISOString());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [api, path]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  return { data, error, loading, updatedAt, refetch: fetchData };
}

export function useEventStreamFreshness(onEvent?: (event: EventStreamEnvelope) => void): EventStreamFreshness {
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastEventAt, setLastEventAt] = useState<string | null>(null);
  const onEventRef = useRef(onEvent);

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    let disposed = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let controller: AbortController | null = null;

    const connect = async (): Promise<void> => {
      controller = new AbortController();
      try {
        await ensureBrowserBootstrap();
        const response = await fetch('/v1/events/stream', {
          headers: {
            Accept: 'text/event-stream',
          },
          credentials: 'same-origin',
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`${response.status} ${response.statusText}`);
        }
        if (!response.body) {
          throw new Error('Event stream body unavailable');
        }

        setConnected(true);
        setError(null);

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (!disposed) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let boundary = buffer.indexOf('\n\n');
          while (boundary >= 0) {
            const frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            if (frame.trim() !== '' && !frame.startsWith(':')) {
              setLastEventAt(new Date().toISOString());
              const lines = frame.split('\n');
              const event = lines.find((line) => line.startsWith('event: '))?.slice(7) ?? 'message';
              const data = lines
                .filter((line) => line.startsWith('data: '))
                .map((line) => line.slice(6))
                .join('\n');
              onEventRef.current?.({ event, data });
            }
            boundary = buffer.indexOf('\n\n');
          }
        }
      } catch (err) {
        if (disposed || controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : 'Event stream failed');
      } finally {
        setConnected(false);
        if (!disposed) {
          retryTimer = setTimeout(() => {
            void connect();
          }, 5000);
        }
      }
    };

    void connect();

    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      controller?.abort();
    };
  }, []);

  return { connected, error, lastEventAt };
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
  return useFetch<SecurityAuditResponse>('/v1/security/audit');
}

export function useHealth() {
  return usePolling<HealthResponse>('/v1/health', 10000);
}
