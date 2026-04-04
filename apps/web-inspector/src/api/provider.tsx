import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ensureBrowserCsrfToken,
  ensureBrowserSession,
  getBrowserUnlockState,
  subscribeBrowserUnlockState,
} from './browser-session';
import { BrowserUnlockModal } from './browser-unlock-modal';

export interface ApiClient {
  get: <T>(path: string) => Promise<T>;
  post: <T>(path: string, body?: unknown) => Promise<T>;
  patch: <T>(path: string, body?: unknown) => Promise<T>;
}

interface ApiErrorBody {
  error?: string;
  details?: string;
}

const ApiContext = createContext<ApiClient | null>(null);

export async function readApiErrorMessage(response: Response): Promise<string> {
  const fallback = `${response.status} ${response.statusText}`;

  try {
    const body = await response.clone().json() as ApiErrorBody;
    return body.details ?? body.error ?? fallback;
  } catch {
    return fallback;
  }
}

export function ApiProvider({ children }: { children: ReactNode }) {
  const [unlockState, setUnlockState] = useState(getBrowserUnlockState());

  useEffect(() => subscribeBrowserUnlockState(setUnlockState), []);

  const client = useMemo(() => {
    const baseHeaders = (): Record<string, string> => ({
      'Content-Type': 'application/json',
    });

    return {
      get: async <T,>(path: string): Promise<T> => {
        await ensureBrowserSession();
        const res = await fetch(path, {
          headers: baseHeaders(),
          credentials: 'same-origin',
        });
        if (!res.ok) throw new Error(await readApiErrorMessage(res));
        return res.json() as Promise<T>;
      },
      post: async <T,>(path: string, body?: unknown): Promise<T> => {
        const csrf = await ensureBrowserCsrfToken();
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
        if (!res.ok) throw new Error(await readApiErrorMessage(res));
        return res.json() as Promise<T>;
      },
      patch: async <T,>(path: string, body?: unknown): Promise<T> => {
        const csrf = await ensureBrowserCsrfToken();
        const res = await fetch(path, {
          method: 'PATCH',
          credentials: 'same-origin',
          headers: {
            ...baseHeaders(),
            'x-popeye-csrf': csrf,
            'sec-fetch-site': 'same-origin',
          },
          body: body ? JSON.stringify(body) : undefined,
        });
        if (!res.ok) throw new Error(await readApiErrorMessage(res));
        return res.json() as Promise<T>;
      },
    };
  }, []);

  return (
    <ApiContext.Provider value={client}>
      {children}
      <BrowserUnlockModal state={unlockState} />
    </ApiContext.Provider>
  );
}

export function useApi(): ApiClient {
  const ctx = useContext(ApiContext);
  if (!ctx) throw new Error('useApi must be used within ApiProvider');
  return ctx;
}
