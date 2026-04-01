import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GoogleTasksAdapter } from '../providers/google-tasks-adapter.js';

const mockFetch = vi.fn();

describe('GoogleTasksAdapter', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((handler: Parameters<typeof setTimeout>[0]) => {
      if (typeof handler === 'function') {
        handler();
      }
      return 0 as never;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('lists task lists as normalized projects', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [
          { id: 'list-1', title: 'Inbox' },
          { id: 'list-2', title: 'Work' },
        ],
      }),
    });

    const adapter = new GoogleTasksAdapter({ accessToken: 'test-token' });
    const projects = await adapter.getProjects();

    expect(projects).toEqual([
      { id: 'list-1', name: 'Inbox', color: null },
      { id: 'list-2', name: 'Work', color: null },
    ]);
    expect(String(mockFetch.mock.calls[0]?.[0])).toBe(
      'https://tasks.googleapis.com/tasks/v1/users/@me/lists?maxResults=100',
    );
    expect(mockFetch.mock.calls[0]?.[1]).toMatchObject({
      headers: { Authorization: 'Bearer test-token' },
      method: 'GET',
    });
  });

  it('lists tasks across lists with project mapping and updatedMin cursor', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [
            { id: 'list-1', title: 'Inbox' },
            { id: 'list-2', title: 'Work' },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [
            {
              id: 'task-1',
              title: 'Inbox task',
              notes: 'notes',
              due: '2026-04-01T00:00:00.000Z',
              updated: '2026-04-01T09:00:00.000Z',
              status: 'needsAction',
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [
            {
              id: 'task-2',
              title: 'Ship feature',
              parent: 'task-parent',
              completed: '2026-04-01T10:00:00.000Z',
              status: 'completed',
            },
          ],
        }),
      });

    const adapter = new GoogleTasksAdapter({ accessToken: 'test-token' });
    const items = await adapter.listItems({ since: '2026-04-01T08:00:00.000Z' });

    expect(items).toEqual([
      expect.objectContaining({
        id: 'task-1',
        projectId: 'list-1',
        projectName: 'Inbox',
        dueDate: '2026-04-01',
        priority: 4,
        labels: [],
      }),
      expect.objectContaining({
        id: 'task-2',
        projectId: 'list-2',
        projectName: 'Work',
        parentId: 'task-parent',
        status: 'completed',
      }),
    ]);

    const firstTasksUrl = mockFetch.mock.calls[1]?.[0];
    expect(String(firstTasksUrl)).toContain('/lists/list-1/tasks');
    expect(String(firstTasksUrl)).toContain('updatedMin=2026-04-01T08%3A00%3A00.000Z');
  });

  it('creates missing named task lists on write', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [{ id: 'list-1', title: 'Inbox' }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'list-2',
          title: 'Deep Work',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'task-1',
          title: 'Focus block',
          due: '2026-04-02T00:00:00.000Z',
          status: 'needsAction',
        }),
      });

    const adapter = new GoogleTasksAdapter({ accessToken: 'test-token' });
    const created = await adapter.createItem({
      title: 'Focus block',
      dueDate: '2026-04-02',
      projectName: 'Deep Work',
    });

    expect(created.projectId).toBe('list-2');
    expect(created.projectName).toBe('Deep Work');
    expect(String(mockFetch.mock.calls[1]?.[0])).toContain('/users/@me/lists');
    expect(String(mockFetch.mock.calls[2]?.[0])).toContain('/lists/list-2/tasks');
  });

  it('moves tasks across lists and patches supported fields', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [
            { id: 'list-1', title: 'Inbox' },
            { id: 'list-2', title: 'Work' },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'task-1',
          title: 'Moved task',
          status: 'needsAction',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'task-1',
          title: 'Moved task',
          due: '2026-04-03T00:00:00.000Z',
          updated: '2026-04-01T12:00:00.000Z',
          status: 'needsAction',
        }),
      });

    const adapter = new GoogleTasksAdapter({ accessToken: 'test-token' });
    const updated = await adapter.updateItem({
      externalId: 'task-1',
      projectId: 'list-1',
      projectName: 'Work',
      dueDate: '2026-04-03',
    });

    expect(updated.projectId).toBe('list-2');
    expect(updated.projectName).toBe('Work');
    expect(updated.dueDate).toBe('2026-04-03');
    expect(String(mockFetch.mock.calls[1]?.[0])).toContain('/lists/list-1/tasks/task-1/move');
    expect(String(mockFetch.mock.calls[1]?.[0])).toContain('destinationTasklist=list-2');
    expect(mockFetch.mock.calls[2]?.[1]).toMatchObject({ method: 'PATCH' });
  });

  it('completes tasks through update semantics', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: '@default',
          title: 'My Tasks',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'task-1',
          title: 'Done',
          completed: '2026-04-01T12:00:00.000Z',
          status: 'completed',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: '@default',
          title: 'My Tasks',
        }),
      });

    const adapter = new GoogleTasksAdapter({ accessToken: 'test-token' });
    const completed = await adapter.completeItem({
      externalId: 'task-1',
      projectId: '@default',
    });

    expect(completed.status).toBe('completed');
    expect(completed.projectId).toBe('@default');
    expect(mockFetch.mock.calls[1]?.[1]).toMatchObject({ method: 'PATCH' });
  });

  it('refreshes access tokens after a 401 and retries the request', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'fresh-token' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [{ id: 'list-1', title: 'Inbox' }],
        }),
      });

    const adapter = new GoogleTasksAdapter({
      accessToken: 'expired-token',
      refreshToken: 'refresh-token',
      clientId: 'client-id',
      clientSecret: 'client-secret',
    });

    const projects = await adapter.getProjects();
    expect(projects[0]?.id).toBe('list-1');
    expect(mockFetch.mock.calls[1]?.[0]).toBe('https://oauth2.googleapis.com/token');
    expect(mockFetch.mock.calls[2]?.[1]).toMatchObject({
      headers: { Authorization: 'Bearer fresh-token' },
    });
  });

  it('rejects unsupported Google Tasks writes deterministically', async () => {
    const adapter = new GoogleTasksAdapter({ accessToken: 'test-token' });

    await expect(adapter.createItem({ title: 'P1', priority: 1 })).rejects.toThrow(
      'Google Tasks does not support priority writes',
    );
    await expect(adapter.createItem({ title: 'Timed', dueTime: '10:00' })).rejects.toThrow(
      'Google Tasks does not support due times',
    );
    await expect(adapter.createItem({ title: 'Labeled', labels: ['urgent'] })).rejects.toThrow(
      'Google Tasks does not support labels',
    );
  });
});
