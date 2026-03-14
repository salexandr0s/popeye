import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { readBootstrapNonce } from './bootstrap';

export interface ApiClient {
  get: <T>(path: string) => Promise<T>;
  post: <T>(path: string, body?: unknown) => Promise<T>;
}

const ApiContext = createContext<ApiClient | null>(null);

export function ApiProvider({ children }: { children: ReactNode }) {
  const client = useMemo(() => {
    let csrfToken: string | null = null;
    let bootstrapped = false;
    let bootstrapPromise: Promise<void> | null = null;

    const baseHeaders = (): Record<string, string> => ({
      'Content-Type': 'application/json',
    });

    const ensureBootstrap = async (): Promise<void> => {
      if (bootstrapped) return;
      if (bootstrapPromise) return bootstrapPromise;
      const nonce = readBootstrapNonce();
      if (!nonce) {
        throw new Error('Missing bootstrap nonce');
      }
      bootstrapPromise = fetch('/v1/auth/exchange', {
        method: 'POST',
        headers: baseHeaders(),
        credentials: 'same-origin',
        body: JSON.stringify({ nonce }),
      }).then(async (res) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        bootstrapped = true;
      }).catch((error: unknown) => {
        bootstrapPromise = null;
        throw error;
      });
      return bootstrapPromise;
    };

    const ensureCsrf = async (): Promise<string> => {
      if (csrfToken) return csrfToken;
      await ensureBootstrap();
      const res = await fetch('/v1/security/csrf-token', {
        headers: baseHeaders(),
        credentials: 'same-origin',
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data: { token: string } = await res.json();
      csrfToken = data.token;
      return csrfToken;
    };

    return {
      get: async <T,>(path: string): Promise<T> => {
        await ensureBootstrap();
        const res = await fetch(path, {
          headers: baseHeaders(),
          credentials: 'same-origin',
        });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return res.json() as Promise<T>;
      },
      post: async <T,>(path: string, body?: unknown): Promise<T> => {
        const csrf = await ensureCsrf();
        const res = await fetch(path, {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            ...baseHeaders(),
            'x-popeye-csrf': csrf,
            'sec-fetch-site': 'same-origin',
          },
          body: body ? JSON.stringify(body) : undefined,
        });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return res.json() as Promise<T>;
      },
    };
  }, []);

  return <ApiContext.Provider value={client}>{children}</ApiContext.Provider>;
}

export function useApi(): ApiClient {
  const ctx = useContext(ApiContext);
  if (!ctx) throw new Error('useApi must be used within ApiProvider');
  return ctx;
}
