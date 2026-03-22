import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

import type { CommandContext } from '../formatters.js';
import { getFlagValue } from '../formatters.js';

export async function handleMedical(ctx: CommandContext): Promise<void> {
  const { client, subcommand, arg1, jsonFlag } = ctx;

  if (subcommand === 'imports') {
    const imports = await client.listMedicalImports();
    if (jsonFlag) {
      console.info(JSON.stringify(imports, null, 2));
    } else if (imports.length === 0) {
      console.info('No medical imports found.');
    } else {
      for (const imp of imports) {
        console.info(`  ${imp.id.slice(0, 8)}  ${imp.fileName.padEnd(30)} ${imp.status.padEnd(12)} ${imp.importType}`);
      }
    }
    return;
  }

  if (subcommand === 'appointments') {
    const limit = getFlagValue('--limit');
    const apptOpts: { limit?: number } = {};
    if (limit) apptOpts.limit = Number(limit);
    const appointments = await client.listMedicalAppointments(apptOpts);
    if (jsonFlag) {
      console.info(JSON.stringify(appointments, null, 2));
    } else if (appointments.length === 0) {
      console.info('No appointments found.');
    } else {
      for (const appt of appointments) {
        console.info(`  ${appt.date}  ${appt.provider.padEnd(20)}${appt.specialty ? ` [${appt.specialty}]` : ''}${appt.location ? ` @ ${appt.location}` : ''}`);
      }
    }
    return;
  }

  if (subcommand === 'medications') {
    const medications = await client.listMedicalMedications();
    if (jsonFlag) {
      console.info(JSON.stringify(medications, null, 2));
    } else if (medications.length === 0) {
      console.info('No medications found.');
    } else {
      for (const med of medications) {
        console.info(`  ${med.name.padEnd(25)} ${med.dosage ?? ''}${med.frequency ? ` · ${med.frequency}` : ''}${med.prescriber ? ` (${med.prescriber})` : ''}`);
      }
    }
    return;
  }

  if (subcommand === 'search' && arg1) {
    const result = await client.searchMedical(arg1);
    if (jsonFlag) {
      console.info(JSON.stringify(result, null, 2));
    } else if (result.results.length === 0) {
      console.info('No results found.');
    } else {
      for (const item of result.results) {
        console.info(`  [${item.recordType}] ${item.redactedSummary.slice(0, 50)}${item.date ? ` (${item.date})` : ''}`);
      }
    }
    return;
  }

  if (subcommand === 'digest') {
    const digest = await client.getMedicalDigest();
    if (jsonFlag) {
      console.info(JSON.stringify(digest, null, 2));
    } else if (!digest) {
      console.info('No medical digest available.');
    } else {
      console.info(`Period: ${digest.period}`);
      console.info(`Appointments: ${digest.appointmentCount}`);
      console.info(`Active medications: ${digest.activeMedications}`);
      if (digest.summary) {
        console.info(`Summary: ${digest.summary}`);
      }
    }
    return;
  }

  if (subcommand === 'import' && arg1) {
    const filePath = resolve(arg1);
    if (!existsSync(filePath)) {
      console.error(`File not found: ${filePath}`);
      process.exitCode = 1;
      return;
    }
    const fileName = filePath.split('/').pop() ?? arg1;
    const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
    const importType = (ext === 'pdf' ? 'pdf' : ext === 'document' ? 'document' : 'other') as 'pdf' | 'document' | 'other';

    const vaultId = getFlagValue('--vault');
    let resolvedVaultId = vaultId;
    if (!resolvedVaultId) {
      const vaults = await client.listVaults('medical');
      if (vaults.length === 0) {
        console.error('No medical vaults found. Create one first: pop vaults create medical <name>');
        process.exitCode = 1;
        return;
      }
      resolvedVaultId = vaults[0]!.id;
    }
    const imp = await client.createMedicalImport({ vaultId: resolvedVaultId, importType, fileName });
    console.info(`Import created: ${imp.id.slice(0, 8)} (${importType})`);
    console.info('Add appointments/medications via API or web inspector.');
    return;
  }
}
