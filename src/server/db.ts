import { PrismaClient } from '@prisma/client';
import { Dec } from '@/domain/decimal';

const g = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = g.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') g.prisma = prisma;

/** Prisma Decimal (or anything with toString) -> Dec. */
export function dec(v: { toString(): string } | string | number | null | undefined, fallback = Dec.ZERO): Dec {
  if (v === null || v === undefined) return fallback;
  return Dec.of(typeof v === 'number' ? v : v.toString());
}

/** Dec -> string Prisma accepts for Decimal columns. */
export function out(v: Dec): string {
  return v.toString();
}

const KST_OFFSET_MS = 9 * 3_600_000;

/** Korean business date (YYYY-MM-DD) of an instant. */
export function kstDate(d: Date = new Date()): string {
  return new Date(d.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** ISO string whose date part is the KST date, for the ledger's date bucketing. */
export function kstIso(d: Date): string {
  return new Date(d.getTime() + KST_OFFSET_MS).toISOString();
}

/** YYYY-MM-DD -> Date at UTC midnight (for @db.Date columns). */
export function dbDate(date: string): Date {
  return new Date(date + 'T00:00:00Z');
}

/** Parse a datetime-local input ("2026-10-07T09:30") as KST. */
export function parseKstLocal(value: string): Date {
  const m = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2}))?/.exec(value);
  if (!m) throw new Error('잘못된 날짜 형식입니다.');
  const [, date, hh = '12', mm = '00'] = m;
  return new Date(Date.parse(`${date}T${hh}:${mm}:00+09:00`));
}
