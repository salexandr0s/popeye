import { readBootstrapNonce } from './bootstrap';

const SESSION_MARKER_KEY = 'popeye_browser_session_seen';
const OPERATOR_TOKEN_REQUIRED_MESSAGE = 'Operator bearer token required to unlock Popeye Inspector';

export interface BrowserUnlockState {
  visible: boolean;
  phase: 'prompt' | 'submitting';
  error: string | null;
}

let browserSessionReady = false;
let browserSessionPromise: Promise<void> | null = null;
let csrfToken: string | null = null;
let unlockState: BrowserUnlockState = {
  visible: false,
  phase: 'prompt',
  error: null,
};
let pendingTokenPromise: Promise<string> | null = null;
let resolvePendingToken: ((token: string) => void) | null = null;
let rejectPendingToken: ((error: Error) => void) | null = null;
const unlockListeners = new Set<(state: BrowserUnlockState) => void>();

function emitUnlockState(): void {
  for (const listener of unlockListeners) {
    listener(unlockState);
  }
}

function setUnlockState(next: BrowserUnlockState): void {
  unlockState = next;
  emitUnlockState();
}

function clearPendingTokenRequest(): void {
  pendingTokenPromise = null;
  resolvePendingToken = null;
  rejectPendingToken = null;
}

function readSessionMarker(): boolean {
  try {
    return globalThis.sessionStorage?.getItem(SESSION_MARKER_KEY) === '1';
  } catch {
    return false;
  }
}

function writeSessionMarker(enabled: boolean): void {
  try {
    if (enabled) {
      globalThis.sessionStorage?.setItem(SESSION_MARKER_KEY, '1');
    } else {
      globalThis.sessionStorage?.removeItem(SESSION_MARKER_KEY);
    }
  } catch {
    // Best-effort only; session reuse still works within the current page.
  }
}

function normalizeOperatorBearerToken(input: string): string {
  return input.replace(/^Bearer\s+/i, '').trim();
}

function mapAuthExchangeFailure(status: number, statusText: string): string {
  if (status === 400) {
    return 'Browser bootstrap nonce expired or was rejected. Refresh the inspector and try again.';
  }
  if (status === 401) {
    return 'Operator bearer token rejected. Check the token and try again.';
  }
  if (status === 403) {
    return 'Only an operator bearer token can unlock the web inspector.';
  }
  if (status >= 500) {
    return 'Popeye daemon is unavailable right now. Check the daemon and try again.';
  }
  return `${status} ${statusText}`;
}

async function waitForOperatorBearerToken(error?: string): Promise<string> {
  if (pendingTokenPromise) {
    if (error !== undefined) {
      setUnlockState({
        visible: true,
        phase: 'prompt',
        error,
      });
    }
    return pendingTokenPromise;
  }

  setUnlockState({
    visible: true,
    phase: 'prompt',
    error: error ?? null,
  });

  pendingTokenPromise = new Promise<string>((resolve, reject) => {
    resolvePendingToken = resolve;
    rejectPendingToken = reject;
  }).finally(() => {
    clearPendingTokenRequest();
  });

  return pendingTokenPromise;
}

async function tryReuseExistingBrowserSession(): Promise<boolean> {
  const response = await fetch('/v1/security/csrf-token', {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
  });
  if (!response.ok) {
    return false;
  }
  const data: { token: string } = await response.json();
  csrfToken = data.token;
  browserSessionReady = true;
  writeSessionMarker(true);
  setUnlockState({ visible: false, phase: 'prompt', error: null });
  return true;
}

export function getBrowserUnlockState(): BrowserUnlockState {
  return unlockState;
}

export function subscribeBrowserUnlockState(listener: (state: BrowserUnlockState) => void): () => void {
  unlockListeners.add(listener);
  listener(unlockState);
  return () => {
    unlockListeners.delete(listener);
  };
}

export function submitBrowserUnlockToken(input: string): void {
  const token = normalizeOperatorBearerToken(input);
  if (!token) {
    setUnlockState({
      visible: true,
      phase: 'prompt',
      error: OPERATOR_TOKEN_REQUIRED_MESSAGE,
    });
    return;
  }
  if (!resolvePendingToken) {
    return;
  }
  setUnlockState({
    visible: true,
    phase: 'submitting',
    error: null,
  });
  resolvePendingToken(token);
}

export function cancelBrowserUnlock(): void {
  const reject = rejectPendingToken;
  clearPendingTokenRequest();
  setUnlockState({
    visible: false,
    phase: 'prompt',
    error: null,
  });
  reject?.(new Error(OPERATOR_TOKEN_REQUIRED_MESSAGE));
}

export function resetBrowserBootstrapForTests(): void {
  browserSessionReady = false;
  browserSessionPromise = null;
  csrfToken = null;
  writeSessionMarker(false);
  clearPendingTokenRequest();
  setUnlockState({
    visible: false,
    phase: 'prompt',
    error: null,
  });
}

export function clearCachedBrowserSessionState(): void {
  browserSessionReady = false;
  browserSessionPromise = null;
  csrfToken = null;
  writeSessionMarker(false);
  clearPendingTokenRequest();
  setUnlockState({
    visible: false,
    phase: 'prompt',
    error: null,
  });
}

export async function ensureBrowserSession(): Promise<void> {
  if (browserSessionReady) {
    return;
  }
  if (browserSessionPromise) {
    return browserSessionPromise;
  }

  browserSessionPromise = (async () => {
    const nonce = readBootstrapNonce();
    if (!nonce) {
      setUnlockState({
        visible: true,
        phase: 'prompt',
        error: 'Missing browser bootstrap nonce.',
      });
      throw new Error('Missing bootstrap nonce');
    }

    if (readSessionMarker()) {
      const reused = await tryReuseExistingBrowserSession();
      if (reused) {
        return;
      }
      writeSessionMarker(false);
    }

    let unlockError: string | undefined;
    while (!browserSessionReady) {
      const token = await waitForOperatorBearerToken(unlockError);
      try {
        const response = await fetch('/v1/auth/exchange', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          credentials: 'same-origin',
          body: JSON.stringify({ nonce }),
        });
        if (!response.ok) {
          unlockError = mapAuthExchangeFailure(response.status, response.statusText);
          setUnlockState({
            visible: true,
            phase: 'prompt',
            error: unlockError,
          });
          continue;
        }

        browserSessionReady = true;
        writeSessionMarker(true);
        setUnlockState({
          visible: false,
          phase: 'prompt',
          error: null,
        });
      } catch (error: unknown) {
        unlockError = error instanceof Error ? error.message : 'Unable to contact the Popeye daemon.';
        setUnlockState({
          visible: true,
          phase: 'prompt',
          error: unlockError,
        });
      }
    }
  })().catch((error: unknown) => {
    browserSessionPromise = null;
    browserSessionReady = false;
    if (error instanceof Error && error.message === OPERATOR_TOKEN_REQUIRED_MESSAGE) {
      throw error;
    }
    throw error;
  });

  return browserSessionPromise;
}

export async function ensureBrowserCsrfToken(): Promise<string> {
  if (csrfToken) {
    return csrfToken;
  }

  await ensureBrowserSession();
  if (csrfToken) {
    return csrfToken;
  }

  const response = await fetch('/v1/security/csrf-token', {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
  });
  if (!response.ok) {
    clearCachedBrowserSessionState();
    throw new Error(`${response.status} ${response.statusText}`);
  }

  const data: { token: string } = await response.json();
  csrfToken = data.token;
  browserSessionReady = true;
  writeSessionMarker(true);
  setUnlockState({
    visible: false,
    phase: 'prompt',
    error: null,
  });
  return csrfToken;
}
