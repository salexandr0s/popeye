import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { AuthRotationRecordSchema, type AuthRotationRecord } from '@popeye/contracts';

export const AUTH_COOKIE_NAME = 'popeye_auth';
export const CSRF_COOKIE_NAME = 'popeye_csrf';

export function generateToken(): string {
  return randomBytes(32).toString('hex');
}

export function initAuthStore(path: string): AuthRotationRecord {
  const now = new Date().toISOString();
  const record: AuthRotationRecord = {
    current: {
      token: generateToken(),
      createdAt: now,
    },
  };
  persistAuthStore(path, record);
  return record;
}

export function readAuthStore(path: string): AuthRotationRecord {
  return AuthRotationRecordSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

export function persistAuthStore(path: string, record: AuthRotationRecord): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(record, null, 2), { mode: 0o600 });
}

// Security trade-off: default 24h overlap window balances operational continuity
// against token exposure. Callers can pass a shorter overlapHours for tighter rotation.
export function rotateAuthStore(path: string, overlapHours = 24): AuthRotationRecord {
  const existing = readAuthStore(path);
  const now = new Date();
  const overlapEndsAt = new Date(now.getTime() + overlapHours * 60 * 60 * 1000).toISOString();

  // If a previous rotation's overlap has expired, promote next → current
  const promoted = existing.next && existing.overlapEndsAt && now >= new Date(existing.overlapEndsAt)
    ? existing.next
    : existing.current;

  const updated: AuthRotationRecord = {
    current: promoted,
    next: {
      token: generateToken(),
      createdAt: now.toISOString(),
    },
    overlapEndsAt,
  };
  persistAuthStore(path, updated);
  return updated;
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

export function validateBearerToken(header: string | undefined, record: AuthRotationRecord, now = new Date()): boolean {
  if (!header?.startsWith('Bearer ')) {
    return false;
  }
  const token = header.replace('Bearer ', '').trim();
  return validateToken(token, record, now);
}

function validateToken(token: string, record: AuthRotationRecord, now = new Date()): boolean {
  if (constantTimeEquals(token, record.current.token)) {
    return true;
  }
  if (record.next && record.overlapEndsAt && now <= new Date(record.overlapEndsAt) && constantTimeEquals(token, record.next.token)) {
    return true;
  }
  return false;
}

export function readCookieValue(cookieHeader: string | string[] | undefined, name: string): string | undefined {
  const rawHeader = Array.isArray(cookieHeader) ? cookieHeader.join('; ') : cookieHeader;
  if (!rawHeader) {
    return undefined;
  }

  for (const entry of rawHeader.split(';')) {
    const trimmed = entry.trim();
    if (trimmed.length === 0) {
      continue;
    }

    const separator = trimmed.indexOf('=');
    if (separator <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    if (key !== name) {
      continue;
    }

    const value = trimmed.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  return undefined;
}

// POP-SEC-002: Random per-bearer CSRF tokens. A random CSRF token is issued on
// first request and cached in-memory keyed by auth token. No deterministic
// fallback — all CSRF tokens are random.
const bearerCsrfCache = new Map<string, string>();

export function issueCsrfToken(record: AuthRotationRecord): string {
  const key = record.current.token;
  const cached = bearerCsrfCache.get(key);
  if (cached) {
    return cached;
  }
  const token = generateToken();
  bearerCsrfCache.set(key, token);
  return token;
}

export function clearBearerCsrfCache(): void {
  bearerCsrfCache.clear();
}

/**
 * Evict cached CSRF entries for tokens that are no longer valid (post-rotation).
 * Call after overlap window expires.
 */
export function evictStaleBearerCsrfEntries(record: AuthRotationRecord): void {
  const validKeys = new Set([record.current.token]);
  if (record.next) {
    validKeys.add(record.next.token);
  }
  for (const key of bearerCsrfCache.keys()) {
    if (!validKeys.has(key)) {
      bearerCsrfCache.delete(key);
    }
  }
}

export function serializeAuthCookie(token: string, secure?: boolean): string {
  const base = `${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/`;
  return secure ? `${base}; Secure` : base;
}

export function serializeCsrfCookie(token: string, secure?: boolean): string {
  const base = `${CSRF_COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/`;
  return secure ? `${base}; Secure` : base;
}

export function validateCsrfToken(token: string | undefined, record: AuthRotationRecord): boolean {
  if (!token) {
    return false;
  }
  const cachedCurrent = bearerCsrfCache.get(record.current.token);
  if (cachedCurrent && constantTimeEquals(token, cachedCurrent)) {
    return true;
  }
  if (record.next) {
    const cachedNext = bearerCsrfCache.get(record.next.token);
    if (cachedNext && constantTimeEquals(token, cachedNext)) {
      return true;
    }
  }
  return false;
}
