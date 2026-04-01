// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Instructions } from './instructions';

const api = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}));

vi.mock('../api/provider', () => ({
  useApi: () => api,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeExplainResponse() {
  const bundle = {
    id: 'bundle-1',
    sources: [
      {
        precedence: 1,
        type: 'workspace',
        path: 'WORKSPACE.md',
        contentHash: 'abcdef123456',
        content: 'workspace instructions',
      },
    ],
    compiledText: 'compiled instructions',
    bundleHash: 'bundle-hash',
    warnings: ['warn once'],
    createdAt: '2026-03-14T10:00:00.000Z',
  };
  return {
    bundle,
    context: {
      workspaceId: 'alpha',
      projectId: 'proj-1',
      identity: 'default',
    },
    sources: [
      {
        precedence: 1,
        bandOrder: 0,
        type: 'workspace',
        path: 'WORKSPACE.md',
        contentHash: 'abcdef123456',
      },
    ],
  };
}

function makeDiffResponse() {
  return {
    leftContext: {
      workspaceId: 'alpha',
      projectId: 'proj-1',
      identity: 'default',
    },
    rightContext: {
      workspaceId: 'alpha',
      projectId: 'proj-2',
      identity: 'default',
    },
    leftBundleHash: 'left-hash',
    rightBundleHash: 'right-hash',
    compiledTextChanged: true,
    addedSources: [
      {
        precedence: 4,
        bandOrder: 1,
        type: 'context_native',
        path: '.popeye/context/project.md',
        contentHash: 'addedhash1234',
      },
    ],
    removedSources: [],
    reorderedSources: [],
  };
}

function renderInstructions(initialEntry = '/instructions') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/instructions" element={<Instructions />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Instructions', () => {
  beforeEach(() => {
    api.get.mockReset();
    api.post.mockReset();
    api.get.mockResolvedValue(makeExplainResponse());
    api.post.mockResolvedValue(makeDiffResponse());
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('auto-fetches from query params and pre-fills inputs', async () => {
    renderInstructions('/instructions?workspaceId=alpha&projectId=proj-1');

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/v1/instruction-previews/alpha/explain?projectId=proj-1');
    });

    expect(screen.getByLabelText('Workspace ID')).toHaveProperty('value', 'alpha');
    expect(screen.getByLabelText('Project ID')).toHaveProperty('value', 'proj-1');
    expect(await screen.findByText('compiled instructions')).toBeTruthy();
    expect(screen.getByText('warn once')).toBeTruthy();
  });

  it('fetches a preview from typed inputs', async () => {
    renderInstructions();

    fireEvent.change(screen.getByLabelText('Workspace ID'), { target: { value: 'beta' } });
    fireEvent.change(screen.getByLabelText('Project ID'), { target: { value: 'proj-2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/v1/instruction-previews/beta/explain?projectId=proj-2');
    });
  });

  it('shows loading state while fetching', async () => {
    const pending = deferred<ReturnType<typeof makeExplainResponse>>();
    api.get.mockReturnValueOnce(pending.promise);

    renderInstructions('/instructions?workspaceId=alpha');

    expect(await screen.findByRole('button', { name: 'Fetching...' })).toBeTruthy();
    expect(screen.getByText('Loading...')).toBeTruthy();

    pending.resolve(makeExplainResponse());

    expect(await screen.findByText('compiled instructions')).toBeTruthy();
  });

  it('shows an error and clears stale bundle content on failure', async () => {
    api.get
      .mockResolvedValueOnce(makeExplainResponse())
      .mockRejectedValueOnce(new Error('Preview failed'));

    renderInstructions('/instructions?workspaceId=alpha');
    expect(await screen.findByText('compiled instructions')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Workspace ID'), { target: { value: 'gamma' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));

    expect(await screen.findByText('Preview failed')).toBeTruthy();
    expect(screen.queryByText('compiled instructions')).toBeNull();
  });

  it('compares the loaded preview to the current draft context', async () => {
    renderInstructions('/instructions?workspaceId=alpha&projectId=proj-1');
    expect(await screen.findByText('compiled instructions')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Project ID'), { target: { value: 'proj-2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Compare' }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/v1/instruction-previews/diff', {
        left: {
          workspaceId: 'alpha',
          projectId: 'proj-1',
          identity: 'default',
        },
        right: {
          workspaceId: 'alpha',
          projectId: 'proj-2',
        },
      });
    });

    expect(await screen.findByText('Bundle diff')).toBeTruthy();
    expect(screen.getByText('.popeye/context/project.md')).toBeTruthy();
    expect(screen.getByText('Yes')).toBeTruthy();
  });
});
