import { resolve } from 'node:path';
import { existsSync, statSync } from 'node:fs';

import type { CommandContext } from '../formatters.js';
import { getFlagValue, pickLatestVault } from '../formatters.js';

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
    const period = getFlagValue('--period');
    const generateFlag = process.argv.includes('--generate');
    const digest = generateFlag
      ? await client.generateMedicalDigest(period ?? undefined)
      : await client.getMedicalDigest(period ?? undefined);
    if (jsonFlag) {
      console.info(JSON.stringify(digest, null, 2));
    } else if (!digest) {
      console.info('No medical digest available. Add appointments or medications first, or use --generate.');
    } else {
      if (generateFlag) {
        console.info('Digest generated:');
      }
      console.info(`Period: ${digest.period}`);
      console.info(`Appointments: ${digest.appointmentCount}`);
      console.info(`Active medications: ${digest.activeMedications}`);
      if (digest.summary) {
        console.info(`Summary: ${digest.summary}`);
      }
    }
    return;
  }

  if (subcommand === 'add-appointment') {
    const importId = arg1 ?? getFlagValue('--import');
    const date = getFlagValue('--date');
    const provider = getFlagValue('--provider');
    if (!importId || !date || !provider) {
      console.error('Usage: pop medical add-appointment <importId> --date <YYYY-MM-DD> --provider <name> [--specialty <name>] [--location <place>] [--summary <text>]');
      process.exitCode = 1;
      return;
    }
    const appointment = await client.insertMedicalAppointment({
      importId,
      date,
      provider,
      specialty: getFlagValue('--specialty') ?? null,
      location: getFlagValue('--location') ?? null,
      redactedSummary: getFlagValue('--summary') ?? '',
    });
    if (jsonFlag) {
      console.info(JSON.stringify(appointment, null, 2));
    } else {
      console.info(`Added appointment: ${appointment.provider} on ${appointment.date}`);
    }
    return;
  }

  if (subcommand === 'add-medication') {
    const importId = arg1 ?? getFlagValue('--import');
    const name = ctx.arg2 ?? getFlagValue('--name');
    if (!importId || !name) {
      console.error('Usage: pop medical add-medication <importId> <name> [--dosage <text>] [--frequency <text>] [--prescriber <name>] [--start-date <YYYY-MM-DD>] [--end-date <YYYY-MM-DD>] [--summary <text>]');
      process.exitCode = 1;
      return;
    }
    const medication = await client.insertMedicalMedication({
      importId,
      name,
      dosage: getFlagValue('--dosage') ?? null,
      frequency: getFlagValue('--frequency') ?? null,
      prescriber: getFlagValue('--prescriber') ?? null,
      startDate: getFlagValue('--start-date') ?? null,
      endDate: getFlagValue('--end-date') ?? null,
      redactedSummary: getFlagValue('--summary') ?? '',
    });
    if (jsonFlag) {
      console.info(JSON.stringify(medication, null, 2));
    } else {
      console.info(`Added medication: ${medication.name}`);
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
    const importType = (ext === 'pdf' ? 'pdf' : 'document') as 'pdf' | 'document';
    const sizeBytes = statSync(filePath).size;
    const mimeType = ext === 'pdf' ? 'application/pdf' : 'application/octet-stream';

    const vaultId = getFlagValue('--vault');
    let resolvedVaultId = vaultId;
    if (!resolvedVaultId) {
      const vaults = await client.listVaults('medical');
      const defaultVault = pickLatestVault(vaults);
      if (!defaultVault) {
        console.error('No medical vaults found. Create one first: pop vaults create medical <name>');
        process.exitCode = 1;
        return;
      }
      resolvedVaultId = defaultVault.id;
    }
    const imp = await client.createMedicalImport({ vaultId: resolvedVaultId, importType, fileName });
    await client.insertMedicalDocument({
      importId: imp.id,
      fileName,
      mimeType,
      sizeBytes,
      redactedSummary: `Imported medical document ${fileName}`,
    });
    await client.updateMedicalImportStatus(imp.id, 'completed');
    if (jsonFlag) {
      console.info(JSON.stringify({ importId: imp.id, status: 'completed', importType, fileName }, null, 2));
    } else {
      console.info(`Imported medical document: ${fileName} (${imp.id.slice(0, 8)})`);
      console.info('Add appointments and medications to prove structured retrieval, then run "pop medical digest --generate".');
    }
    return;
  }
}
