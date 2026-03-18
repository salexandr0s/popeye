import type { TemporalConstraint } from '@popeye/contracts';

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(23, 59, 59, 999);
  return d;
}

function toIso(date: Date): string {
  return date.toISOString();
}

export function parseTemporalConstraint(query: string, now = new Date()): TemporalConstraint | null {
  const normalized = query.toLowerCase();

  if (/\byesterday\b/.test(normalized)) {
    const day = new Date(now);
    day.setUTCDate(day.getUTCDate() - 1);
    return { label: 'yesterday', from: toIso(startOfDay(day)), to: toIso(endOfDay(day)) };
  }

  if (/\btoday\b/.test(normalized)) {
    return { label: 'today', from: toIso(startOfDay(now)), to: toIso(endOfDay(now)) };
  }

  if (/\bthis week\b/.test(normalized)) {
    const start = startOfDay(now);
    const day = start.getUTCDay() || 7;
    start.setUTCDate(start.getUTCDate() - day + 1);
    return { label: 'this week', from: toIso(start), to: toIso(endOfDay(now)) };
  }

  if (/\blast week\b/.test(normalized)) {
    const end = startOfDay(now);
    const day = end.getUTCDay() || 7;
    end.setUTCDate(end.getUTCDate() - day);
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - 6);
    return { label: 'last week', from: toIso(startOfDay(start)), to: toIso(endOfDay(end)) };
  }

  if (/\bthis month\b/.test(normalized)) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
    return { label: 'this month', from: toIso(start), to: toIso(endOfDay(now)) };
  }

  if (/\blast month\b/.test(normalized)) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1, 0, 0, 0, 0));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0, 23, 59, 59, 999));
    return { label: 'last month', from: toIso(start), to: toIso(end) };
  }

  if (/\b(latest|newest|recent|recently)\b/.test(normalized)) {
    const start = new Date(now);
    start.setUTCDate(start.getUTCDate() - 14);
    return { label: 'recent', from: toIso(start), to: toIso(endOfDay(now)) };
  }

  return null;
}

export function chooseTemporalReference(input: {
  occurredAt?: string | null | undefined;
  validFrom?: string | null | undefined;
  createdAt: string;
}): string {
  return input.occurredAt ?? input.validFrom ?? input.createdAt;
}

export function computeTemporalFit(referenceAt: string | null | undefined, constraint: TemporalConstraint | null | undefined): number {
  if (!referenceAt || !constraint) return 0;
  const reference = new Date(referenceAt).getTime();
  if (Number.isNaN(reference)) return 0;

  const from = constraint.from ? new Date(constraint.from).getTime() : null;
  const to = constraint.to ? new Date(constraint.to).getTime() : null;

  if (from !== null && reference < from) {
    const diffDays = (from - reference) / (1000 * 60 * 60 * 24);
    return Math.max(0, 1 - Math.min(1, diffDays / 30));
  }
  if (to !== null && reference > to) {
    const diffDays = (reference - to) / (1000 * 60 * 60 * 24);
    return Math.max(0, 1 - Math.min(1, diffDays / 30));
  }
  return 1;
}
