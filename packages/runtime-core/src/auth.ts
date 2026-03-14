import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
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
  const updated: AuthRotationRecord = {
    current: existing.current,
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

export function validateRequestToken(
  authorizationHeader: string | undefined,
  cookieHeader: string | string[] | undefined,
  record: AuthRotationRecord,
  now = new Date(),
): boolean {
  if (authorizationHeader !== undefined) {
    return validateBearerToken(authorizationHeader, record, now);
  }
  const token = readCookieValue(cookieHeader, AUTH_COOKIE_NAME);
  if (!token) {
    return false;
  }
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

export function validateAuthCookie(cookieHeader: string | undefined, record: AuthRotationRecord, now = new Date()): boolean {
  const token = readCookieValue(cookieHeader, AUTH_COOKIE_NAME);
  if (!token) {
    return false;
  }
  return validateToken(token, record, now);
}

function hashCsrfSeed(seed: string): string {
  return createHash('sha256').update(seed).digest('hex');
}

// POP-SEC-002: CSRF token is deterministic (derived from auth token + createdAt).
// Accepted risk for the loopback-only model: an attacker who can read the auth
// token already has full API access, so a predictable CSRF derivative adds no
// additional exposure. If the API is ever exposed beyond loopback, this should
// be replaced with a random per-session token.
export function issueCsrfToken(record: AuthRotationRecord): string {
  return hashCsrfSeed(`csrf:${record.current.token}:${record.current.createdAt}`);
}

export function serializeAuthCookie(token: string): string {
  return `${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/`;
}

export function serializeCsrfCookie(token: string): string {
  return `${CSRF_COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/`;
}

export function validateCsrfToken(token: string | undefined, record: AuthRotationRecord): boolean {
  if (!token) {
    return false;
  }
  if (constantTimeEquals(token, issueCsrfToken(record))) {
    return true;
  }
  if (record.next) {
    return constantTimeEquals(token, hashCsrfSeed(`csrf:${record.next.token}:${record.next.createdAt}`));
  }
  return false;
}
