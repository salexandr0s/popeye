import { useState } from 'react';
import { useApi } from '../api/provider';
import { useMedicalImports } from '../api/hooks';
import { PageHeader } from '../components/page-header';
import { Loading } from '../components/loading';
import { ErrorDisplay } from '../components/error-display';
import { EmptyState } from '../components/empty-state';
import { Card } from '../components/card';

interface MedicalAppointmentRecord {
  id: string;
  importId: string;
  date: string;
  provider: string;
  specialty: string | null;
  location: string | null;
  redactedSummary: string;
}

interface MedicalMedicationRecord {
  id: string;
  importId: string;
  name: string;
  dosage: string | null;
  frequency: string | null;
  prescriber: string | null;
  startDate: string | null;
  endDate: string | null;
  redactedSummary: string;
}

interface MedicalDigestRecord {
  id: string;
  period: string;
  appointmentCount: number;
  activeMedications: number;
  summary: string;
  generatedAt: string;
}

interface MedicalSearchResponse {
  query: string;
  results: Array<{
    recordId: string;
    recordType: string;
    date: string | null;
    redactedSummary: string;
    score: number;
  }>;
}

export function Medical() {
  const api = useApi();
  const imports = useMedicalImports();
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<MedicalSearchResponse['results']>([]);
  const [appointments, setAppointments] = useState<MedicalAppointmentRecord[]>([]);
  const [medications, setMedications] = useState<MedicalMedicationRecord[]>([]);
  const [digest, setDigest] = useState<MedicalDigestRecord | null>(null);

  if (imports.loading) return <Loading />;
  if (imports.error) return <ErrorDisplay message={imports.error} />;
  if (!imports.data || imports.data.length === 0) {
    return (
      <>
        <PageHeader title="Medical" description="Medical records, appointments, medications, and digest views." />
        <EmptyState title="No medical imports" description="Import medical data to get started." />
      </>
    );
  }

  const handleSearch = async () => {
    if (!query.trim()) return;
    try {
      setBusyAction('search');
      setActionError(null);
      const response = await api.get<MedicalSearchResponse>(
        `/v1/medical/search?query=${encodeURIComponent(query)}`,
      );
      setSearchResults(response.results);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Search failed');
    } finally {
      setBusyAction(null);
    }
  };

  const handleLoadAppointments = async () => {
    try {
      setBusyAction('appointments');
      setActionError(null);
      const result = await api.get<MedicalAppointmentRecord[]>('/v1/medical/appointments');
      setAppointments(result);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Failed to load appointments');
    } finally {
      setBusyAction(null);
    }
  };

  const handleLoadMedications = async () => {
    try {
      setBusyAction('medications');
      setActionError(null);
      const result = await api.get<MedicalMedicationRecord[]>('/v1/medical/medications');
      setMedications(result);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Failed to load medications');
    } finally {
      setBusyAction(null);
    }
  };

  const handleLoadDigest = async () => {
    try {
      setBusyAction('digest');
      setActionError(null);
      const result = await api.get<MedicalDigestRecord | null>('/v1/medical/digest');
      setDigest(result);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Failed to load digest');
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div>
      <PageHeader title="Medical" description="Medical records, appointments, medications, and digest views." />

      <div className="mb-[24px] grid gap-[16px] md:grid-cols-3">
        <Card label="Imports" value={String(imports.data.length)} description="Total medical imports" />
        <Card
          label="Latest Import"
          value={imports.data[0]?.fileName ?? 'None'}
          description={imports.data[0]?.status ?? ''}
        />
        <Card
          label="Imported At"
          value={imports.data[0] ? new Date(imports.data[0].importedAt).toLocaleString() : 'Never'}
          description="Most recent import"
        />
      </div>

      {actionError ? (
        <div className="mb-[16px]">
          <ErrorDisplay message={actionError} />
        </div>
      ) : null}

      <div className="mb-[24px] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[20px]">
        <h2 className="text-[16px] font-semibold text-[var(--color-fg)]">Search Medical</h2>
        <div className="mt-[12px] flex gap-[12px]">
          <input
            className="flex-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-transparent px-[12px] py-[8px]"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search appointments, medications, documents"
            value={query}
          />
          <button
            className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-[14px] py-[8px] text-[13px] font-medium text-white"
            onClick={() => void handleSearch()}
            type="button"
          >
            {busyAction === 'search' ? 'Searching…' : 'Search'}
          </button>
        </div>
        <div className="mt-[16px] space-y-[8px]">
          {searchResults.length === 0 ? (
            <p className="text-[14px] text-[var(--color-fg-muted)]">Run a search to find medical records.</p>
          ) : searchResults.map((result) => (
            <div key={result.recordId} className="rounded-[var(--radius-sm)] border border-[var(--color-border)] p-[12px]">
              <p className="font-medium">{result.redactedSummary}</p>
              <p className="mt-[4px] text-[12px] text-[var(--color-fg-muted)]">
                {result.recordType}{result.date ? ` · ${result.date}` : ''} · score {result.score}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="mb-[24px] flex flex-wrap gap-[12px]">
        <button
          className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-[14px] py-[8px] text-[13px] font-medium text-white"
          onClick={() => void handleLoadAppointments()}
          type="button"
        >
          {busyAction === 'appointments' ? 'Loading…' : 'Load Appointments'}
        </button>
        <button
          className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-[14px] py-[8px] text-[13px] font-medium"
          onClick={() => void handleLoadMedications()}
          type="button"
        >
          {busyAction === 'medications' ? 'Loading…' : 'Load Medications'}
        </button>
        <button
          className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-[14px] py-[8px] text-[13px] font-medium"
          onClick={() => void handleLoadDigest()}
          type="button"
        >
          {busyAction === 'digest' ? 'Loading…' : 'Load Digest'}
        </button>
      </div>

      <div className="grid gap-[24px] md:grid-cols-2">
        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[20px]">
          <h2 className="text-[16px] font-semibold text-[var(--color-fg)]">Appointments</h2>
          <div className="mt-[12px] space-y-[8px]">
            {appointments.length === 0 ? (
              <p className="text-[14px] text-[var(--color-fg-muted)]">No appointments loaded.</p>
            ) : appointments.map((appt) => (
              <div key={appt.id} className="rounded-[var(--radius-sm)] border border-[var(--color-border)] p-[10px]">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-medium">{appt.provider}</p>
                    <p className="mt-[4px] text-[12px] text-[var(--color-fg-muted)]">
                      {appt.date}{appt.specialty ? ` · ${appt.specialty}` : ''}{appt.location ? ` · ${appt.location}` : ''}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[20px]">
          <h2 className="text-[16px] font-semibold text-[var(--color-fg)]">Medications</h2>
          <div className="mt-[12px] space-y-[8px]">
            {medications.length === 0 ? (
              <p className="text-[14px] text-[var(--color-fg-muted)]">No medications loaded.</p>
            ) : medications.map((med) => (
              <div key={med.id} className="rounded-[var(--radius-sm)] border border-[var(--color-border)] p-[10px]">
                <p className="font-medium">{med.name}</p>
                <p className="mt-[4px] text-[12px] text-[var(--color-fg-muted)]">
                  {med.dosage ? `${med.dosage}` : ''}{med.frequency ? ` · ${med.frequency}` : ''}{med.prescriber ? ` · ${med.prescriber}` : ''}
                  {med.startDate ? ` · from ${med.startDate}` : ''}{med.endDate ? ` to ${med.endDate}` : ''}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {digest ? (
        <div className="mt-[24px] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[20px]">
          <h2 className="text-[16px] font-semibold text-[var(--color-fg)]">Digest</h2>
          <div className="mt-[12px] grid grid-cols-2 gap-[8px]">
            <div className="rounded-[var(--radius-sm)] border border-[var(--color-border)] p-[10px] text-center">
              <p className="text-[20px] font-semibold">{digest.appointmentCount}</p>
              <p className="text-[12px] text-[var(--color-fg-muted)]">Appointments</p>
            </div>
            <div className="rounded-[var(--radius-sm)] border border-[var(--color-border)] p-[10px] text-center">
              <p className="text-[20px] font-semibold">{digest.activeMedications}</p>
              <p className="text-[12px] text-[var(--color-fg-muted)]">Active Medications</p>
            </div>
          </div>
          {digest.summary ? (
            <div className="mt-[12px] rounded-[var(--radius-sm)] border border-[var(--color-border)] p-[12px]">
              <pre className="whitespace-pre-wrap text-[13px]">{digest.summary}</pre>
            </div>
          ) : null}
          <p className="mt-[8px] text-[12px] text-[var(--color-fg-muted)]">
            Period: {digest.period} · Generated {new Date(digest.generatedAt).toLocaleString()}
          </p>
        </div>
      ) : null}
    </div>
  );
}
