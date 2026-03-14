import { randomBytes } from 'node:crypto';

export const WEB_BOOTSTRAP_TTL_MS = 60_000;
export const MAX_WEB_BOOTSTRAP_NONCES = 64;

export type WebBootstrapNonceConsumeResult = 'accepted' | 'expired' | 'invalid';

export class WebBootstrapNonceStore {
  private readonly nonces = new Map<string, number>();

  constructor(
    private readonly ttlMs = WEB_BOOTSTRAP_TTL_MS,
    private readonly now: () => number = () => Date.now(),
  ) {}

  issue(): string {
    this.prune();
    if (this.nonces.size >= MAX_WEB_BOOTSTRAP_NONCES) {
      const oldest = this.nonces.keys().next().value;
      if (oldest) this.nonces.delete(oldest);
    }
    const nonce = randomBytes(32).toString('hex');
    this.nonces.set(nonce, this.now() + this.ttlMs);
    return nonce;
  }

  consume(nonce: string): WebBootstrapNonceConsumeResult {
    const expiresAt = this.nonces.get(nonce);
    if (!expiresAt) {
      this.prune();
      return 'invalid';
    }
    if (expiresAt < this.now()) {
      this.nonces.delete(nonce);
      this.prune();
      return 'expired';
    }
    this.nonces.delete(nonce);
    this.prune();
    return 'accepted';
  }

  size(): number {
    this.prune();
    return this.nonces.size;
  }

  private prune(): void {
    const now = this.now();
    for (const [nonce, expiresAt] of this.nonces.entries()) {
      if (expiresAt < now) {
        this.nonces.delete(nonce);
      }
    }
  }
}
