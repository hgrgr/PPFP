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
import { BROKERS } from '@/lib/brokers';
import { kindOf, marketProviders } from './services/brokers';

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
const fxCache = new Map<string, { rate: Dec; fetchedAt: number; source: string }>();

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
      const mine = [...missing.values()].filter((a) => kindOf(a.symbol) === adapter.kind);
      if (!adapter.quotes || !mine.length) continue;
      try {
        const quotes = await adapter.quotes(mine.map(refOf));
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
export interface FxQuote {
  rate: Dec;
  /** When the rate was published or received (ISO instant), null for the built-in fallback */
  asOf: string | null;
  /** Where it came from, for display: "한국투자증권 고시", "저장된 일별 환율", "기본값" */
  source: string;
  /** Source and time for display: "한국투자증권 고시 10-10 13:07", "저장된 일별 환율 10-09" */
  label: string;
}

const kstShort = (ms: number) => new Date(ms + 9 * 3_600_000).toISOString().slice(5, 16).replace('T', ' ');

/** Latest published KRW rate for a currency, with where and when it came from. */
export async function fxQuote(userId: string, currency: string): Promise<FxQuote> {
  if (currency === 'KRW') return { rate: Dec.ONE, asOf: null, source: '원화', label: '원화' };
  const key = `${currency}KRW`;
  const c = fxCache.get(key);
  if (c && Date.now() - c.fetchedAt < FX_TTL_MS) return { rate: c.rate, asOf: new Date(c.fetchedAt).toISOString(), source: c.source, label: `${c.source} ${kstShort(c.fetchedAt)}` };
  if (currency === 'USD') {
    for (const { adapter } of await marketProviders(userId, 'stock')) {
      if (!adapter.usdKrw) continue;
      try {
        const r = await adapter.usdKrw();
        if (r && Dec.of(r).isPos()) {
          const rate = Dec.of(r);
          const source = `${BROKERS[adapter.broker].label} 고시`;
          const fetchedAt = Date.now();
          fxCache.set(key, { rate, fetchedAt, source });
          return { rate, asOf: new Date(fetchedAt).toISOString(), source, label: `${source} ${kstShort(fetchedAt)}` };
        }
      } catch (e) {
        logFailure(`${adapter.broker} fx`, e);
      }
    }
  }
  const row = await prisma.fxDaily.findFirst({ where: { pair: key }, orderBy: { date: 'desc' } });
  if (row) return { rate: dec(row.rate), asOf: row.date.toISOString(), source: '저장된 일별 환율', label: `저장된 일별 환율 ${kstDate(row.date).slice(5)}` };
  return { rate: Dec.of(process.env.FALLBACK_USDKRW ?? '1390'), asOf: null, source: '기본값', label: '기본값 (시세 연결 없음)' };
}

export async function fxRate(userId: string, currency: string): Promise<Dec> {
  return (await fxQuote(userId, currency)).rate;
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
  const all = (await marketProviders(userId)).filter((p) => p.adapter.dailyCloses);
  if (!all.length) return 0;
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
    for (const { adapter } of all.filter((p) => p.adapter.kind === kindOf(ref.symbol))) {
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
