import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { AuthRotationRecordSchema, type AuthRotationRecord } from '@popeye/contracts';

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

export function validateBearerToken(header: string | undefined, record: AuthRotationRecord, now = new Date()): boolean {
  if (!header?.startsWith('Bearer ')) {
    return false;
  }
  const token = header.replace('Bearer ', '').trim();
  if (token === record.current.token) {
    return true;
  }
  if (record.next && record.overlapEndsAt && now <= new Date(record.overlapEndsAt) && token === record.next.token) {
    return true;
  }
  return false;
}

function hashCsrfSeed(seed: string): string {
  return createHash('sha256').update(seed).digest('hex');
}

export function issueCsrfToken(record: AuthRotationRecord): string {
  return hashCsrfSeed(`csrf:${record.current.token}:${record.current.createdAt}`);
}

export function validateCsrfToken(token: string | undefined, record: AuthRotationRecord): boolean {
  if (!token) {
    return false;
  }
  if (token === issueCsrfToken(record)) {
    return true;
  }
  if (record.next) {
    return token === hashCsrfSeed(`csrf:${record.next.token}:${record.next.createdAt}`);
  }
  return false;
}
