import type {
  NormalizedTodoItem,
  NormalizedTodoProject,
  TodoProviderAdapter,
} from './adapter-interface.js';

const GOOGLE_TASKS_API_BASE = 'https://tasks.googleapis.com/tasks/v1';
const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DEFAULT_TASK_LIST_ID = '@default';
const MAX_BACKOFF_MS = 32_000;
const MAX_RETRIES = 3;

export interface GoogleTasksAdapterConfig {
  accessToken: string;
  refreshToken?: string | undefined;
  clientId?: string | undefined;
  clientSecret?: string | undefined;
}

interface GoogleTaskList {
  id: string;
  title?: string;
  updated?: string;
}

interface GoogleTaskListListResponse {
  items?: GoogleTaskList[];
  nextPageToken?: string;
}

interface GoogleTask {
  id: string;
  title?: string;
  notes?: string;
  due?: string;
  completed?: string;
  updated?: string;
  status?: 'needsAction' | 'completed';
  deleted?: boolean;
  hidden?: boolean;
  parent?: string;
}

interface GoogleTaskListTasksResponse {
  items?: GoogleTask[];
  nextPageToken?: string;
}

export class GoogleTasksAdapter implements TodoProviderAdapter {
  private accessToken: string;
  private readonly refreshToken: string | undefined;
  private readonly clientId: string | undefined;
  private readonly clientSecret: string | undefined;

  constructor(config: GoogleTasksAdapterConfig) {
    this.accessToken = config.accessToken;
    this.refreshToken = config.refreshToken;
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
  }

  async getProjects(): Promise<NormalizedTodoProject[]> {
    const taskLists = await this.listTaskLists();
    return taskLists.map((taskList) => normalizeTaskList(taskList));
  }

  async getDefaultProject(): Promise<NormalizedTodoProject> {
    const taskList = await this.getDefaultTaskList();
    return normalizeTaskList(taskList);
  }

  async listItems(opts?: { since?: string }): Promise<NormalizedTodoItem[]> {
    const taskLists = await this.listTaskLists();
    const results: NormalizedTodoItem[] = [];

    for (const taskList of taskLists) {
      const tasks = await this.listTasksForTaskList(taskList.id, opts?.since);
      for (const task of tasks) {
        if (task.deleted) {
          continue;
        }
        results.push(normalizeTask(task, taskList.id, taskList.title ?? 'Untitled List'));
      }
    }

    return results;
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
    this.assertSupportedWriteShape({
      priority: input.priority,
      dueTime: input.dueTime,
      labels: input.labels,
    });

    const taskList = await this.resolveTaskListForWrite(input.projectName);
    const task = await this.request<GoogleTask>(`/lists/${encodeURIComponent(taskList.id)}/tasks`, 0, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: input.title,
        ...(input.description !== undefined ? { notes: input.description } : {}),
        ...(input.dueDate !== undefined ? { due: serializeGoogleDueDate(input.dueDate) } : {}),
        status: 'needsAction',
      }),
    });

    return normalizeTask(task, taskList.id, taskList.title ?? 'Untitled List');
  }

  async updateItem(input: {
    externalId: string;
    projectId?: string | null;
    title?: string;
    description?: string;
    priority?: number;
    status?: string;
    dueDate?: string | null;
    dueTime?: string | null;
    labels?: string[];
    projectName?: string | null;
  }): Promise<NormalizedTodoItem> {
    this.assertSupportedWriteShape({
      priority: input.priority,
      dueTime: input.dueTime ?? undefined,
      labels: input.labels,
    });

    const sourceTaskListId = input.projectId?.trim() || (await this.getDefaultTaskList()).id;
    let targetTaskList = input.projectName !== undefined
      ? await this.resolveTaskListForWrite(input.projectName ?? undefined)
      : await this.getTaskList(sourceTaskListId);
    let currentTaskListId = sourceTaskListId;
    let task: GoogleTask | null = null;

    if (targetTaskList.id !== sourceTaskListId) {
      task = await this.request<GoogleTask>(
        `/lists/${encodeURIComponent(sourceTaskListId)}/tasks/${encodeURIComponent(input.externalId)}/move`,
        0,
        {
          method: 'POST',
          query: { destinationTasklist: targetTaskList.id },
        },
      );
      currentTaskListId = targetTaskList.id;
    }

    const patchBody = buildUpdateBody(input);
    if (Object.keys(patchBody).length > 0) {
      task = await this.request<GoogleTask>(
        `/lists/${encodeURIComponent(currentTaskListId)}/tasks/${encodeURIComponent(input.externalId)}`,
        0,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patchBody),
        },
      );
    }

    if (!task) {
      task = await this.request<GoogleTask>(
        `/lists/${encodeURIComponent(currentTaskListId)}/tasks/${encodeURIComponent(input.externalId)}`,
      );
    }

    if (input.projectName === undefined) {
      targetTaskList = await this.getTaskList(currentTaskListId);
    }

    return normalizeTask(task, currentTaskListId, targetTaskList.title ?? 'Untitled List');
  }

  async completeItem(input: {
    externalId: string;
    projectId?: string | null;
  }): Promise<NormalizedTodoItem> {
    return this.updateItem({
      externalId: input.externalId,
      status: 'completed',
      ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
    });
  }

  private async listTaskLists(): Promise<GoogleTaskList[]> {
    const taskLists: GoogleTaskList[] = [];
    let pageToken: string | undefined;

    do {
      const response = await this.request<GoogleTaskListListResponse>('/users/@me/lists', 0, {
        query: {
          ...(pageToken ? { pageToken } : {}),
          maxResults: '100',
        },
      });
      taskLists.push(...(response.items ?? []));
      pageToken = response.nextPageToken;
    } while (pageToken);

    return taskLists;
  }

  private async getTaskList(taskListId: string): Promise<GoogleTaskList> {
    if (taskListId === DEFAULT_TASK_LIST_ID) {
      return this.getDefaultTaskList();
    }
    return this.request<GoogleTaskList>(`/users/@me/lists/${encodeURIComponent(taskListId)}`);
  }

  private async getDefaultTaskList(): Promise<GoogleTaskList> {
    try {
      return await this.request<GoogleTaskList>(`/users/@me/lists/${encodeURIComponent(DEFAULT_TASK_LIST_ID)}`);
    } catch {
      const taskLists = await this.listTaskLists();
      if (taskLists[0]) {
        return taskLists[0];
      }
      return this.createTaskList('My Tasks');
    }
  }

  private async createTaskList(title: string): Promise<GoogleTaskList> {
    return this.request<GoogleTaskList>('/users/@me/lists', 0, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
  }

  private async resolveTaskListForWrite(projectName?: string): Promise<GoogleTaskList> {
    const trimmed = projectName?.trim();
    if (!trimmed) {
      return this.getDefaultTaskList();
    }

    const taskLists = await this.listTaskLists();
    const existing = taskLists.find((taskList) => taskList.title?.toLowerCase() === trimmed.toLowerCase());
    if (existing) {
      return existing;
    }
    return this.createTaskList(trimmed);
  }

  private async listTasksForTaskList(taskListId: string, since?: string): Promise<GoogleTask[]> {
    const tasks: GoogleTask[] = [];
    let pageToken: string | undefined;

    do {
      const response = await this.request<GoogleTaskListTasksResponse>(
        `/lists/${encodeURIComponent(taskListId)}/tasks`,
        0,
        {
          query: {
            ...(pageToken ? { pageToken } : {}),
            ...(since ? { updatedMin: since } : {}),
            maxResults: '100',
            showCompleted: 'true',
            showDeleted: 'false',
            showHidden: 'true',
          },
        },
      );
      tasks.push(...(response.items ?? []));
      pageToken = response.nextPageToken;
    } while (pageToken);

    return tasks;
  }

  private async request<T>(
    path: string,
    retryCount = 0,
    init: RequestInit & { query?: Record<string, string> } = {},
  ): Promise<T> {
    const url = new URL(`${GOOGLE_TASKS_API_BASE}${path}`);
    const query = init.query ?? {};
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }

    const response = await fetch(url, {
      method: init.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        ...(init.headers as Record<string, string> | undefined),
      },
      ...(init.body !== undefined ? { body: init.body } : {}),
    });

    if (response.status === 401 && retryCount === 0 && this.refreshToken) {
      await this.refreshAccessToken();
      return this.request<T>(path, retryCount + 1, init);
    }

    if (response.status === 429 && retryCount < MAX_RETRIES) {
      const backoff = Math.min(1000 * Math.pow(2, retryCount), MAX_BACKOFF_MS);
      await new Promise((resolve) => setTimeout(resolve, backoff));
      return this.request<T>(path, retryCount + 1, init);
    }

    if (!response.ok) {
      throw new Error(`Google Tasks API error ${response.status}: ${await response.text()}`);
    }

    return response.json() as Promise<T>;
  }

  private async refreshAccessToken(): Promise<void> {
    if (!this.refreshToken || !this.clientId || !this.clientSecret) {
      throw new Error('Cannot refresh Google Tasks token: missing refresh token or client credentials');
    }

    const response = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: this.refreshToken,
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }),
    });

    if (!response.ok) {
      throw new Error(`Google Tasks token refresh failed: ${response.status}`);
    }

    const payload = await response.json() as { access_token: string };
    this.accessToken = payload.access_token;
  }

  private assertSupportedWriteShape(input: {
    priority?: number | undefined;
    dueTime?: string | undefined;
    labels?: string[] | undefined;
  }): void {
    if (input.priority !== undefined && input.priority !== 4) {
      throw new Error('Google Tasks does not support priority writes');
    }
    if (input.dueTime !== undefined && input.dueTime !== null) {
      throw new Error('Google Tasks does not support due times');
    }
    if (input.labels && input.labels.length > 0) {
      throw new Error('Google Tasks does not support labels');
    }
  }
}

function normalizeTaskList(taskList: GoogleTaskList): NormalizedTodoProject {
  return {
    id: taskList.id,
    name: taskList.title ?? 'Untitled List',
    color: null,
  };
}

function normalizeTask(task: GoogleTask, projectId: string, projectName: string): NormalizedTodoItem {
  return {
    id: task.id,
    title: task.title ?? '(untitled task)',
    description: task.notes ?? '',
    priority: 4,
    status: task.status === 'completed' ? 'completed' : 'pending',
    dueDate: task.due ? task.due.slice(0, 10) : null,
    dueTime: null,
    labels: [],
    projectId,
    projectName,
    parentId: task.parent ?? null,
    createdAt: null,
    updatedAt: task.completed ?? task.updated ?? null,
  };
}

function serializeGoogleDueDate(dueDate: string): string {
  return `${dueDate}T00:00:00.000Z`;
}

function buildUpdateBody(input: {
  title?: string;
  description?: string;
  dueDate?: string | null;
  status?: string;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (input.title !== undefined) {
    body['title'] = input.title;
  }
  if (input.description !== undefined) {
    body['notes'] = input.description;
  }
  if (input.dueDate !== undefined) {
    body['due'] = input.dueDate ? serializeGoogleDueDate(input.dueDate) : null;
  }
  if (input.status !== undefined) {
    if (input.status === 'completed') {
      body['status'] = 'completed';
      body['completed'] = new Date().toISOString();
    } else if (input.status === 'pending') {
      body['status'] = 'needsAction';
      body['completed'] = null;
    }
  }
  return body;
}
