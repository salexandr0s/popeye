import type { CapabilityContext, FinanceDigestRecord } from '@popeye/contracts';
import { nowIso } from '@popeye/contracts';

import type { FinanceService } from './finance-service.js';

export class FinanceDigestService {
  constructor(
    private readonly financeService: FinanceService,
    private readonly ctx: CapabilityContext,
  ) {}

  generateDigest(period?: string): FinanceDigestRecord {
    const targetPeriod = period ?? nowIso().slice(0, 7); // YYYY-MM default

    // Calculate income vs expenses for the period
    const dateFrom = `${targetPeriod}-01`;
    const dateTo = `${targetPeriod}-31`; // safe upper bound for any month
    const transactions = this.financeService.listTransactions(undefined, {
      dateFrom,
      dateTo,
      limit: 10_000,
    });

    let totalIncome = 0;
    let totalExpenses = 0;
    const categoryTotals: Record<string, number> = {};

    for (const tx of transactions) {
      if (tx.amount >= 0) {
        totalIncome += tx.amount;
      } else {
        totalExpenses += Math.abs(tx.amount);
      }
      const cat = tx.category ?? 'uncategorized';
      categoryTotals[cat] = (categoryTotals[cat] ?? 0) + tx.amount;
    }

    const digest = this.financeService.insertDigest({
      period: targetPeriod,
      totalIncome,
      totalExpenses,
      categoryBreakdown: categoryTotals,
      anomalyFlags: [],
    });

    // Store in memory as episodic
    this.ctx.memoryInsert({
      description: `Finance digest for ${targetPeriod}: income ${totalIncome.toFixed(2)}, expenses ${totalExpenses.toFixed(2)}, ${transactions.length} transactions`,
      classification: 'sensitive',
      sourceType: 'capability_sync',
      content: `Period: ${targetPeriod}\nIncome: ${totalIncome.toFixed(2)}\nExpenses: ${totalExpenses.toFixed(2)}\nTransactions: ${transactions.length}`,
      confidence: 0.7,
      scope: 'workspace',
      memoryType: 'episodic',
      sourceRef: `finance:digest:${targetPeriod}`,
      sourceRefType: 'finance_digest',
      domain: 'finance',
      contextReleasePolicy: 'summary',
      dedupKey: `finance-digest:${targetPeriod}`,
    });

    this.ctx.auditCallback({
      eventType: 'finance_digest_generated',
      details: { period: targetPeriod, totalIncome, totalExpenses, transactionCount: transactions.length },
      severity: 'info',
    });

    return digest;
  }
}
