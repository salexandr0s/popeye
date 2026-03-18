import type { CapabilityContext, TodoAccountRecord, TodoDigestRecord } from '@popeye/contracts';
import { nowIso } from '@popeye/contracts';

import type { TodoService } from './todo-service.js';

export class TodoDigestService {
  constructor(
    private readonly todoService: TodoService,
    private readonly ctx: CapabilityContext,
  ) {}

  generateDigest(account: TodoAccountRecord, date?: string, workspaceId = 'default'): TodoDigestRecord {
    const targetDate = date ?? nowIso().slice(0, 10);

    const pendingCount = this.todoService.getPendingCount(account.id);
    const overdueCount = this.todoService.getOverdueCount(account.id);
    const completedTodayCount = this.todoService.getCompletedTodayCount(account.id);

    // Gather detail lists
    const overdueItems = this.todoService.listOverdue(account.id);
    const dueTodayItems = this.todoService.listDueToday(account.id);
    const highPriority1 = this.todoService.getByPriority(account.id, 1);
    const highPriority2 = this.todoService.getByPriority(account.id, 2);
    const highPriorityItems = [...highPriority1, ...highPriority2];

    // Build markdown
    const sections: string[] = [];
    sections.push(`# Todo Digest — ${targetDate}`);
    sections.push(`**Account:** ${account.displayName}`);
    sections.push('');
    sections.push('## Summary');
    sections.push(`- **Pending:** ${pendingCount}`);
    sections.push(`- **Overdue:** ${overdueCount}`);
    sections.push(`- **Completed today:** ${completedTodayCount}`);

    if (overdueItems.length > 0) {
      sections.push('');
      sections.push('## Overdue');
      for (const item of overdueItems.slice(0, 10)) {
        const prio = item.priority <= 2 ? ` [P${item.priority}]` : '';
        sections.push(`- **${item.title}** (due ${item.dueDate})${prio}`);
      }
    }

    if (dueTodayItems.length > 0) {
      sections.push('');
      sections.push('## Due Today');
      for (const item of dueTodayItems.slice(0, 10)) {
        const prio = item.priority <= 2 ? ` [P${item.priority}]` : '';
        const time = item.dueTime ? ` at ${item.dueTime}` : '';
        sections.push(`- **${item.title}**${time}${prio}`);
      }
    }

    if (highPriorityItems.length > 0) {
      sections.push('');
      sections.push('## High Priority');
      for (const item of highPriorityItems.slice(0, 10)) {
        const due = item.dueDate ? ` (due ${item.dueDate})` : '';
        sections.push(`- **${item.title}** [P${item.priority}]${due}`);
      }
    }

    const summaryMarkdown = sections.join('\n');

    const digest = this.todoService.insertDigest({
      accountId: account.id,
      workspaceId,
      date: targetDate,
      pendingCount,
      overdueCount,
      completedTodayCount,
      summaryMarkdown,
    });

    // Store in memory as episodic
    this.ctx.memoryInsert({
      description: `Todo digest for ${account.displayName} on ${targetDate}: ${pendingCount} pending, ${overdueCount} overdue, ${completedTodayCount} completed today`,
      classification: 'internal',
      sourceType: 'capability_sync',
      content: summaryMarkdown,
      confidence: 0.7,
      scope: 'workspace',
      memoryType: 'episodic',
      sourceRef: `todos:${account.id}:digest:${targetDate}`,
      sourceRefType: 'todo_digest',
      domain: 'todos',
      contextReleasePolicy: 'summary',
      dedupKey: `todo-digest:${account.id}:${targetDate}`,
    });

    this.ctx.auditCallback({
      eventType: 'todo_digest_generated',
      details: { accountId: account.id, date: targetDate, pendingCount, overdueCount, completedTodayCount },
      severity: 'info',
    });

    return digest;
  }
}
