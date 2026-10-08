/**
 * 코빗, now Digital X (https://docs.digitalx.miraeasset.com), Open API v2.
 * Private calls send X-KAPI-KEY and sign the exact query string (with a
 * millisecond timestamp) by HMAC-SHA256. Trade history is kept for 36 hours
 * only and is listed per trading pair; deposit/withdrawal lists hold the most
 * recent 100 records.
 */
import { Dec } from '@/domain/decimal';
import { coinOf, cryptoSymbol, isCryptoSymbol, num } from '@/domain/broker-format';
import type { ExchangeBalance, ExchangeEvent } from '@/domain/exchange-replay';
import { backoff, fetchJson, rows, sleep, str, throttle } from './http';
import { hmacHex } from './sign';
import {
  BrokerApiError,
  type BrokerAdapter,
  type BrokerHolding,
  type Candle,
  type CandleUnit,
  type ConnectionConfig,
  type DailyClose,
  type Instrument,
  type InstrumentRef,
  type MinuteBar,
  type Orderbook,
  type PriceQuote,
  type RankingMarket,
  type RankingRow,
  type RankingType,
  type TokenStore,
} from './types';

const BASE = 'https://api.digitalx.miraeasset.com';
const DAY = 86_400_000;
/** How far back /v2/myTrades reaches, less a margin for clock drift */
export const KORBIT_TRADE_WINDOW_MS = 36 * 3_600_000 - 10 * 60_000;
const INTERVAL: Record<CandleUnit, string> = { '1m': '1', '5m': '5', '15m': '15', '60m': '60', '240m': '240', '1d': '1D', '1w': '1W' };
let nameCache: { at: number; names: Map<string, string> } | null = null;

const pair = (symbol: string) => `${coinOf(symbol).toLowerCase()}_krw`;
const fromPair = (p: string) => cryptoSymbol(p.split('_')[0]);

/** Signed query string: params + timestamp, then the HMAC-SHA256 signature appended. */
export function korbitQuery(params: Record<string, string>, secret: string, timestamp = Date.now()): string {
  const p = new URLSearchParams({ ...params, timestamp: String(timestamp) });
  p.append('signature', hmacHex('sha256', secret, p.toString()));
  return p.toString();
}

export class KorbitAdapter implements BrokerAdapter {
  readonly broker = 'KORBIT' as const;
  readonly kind = 'crypto' as const;

  constructor(
    private readonly cfg: ConnectionConfig,
    _store?: TokenStore,
  ) {}

  private async get(path: string, params: Record<string, string> = {}, auth = true): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      await throttle(auth ? `KORBIT:${this.cfg.id}` : 'KORBIT:public', 110);
      const qs = auth ? korbitQuery(params, this.cfg.secret) : new URLSearchParams(params).toString();
      const r = await fetchJson('KORBIT', `${BASE}${path}${qs ? `?${qs}` : ''}`, { headers: auth ? { 'X-KAPI-KEY': this.cfg.appKey } : {} });
      if (r.status === 200 && r.body.success !== false) return r.body.data ?? r.body;
      if ((r.status === 429 || r.status >= 500) && attempt < 3) {
        await sleep(backoff(attempt));
        continue;
      }
      // The symbolic code is error.message, not error.code
      const code = str((r.body.error as { message?: string } | undefined)?.message);
      throw new BrokerApiError(code ? `코빗 API 오류: ${code}` : `코빗 API 오류 (${r.status})`, 'KORBIT', r.status, code);
    }
  }

  private async names(): Promise<Map<string, string>> {
    if (nameCache && Date.now() - nameCache.at < 3_600_000) return nameCache.names;
    const list = rows(await this.get('/v2/currencies', {}, false));
    nameCache = { at: Date.now(), names: new Map(list.map((c) => [str(c.name).toUpperCase(), str(c.fullName) || str(c.name).toUpperCase()])) };
    return nameCache.names;
  }

  async balances(): Promise<ExchangeBalance[]> {
    return rows(await this.get('/v2/balance')).map((b) => ({
      currency: str(b.currency).toUpperCase(),
      qty: num(b.balance),
      avgPrice: num(b.avgPrice) === '0' ? null : num(b.avgPrice),
    }));
  }

  async verify() {
    await this.balances();
    return {};
  }

  async holdings(): Promise<BrokerHolding[]> {
    const [balances, names] = await Promise.all([this.balances(), this.names().catch(() => new Map<string, string>())]);
    return balances
      .filter((b) => b.currency !== 'KRW' && Dec.of(b.qty).isPos())
      .map((b) => ({
        symbol: cryptoSymbol(b.currency),
        name: names.get(b.currency) ?? b.currency,
        currency: 'KRW' as const,
        market: 'CRYPTO',
        quantity: b.qty,
        averagePrice: b.avgPrice ?? '0',
        lastPrice: null,
      }));
  }

  private async tickers(symbols?: string[]): Promise<Record<string, unknown>[]> {
    return rows(await this.get('/v2/tickers', symbols?.length ? { symbol: symbols.map(pair).join(',') } : {}, false));
  }

  async quotes(refs: InstrumentRef[]): Promise<PriceQuote[]> {
    const symbols = [...new Set(refs.map((r) => r.symbol.toUpperCase()).filter(isCryptoSymbol))];
    if (!symbols.length) return [];
    return (await this.tickers(symbols)).map((t) => ({
      symbol: fromPair(str(t.symbol)),
      price: num(t.close),
      currency: 'KRW' as const,
      market: 'CRYPTO',
      asOf: t.lastTradedAt ? new Date(Number(t.lastTradedAt)).toISOString() : null,
      prevClose: num(t.prevClose) === '0' ? null : num(t.prevClose),
      volume: num(t.volume),
    }));
  }

  async instrument(symbol: string): Promise<Instrument | null> {
    if (!isCryptoSymbol(symbol)) return null;
    const [t] = await this.tickers([symbol]).catch(() => []);
    if (!t) return null;
    const names = await this.names().catch(() => new Map<string, string>());
    return { symbol: symbol.toUpperCase(), name: names.get(coinOf(symbol)) ?? coinOf(symbol), currency: 'KRW', market: 'CRYPTO' };
  }

  async candles(ref: InstrumentRef, unit: CandleUnit, count: number): Promise<Candle[] | null> {
    if (!isCryptoSymbol(ref.symbol)) return null;
    const list = rows(await this.get('/v2/candles', { symbol: pair(ref.symbol), interval: INTERVAL[unit], limit: String(Math.min(200, count)) }, false));
    return list
      .map((c) => ({ time: new Date(Number(c.timestamp)).toISOString(), open: num(c.open), high: num(c.high), low: num(c.low), close: num(c.close), volume: num(c.volume) }))
      .sort((a, b) => a.time.localeCompare(b.time));
  }

  async dailyCloses(ref: InstrumentRef, since: string): Promise<DailyClose[]> {
    const days = Math.min(200, Math.ceil((Date.now() - Date.parse(since + 'T00:00:00Z')) / DAY) + 2);
    return ((await this.candles(ref, '1d', days)) ?? [])
      .map((b) => ({ date: new Date(Date.parse(b.time) + 9 * 3_600_000).toISOString().slice(0, 10), close: b.close }))
      .filter((c) => c.date >= since);
  }

  async intraday(ref: InstrumentRef): Promise<MinuteBar[]> {
    return ((await this.candles(ref, '5m', 144)) ?? []).map((b) => ({ time: b.time, close: b.close, volume: b.volume }));
  }

  async orderbook(ref: InstrumentRef): Promise<Orderbook | null> {
    if (!isCryptoSymbol(ref.symbol)) return null;
    const b = (await this.get('/v2/orderbook', { symbol: pair(ref.symbol) }, false)) as Record<string, unknown>;
    const level = (x: Record<string, unknown>) => ({ price: num(x.price), volume: num(x.qty) });
    return {
      asks: rows(b.asks).map(level).sort((x, y) => Dec.of(x.price).cmp(y.price)).slice(0, 10),
      bids: rows(b.bids).map(level).sort((x, y) => Dec.of(y.price).cmp(x.price)).slice(0, 10),
      currency: 'KRW',
      asOf: b.timestamp ? new Date(Number(b.timestamp)).toISOString() : null,
    };
  }

  async rankings(market: RankingMarket, type: RankingType): Promise<RankingRow[] | null> {
    if (market !== 'CRYPTO') return null;
    const [tickers, names] = await Promise.all([this.tickers(), this.names().catch(() => new Map<string, string>())]);
    const key = (t: Record<string, unknown>) =>
      Dec.of(num(type === 'AMOUNT' ? t.quoteVolume : type === 'VOLUME' ? t.volume : t.priceChangePercent));
    return tickers
      .filter((t) => str(t.symbol).endsWith('_krw'))
      .sort((a, b) => (type === 'LOSERS' ? key(a).cmp(key(b)) : key(b).cmp(key(a))))
      .slice(0, 30)
      .map((t) => ({
        symbol: fromPair(str(t.symbol)),
        name: names.get(coinOf(fromPair(str(t.symbol)))) ?? coinOf(fromPair(str(t.symbol))),
        price: num(t.close),
        changeRate: Dec.of(num(t.priceChangePercent)).div(100).toString(),
        volume: num(t.volume),
        amount: num(t.quoteVolume),
        currency: 'KRW' as const,
      }));
  }

  /**
   * Only the last 36 hours of trades exist, per pair: the pairs asked are those of today's balances
   * (a coin bought and sold out within the window is therefore missed).
   */
  async history(since: Date, until: Date) {
    const start = new Date(Math.max(since.getTime(), Date.now() - KORBIT_TRADE_WINDOW_MS));
    const balances = await this.balances();
    const coins = balances.filter((b) => b.currency !== 'KRW').map((b) => b.currency);
    const events: ExchangeEvent[] = [];
    for (const coin of coins) {
      const list = rows(await this.get('/v2/myTrades', { symbol: `${coin.toLowerCase()}_krw`, startTime: String(start.getTime()), endTime: String(until.getTime()), limit: '1000' }).catch(() => []));
      for (const t of list) {
        const feeCcy = str(t.feeCurrency).toUpperCase();
        events.push({
          id: `${coin}:${str(t.tradeId)}`,
          kind: str(t.side) === 'buy' ? 'BUY' : 'SELL',
          at: new Date(Number(t.tradedAt)).toISOString(),
          currency: coin,
          qty: num(t.qty),
          price: num(t.price),
          fee: num(t.feeQty),
          feeInCoin: !!feeCcy && feeCcy !== 'KRW',
        });
      }
    }
    const inWindow = (ms: number) => ms >= start.getTime() && ms < until.getTime();
    for (const [path, kind] of [['/v2/krw/recentDeposits', 'DEPOSIT'], ['/v2/krw/recentWithdrawals', 'WITHDRAW']] as const) {
      for (const t of rows(await this.get(path, { limit: '100' }))) {
        if (str(t.status) !== 'done' || !inWindow(Number(t.createdAt))) continue;
        events.push({ id: `KRW:${str(t.id)}`, kind, at: new Date(Number(t.createdAt)).toISOString(), currency: 'KRW', qty: num(t.quantity), price: null, fee: num(t.fee) });
      }
    }
    for (const coin of coins) {
      for (const [path, kind] of [['/v2/coin/recentDeposits', 'DEPOSIT'], ['/v2/coin/recentWithdrawals', 'WITHDRAW']] as const) {
        for (const t of rows(await this.get(path, { currency: coin.toLowerCase(), limit: '100' }).catch(() => []))) {
          if (str(t.status) !== 'done' || !inWindow(Number(t.createdAt))) continue;
          events.push({ id: `${coin}:${str(t.id)}`, kind, at: new Date(Number(t.createdAt)).toISOString(), currency: coin, qty: num(t.quantity), price: null, fee: num(t.fee) });
        }
      }
    }
    return { since: start, events };
  }
}
