/**
 * Counts calls to outside services (AI companies, book search, GitHub, brokers) per day, and
 * keeps the latest rate-limit headers they send, for the usage page. Recording never throws
 * and never delays the call it describes.
 */
import { dbDate, kstDate, prisma } from '../db';

export type Outcome = 'ok' | 'error' | 'limited';

/** Only these headers are kept: they say how much of a rate limit is left. */
const LIMIT_HEADER = /ratelimit|retry-after/i;

export function limitHeaders(h: Headers | Record<string, string | null | undefined> | null | undefined): Record<string, string> | null {
  if (!h) return null;
  const out: Record<string, string> = {};
  const entries: [string, string | null | undefined][] = typeof (h as Headers).forEach === 'function' && typeof (h as Headers).get === 'function' ? [...(h as Headers).entries()] : Object.entries(h);
  for (const [k, v] of entries) if (v && LIMIT_HEADER.test(k)) out[k.toLowerCase()] = String(v);
  return Object.keys(out).length ? out : null;
}

/** HTTP status → outcome */
export const outcomeOf = (status: number): Outcome => (status === 429 ? 'limited' : status >= 400 ? 'error' : 'ok');

async function write(userId: string, service: string, outcome: Outcome, headers: Record<string, string> | null, countCall: boolean) {
  const day = dbDate(kstDate());
  const inc = { calls: countCall ? 1 : 0, errors: outcome === 'error' ? 1 : 0, limited: outcome === 'limited' ? 1 : 0 };
  await prisma.apiUsage.upsert({
    where: { userId_service_day: { userId, service, day } },
    create: { userId, service, day, ...inc },
    update: { calls: { increment: inc.calls }, errors: { increment: inc.errors }, limited: { increment: inc.limited }, lastAt: new Date() },
  });
  if (headers) {
    await prisma.apiLimit.upsert({ where: { userId_service: { userId, service } }, create: { userId, service, headers }, update: { headers, at: new Date() } });
  }
}

/**
 * Record one call. `userId` null for calls not made for a particular user. `headers` are the
 * response headers (rate-limit ones are kept).
 */
export function noteCall(userId: string | null, service: string, outcome: Outcome, headers?: Headers | Record<string, string | null | undefined> | null) {
  write(userId ?? '', service, outcome, limitHeaders(headers), true).catch((e) => console.error('[api-usage]', service, e instanceof Error ? e.message : e));
}

/** A call already counted turned out to be refused for its rate (an error code in the body). */
export function noteLimited(userId: string | null, service: string) {
  write(userId ?? '', service, 'limited', null, false).catch((e) => console.error('[api-usage]', service, e instanceof Error ? e.message : e));
}
