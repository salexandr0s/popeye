import { resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

import type { CommandContext } from '../formatters.js';
import { getFlagValue, parseCsvLine, pickLatestVault } from '../formatters.js';

export async function handleFinance(ctx: CommandContext): Promise<void> {
  const { client, subcommand, arg1, jsonFlag } = ctx;

  if (subcommand === 'imports') {
    const imports = await client.listFinanceImports();
    if (jsonFlag) {
      console.info(JSON.stringify(imports, null, 2));
    } else if (imports.length === 0) {
      console.info('No finance imports found.');
    } else {
      for (const imp of imports) {
        console.info(`  ${imp.id.slice(0, 8)}  ${imp.fileName.padEnd(30)} ${imp.status.padEnd(12)} ${imp.importType}  records: ${imp.recordCount}`);
      }
    }
    return;
  }

  if (subcommand === 'transactions') {
    const category = getFlagValue('--category');
    const limit = getFlagValue('--limit');
    const opts: { category?: string; limit?: number } = {};
    if (category) opts.category = category;
    if (limit) opts.limit = Number(limit);
    const transactions = await client.listFinanceTransactions(opts);
    if (jsonFlag) {
      console.info(JSON.stringify(transactions, null, 2));
    } else if (transactions.length === 0) {
      console.info('No transactions found.');
    } else {
      for (const tx of transactions) {
        const sign = tx.amount >= 0 ? '+' : '';
        console.info(`  ${tx.date}  ${sign}${tx.currency} ${tx.amount.toFixed(2).padStart(10)}  ${tx.description.slice(0, 40)}${tx.category ? `  [${tx.category}]` : ''}`);
      }
    }
    return;
  }

  if (subcommand === 'search' && arg1) {
    const result = await client.searchFinance(arg1);
    if (jsonFlag) {
      console.info(JSON.stringify(result, null, 2));
    } else if (result.results.length === 0) {
      console.info('No results found.');
    } else {
      for (const item of result.results) {
        console.info(`  ${item.date}  $${item.amount.toFixed(2).padStart(10)}  ${item.description.slice(0, 40)}`);
      }
    }
    return;
  }

  if (subcommand === 'digest') {
    const period = getFlagValue('--period');
    const digest = await client.getFinanceDigest(period ?? undefined);
    if (jsonFlag) {
      console.info(JSON.stringify(digest, null, 2));
    } else if (!digest) {
      console.info('No finance digest available.');
    } else {
      console.info(`Period: ${digest.period}`);
      console.info(`Income:   $${digest.totalIncome.toFixed(2)}`);
      console.info(`Expenses: $${digest.totalExpenses.toFixed(2)}`);
      if (Object.keys(digest.categoryBreakdown).length > 0) {
        console.info('Categories:');
        for (const [cat, amount] of Object.entries(digest.categoryBreakdown)) {
          console.info(`  ${cat.padEnd(20)} $${amount.toFixed(2)}`);
        }
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
    const importType = (['csv', 'ofx', 'qfx'].includes(ext) ? ext : 'other') as 'csv' | 'ofx' | 'qfx' | 'other';

    let vaultId = getFlagValue('--vault');
    if (!vaultId) {
      const vaults = await client.listVaults('finance');
      const defaultVault = pickLatestVault(vaults);
      if (!defaultVault) {
        console.error('No finance vaults found. Create one first: pop vaults create finance <name>');
        process.exitCode = 1;
        return;
      }
      vaultId = defaultVault.id;
    }

    const imp = await client.createFinanceImport({ vaultId, importType, fileName });
    if (importType === 'csv') {
      const content = readFileSync(filePath, 'utf-8');
      const lines = content.trim().split('\n');
      const header = parseCsvLine(lines[0] ?? '');
      const dateIdx = header.findIndex((h) => /date/i.test(h));
      const descIdx = header.findIndex((h) => /desc|memo|name/i.test(h));
      const amountIdx = header.findIndex((h) => /amount/i.test(h));
      const catIdx = header.findIndex((h) => /category|cat/i.test(h));
      const transactions: Array<{
        date: string;
        description: string;
        amount: number;
        category?: string | null;
      }> = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = parseCsvLine(lines[i]!);
        if (cols.length < 3) continue;
        transactions.push({
          date: cols[dateIdx >= 0 ? dateIdx : 0]?.trim() ?? '',
          description: cols[descIdx >= 0 ? descIdx : 1]?.trim() ?? '',
          amount: parseFloat(cols[amountIdx >= 0 ? amountIdx : 2]?.trim() ?? '0') || 0,
          category: catIdx >= 0 ? (cols[catIdx]?.trim() || null) : null,
        });
      }
      if (transactions.length > 0) {
        await client.insertFinanceTransactionBatch({ importId: imp.id, transactions });
      }
      await client.updateFinanceImportStatus(imp.id, 'completed', transactions.length);
      console.info(`Imported ${transactions.length} transactions from ${fileName}`);
      return;
    }

    console.info(`Import created: ${imp.id.slice(0, 8)} (${importType}). Parse and add transactions via API or web inspector.`);
    return;
  }
}
