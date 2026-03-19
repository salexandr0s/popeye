import { useEffect, useState, type FormEvent } from 'react';
import {
  cancelBrowserUnlock,
  submitBrowserUnlockToken,
  type BrowserUnlockState,
} from './browser-session';

export function BrowserUnlockModal({ state }: { state: BrowserUnlockState }) {
  const [token, setToken] = useState('');

  useEffect(() => {
    if (!state.visible) {
      setToken('');
    }
  }, [state.visible]);

  if (!state.visible) {
    return null;
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submitBrowserUnlockToken(token);
  };

  const submitting = state.phase === 'submitting';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-[24px]">
      <div className="w-full max-w-[520px] rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[24px] shadow-[var(--shadow-md)]">
        <div className="space-y-[8px]">
          <h1 className="text-[20px] font-semibold text-[var(--color-fg)]">
            Unlock Popeye Inspector
          </h1>
          <p className="text-[14px] text-[var(--color-fg-muted)]">
            Enter your operator bearer token once to mint an HttpOnly browser session.
            The token is used for the exchange and is not stored in browser storage.
          </p>
        </div>

        <form className="mt-[20px] space-y-[16px]" onSubmit={handleSubmit}>
          <div className="space-y-[8px]">
            <label
              htmlFor="popeye-operator-token"
              className="block text-[12px] font-medium uppercase tracking-wide text-[var(--color-fg-muted)]"
            >
              Operator bearer token
            </label>
            <input
              id="popeye-operator-token"
              type="password"
              autoFocus
              autoComplete="off"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              disabled={submitting}
              className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border-strong)] bg-[var(--color-bg)] px-[12px] py-[10px] text-[14px] text-[var(--color-fg)] outline-none focus:border-[var(--color-accent)]"
              placeholder="op_…"
            />
          </div>

          {state.error ? (
            <div className="rounded-[var(--radius-sm)] border border-[var(--color-danger)]/20 bg-[var(--color-danger)]/5 px-[12px] py-[10px] text-[14px] text-[var(--color-danger)]">
              {state.error}
            </div>
          ) : null}

          <div className="flex items-center justify-between gap-[12px]">
            <p className="text-[12px] text-[var(--color-fg-muted)]">
              You can get the token from your local Popeye auth store or CLI workflow.
            </p>
            <div className="flex gap-[8px]">
              <button
                type="button"
                onClick={() => cancelBrowserUnlock()}
                disabled={submitting}
                className="px-[14px] py-[8px] rounded-[var(--radius-sm)] text-[14px] font-medium text-[var(--color-fg-muted)] hover:bg-[var(--color-fg)]/[0.03] disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-[16px] py-[8px] rounded-[var(--radius-sm)] text-[14px] font-medium bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-70"
              >
                {submitting ? 'Unlocking…' : 'Unlock'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
