import { useState, useEffect, useCallback, useRef } from 'react';
import { useApi } from './provider';
import { ensureBrowserSession } from './browser-session';
export { resetBrowserBootstrapForTests } from './browser-session';

import type {
  ApprovalRecord,
  AgentProfileRecord,
  AutomationGrantRecord,
  CalendarAccountRecord,
  CalendarEventRecord,
  ConnectionDiagnosticsResponse,
  ConnectionRecord,
  ConnectionResourceRule,
  DaemonStatusResponse,
  EmailAccountRecord,
  EmailDigestRecord,
  EmailSearchResult,
  GithubAccountRecord,
  GithubDigestRecord,
  GithubNotificationRecord,
  GithubSearchResult,
  PersonRecord,
  EngineCapabilitiesResponse,
  ExecutionEnvelopeResponse,
  SecurityPolicyResponse,
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
  StandingApprovalRecord,
  TodoAccountRecord,
  TodoProjectRecord,
  VaultRecord,
  FinanceImportRecord,
  MedicalImportRecord,
  FileRootRecord,
  FileWriteIntentRecord,
} from '@popeye/contracts';

// Re-export contract types for view convenience
export type { RunRecord, RunEventRecord, JobRecord, TaskRecord, ReceiptRecord, InterventionRecord, SecurityAuditFinding };
export type { MemorySearchResult, MemorySearchResponse };
export type { AgentProfileRecord, EngineCapabilitiesResponse, ExecutionEnvelopeResponse };
export type {
  ApprovalRecord,
  AutomationGrantRecord,
  CalendarAccountRecord,
  CalendarEventRecord,
  ConnectionDiagnosticsResponse,
  ConnectionRecord,
  ConnectionResourceRule,
  EmailAccountRecord,
  EmailDigestRecord,
  EmailSearchResult,
  GithubAccountRecord,
  GithubDigestRecord,
  GithubNotificationRecord,
  GithubSearchResult,
  PersonRecord,
  SecurityPolicyResponse,
  StandingApprovalRecord,
  TodoAccountRecord,
  TodoProjectRecord,
  VaultRecord,
  FinanceImportRecord,
  MedicalImportRecord,
  FileRootRecord,
  FileWriteIntentRecord,
};
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

  return { data, error, loading, updatedAt, refetch: () => void fetchData() };
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

  return { data, error, loading, updatedAt, refetch: () => void fetchData() };
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
        await ensureBrowserSession();
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

export function useEngineCapabilities() {
  return usePolling<EngineCapabilitiesResponse>('/v1/engine/capabilities', 10000);
}

export function useRuns() {
  return usePolling<RunRecord[]>('/v1/runs', 3000);
}

export function useRun(id: string | undefined) {
  return useFetch<RunRecord>(id ? `/v1/runs/${id}` : null);
}

export function useRunEnvelope(runId: string | undefined) {
  return useFetch<ExecutionEnvelopeResponse>(runId ? `/v1/runs/${runId}/envelope` : null);
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

export function useApprovals() {
  return usePolling<ApprovalRecord[]>('/v1/approvals', 5000);
}

export function useStandingApprovals() {
  return usePolling<StandingApprovalRecord[]>('/v1/policies/standing-approvals', 5000);
}

export function useAutomationGrants() {
  return usePolling<AutomationGrantRecord[]>('/v1/policies/automation-grants', 5000);
}

export function useTasks() {
  return useFetch<TaskRecord[]>('/v1/tasks');
}

export function useProfiles() {
  return useFetch<AgentProfileRecord[]>('/v1/profiles');
}

export function useProfile(id: string | undefined) {
  return useFetch<AgentProfileRecord>(id ? `/v1/profiles/${id}` : null);
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

export function useSecurityPolicy() {
  return useFetch<SecurityPolicyResponse>('/v1/security/policy');
}

export function useHealth() {
  return usePolling<HealthResponse>('/v1/health', 10000);
}

export function useVaults() {
  return usePolling<VaultRecord[]>('/v1/vaults', 5000);
}

export function useConnections(domain?: string) {
  const suffix = domain ? `?domain=${encodeURIComponent(domain)}` : '';
  return usePolling<ConnectionRecord[]>(`/v1/connections${suffix}`, 5000);
}

export function useEmailAccounts() {
  return usePolling<EmailAccountRecord[]>('/v1/email/accounts', 5000);
}

export function useGithubAccounts() {
  return usePolling<GithubAccountRecord[]>('/v1/github/accounts', 5000);
}

export function useCalendarAccounts() {
  return usePolling<CalendarAccountRecord[]>('/v1/calendar/accounts', 5000);
}

export function useTodoAccounts() {
  return usePolling<TodoAccountRecord[]>('/v1/todos/accounts', 5000);
}

export function usePeople() {
  return usePolling<PersonRecord[]>('/v1/people', 5000);
}

export function useConnectionResourceRules(connectionId: string) {
  return useFetch<ConnectionResourceRule[]>(
    connectionId ? `/v1/connections/${encodeURIComponent(connectionId)}/resource-rules` : null,
  );
}

export function useConnectionDiagnostics(connectionId: string) {
  return useFetch<ConnectionDiagnosticsResponse>(
    connectionId ? `/v1/connections/${encodeURIComponent(connectionId)}/diagnostics` : null,
  );
}

export function useFinanceImports() {
  return usePolling<FinanceImportRecord[]>('/v1/finance/imports', 5000);
}

export function useMedicalImports() {
  return usePolling<MedicalImportRecord[]>('/v1/medical/imports', 5000);
}

export function useFileRoots() {
  return usePolling<FileRootRecord[]>('/v1/files/roots', 5000);
}

export function useFileWriteIntents(status?: string) {
  const suffix = status ? `?status=${encodeURIComponent(status)}` : '';
  return usePolling<FileWriteIntentRecord[]>(`/v1/files/write-intents${suffix}`, 5000);
}

export function useTodoProjects(accountId: string) {
  return useFetch<TodoProjectRecord[]>(
    accountId ? `/v1/todos/projects?accountId=${encodeURIComponent(accountId)}` : null,
  );
}
