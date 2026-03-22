import type { CapabilityContext, CapabilityToolDescriptor } from '@popeye/contracts';
import { authorizeContextRelease } from '@popeye/cap-common';
import { extractRedactionPatterns, redactText } from '@popeye/observability';
import { z } from 'zod';

import type { TodoService } from './todo-service.js';
import type { TodoSearchService } from './todo-search.js';
import type { TodoDigestService } from './todo-digest.js';

type ToolResult = { content: Array<{ type: string; text: string }>; details?: Record<string, unknown> };

export function createTodoTools(
  todoService: TodoService,
  searchService: TodoSearchService,
  digestService: TodoDigestService,
  ctx: CapabilityContext,
  taskContext: { workspaceId: string; runId?: string },
): CapabilityToolDescriptor[] {
  const redactionPatterns = extractRedactionPatterns(ctx.config);

  function redact(text: string): string {
    return redactText(text, redactionPatterns).text;
  }

  return [
    {
      name: 'popeye_todo_list',
      label: 'Popeye Todo List',
      description: 'List pending todos. Filterable by priority, project, and due date.',
      inputSchema: {
        type: 'object',
        properties: {
          accountId: { type: 'string', description: 'Todo account ID (uses first account if omitted)' },
          priority: { type: 'number', description: 'Filter by priority (1=highest, 4=lowest)' },
          projectName: { type: 'string', description: 'Filter by project name' },
          dueDate: { type: 'string', description: 'Filter by due date (YYYY-MM-DD)' },
          limit: { type: 'number', description: 'Maximum results (default 50)' },
        },
        required: [],
        additionalProperties: false,
      },
      execute: async (params: unknown): Promise<ToolResult> => {
        const parsed = z.object({
          accountId: z.string().optional(),
          priority: z.number().int().min(1).max(4).optional(),
          projectName: z.string().optional(),
          dueDate: z.string().optional(),
          limit: z.number().int().positive().max(100).optional(),
        }).parse(params ?? {});

        const accounts = todoService.listAccounts();
        if (accounts.length === 0) {
          return { content: [{ type: 'text', text: 'No todo accounts registered.' }] };
        }

        const account = parsed.accountId
          ? todoService.getAccount(parsed.accountId)
          : accounts[0]!;

        if (!account) {
          return { content: [{ type: 'text', text: 'Todo account not found.' }] };
        }

        const items = todoService.listItems(account.id, {
          status: 'pending',
          priority: parsed.priority,
          projectName: parsed.projectName,
          dueDate: parsed.dueDate,
          limit: parsed.limit ?? 50,
        });

        if (items.length === 0) {
          return { content: [{ type: 'text', text: 'No pending todos found.' }] };
        }

        const lines = items.map((item, i) => {
          const prio = `P${item.priority}`;
          const due = item.dueDate ? ` (due ${item.dueDate})` : '';
          const project = item.projectName ? ` [${item.projectName}]` : '';
          return `${i + 1}. [${prio}] **${redact(item.title)}**${due}${project}`;
        });
        const text = lines.join('\n');

        const release = authorizeContextRelease(ctx, taskContext, {
          domain: 'todos',
          sourceRef: `todos:list:${account.id}`,
          releaseLevel: 'summary',
          tokenEstimate: Math.ceil(text.length / 4),
          resourceType: 'todo_context',
          requestedBy: 'cap-todos',
          payloadPreview: `todo list ${account.id}`,
        });
        if (!release.ok) {
          return { content: [{ type: 'text', text: release.text }] };
        }

        ctx.contextReleaseRecord({
          domain: 'todos',
          sourceRef: `todos:list:${account.id}`,
          releaseLevel: 'summary',
          ...(release.approvalId !== undefined ? { approvalId: release.approvalId } : {}),
          ...(taskContext.runId !== undefined ? { runId: taskContext.runId } : {}),
          tokenEstimate: Math.ceil(text.length / 4),
        });

        return { content: [{ type: 'text', text }], details: { count: items.length } };
      },
    },
    {
      name: 'popeye_todo_search',
      label: 'Popeye Todo Search',
      description: 'Full-text search across todo items by title and description.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query for todo titles and descriptions' },
          accountId: { type: 'string', description: 'Optional: restrict to specific todo account' },
          status: { type: 'string', enum: ['pending', 'completed', 'all'], description: 'Filter by status (default: all)' },
          limit: { type: 'number', description: 'Maximum results (default 20)' },
        },
        required: ['query'],
        additionalProperties: false,
      },
      execute: async (params: unknown): Promise<ToolResult> => {
        const parsed = z.object({
          query: z.string().min(1),
          accountId: z.string().optional(),
          status: z.enum(['pending', 'completed', 'all']).optional(),
          limit: z.number().int().positive().max(100).optional(),
        }).parse(params ?? {});

        const response = searchService.search({
          query: parsed.query,
          accountId: parsed.accountId,
          status: parsed.status,
          limit: parsed.limit ?? 20,
        });

        if (response.results.length === 0) {
          return { content: [{ type: 'text', text: 'No matching todos found.' }] };
        }

        const lines = response.results.map((r, i) => {
          const due = r.dueDate ? ` (due ${r.dueDate})` : '';
          const project = r.projectName ? ` [${r.projectName}]` : '';
          return `${i + 1}. [P${r.priority}] **${redact(r.title)}** — ${r.status}${due}${project}`;
        });
        const text = lines.join('\n');

        const release = authorizeContextRelease(ctx, taskContext, {
          domain: 'todos',
          sourceRef: `todos:search:${parsed.query}`,
          releaseLevel: 'summary',
          tokenEstimate: Math.ceil(text.length / 4),
          resourceType: 'todo_context',
          requestedBy: 'cap-todos',
          payloadPreview: parsed.query,
        });
        if (!release.ok) {
          return { content: [{ type: 'text', text: release.text }] };
        }

        ctx.contextReleaseRecord({
          domain: 'todos',
          sourceRef: `todos:search:${parsed.query}`,
          releaseLevel: 'summary',
          ...(release.approvalId !== undefined ? { approvalId: release.approvalId } : {}),
          ...(taskContext.runId !== undefined ? { runId: taskContext.runId } : {}),
          tokenEstimate: Math.ceil(text.length / 4),
        });

        return { content: [{ type: 'text', text }], details: response };
      },
    },
    {
      name: 'popeye_todo_add',
      label: 'Popeye Todo Add',
      description: 'Create a new todo item. For local accounts, creates directly. For external accounts (Todoist), requires approval.',
      inputSchema: {
        type: 'object',
        properties: {
          accountId: { type: 'string', description: 'Todo account ID (uses first account if omitted)' },
          title: { type: 'string', description: 'Todo title (required)' },
          description: { type: 'string', description: 'Optional description' },
          priority: { type: 'number', description: 'Priority 1-4 (1=highest, default 4)' },
          dueDate: { type: 'string', description: 'Due date (YYYY-MM-DD)' },
          dueTime: { type: 'string', description: 'Due time (HH:MM)' },
          labels: { type: 'array', items: { type: 'string' }, description: 'Labels' },
          projectName: { type: 'string', description: 'Project name' },
        },
        required: ['title'],
        additionalProperties: false,
      },
      execute: async (params: unknown): Promise<ToolResult> => {
        const parsed = z.object({
          accountId: z.string().optional(),
          title: z.string().min(1),
          description: z.string().optional(),
          priority: z.number().int().min(1).max(4).optional(),
          dueDate: z.string().optional(),
          dueTime: z.string().optional(),
          labels: z.array(z.string()).optional(),
          projectName: z.string().optional(),
        }).parse(params ?? {});

        const accounts = todoService.listAccounts();
        if (accounts.length === 0) {
          return { content: [{ type: 'text', text: 'No todo accounts registered.' }] };
        }

        const account = parsed.accountId
          ? todoService.getAccount(parsed.accountId)
          : accounts[0]!;

        if (!account) {
          return { content: [{ type: 'text', text: 'Todo account not found.' }] };
        }

        // For external accounts, require approval
        if (account.providerKind !== 'local') {
          const approval = ctx.actionApprovalRequest({
            scope: 'external_write',
            domain: 'todos',
            actionKind: 'write',
            resourceScope: 'resource',
            resourceType: 'todo',
            resourceId: 'new',
            requestedBy: 'popeye_todo_add',
            ...(taskContext.runId !== undefined ? { runId: taskContext.runId } : {}),
            payloadPreview: `Create todo: "${parsed.title}"`,
          });
          if (approval.status !== 'approved') {
            return { content: [{ type: 'text', text: `Todo creation requires approval for external accounts. Approval status: ${approval.status}` }] };
          }
        }

        const createInput: {
          title: string;
          description?: string;
          priority?: number;
          dueDate?: string;
          dueTime?: string;
          labels?: string[];
          projectName?: string;
        } = { title: parsed.title };
        if (parsed.description !== undefined) createInput.description = parsed.description;
        if (parsed.priority !== undefined) createInput.priority = parsed.priority;
        if (parsed.dueDate !== undefined) createInput.dueDate = parsed.dueDate;
        if (parsed.dueTime !== undefined) createInput.dueTime = parsed.dueTime;
        if (parsed.labels !== undefined) createInput.labels = parsed.labels;
        if (parsed.projectName !== undefined) createInput.projectName = parsed.projectName;

        const item = todoService.createItem(account.id, createInput);

        const prio = `P${item.priority}`;
        const due = item.dueDate ? ` (due ${item.dueDate})` : '';
        return {
          content: [{ type: 'text', text: `Created todo: [${prio}] **${item.title}**${due}` }],
          details: { todoId: item.id },
        };
      },
    },
    {
      name: 'popeye_todo_complete',
      label: 'Popeye Todo Complete',
      description: 'Mark a todo item as completed.',
      inputSchema: {
        type: 'object',
        properties: {
          todoId: { type: 'string', description: 'Todo item ID to complete' },
        },
        required: ['todoId'],
        additionalProperties: false,
      },
      execute: async (params: unknown): Promise<ToolResult> => {
        const parsed = z.object({
          todoId: z.string().min(1),
        }).parse(params ?? {});

        const item = todoService.getItem(parsed.todoId);
        if (!item) {
          return { content: [{ type: 'text', text: 'Todo item not found.' }] };
        }

        const account = todoService.getAccount(item.accountId);
        if (!account) {
          return { content: [{ type: 'text', text: 'Todo account not found.' }] };
        }

        // For external accounts, require approval
        if (account.providerKind !== 'local') {
          const approval = ctx.actionApprovalRequest({
            scope: 'external_write',
            domain: 'todos',
            actionKind: 'write',
            resourceScope: 'resource',
            resourceType: 'todo',
            resourceId: parsed.todoId,
            requestedBy: 'popeye_todo_complete',
            ...(taskContext.runId !== undefined ? { runId: taskContext.runId } : {}),
            payloadPreview: `Complete todo: "${item.title}"`,
          });
          if (approval.status !== 'approved') {
            return { content: [{ type: 'text', text: `Todo completion requires approval for external accounts. Approval status: ${approval.status}` }] };
          }
        }

        const completed = todoService.completeItem(parsed.todoId);
        if (!completed) {
          return { content: [{ type: 'text', text: 'Failed to complete todo.' }] };
        }

        return {
          content: [{ type: 'text', text: `Completed: **${completed.title}**` }],
          details: { todoId: completed.id },
        };
      },
    },
    {
      name: 'popeye_todo_digest',
      label: 'Popeye Todo Digest',
      description: 'Get the latest todo digest or generate one for today. Shows pending, overdue, and high-priority items.',
      inputSchema: {
        type: 'object',
        properties: {
          accountId: { type: 'string', description: 'Todo account ID (uses first account if omitted)' },
          date: { type: 'string', description: 'Date for digest (YYYY-MM-DD, default today)' },
        },
        required: [],
        additionalProperties: false,
      },
      execute: async (params: unknown): Promise<ToolResult> => {
        const parsed = z.object({
          accountId: z.string().optional(),
          date: z.string().optional(),
        }).parse(params ?? {});

        const accounts = todoService.listAccounts();
        if (accounts.length === 0) {
          return { content: [{ type: 'text', text: 'No todo accounts registered.' }] };
        }

        const account = parsed.accountId
          ? todoService.getAccount(parsed.accountId)
          : accounts[0]!;

        if (!account) {
          return { content: [{ type: 'text', text: 'Todo account not found.' }] };
        }

        if (!parsed.date) {
          const latest = todoService.getLatestDigest(account.id);
          if (latest && latest.date === new Date().toISOString().slice(0, 10)) {
            const release = authorizeContextRelease(ctx, taskContext, {
              domain: 'todos',
              sourceRef: `todos:digest:${account.id}`,
              releaseLevel: 'summary',
              tokenEstimate: Math.ceil(latest.summaryMarkdown.length / 4),
              resourceType: 'todo_context',
              requestedBy: 'cap-todos',
              payloadPreview: `todo digest ${account.id}`,
            });
            if (!release.ok) {
              return { content: [{ type: 'text', text: release.text }] };
            }

            ctx.contextReleaseRecord({
              domain: 'todos',
              sourceRef: `todos:digest:${account.id}`,
              releaseLevel: 'summary',
              ...(release.approvalId !== undefined ? { approvalId: release.approvalId } : {}),
              ...(taskContext.runId !== undefined ? { runId: taskContext.runId } : {}),
              tokenEstimate: Math.ceil(latest.summaryMarkdown.length / 4),
            });
            return { content: [{ type: 'text', text: latest.summaryMarkdown }], details: latest };
          }
        }

        const digest = digestService.generateDigest(account, parsed.date);

        const release = authorizeContextRelease(ctx, taskContext, {
          domain: 'todos',
          sourceRef: `todos:digest:${account.id}`,
          releaseLevel: 'summary',
          tokenEstimate: Math.ceil(digest.summaryMarkdown.length / 4),
          resourceType: 'todo_context',
          requestedBy: 'cap-todos',
          payloadPreview: `todo digest ${account.id}`,
        });
        if (!release.ok) {
          return { content: [{ type: 'text', text: release.text }] };
        }

        ctx.contextReleaseRecord({
          domain: 'todos',
          sourceRef: `todos:digest:${account.id}`,
          releaseLevel: 'summary',
          ...(release.approvalId !== undefined ? { approvalId: release.approvalId } : {}),
          ...(taskContext.runId !== undefined ? { runId: taskContext.runId } : {}),
          tokenEstimate: Math.ceil(digest.summaryMarkdown.length / 4),
        });

        return { content: [{ type: 'text', text: digest.summaryMarkdown }], details: digest };
      },
    },
  ];
}
