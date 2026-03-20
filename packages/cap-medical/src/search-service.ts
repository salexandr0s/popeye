import type { MedicalSearchResult } from '@popeye/contracts';

import type { MedicalCapabilityDb, MedicalAppointmentRow, MedicalMedicationRow, MedicalDocumentRow } from './types.js';
import { prepareAll } from './types.js';

export class MedicalSearchService {
  constructor(private readonly db: MedicalCapabilityDb) {}

  search(query: string, limit = 20): { query: string; results: MedicalSearchResult[] } {
    const lowered = query.trim().toLowerCase();
    const results: MedicalSearchResult[] = [];

    // Search appointments
    const appointments = prepareAll<MedicalAppointmentRow>(this.db,
      `SELECT * FROM medical_appointments
       WHERE lower(provider) LIKE ? OR lower(COALESCE(specialty, '')) LIKE ? OR lower(redacted_summary) LIKE ?
       ORDER BY date DESC
       LIMIT ?`,
    )(`%${lowered}%`, `%${lowered}%`, `%${lowered}%`, limit);

    for (const row of appointments) {
      results.push({
        recordId: row.id,
        recordType: 'appointment',
        date: row.date,
        redactedSummary: row.redacted_summary || `${row.provider} — ${row.specialty ?? 'general'}`,
        score: this.scoreMatch(
          [row.provider, row.specialty, row.redacted_summary],
          lowered,
        ),
      });
    }

    // Search medications
    const medications = prepareAll<MedicalMedicationRow>(this.db,
      `SELECT * FROM medical_medications
       WHERE lower(name) LIKE ? OR lower(COALESCE(prescriber, '')) LIKE ? OR lower(redacted_summary) LIKE ?
       ORDER BY name ASC
       LIMIT ?`,
    )(`%${lowered}%`, `%${lowered}%`, `%${lowered}%`, limit);

    for (const row of medications) {
      results.push({
        recordId: row.id,
        recordType: 'medication',
        date: row.start_date,
        redactedSummary: row.redacted_summary || `${row.name} — ${row.dosage ?? ''}`,
        score: this.scoreMatch(
          [row.name, row.prescriber, row.redacted_summary],
          lowered,
        ),
      });
    }

    // Search documents
    const documents = prepareAll<MedicalDocumentRow>(this.db,
      `SELECT * FROM medical_documents
       WHERE lower(file_name) LIKE ? OR lower(redacted_summary) LIKE ?
       ORDER BY file_name ASC
       LIMIT ?`,
    )(`%${lowered}%`, `%${lowered}%`, limit);

    for (const row of documents) {
      results.push({
        recordId: row.id,
        recordType: 'document',
        date: null,
        redactedSummary: row.redacted_summary || row.file_name,
        score: this.scoreMatch(
          [row.file_name, row.redacted_summary],
          lowered,
        ),
      });
    }

    // Sort by score descending and take top results
    results.sort((left, right) => right.score - left.score);
    return { query, results: results.slice(0, limit) };
  }

  private scoreMatch(fields: (string | null)[], query: string): number {
    let best = 0;
    for (const field of fields) {
      if (!field) continue;
      const lower = field.toLowerCase();
      if (lower === query) {
        best = Math.max(best, 100);
      } else if (lower.startsWith(query)) {
        best = Math.max(best, 80);
      } else if (lower.includes(query)) {
        best = Math.max(best, 60);
      }
    }
    return best || 50;
  }
}
