// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ApiProvider, useApi } from './provider';
import type { ApiClient } from './provider';

const BOOTSTRAP_NONCE = 'bootstrap-nonce-abc123';
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
    (window as unknown as { __POPEYE_BOOTSTRAP_NONCE__: string }).__POPEYE_BOOTSTRAP_NONCE__ = BOOTSTRAP_NONCE;
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

  it('GET bootstraps browser auth first and then fetches with same-origin credentials', async () => {
    const responseData = { status: 'ok' };
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    });
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
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [exchangePath, exchangeOptions] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(exchangePath).toBe('/v1/auth/exchange');
    expect(exchangeOptions.method).toBe('POST');
    expect(exchangeOptions.credentials).toBe('same-origin');
    expect(exchangeOptions.body).toBe(JSON.stringify({ nonce: BOOTSTRAP_NONCE }));

    const [path, options] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(path).toBe('/v1/status');
    expect(options.credentials).toBe('same-origin');
    expect(options.headers).toMatchObject({ 'Content-Type': 'application/json' });
    expect((options.headers as Record<string, string>)['Authorization']).toBeUndefined();
  });

  it('POST bootstraps auth, fetches CSRF token, then sends mutation with csrf header', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ token: CSRF_TOKEN }),
    });
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
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const [exchangePath, exchangeOptions] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(exchangePath).toBe('/v1/auth/exchange');
    expect(exchangeOptions.method).toBe('POST');
    expect(exchangeOptions.body).toBe(JSON.stringify({ nonce: BOOTSTRAP_NONCE }));

    const [csrfPath, csrfOptions] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(csrfPath).toBe('/v1/security/csrf-token');
    expect(csrfOptions.credentials).toBe('same-origin');
    expect((csrfOptions.headers as Record<string, string>)['Authorization']).toBeUndefined();

    const [postPath, postOptions] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(postPath).toBe('/v1/runs');
    expect(postOptions.method).toBe('POST');
    expect(postOptions.credentials).toBe('same-origin');
    expect((postOptions.headers as Record<string, string>)['x-popeye-csrf']).toBe(CSRF_TOKEN);
    expect((postOptions.headers as Record<string, string>)['sec-fetch-site']).toBe('same-origin');
    expect(postOptions.body).toBe(JSON.stringify({ task: 'test' }));
  });

  it('POST caches bootstrap and CSRF token for subsequent requests', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ token: CSRF_TOKEN }),
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: 1 }),
    });
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

    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('GET throws on non-ok response', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    });
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
