/**
 * Market data: current quotes, FX, and stored daily closes.
 *
 * Live quotes come from the user's linked brokers, asked in MARKET_DATA_ORDER
 * until each symbol has a price, and are cached in memory for a few seconds so
 * many page loads share one API call. When every broker fails, the last known
 * value is returned with `stale: true`.
 */
import type { Asset } from '@prisma/client';
import { Dec } from '@/domain/decimal';
import { isKrSymbol, usMarketOf } from '@/domain/broker-format';
import { dbDate, dec, kstDate, out, prisma } from './db';
import { BrokerApiError, type InstrumentRef } from './brokers';
import { marketProviders } from './services/brokers';

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

function logFailure(what: string, e: unknown) {
  if (!(e instanceof BrokerApiError)) console.error(`[market] ${what} failed`, e);
}

export function refOf(a: { symbol: string | null; market: string | null }): InstrumentRef {
  const symbol = a.symbol!.toUpperCase();
  return { symbol, market: isKrSymbol(symbol) ? a.market : usMarketOf(a.market) };
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
  const listed = assets.filter((a) => a.priceSource === 'BROKER' && a.symbol);
  const now = Date.now();
  const missing = new Map<string, Asset>();
  for (const a of listed) {
    const s = a.symbol!.toUpperCase();
    const c = quoteCache.get(s);
    if (!c || now - c.fetchedAt > QUOTE_TTL_MS) missing.set(s, a);
  }

  if (missing.size) {
    for (const { adapter } of await marketProviders(userId)) {
      if (!adapter.quotes || !missing.size) continue;
      try {
        const quotes = await adapter.quotes([...missing.values()].map(refOf));
        for (const q of quotes) {
          const s = q.symbol.toUpperCase();
          const asset = missing.get(s);
          if (!asset) continue;
          quoteCache.set(s, { quote: { price: Dec.of(q.price), currency: q.currency, asOf: q.asOf, stale: false }, fetchedAt: now });
          // Remember a US exchange we had to discover, so the next lookup goes straight there.
          if (q.market && !isKrSymbol(s) && usMarketOf(asset.market) !== q.market) {
            await prisma.asset.updateMany({ where: { userId, symbol: asset.symbol }, data: { market: q.market } });
          }
          missing.delete(s);
        }
      } catch (e) {
        logFailure(`${adapter.broker} quotes`, e);
      }
    }
  }

  for (const a of assets) {
    if (a.priceSource === 'BROKER' && a.symbol) {
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
    for (const { adapter } of await marketProviders(userId)) {
      if (!adapter.usdKrw) continue;
      try {
        const r = await adapter.usdKrw();
        if (r && Dec.of(r).isPos()) {
          const rate = Dec.of(r);
          fxCache.set(key, { rate, fetchedAt: Date.now() });
          return rate;
        }
      } catch (e) {
        logFailure(`${adapter.broker} fx`, e);
      }
    }
  }
  const row = await prisma.fxDaily.findFirst({ where: { pair: key }, orderBy: { date: 'desc' } });
  if (row) return dec(row.rate);
  return Dec.of(process.env.FALLBACK_USDKRW ?? '1390');
}

export async function storeClose(symbol: string, date: string, close: Dec, currency: string, source = 'BROKER') {
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
 * Make sure daily closes exist for the given listed assets back to `since`.
 * Asks each linked broker in turn until one answers; safe to call repeatedly (upserts).
 */
export async function backfillCloses(
  userId: string,
  assets: { symbol: string | null; market: string | null; currency: string }[],
  since: string,
): Promise<number> {
  const providers = (await marketProviders(userId)).filter((p) => p.adapter.dailyCloses);
  if (!providers.length) return 0;
  let n = 0;
  const seen = new Set<string>();
  for (const a of assets) {
    if (!a.symbol) continue;
    const ref = refOf(a);
    if (seen.has(ref.symbol)) continue;
    seen.add(ref.symbol);
    const have = await prisma.priceDaily.findFirst({ where: { symbol: ref.symbol }, orderBy: { date: 'asc' }, select: { date: true } });
    // Already covered back to `since`: only refresh the last two weeks.
    const fetchFrom = have && kstDate(have.date) <= since ? kstDate(new Date(Date.now() - 14 * 86_400_000)) : since;
    for (const { adapter } of providers) {
      try {
        const closes = await adapter.dailyCloses!(ref, fetchFrom);
        if (!closes.length) continue;
        for (const c of closes) {
          await storeClose(ref.symbol, c.date, Dec.of(c.close), a.currency, adapter.broker);
          n++;
        }
        break;
      } catch (e) {
        console.error(`[market] ${adapter.broker} closes failed for ${ref.symbol}`, e instanceof Error ? e.message : e);
      }
    }
  }
  return n;
}

/** Record today's USD/KRW rate (called by the daily job). */
export async function recordTodayFx(userId: string): Promise<void> {
  const rate = await fxRate(userId, 'USD');
  await storeFx('USDKRW', kstDate(), rate);
}
