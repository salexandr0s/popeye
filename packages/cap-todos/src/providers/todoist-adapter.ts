import type { TodoProviderAdapter, NormalizedTodoProject, NormalizedTodoItem } from './adapter-interface.js';

const TODOIST_API_BASE = 'https://api.todoist.com/rest/v2';
const REQUEST_TIMEOUT_MS = 30_000;

interface TodoistProject {
  id: string;
  name: string;
  color: string;
}

interface TodoistTask {
  id: string;
  content: string;
  description: string;
  priority: number;
  is_completed: boolean;
  due: {
    date: string;
    datetime: string | null;
  } | null;
  labels: string[];
  project_id: string;
  parent_id: string | null;
  created_at: string;
}

export class TodoistAdapter implements TodoProviderAdapter {
  private readonly apiToken: string;

  constructor(config: { apiToken: string }) {
    this.apiToken = config.apiToken;
  }

  async getProjects(): Promise<NormalizedTodoProject[]> {
    const projects = await this.todoistFetch<TodoistProject[]>('/projects', 'GET');
    return projects.map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
    }));
  }

  async listItems(opts?: { since?: string }): Promise<NormalizedTodoItem[]> {
    const _opts = opts; // acknowledge parameter for future use
    void _opts;
    const tasks = await this.todoistFetch<TodoistTask[]>('/tasks', 'GET');
    return tasks.map((t) => this.mapTask(t));
  }

  async createItem(input: {
    title: string;
    description?: string;
    priority?: number;
    dueDate?: string;
    dueTime?: string;
    labels?: string[];
    projectName?: string;
  }): Promise<NormalizedTodoItem> {
    const body: Record<string, unknown> = {
      content: input.title,
    };
    if (input.description) body['description'] = input.description;
    if (input.priority) body['priority'] = input.priority;
    if (input.dueDate) {
      body['due_date'] = input.dueDate;
      if (input.dueTime) body['due_datetime'] = `${input.dueDate}T${input.dueTime}`;
    }
    if (input.labels) body['labels'] = input.labels;

    const task = await this.todoistFetch<TodoistTask>('/tasks', 'POST', body);
    return this.mapTask(task);
  }

  async updateItem(externalId: string, input: {
    title?: string;
    description?: string;
    priority?: number;
    status?: string;
    dueDate?: string;
    labels?: string[];
  }): Promise<NormalizedTodoItem> {
    const body: Record<string, unknown> = {};
    if (input.title) body['content'] = input.title;
    if (input.description !== undefined) body['description'] = input.description;
    if (input.priority) body['priority'] = input.priority;
    if (input.dueDate !== undefined) body['due_date'] = input.dueDate;
    if (input.labels) body['labels'] = input.labels;

    const task = await this.todoistFetch<TodoistTask>(`/tasks/${encodeURIComponent(externalId)}`, 'POST', body);
    return this.mapTask(task);
  }

  async completeItem(externalId: string): Promise<void> {
    await this.todoistFetch<unknown>(`/tasks/${encodeURIComponent(externalId)}/close`, 'POST');
  }

  private mapTask(task: TodoistTask): NormalizedTodoItem {
    return {
      id: task.id,
      title: task.content,
      description: task.description,
      priority: task.priority,
      status: task.is_completed ? 'completed' : 'pending',
      dueDate: task.due?.date ?? null,
      dueTime: task.due?.datetime ? task.due.datetime.slice(11, 16) : null,
      labels: task.labels,
      projectId: task.project_id ?? null,
      projectName: null, // Resolved by sync service using projectId → project name mapping
      parentId: task.parent_id,
      createdAt: task.created_at,
      updatedAt: null,
    };
  }

  private async todoistFetch<T>(path: string, method: string, body?: Record<string, unknown>): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const headers: Record<string, string> = {
        'Authorization': `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
      };

      const init: RequestInit = {
        method,
        headers,
        signal: controller.signal,
      };
      if (body) {
        init.body = JSON.stringify(body);
      }

      const response = await fetch(`${TODOIST_API_BASE}${path}`, init);

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Todoist API error ${response.status}: ${text}`);
      }

      // Some endpoints (like close) return 204 No Content
      if (response.status === 204) {
        return undefined as unknown as T;
      }

      const json: unknown = await response.json();
      return json as T;
    } finally {
      clearTimeout(timeout);
    }
  }
}
