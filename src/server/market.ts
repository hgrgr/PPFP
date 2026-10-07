/**
 * Market data: current quotes, FX, and stored daily closes.
 *
 * Live quotes come from the user's own Toss credentials and are cached in
 * memory for a few seconds so many page loads share one API call. When the
 * API fails, the last known value is returned with `stale: true`.
 */
import type { Asset } from '@prisma/client';
import { Dec } from '@/domain/decimal';
import { dbDate, dec, kstDate, out, prisma } from './db';
import { decryptSecret } from './crypto';
import { TossApiError, TossClient } from './toss/client';

const QUOTE_TTL_MS = 10_000;
const FX_TTL_MS = 60_000;

export interface Quote {
  price: Dec;
  currency: string;
  /** When the price was observed (ISO), if known. */
  asOf: string | null;
  stale: boolean;
}

const quoteCache = new Map<string, { quote: Quote; fetchedAt: number }>();
const fxCache = new Map<string, { rate: Dec; fetchedAt: number }>();

export async function tossClientFor(userId: string): Promise<TossClient | null> {
  const cred = await prisma.tossCredential.findUnique({ where: { userId } });
  if (!cred) return null;
  return new TossClient({ clientId: cred.clientId, clientSecret: decryptSecret(cred.secretEncrypted) });
}

async function lastClose(symbol: string): Promise<Quote | null> {
  const row = await prisma.priceDaily.findFirst({ where: { symbol }, orderBy: { date: 'desc' } });
  return row ? { price: dec(row.close), currency: row.currency, asOf: row.date.toISOString(), stale: true } : null;
}

/** Last price from the user's own trades/valuations, for manual assets or as a final fallback. */
async function lastLedgerPrice(assetId: string): Promise<Quote | null> {
  const t = await prisma.transaction.findFirst({
    where: { holding: { assetId }, price: { not: null }, type: { in: ['BUY', 'SELL', 'VALUATION'] } },
    orderBy: { tradeAt: 'desc' },
    select: { price: true, currency: true, tradeAt: true },
  });
  return t?.price ? { price: dec(t.price), currency: t.currency, asOf: t.tradeAt.toISOString(), stale: false } : null;
}

/** Quotes keyed by asset id. Manual assets use their manual price. */
export async function getQuotes(userId: string, assets: Asset[]): Promise<Map<string, Quote>> {
  const result = new Map<string, Quote>();
  const listed = assets.filter((a) => a.priceSource === 'TOSS' && a.symbol);
  const now = Date.now();
  const missing = [...new Set(listed.map((a) => a.symbol!.toUpperCase()))].filter((s) => {
    const c = quoteCache.get(s);
    return !c || now - c.fetchedAt > QUOTE_TTL_MS;
  });

  if (missing.length) {
    try {
      const client = await tossClientFor(userId);
      if (client) {
        const prices = await client.prices(missing);
        for (const p of prices) {
          quoteCache.set(p.symbol.toUpperCase(), {
            quote: { price: Dec.of(p.lastPrice), currency: p.currency, asOf: p.timestamp, stale: false },
            fetchedAt: now,
          });
        }
      }
    } catch (e) {
      if (!(e instanceof TossApiError)) console.error('[market] quote fetch failed', e);
    }
  }

  for (const a of assets) {
    if (a.priceSource === 'TOSS' && a.symbol) {
      const cached = quoteCache.get(a.symbol.toUpperCase());
      const fresh = cached && now - cached.fetchedAt <= QUOTE_TTL_MS * 6;
      const q = fresh ? cached!.quote : cached ? { ...cached.quote, stale: true } : (await lastClose(a.symbol)) ?? (await lastLedgerPrice(a.id));
      if (q) result.set(a.id, q);
    } else {
      const q = a.manualPrice
        ? { price: dec(a.manualPrice), currency: a.currency, asOf: a.manualPriceAt?.toISOString() ?? null, stale: false }
        : await lastLedgerPrice(a.id);
      if (q) result.set(a.id, q);
    }
  }
  return result;
}

/** Base-currency (KRW) units per one unit of `currency`. */
export async function fxRate(userId: string, currency: string): Promise<Dec> {
  if (currency === 'KRW') return Dec.ONE;
  const key = `${currency}KRW`;
  const c = fxCache.get(key);
  if (c && Date.now() - c.fetchedAt < FX_TTL_MS) return c.rate;
  if (currency === 'USD') {
    try {
      const client = await tossClientFor(userId);
      if (client) {
        const r = await client.exchangeRate('USD', 'KRW');
        const rate = Dec.of(r.midRate);
        fxCache.set(key, { rate, fetchedAt: Date.now() });
        return rate;
      }
    } catch (e) {
      if (!(e instanceof TossApiError)) console.error('[market] fx fetch failed', e);
    }
  }
  const row = await prisma.fxDaily.findFirst({ where: { pair: key }, orderBy: { date: 'desc' } });
  if (row) return dec(row.rate);
  return Dec.of(process.env.FALLBACK_USDKRW ?? '1390');
}

export async function storeClose(symbol: string, date: string, close: Dec, currency: string, source = 'TOSS') {
  await prisma.priceDaily.upsert({
    where: { symbol_date: { symbol, date: dbDate(date) } },
    create: { symbol, date: dbDate(date), close: out(close), currency, source },
    update: { close: out(close), currency, source },
  });
}

export async function storeFx(pair: string, date: string, rate: Dec) {
  await prisma.fxDaily.upsert({
    where: { pair_date: { pair, date: dbDate(date) } },
    create: { pair, date: dbDate(date), rate: out(rate) },
    update: { rate: out(rate) },
  });
}

/**
 * Make sure daily closes exist for the user's listed symbols back to `since`.
 * Uses the candles endpoint; safe to call repeatedly (upserts).
 */
export async function backfillCloses(userId: string, symbols: string[], since: string): Promise<number> {
  const client = await tossClientFor(userId);
  if (!client) return 0;
  let n = 0;
  for (const symbol of [...new Set(symbols.map((s) => s.toUpperCase()))]) {
    const have = await prisma.priceDaily.findFirst({ where: { symbol }, orderBy: { date: 'asc' }, select: { date: true } });
    const from = have && kstDate(have.date) <= since ? null : since;
    // Already covered back to `since`: only refresh the last two weeks.
    const fetchFrom = from ?? kstDate(new Date(Date.now() - 14 * 86_400_000));
    try {
      const candles = await client.dailyCandles(symbol, fetchFrom);
      for (const c of candles) {
        await storeClose(symbol, kstDate(new Date(c.timestamp)), Dec.of(c.closePrice), c.currency);
        n++;
      }
    } catch (e) {
      console.error(`[market] candles failed for ${symbol}`, e instanceof Error ? e.message : e);
    }
  }
  return n;
}

/** Record today's USD/KRW mid rate (called by the daily job). */
export async function recordTodayFx(userId: string): Promise<void> {
  const rate = await fxRate(userId, 'USD');
  await storeFx('USDKRW', kstDate(), rate);
}
