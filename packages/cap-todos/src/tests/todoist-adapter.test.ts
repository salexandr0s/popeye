import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { TodoistAdapter } from '../providers/todoist-adapter.js';

type RequestInit = globalThis.RequestInit;

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const TEST_TOKEN = 'test-todoist-api-token-abc123';

function mockFetchJson(data: unknown, status = 200) {
  mockFetch.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data),
  });
}

function mockFetchNoContent() {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 204,
    json: async () => undefined,
    text: async () => '',
  });
}

function mockFetchError(status: number, body: string) {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    json: async () => ({}),
    text: async () => body,
  });
}

describe('TodoistAdapter', () => {
  let adapter: TodoistAdapter;

  beforeEach(() => {
    adapter = new TodoistAdapter({ apiToken: TEST_TOKEN });
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --- Auth header ---

  it('includes Bearer token in all requests', async () => {
    mockFetchJson([]);
    await adapter.getProjects();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, init] = mockFetch.mock.calls[0]! as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe(`Bearer ${TEST_TOKEN}`);
    expect(headers['Content-Type']).toBe('application/json');
  });

  // --- getProjects ---

  it('getProjects maps API response to NormalizedTodoProject[]', async () => {
    const apiProjects = [
      { id: 'proj-1', name: 'Work', color: 'blue' },
      { id: 'proj-2', name: 'Personal', color: 'red' },
      { id: 'proj-3', name: 'Inbox', color: 'grey' },
    ];

    mockFetchJson(apiProjects);
    const projects = await adapter.getProjects();

    expect(projects.length).toBe(3);
    expect(projects[0]).toEqual({ id: 'proj-1', name: 'Work', color: 'blue' });
    expect(projects[1]).toEqual({ id: 'proj-2', name: 'Personal', color: 'red' });
    expect(projects[2]).toEqual({ id: 'proj-3', name: 'Inbox', color: 'grey' });
  });

  it('getProjects returns empty array when API returns no projects', async () => {
    mockFetchJson([]);
    const projects = await adapter.getProjects();
    expect(projects).toEqual([]);
  });

  // --- listItems ---

  it('listItems maps tasks to NormalizedTodoItem[]', async () => {
    const apiTasks = [
      {
        id: 'task-1',
        content: 'Buy groceries',
        description: 'Milk, eggs, bread',
        priority: 3,
        is_completed: false,
        due: { date: '2025-06-15', datetime: '2025-06-15T09:00:00' },
        labels: ['shopping', 'urgent'],
        project_id: 'proj-1',
        parent_id: null,
        created_at: '2025-06-10T08:00:00Z',
      },
      {
        id: 'task-2',
        content: 'Review PR',
        description: '',
        priority: 1,
        is_completed: true,
        due: null,
        labels: [],
        project_id: 'proj-2',
        parent_id: 'task-1',
        created_at: '2025-06-11T10:00:00Z',
      },
    ];

    mockFetchJson(apiTasks);
    const items = await adapter.listItems();

    expect(items.length).toBe(2);

    const first = items[0]!;
    expect(first.id).toBe('task-1');
    expect(first.title).toBe('Buy groceries');
    expect(first.description).toBe('Milk, eggs, bread');
    expect(first.priority).toBe(3);
    expect(first.status).toBe('pending');
    expect(first.dueDate).toBe('2025-06-15');
    expect(first.dueTime).toBe('09:00');
    expect(first.labels).toEqual(['shopping', 'urgent']);
    expect(first.projectId).toBe('proj-1');
    expect(first.projectName).toBeNull();
    expect(first.parentId).toBeNull();
    expect(first.createdAt).toBe('2025-06-10T08:00:00Z');
    expect(first.updatedAt).toBeNull();

    const second = items[1]!;
    expect(second.id).toBe('task-2');
    expect(second.status).toBe('completed');
    expect(second.dueDate).toBeNull();
    expect(second.dueTime).toBeNull();
    expect(second.parentId).toBe('task-1');
  });

  it('listItems returns empty array when no tasks', async () => {
    mockFetchJson([]);
    const items = await adapter.listItems();
    expect(items).toEqual([]);
  });

  // --- createItem ---

  it('createItem sends correct body and maps response', async () => {
    const createdTask = {
      id: 'task-new',
      content: 'Write tests',
      description: 'Unit tests for adapter',
      priority: 2,
      is_completed: false,
      due: { date: '2025-06-20', datetime: '2025-06-20T14:00:00' },
      labels: ['dev'],
      project_id: 'proj-1',
      parent_id: null,
      created_at: '2025-06-15T12:00:00Z',
    };

    mockFetchJson(createdTask);

    const result = await adapter.createItem({
      title: 'Write tests',
      description: 'Unit tests for adapter',
      priority: 2,
      dueDate: '2025-06-20',
      dueTime: '14:00',
      labels: ['dev'],
    });

    expect(result.id).toBe('task-new');
    expect(result.title).toBe('Write tests');
    expect(result.priority).toBe(2);

    // Verify the request body
    const [url, init] = mockFetch.mock.calls[0]! as [string, RequestInit];
    expect(url).toContain('/tasks');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body['content']).toBe('Write tests');
    expect(body['description']).toBe('Unit tests for adapter');
    expect(body['priority']).toBe(2);
    expect(body['due_date']).toBe('2025-06-20');
    expect(body['due_datetime']).toBe('2025-06-20T14:00');
    expect(body['labels']).toEqual(['dev']);
  });

  it('createItem sends minimal body when only title provided', async () => {
    const createdTask = {
      id: 'task-min',
      content: 'Simple task',
      description: '',
      priority: 1,
      is_completed: false,
      due: null,
      labels: [],
      project_id: 'proj-1',
      parent_id: null,
      created_at: '2025-06-15T12:00:00Z',
    };

    mockFetchJson(createdTask);
    await adapter.createItem({ title: 'Simple task' });

    const [, init] = mockFetch.mock.calls[0]! as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body['content']).toBe('Simple task');
    // Optional fields should not be present
    expect(body['description']).toBeUndefined();
    expect(body['priority']).toBeUndefined();
    expect(body['due_date']).toBeUndefined();
    expect(body['labels']).toBeUndefined();
  });

  // --- completeItem ---

  it('completeItem sends POST to correct URL with encoded ID', async () => {
    mockFetchNoContent();
    await adapter.completeItem('task-123');

    const [url, init] = mockFetch.mock.calls[0]! as [string, RequestInit];
    expect(url).toContain('/tasks/task-123/close');
    expect(init.method).toBe('POST');
  });

  it('completeItem encodes special characters in externalId', async () => {
    mockFetchNoContent();
    await adapter.completeItem('task/with spaces&special');

    const [url] = mockFetch.mock.calls[0]! as [string, RequestInit];
    expect(url).toContain(encodeURIComponent('task/with spaces&special'));
    expect(url).not.toContain('task/with spaces&special');
  });

  // --- updateItem ---

  it('updateItem sends correct body and URL-encodes ID', async () => {
    const updatedTask = {
      id: 'task-42',
      content: 'Updated title',
      description: 'New description',
      priority: 4,
      is_completed: false,
      due: { date: '2025-07-01', datetime: null },
      labels: ['updated'],
      project_id: 'proj-1',
      parent_id: null,
      created_at: '2025-06-10T08:00:00Z',
    };

    mockFetchJson(updatedTask);

    const result = await adapter.updateItem('task-42', {
      title: 'Updated title',
      description: 'New description',
      priority: 4,
      dueDate: '2025-07-01',
      labels: ['updated'],
    });

    expect(result.id).toBe('task-42');
    expect(result.title).toBe('Updated title');

    const [url, init] = mockFetch.mock.calls[0]! as [string, RequestInit];
    expect(url).toContain('/tasks/task-42');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body['content']).toBe('Updated title');
    expect(body['description']).toBe('New description');
    expect(body['priority']).toBe(4);
    expect(body['due_date']).toBe('2025-07-01');
    expect(body['labels']).toEqual(['updated']);
  });

  it('updateItem sends only provided fields', async () => {
    const updatedTask = {
      id: 'task-42',
      content: 'Only title changed',
      description: '',
      priority: 1,
      is_completed: false,
      due: null,
      labels: [],
      project_id: 'proj-1',
      parent_id: null,
      created_at: '2025-06-10T08:00:00Z',
    };

    mockFetchJson(updatedTask);
    await adapter.updateItem('task-42', { title: 'Only title changed' });

    const [, init] = mockFetch.mock.calls[0]! as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body['content']).toBe('Only title changed');
    expect(body['description']).toBeUndefined();
    expect(body['priority']).toBeUndefined();
  });

  // --- Error handling ---

  it('throws on non-2xx response with status and body info', async () => {
    mockFetchError(403, 'Forbidden: invalid token');
    await expect(adapter.getProjects()).rejects.toThrow('Todoist API error 403: Forbidden: invalid token');
  });

  it('throws on 404 response', async () => {
    mockFetchError(404, 'Not found');
    await expect(adapter.listItems()).rejects.toThrow('Todoist API error 404');
  });

  it('throws on 500 response', async () => {
    mockFetchError(500, 'Internal server error');
    await expect(adapter.completeItem('task-1')).rejects.toThrow('Todoist API error 500');
  });

  // --- AbortSignal timeout ---

  it('passes AbortSignal to fetch for timeout', async () => {
    mockFetchJson([]);
    await adapter.getProjects();

    const [, init] = mockFetch.mock.calls[0]! as [string, RequestInit];
    expect(init.signal).toBeDefined();
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  // --- API URL ---

  it('calls correct Todoist API base URL', async () => {
    mockFetchJson([]);
    await adapter.getProjects();

    const [url] = mockFetch.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe('https://api.todoist.com/rest/v2/projects');
  });

  it('calls correct URL for listItems', async () => {
    mockFetchJson([]);
    await adapter.listItems();

    const [url] = mockFetch.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe('https://api.todoist.com/rest/v2/tasks');
  });
});
