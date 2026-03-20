import type { CapabilityContext, MedicalDigestRecord } from '@popeye/contracts';
import { nowIso } from '@popeye/contracts';

import type { MedicalService } from './medical-service.js';

export class MedicalDigestService {
  constructor(
    private readonly medicalService: MedicalService,
    private readonly ctx: CapabilityContext,
  ) {}

  generateDigest(period?: string): MedicalDigestRecord {
    const targetPeriod = period ?? nowIso().slice(0, 7); // YYYY-MM

    const appointmentCount = this.medicalService.getAppointmentCount();
    const activeMedications = this.medicalService.getActiveMedicationCount();

    // Gather recent appointments for the digest
    const appointments = this.medicalService.listAppointments(undefined, { limit: 10 });
    const medications = this.medicalService.listMedications();

    // Build markdown summary
    const sections: string[] = [];
    sections.push(`# Medical Digest — ${targetPeriod}`);
    sections.push('');
    sections.push('## Summary');
    sections.push(`- **Total appointments:** ${appointmentCount}`);
    sections.push(`- **Active medications:** ${activeMedications}`);

    if (appointments.length > 0) {
      sections.push('');
      sections.push('## Recent Appointments');
      for (const appt of appointments.slice(0, 10)) {
        const specialty = appt.specialty ? ` (${appt.specialty})` : '';
        sections.push(`- **${appt.date}** — ${appt.provider}${specialty}`);
      }
    }

    if (medications.length > 0) {
      const active = medications.filter((med) =>
        !med.endDate || med.endDate >= nowIso().slice(0, 10),
      );
      if (active.length > 0) {
        sections.push('');
        sections.push('## Active Medications');
        for (const med of active.slice(0, 10)) {
          const dosage = med.dosage ? ` — ${med.dosage}` : '';
          const freq = med.frequency ? ` (${med.frequency})` : '';
          sections.push(`- **${med.name}**${dosage}${freq}`);
        }
      }
    }

    const summary = sections.join('\n');

    const digest = this.medicalService.insertDigest({
      period: targetPeriod,
      appointmentCount,
      activeMedications,
      summary,
    });

    // Store in memory as episodic
    this.ctx.memoryInsert({
      description: `Medical digest for ${targetPeriod}: ${appointmentCount} appointments, ${activeMedications} active medications`,
      classification: 'sensitive',
      sourceType: 'capability_sync',
      content: summary,
      confidence: 0.7,
      scope: 'workspace',
      memoryType: 'episodic',
      sourceRef: `medical:digest:${targetPeriod}`,
      sourceRefType: 'medical_digest',
      domain: 'medical',
      contextReleasePolicy: 'summary',
      dedupKey: `medical-digest:${targetPeriod}`,
    });

    this.ctx.auditCallback({
      eventType: 'medical_digest_generated',
      details: { period: targetPeriod, appointmentCount, activeMedications },
      severity: 'info',
    });

    return digest;
  }
}
