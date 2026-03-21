import { z } from 'zod';

// --- Medical Import ---

const MedicalImportTypeSchema = z.enum(['pdf', 'document', 'operator_note']);

const MedicalImportStatusSchema = z.enum(['pending', 'processing', 'completed', 'failed']);

export const MedicalImportRecordSchema = z.object({
  id: z.string(),
  vaultId: z.string(),
  importType: MedicalImportTypeSchema,
  fileName: z.string(),
  status: MedicalImportStatusSchema.default('pending'),
  importedAt: z.string(),
});
export type MedicalImportRecord = z.infer<typeof MedicalImportRecordSchema>;

// --- Medical Appointment ---

export const MedicalAppointmentRecordSchema = z.object({
  id: z.string(),
  importId: z.string(),
  date: z.string(),
  provider: z.string(),
  specialty: z.string().nullable().default(null),
  location: z.string().nullable().default(null),
  redactedSummary: z.string().default(''),
});
export type MedicalAppointmentRecord = z.infer<typeof MedicalAppointmentRecordSchema>;

// --- Medical Medication ---

export const MedicalMedicationRecordSchema = z.object({
  id: z.string(),
  importId: z.string(),
  name: z.string(),
  dosage: z.string().nullable().default(null),
  frequency: z.string().nullable().default(null),
  prescriber: z.string().nullable().default(null),
  startDate: z.string().nullable().default(null),
  endDate: z.string().nullable().default(null),
  redactedSummary: z.string().default(''),
});
export type MedicalMedicationRecord = z.infer<typeof MedicalMedicationRecordSchema>;

// --- Medical Document ---

export const MedicalDocumentRecordSchema = z.object({
  id: z.string(),
  importId: z.string(),
  fileName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  redactedSummary: z.string().default(''),
});
export type MedicalDocumentRecord = z.infer<typeof MedicalDocumentRecordSchema>;

// --- Medical Digest ---

export const MedicalDigestRecordSchema = z.object({
  id: z.string(),
  period: z.string(),
  appointmentCount: z.number().int().nonnegative().default(0),
  activeMedications: z.number().int().nonnegative().default(0),
  summary: z.string().default(''),
  generatedAt: z.string(),
});
export type MedicalDigestRecord = z.infer<typeof MedicalDigestRecordSchema>;

// --- Medical Search ---


export const MedicalSearchResultSchema = z.object({
  recordId: z.string(),
  recordType: z.enum(['appointment', 'medication', 'document']),
  date: z.string().nullable(),
  redactedSummary: z.string(),
  score: z.number(),
});
export type MedicalSearchResult = z.infer<typeof MedicalSearchResultSchema>;

// --- Medical Reminder ---

export const MedicalReminderCandidateSchema = z.object({
  description: z.string(),
  date: z.string().nullable(),
  source: z.string(),
  reminderType: z.enum(['appointment', 'medication_refill', 'follow_up']),
});
