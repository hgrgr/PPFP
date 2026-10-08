/**
 * Live market board: quotes for held and watched stocks, major indices,
 * rankings, intraday bars and orderbooks, polled by the browser every few
 * seconds. Each kind of data is asked of the linked brokers in
 * MARKET_DATA_ORDER until one answers, and cached briefly per symbol so many
 * polls (and tabs) share one upstream call. Market data is the same for every
 * user, so the caches are global; credentials are still the requesting user's.
 */
import { Dec } from '@/domain/decimal';
import { cleanSymbol, isCryptoSymbol, isKrSymbol, usMarketOf } from '@/domain/broker-format';
import { BUILD_FROM, rollUp, type Candle, type CandleUnit } from '@/domain/candles';
import { dbDate, dec, kstDate, prisma } from '../db';
import { fxRate, refOf } from '../market';
import {
  BrokerApiError,
  type IndexCode,
  type IndexQuote,
  type InstrumentRef,
  type MinuteBar,
  type Orderbook,
  type PriceQuote,
  type RankingMarket,
  type RankingRow,
  type RankingType,
} from '../brokers';
import { kindOf, marketProviders, type Provider } from './brokers';
import { UserError } from './portfolios';

const QUOTE_TTL = 3_000;
const INDEX_TTL = 5_000;
const RANKING_TTL = 15_000;
const SPARK_TTL = 5 * 60_000;
const ORDERBOOK_TTL = 2_000;

export const INDEX_LABEL: Record<IndexCode, string> = { KOSPI: '코스피', KOSDAQ: '코스닥', NASDAQ: '나스닥', SP500: 'S&P 500', DOW: '다우존스' };
const INDEX_CODES = Object.keys(INDEX_LABEL) as IndexCode[];

interface Cached<T> {
  value: T;
  at: number;
}
const quoteCache = new Map<string, Cached<PriceQuote>>();
const prevCache = new Map<string, Cached<string | null>>();
const indexCache = new Map<IndexCode, Cached<IndexQuote>>();
const rankingCache = new Map<string, Cached<{ rows: RankingRow[]; source: string } | null>>();
const intradayCache = new Map<string, Cached<MinuteBar[]>>();
const sparkCache = new Map<string, Cached<number[]>>();
const sparkPending = new Set<string>();
const orderbookCache = new Map<string, Cached<Orderbook | null>>();
const candleCache = new Map<string, Cached<{ candles: Candle[]; source: string | null; built: boolean }>>();
const CANDLE_TTL: Record<CandleUnit, number> = { '1m': 10_000, '5m': 20_000, '15m': 30_000, '60m': 60_000, '240m': 120_000, '1d': 300_000, '1w': 600_000 };

/** Providers that can answer for this symbol (stock brokers for stocks, exchanges for coins). */
async function providersFor(userId: string, symbol: string): Promise<Provider[]> {
  return marketProviders(userId, kindOf(symbol));
}

/** Home market's time zone for bucketing bars. */
const zoneOf = (symbol: string) => (isKrSymbol(symbol) || isCryptoSymbol(symbol) ? ('Asia/Seoul' as const) : ('America/New_York' as const));

const fresh = <T>(c: Cached<T> | undefined, ttl: number): boolean => !!c && Date.now() - c.at < ttl;

function quiet(what: string, e: unknown) {
  if (!(e instanceof BrokerApiError)) console.error(`[market-board] ${what}`, e);
}

/** First answer from the brokers that implement `pick`. */
async function firstAnswer<T>(providers: Provider[], pick: (p: Provider) => Promise<T | null | undefined> | null, what: string): Promise<{ value: T; source: string } | null> {
  for (const p of providers) {
    try {
      const call = pick(p);
      if (!call) continue;
      const value = await call;
      if (value !== null && value !== undefined && (!Array.isArray(value) || value.length)) return { value, source: p.conn.broker };
    } catch (e) {
      quiet(`${p.conn.broker} ${what}`, e);
    }
  }
  return null;
}

export interface LiveQuote {
  symbol: string;
  price: string | null;
  prevClose: string | null;
  change: string | null;
  /** fraction, 0.0125 = +1.25% */
  changeRate: string | null;
  volume: string | null;
  currency: string;
  stale: boolean;
}

function changeOf(price: string | null, prev: string | null) {
  if (!price || !prev || !Dec.of(prev).isPos()) return { change: null, changeRate: null };
  const ch = Dec.of(price).sub(prev);
  return { change: ch.toString(), changeRate: ch.div(prev).round(6).toString() };
}

/** Previous close for brokers whose quote omits it: the daily bar before the latest one. */
async function prevCloseFallback(providers: Provider[], ref: InstrumentRef): Promise<string | null> {
  // Re-checked every 30 minutes so a value cached before the open is replaced once today's bar exists.
  const key = ref.symbol;
  const c = prevCache.get(key);
  if (fresh(c, 30 * 60_000)) return c!.value;
  let prev: string | null = null;
  const since = kstDate(new Date(Date.now() - 12 * 86_400_000));
  const r = await firstAnswer(providers, (p) => p.adapter.dailyCloses?.(ref, since) ?? null, 'daily closes');
  if (r) {
    const sorted = [...r.value].sort((a, b) => a.date.localeCompare(b.date));
    prev = sorted.length >= 2 ? sorted[sorted.length - 2].close : null;
  } else {
    // Stored closes from the daily job, for held symbols
    const stored = await prisma.priceDaily.findMany({ where: { symbol: ref.symbol, date: { gte: dbDate(since) } }, orderBy: { date: 'desc' }, take: 2 });
    if (stored.length >= 2) prev = dec(stored[1].close).toString();
  }
  prevCache.set(key, { value: prev, at: Date.now() });
  return prev;
}

/** Live quotes for symbols, 3-second cache. Unknown or failing symbols come back with price null (or stale). */
export async function liveQuotes(userId: string, items: { symbol: string; market: string | null; currency: string }[]): Promise<Map<string, LiveQuote>> {
  const out = new Map<string, LiveQuote>();
  const refs = new Map<string, InstrumentRef>();
  for (const i of items) refs.set(i.symbol.toUpperCase(), refOf(i));
  const missing = [...refs.values()].filter((r) => !fresh(quoteCache.get(r.symbol), QUOTE_TTL));
  let providers: Provider[] | null = null;
  if (missing.length) {
    providers = await marketProviders(userId);
    let left = missing;
    for (const p of providers) {
      const mine = left.filter((r) => kindOf(r.symbol) === p.adapter.kind);
      if (!p.adapter.quotes || !mine.length) continue;
      try {
        const got = await p.adapter.quotes(mine);
        for (const q of got) quoteCache.set(q.symbol.toUpperCase(), { value: q, at: Date.now() });
        const done = new Set(got.map((q) => q.symbol.toUpperCase()));
        left = left.filter((r) => !done.has(r.symbol));
      } catch (e) {
        quiet(`${p.conn.broker} quotes`, e);
      }
    }
  }
  for (const i of items) {
    const s = i.symbol.toUpperCase();
    const c = quoteCache.get(s);
    const q = c?.value;
    let prev = q?.prevClose ?? null;
    if (q && !prev) prev = await prevCloseFallback(await providersFor(userId, s), refs.get(s)!);
    const price = q?.price ?? null;
    out.set(s, {
      symbol: s,
      price,
      prevClose: prev,
      ...changeOf(price, prev),
      volume: q?.volume ?? null,
      currency: q?.currency ?? i.currency,
      stale: !c || Date.now() - c.at > QUOTE_TTL * 10,
    });
  }
  return out;
}

export interface IndexView {
  code: IndexCode;
  label: string;
  price: string;
  change: string | null;
  changeRate: string | null;
}

export async function liveIndices(userId: string): Promise<IndexView[]> {
  const missing = INDEX_CODES.filter((c) => !fresh(indexCache.get(c), INDEX_TTL));
  if (missing.length) {
    let left = missing;
    for (const p of await marketProviders(userId, 'stock')) {
      if (!p.adapter.indices || !left.length) continue;
      try {
        const got = await p.adapter.indices(left);
        for (const q of got) indexCache.set(q.code, { value: q, at: Date.now() });
        left = left.filter((c) => !got.some((q) => q.code === c));
      } catch (e) {
        quiet(`${p.conn.broker} indices`, e);
      }
    }
  }
  return INDEX_CODES.flatMap((code) => {
    const q = indexCache.get(code)?.value;
    return q ? [{ code, label: INDEX_LABEL[code], price: q.price, ...changeOf(q.price, q.prevClose) }] : [];
  });
}

export async function liveFx(userId: string): Promise<{ rate: string; change: string | null; changeRate: string | null }> {
  const rate = (await fxRate(userId, 'USD')).toString();
  const prev = await prisma.fxDaily.findFirst({ where: { pair: 'USDKRW', date: { lt: dbDate(kstDate()) } }, orderBy: { date: 'desc' } });
  return { rate, ...changeOf(rate, prev ? dec(prev.rate).toString() : null) };
}

export interface RankingView {
  rows: (RankingRow & { rank: number })[];
  source: string | null;
}

export async function liveRankings(userId: string, market: RankingMarket, type: RankingType): Promise<RankingView> {
  const key = `${market}:${type}`;
  let c = rankingCache.get(key);
  if (!fresh(c, RANKING_TTL)) {
    const r = await firstAnswer(await marketProviders(userId, market === 'CRYPTO' ? 'crypto' : 'stock'), (p) => p.adapter.rankings?.(market, type) ?? null, `${key} ranking`);
    c = { value: r ? { rows: r.value, source: r.source } : null, at: Date.now() };
    rankingCache.set(key, c);
  }
  const v = c!.value;
  return v ? { rows: v.rows.slice(0, 20).map((row, i) => ({ ...row, rank: i + 1 })), source: v.source } : { rows: [], source: null };
}

async function intradayBars(userId: string, ref: InstrumentRef, ttl: number): Promise<MinuteBar[]> {
  const c = intradayCache.get(ref.symbol);
  if (fresh(c, ttl)) return c!.value;
  const r = await firstAnswer(await providersFor(userId, ref.symbol), (p) => p.adapter.intraday?.(ref) ?? null, 'intraday');
  const bars = r?.value ?? c?.value ?? [];
  intradayCache.set(ref.symbol, { value: bars, at: Date.now() });
  return bars;
}

/** Down-sample a series to at most n points, keeping the last one. */
function thin(values: number[], n: number): number[] {
  if (values.length <= n) return values;
  const step = values.length / n;
  const out: number[] = [];
  for (let i = 0; i < n - 1; i++) out.push(values[Math.floor(i * step)]);
  out.push(values[values.length - 1]);
  return out;
}

/**
 * Mini-chart series for the board. Cached ones return at once; missing ones are
 * fetched in the background (one at a time per symbol) and appear on a later poll.
 */
export async function sparklines(userId: string, items: { symbol: string; market: string | null }[]): Promise<Record<string, number[] | null>> {
  const out: Record<string, number[] | null> = {};
  const todo: InstrumentRef[] = [];
  for (const i of items) {
    const ref = refOf(i);
    const c = sparkCache.get(ref.symbol);
    out[ref.symbol] = c?.value ?? null;
    if (!fresh(c, SPARK_TTL) && !sparkPending.has(ref.symbol)) todo.push(ref);
  }
  if (todo.length) {
    for (const r of todo) sparkPending.add(r.symbol);
    void (async () => {
      for (const ref of todo) {
        try {
          const bars = await intradayBars(userId, ref, SPARK_TTL);
          sparkCache.set(ref.symbol, { value: thin(bars.map((b) => Number(b.close)), 80), at: Date.now() });
        } catch (e) {
          quiet('spark', e);
        } finally {
          sparkPending.delete(ref.symbol);
        }
      }
    })();
  }
  return out;
}

export interface StockDetail {
  symbol: string;
  name: string;
  currency: string;
  market: string | null;
  quote: LiveQuote | null;
  orderbook: Orderbook | null;
  watched: boolean;
  held: boolean;
}

/** Quote and orderbook for the detail panel (its chart loads separately, see liveCandles). */
export async function stockDetail(userId: string, rawSymbol: string): Promise<StockDetail> {
  const symbol = cleanSymbol(rawSymbol);
  if (!symbol) throw new UserError('종목 코드가 올바르지 않습니다.');
  const [asset, watch] = await Promise.all([
    prisma.asset.findUnique({ where: { userId_symbol: { userId, symbol } }, include: { holdings: { select: { id: true }, take: 1 } } }),
    prisma.watchItem.findUnique({ where: { userId_symbol: { userId, symbol } } }),
  ]);
  const currency = asset?.currency ?? watch?.currency ?? (isKrSymbol(symbol) || isCryptoSymbol(symbol) ? 'KRW' : 'USD');
  const market = asset?.market ?? watch?.market ?? null;
  let name = asset?.name ?? watch?.name ?? null;
  const ref = refOf({ symbol, market });
  const quotes = await liveQuotes(userId, [{ symbol, market, currency }]);
  let orderbook = orderbookCache.get(symbol);
  if (!fresh(orderbook, ORDERBOOK_TTL)) {
    const r = await firstAnswer(await providersFor(userId, symbol), (p) => p.adapter.orderbook?.(ref) ?? null, 'orderbook');
    orderbook = { value: r?.value ?? orderbook?.value ?? null, at: Date.now() };
    orderbookCache.set(symbol, orderbook);
  }
  if (!name) {
    const r = await firstAnswer(await providersFor(userId, symbol), (p) => p.adapter.instrument?.(symbol) ?? null, 'instrument');
    name = r?.value.name ?? symbol;
  }
  return {
    symbol,
    name,
    currency,
    market,
    quote: quotes.get(symbol) ?? null,
    orderbook: orderbook!.value,
    watched: !!watch,
    held: !!asset?.holdings.length,
  };
}

export interface BoardRow extends LiveQuote {
  name: string;
  market: string | null;
  watched: boolean;
  /** Held quantity across all portfolios, with KRW value and today's KRW change */
  held: { qty: string; valueKrw: string | null; costKrw: string; todayKrw: string | null } | null;
}

export interface Board {
  at: string;
  indices: IndexView[];
  fx: { rate: string; change: string | null; changeRate: string | null };
  rows: BoardRow[];
  totals: { valueKrw: string; todayKrw: string | null; costKrw: string };
  linked: boolean;
}

/** Held listed stocks and the watchlist, priced live. */
export async function board(userId: string): Promise<Board> {
  const [lots, watch, linked] = await Promise.all([
    prisma.lot.findMany({
      where: { qtyRemaining: { gt: 0 }, holding: { portfolio: { userId }, asset: { priceSource: 'BROKER', symbol: { not: null } } } },
      select: { qtyRemaining: true, unitCost: true, fxRate: true, holding: { select: { asset: { select: { symbol: true, name: true, currency: true, market: true } } } } },
    }),
    prisma.watchItem.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    prisma.brokerConnection.count({ where: { userId } }),
  ]);

  const held = new Map<string, { name: string; currency: string; market: string | null; qty: Dec; cost: Dec }>();
  for (const l of lots) {
    const a = l.holding.asset;
    const s = a.symbol!.toUpperCase();
    const q = dec(l.qtyRemaining);
    const cur = held.get(s) ?? { name: a.name, currency: a.currency, market: a.market, qty: Dec.ZERO, cost: Dec.ZERO };
    cur.qty = cur.qty.add(q);
    cur.cost = cur.cost.add(q.mul(dec(l.unitCost)).mul(dec(l.fxRate)));
    held.set(s, cur);
  }
  const items = new Map<string, { symbol: string; name: string; currency: string; market: string | null }>();
  for (const [s, h] of held) items.set(s, { symbol: s, name: h.name, currency: h.currency, market: h.market });
  for (const w of watch) if (!items.has(w.symbol)) items.set(w.symbol, { symbol: w.symbol, name: w.name, currency: w.currency, market: w.market });
  const watched = new Set(watch.map((w) => w.symbol));

  const [quotes, indices, fx] = await Promise.all([
    items.size && linked ? liveQuotes(userId, [...items.values()]) : Promise.resolve(new Map<string, LiveQuote>()),
    linked ? liveIndices(userId) : Promise.resolve([]),
    liveFx(userId),
  ]);
  const usd = Dec.of(fx.rate);

  let value = Dec.ZERO;
  let today = Dec.ZERO;
  let todayKnown = false;
  let cost = Dec.ZERO;
  const rows: BoardRow[] = [...items.values()].map((it) => {
    const q = quotes.get(it.symbol) ?? { symbol: it.symbol, price: null, prevClose: null, change: null, changeRate: null, volume: null, currency: it.currency, stale: true };
    const h = held.get(it.symbol);
    let heldView: BoardRow['held'] = null;
    if (h) {
      const k = it.currency === 'USD' ? usd : Dec.ONE;
      const v = q.price ? h.qty.mul(q.price).mul(k) : null;
      const t = q.change ? h.qty.mul(q.change).mul(k) : null;
      if (v) value = value.add(v);
      else value = value.add(h.cost);
      if (t) {
        today = today.add(t);
        todayKnown = true;
      }
      cost = cost.add(h.cost);
      heldView = { qty: h.qty.toString(), valueKrw: v?.round(0).toString() ?? null, costKrw: h.cost.round(0).toString(), todayKrw: t?.round(0).toString() ?? null };
    }
    return {
      ...q,
      name: it.name,
      market: it.market ?? (isCryptoSymbol(it.symbol) ? 'CRYPTO' : isKrSymbol(it.symbol) ? 'KRX' : usMarketOf(it.market)),
      watched: watched.has(it.symbol),
      held: heldView,
    };
  });
  // Held first, by value; then the watchlist in the order it was added.
  rows.sort((a, b) => {
    if (!!a.held !== !!b.held) return a.held ? -1 : 1;
    if (a.held && b.held) return Dec.of(b.held.valueKrw ?? b.held.costKrw).cmp(a.held.valueKrw ?? a.held.costKrw);
    return 0;
  });

  return {
    at: new Date().toISOString(),
    indices,
    fx,
    rows,
    totals: { valueKrw: value.round(0).toString(), todayKrw: todayKnown ? today.round(0).toString() : null, costKrw: cost.round(0).toString() },
    linked: linked > 0,
  };
}

export async function addWatch(userId: string, rawSymbol: string) {
  const symbol = cleanSymbol(rawSymbol);
  if (!symbol) throw new UserError('종목 코드는 6자리 코드(국내) 또는 티커(해외)로 입력하세요.');
  if (await prisma.watchItem.findUnique({ where: { userId_symbol: { userId, symbol } } })) throw new UserError('이미 관심종목에 있습니다.');
  if ((await prisma.watchItem.count({ where: { userId } })) >= 100) throw new UserError('관심종목은 100개까지 담을 수 있습니다.');
  const asset = await prisma.asset.findUnique({ where: { userId_symbol: { userId, symbol } } });
  let info = asset ? { name: asset.name, currency: asset.currency, market: asset.market } : null;
  if (!info) {
    const providers = await providersFor(userId, symbol);
    if (!providers.length)
      throw new UserError(isCryptoSymbol(symbol) ? '코인을 추가하려면 먼저 설정에서 코인 거래소 API를 연결하세요.' : '관심종목을 추가하려면 먼저 설정에서 증권사 API를 연결하세요.');
    const r = await firstAnswer(providers, (p) => p.adapter.instrument?.(symbol) ?? null, 'instrument');
    if (r) info = { name: r.value.name, currency: r.value.currency, market: r.value.market };
    else {
      const q = await firstAnswer(providers, (p) => p.adapter.quotes?.([{ symbol, market: null }]) ?? null, 'quote');
      if (!q) throw new UserError(`연결된 증권사에서 '${symbol}' 종목을 찾지 못했습니다.`);
      info = { name: symbol, currency: q.value[0].currency, market: q.value[0].market };
    }
  }
  return prisma.watchItem.create({ data: { userId, symbol, name: info.name.slice(0, 80), currency: info.currency, market: info.market } });
}

export async function removeWatch(userId: string, rawSymbol: string) {
  const symbol = cleanSymbol(rawSymbol);
  if (!symbol) throw new UserError('종목 코드가 올바르지 않습니다.');
  await prisma.watchItem.deleteMany({ where: { userId, symbol } });
}

export interface CandleView {
  unit: CandleUnit;
  candles: { t: string; o: number; h: number; l: number; c: number; v: number | null }[];
  source: string | null;
  /** Built from a finer interval because no linked broker publishes this one */
  built: boolean;
}

/**
 * Candles for the chart. Brokers that publish the interval are asked first; failing that,
 * it is rolled up from the finer interval (1m -> 5m/15m/1h, 1h -> 4h, 1d -> 1w).
 */
export async function liveCandles(userId: string, rawSymbol: string, unit: CandleUnit, count = 120): Promise<CandleView> {
  const symbol = cleanSymbol(rawSymbol);
  if (!symbol) throw new UserError('종목 코드가 올바르지 않습니다.');
  const key = `${symbol}:${unit}`;
  let c = candleCache.get(key);
  if (!fresh(c, CANDLE_TTL[unit])) {
    const [asset, watch] = await Promise.all([
      prisma.asset.findUnique({ where: { userId_symbol: { userId, symbol } }, select: { market: true } }),
      prisma.watchItem.findUnique({ where: { userId_symbol: { userId, symbol } }, select: { market: true } }),
    ]);
    const ref = refOf({ symbol, market: asset?.market ?? watch?.market ?? null });
    const providers = await providersFor(userId, symbol);
    let r = await firstAnswer(providers, (p) => p.adapter.candles?.(ref, unit, count) ?? null, `${unit} candles`);
    let built = false;
    // Roll up from a finer interval: 4h needs 1h (which may itself come from 1m)
    let from = BUILD_FROM[unit];
    while (!r && from) {
      const need = unit === '1w' ? count * 5 : Math.min(2000, count * ((unit === '240m' ? 240 : Number(unit.replace('m', ''))) / (from === '1m' ? 1 : 60)));
      const base = await firstAnswer(providers, (p) => p.adapter.candles?.(ref, from!, need) ?? null, `${from} candles`);
      if (base) {
        r = { value: rollUp(base.value, unit, zoneOf(symbol)).slice(-count), source: base.source };
        built = true;
      }
      from = from === '60m' ? '1m' : undefined;
    }
    c = { value: { candles: r?.value ?? c?.value.candles ?? [], source: r?.source ?? null, built }, at: Date.now() };
    candleCache.set(key, c);
  }
  const v = c!.value;
  return {
    unit,
    source: v.source,
    built: v.built,
    candles: v.candles.map((b) => ({ t: b.time, o: Number(b.open), h: Number(b.high), l: Number(b.low), c: Number(b.close), v: b.volume === null ? null : Number(b.volume) })),
  };
}
