import { createContext, useContext, useMemo, type ReactNode } from 'react';

export interface ApiClient {
  get: <T>(path: string) => Promise<T>;
  post: <T>(path: string, body?: unknown) => Promise<T>;
}

const ApiContext = createContext<ApiClient | null>(null);

export function ApiProvider({ children }: { children: ReactNode }) {
  const client = useMemo(() => {
    const token = (window as unknown as { __POPEYE_AUTH_TOKEN__: string })
      .__POPEYE_AUTH_TOKEN__;
    let csrfToken: string | null = null;

    const baseHeaders = (): Record<string, string> => ({
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    });

    const ensureCsrf = async (): Promise<string> => {
      if (csrfToken) return csrfToken;
      const res = await fetch('/v1/security/csrf-token', {
        headers: baseHeaders(),
      });
      const data: { token: string } = await res.json();
      csrfToken = data.token;
      return csrfToken;
    };

    return {
      get: async <T,>(path: string): Promise<T> => {
        const res = await fetch(path, { headers: baseHeaders() });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return res.json() as Promise<T>;
      },
      post: async <T,>(path: string, body?: unknown): Promise<T> => {
        const csrf = await ensureCsrf();
        const res = await fetch(path, {
          method: 'POST',
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
