import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import {
  AuthRoleStoreSchema,
  AuthRotationRecordSchema,
  AuthStoreFileSchema,
  type AuthRole,
  type AuthRoleStore,
  type AuthRotationRecord,
  type AuthStoreFile,
} from '@popeye/contracts';

export const AUTH_COOKIE_NAME = 'popeye_auth';
export const CSRF_COOKIE_NAME = 'popeye_csrf';

const AUTH_ROLES: AuthRole[] = ['operator', 'service', 'readonly'];

export interface ResolvedBearerPrincipal {
  role: AuthRole;
  record: AuthRotationRecord;
}

export function generateToken(): string {
  return randomBytes(32).toString('hex');
}

function createRotationRecord(now = new Date().toISOString()): AuthRotationRecord {
  return {
    current: {
      token: generateToken(),
      createdAt: now,
    },
  };
}

export function normalizeAuthStore(input: AuthStoreFile): AuthRoleStore {
  if ('roles' in input) {
    return AuthRoleStoreSchema.parse(input);
  }
  return AuthRoleStoreSchema.parse({
    version: 2,
    roles: {
      operator: AuthRotationRecordSchema.parse(input),
    },
  });
}

export function readRoleAuthStore(path: string): AuthRoleStore {
  const raw = AuthStoreFileSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
  return normalizeAuthStore(raw);
}

export function persistRoleAuthStore(path: string, record: AuthRoleStore): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(AuthRoleStoreSchema.parse(record), null, 2), { mode: 0o600 });
}

export function initAuthStore(path: string, role: AuthRole = 'operator'): AuthRotationRecord {
  const now = new Date().toISOString();
  const store = existsSync(path)
    ? readRoleAuthStore(path)
    : AuthRoleStoreSchema.parse({
        version: 2,
        roles: {
          operator: createRotationRecord(now),
        },
      });

  if (!store.roles.operator) {
    store.roles.operator = createRotationRecord(now);
  }
  if (!store.roles[role]) {
    store.roles[role] = role === 'operator' ? store.roles.operator : createRotationRecord(now);
  }

  persistRoleAuthStore(path, store);
  return store.roles[role]!;
}

export function readAuthStore(path: string, role: AuthRole = 'operator'): AuthRotationRecord {
  const store = readRoleAuthStore(path);
  const record = store.roles[role];
  if (!record) {
    throw new Error(`Auth token for role ${role} not found`);
  }
  return record;
}

export function persistAuthStore(path: string, record: AuthRotationRecord, role: AuthRole = 'operator'): void {
  const store = existsSync(path)
    ? readRoleAuthStore(path)
    : AuthRoleStoreSchema.parse({
        version: 2,
        roles: {
          operator: createRotationRecord(),
        },
      });

  if (!store.roles.operator) {
    store.roles.operator = createRotationRecord();
  }
  store.roles[role] = AuthRotationRecordSchema.parse(record);
  if (role === 'operator') {
    store.roles.operator = AuthRotationRecordSchema.parse(record);
  }
  persistRoleAuthStore(path, store);
}

function rotateRecord(record: AuthRotationRecord, overlapHours: number, now = new Date()): AuthRotationRecord {
  const overlapEndsAt = new Date(now.getTime() + overlapHours * 60 * 60 * 1000).toISOString();
  const promoted = record.next && record.overlapEndsAt && now >= new Date(record.overlapEndsAt)
    ? record.next
    : record.current;

  return {
    current: promoted,
    next: {
      token: generateToken(),
      createdAt: now.toISOString(),
    },
    overlapEndsAt,
  };
}

// Security trade-off: default 24h overlap window balances operational continuity
// against token exposure. Callers can pass a shorter overlapHours for tighter rotation.
export function rotateAuthStore(path: string, overlapHours = 24, role: AuthRole = 'operator'): AuthRotationRecord {
  const store = existsSync(path)
    ? readRoleAuthStore(path)
    : AuthRoleStoreSchema.parse({
        version: 2,
        roles: {
          operator: createRotationRecord(),
        },
      });

  if (!store.roles.operator) {
    store.roles.operator = createRotationRecord();
  }

  const existing = store.roles[role];
  if (!existing) {
    const created = createRotationRecord();
    store.roles[role] = created;
    persistRoleAuthStore(path, store);
    return created;
  }

  const updated = rotateRecord(existing, overlapHours);
  store.roles[role] = updated;
  if (role === 'operator') {
    store.roles.operator = updated;
  }
  persistRoleAuthStore(path, store);
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

function extractBearerToken(header: string | undefined): string | null {
  if (!header?.startsWith('Bearer ')) {
    return null;
  }
  const token = header.replace('Bearer ', '').trim();
  return token.length > 0 ? token : null;
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

export function resolveBearerPrincipal(
  header: string | undefined,
  record: AuthRotationRecord | AuthRoleStore,
  now = new Date(),
): ResolvedBearerPrincipal | null {
  const token = extractBearerToken(header);
  if (!token) {
    return null;
  }

  if ('roles' in record) {
    for (const role of AUTH_ROLES) {
      const candidate = record.roles[role];
      if (candidate && validateToken(token, candidate, now)) {
        return { role, record: candidate };
      }
    }
    return null;
  }

  return validateToken(token, record, now)
    ? { role: 'operator', record }
    : null;
}

export function validateBearerToken(
  header: string | undefined,
  record: AuthRotationRecord | AuthRoleStore,
  now = new Date(),
): boolean {
  return resolveBearerPrincipal(header, record, now) !== null;
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
