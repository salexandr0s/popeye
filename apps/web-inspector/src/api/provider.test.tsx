// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ApiProvider, useApi } from './provider';
import type { ApiClient } from './provider';

const AUTH_TOKEN = 'test-auth-token-abc123';
const CSRF_TOKEN = 'csrf-token-xyz789';

function TestConsumer({ onApi }: { onApi: (api: ApiClient) => void }) {
  const api = useApi();
  onApi(api);
  return <div>consumer</div>;
}

function ThrowConsumer() {
  try {
    useApi();
    return <div>no error</div>;
  } catch (e) {
    return <div>{(e as Error).message}</div>;
  }
}

describe('ApiProvider', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    (window as unknown as { __POPEYE_AUTH_TOKEN__: string }).__POPEYE_AUTH_TOKEN__ = AUTH_TOKEN;
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('useApi throws when used outside ApiProvider', () => {
    render(<ThrowConsumer />);
    expect(screen.getByText('useApi must be used within ApiProvider')).toBeDefined();
  });

  it('GET requests include Bearer token header', async () => {
    const responseData = { status: 'ok' };
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(responseData),
    });

    let capturedApi: ApiClient | null = null;
    render(
      <ApiProvider>
        <TestConsumer onApi={(api) => { capturedApi = api; }} />
      </ApiProvider>,
    );

    expect(capturedApi).not.toBeNull();
    const result = await capturedApi!.get<{ status: string }>('/v1/status');

    expect(result).toEqual(responseData);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [path, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/v1/status');
    expect((options.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${AUTH_TOKEN}`);
    expect((options.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('POST requests fetch CSRF token first, then send with csrf header', async () => {
    // First call: CSRF token fetch
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ token: CSRF_TOKEN }),
    });
    // Second call: actual POST
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ created: true }),
    });

    let capturedApi: ApiClient | null = null;
    render(
      <ApiProvider>
        <TestConsumer onApi={(api) => { capturedApi = api; }} />
      </ApiProvider>,
    );

    expect(capturedApi).not.toBeNull();
    const result = await capturedApi!.post<{ created: boolean }>('/v1/runs', { task: 'test' });

    expect(result).toEqual({ created: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // First call should be CSRF token fetch
    const [csrfPath, csrfOptions] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(csrfPath).toBe('/v1/security/csrf-token');
    expect((csrfOptions.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${AUTH_TOKEN}`);

    // Second call should be the actual POST with CSRF header
    const [postPath, postOptions] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(postPath).toBe('/v1/runs');
    expect(postOptions.method).toBe('POST');
    expect((postOptions.headers as Record<string, string>)['x-popeye-csrf']).toBe(CSRF_TOKEN);
    expect((postOptions.headers as Record<string, string>)['sec-fetch-site']).toBe('same-origin');
    expect(postOptions.body).toBe(JSON.stringify({ task: 'test' }));
  });

  it('POST caches CSRF token for subsequent requests', async () => {
    // First POST: CSRF fetch + POST
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ token: CSRF_TOKEN }),
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: 1 }),
    });
    // Second POST: only POST (CSRF cached)
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: 2 }),
    });

    let capturedApi: ApiClient | null = null;
    render(
      <ApiProvider>
        <TestConsumer onApi={(api) => { capturedApi = api; }} />
      </ApiProvider>,
    );

    await capturedApi!.post('/v1/runs', { task: 'first' });
    await capturedApi!.post('/v1/runs', { task: 'second' });

    // 3 calls total: CSRF fetch + first POST + second POST (no second CSRF fetch)
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('GET throws on non-ok response', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });

    let capturedApi: ApiClient | null = null;
    render(
      <ApiProvider>
        <TestConsumer onApi={(api) => { capturedApi = api; }} />
      </ApiProvider>,
    );

    await expect(capturedApi!.get('/v1/missing')).rejects.toThrow('404 Not Found');
  });
});
