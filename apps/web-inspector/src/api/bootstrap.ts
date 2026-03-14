export function readBootstrapNonce(): string | undefined {
  if (typeof globalThis.document !== 'undefined') {
    const metaNonce = globalThis.document
      .querySelector('meta[name="popeye-bootstrap-nonce"]')
      ?.getAttribute('content');
    if (metaNonce && metaNonce !== '__POPEYE_BOOTSTRAP_NONCE__') {
      return metaNonce;
    }
  }

  const windowNonce = (
    globalThis.window as unknown as { __POPEYE_BOOTSTRAP_NONCE__?: string } | undefined
  )?.__POPEYE_BOOTSTRAP_NONCE__;

  if (windowNonce && windowNonce !== '__POPEYE_BOOTSTRAP_NONCE__') {
    return windowNonce;
  }

  return undefined;
}
