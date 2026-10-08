/**
 * 코인원 Open API (https://docs.coinone.co.kr). Private v2.1 calls are POSTs
 * whose JSON body (with access_token and a UUID nonce) is base64-encoded into
 * X-COINONE-PAYLOAD and signed with HMAC-SHA512 into X-COINONE-SIGNATURE.
 * Completed orders come back per fill, within windows of at most 90 days.
 */
import { Dec } from '@/domain/decimal';
import { coinOf, cryptoSymbol, isCryptoSymbol, num } from '@/domain/broker-format';
import type { ExchangeBalance, ExchangeEvent } from '@/domain/exchange-replay';
import { backoff, fetchJson, rows, sleep, str, throttle } from './http';
import { hmacHex, nonce } from './sign';
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

const BASE = 'https://api.coinone.co.kr';
const DAY = 86_400_000;
const INTERVAL: Record<CandleUnit, string> = { '1m': '1m', '5m': '5m', '15m': '15m', '60m': '1h', '240m': '4h', '1d': '1d', '1w': '1w' };
let nameCache: { at: number; names: Map<string, string> } | null = null;

export function coinonePayload(accessToken: string, body: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify({ access_token: accessToken, nonce: nonce(), ...body })).toString('base64');
}

export class CoinoneAdapter implements BrokerAdapter {
  readonly broker = 'COINONE' as const;
  readonly kind = 'crypto' as const;

  constructor(
    private readonly cfg: ConnectionConfig,
    _store?: TokenStore,
  ) {}

  private async priv(path: string, body: Record<string, unknown> = {}) {
    for (let attempt = 0; ; attempt++) {
      await throttle(`COINONE:${this.cfg.id}`, 110);
      const payload = coinonePayload(this.cfg.appKey, body);
      const r = await fetchJson('COINONE', BASE + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'X-COINONE-PAYLOAD': payload, 'X-COINONE-SIGNATURE': hmacHex('sha512', this.cfg.secret, payload) },
        body: payload,
      });
      if (r.status === 200 && str(r.body.result) === 'success') return r.body;
      if ((r.status === 429 || r.status >= 500) && attempt < 3) {
        await sleep(backoff(attempt));
        continue;
      }
      const code = str(r.body.error_code);
      throw new BrokerApiError(str(r.body.error_msg) || `코인원 API 오류 (${code || r.status})`, 'COINONE', r.status, code);
    }
  }

  private async pub(path: string, query: Record<string, string> = {}) {
    const url = new URL(BASE + path);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    await throttle('COINONE:public', 110);
    const r = await fetchJson('COINONE', url.toString(), { headers: { accept: 'application/json' } });
    if (r.status !== 200 || str(r.body.result) !== 'success') throw new BrokerApiError(`코인원 시세 오류 (${str(r.body.error_code) || r.status})`, 'COINONE', r.status, str(r.body.error_code));
    return r.body;
  }

  private async names(): Promise<Map<string, string>> {
    if (nameCache && Date.now() - nameCache.at < 3_600_000) return nameCache.names;
    const list = rows((await this.pub('/public/v2/currencies')).currencies);
    nameCache = { at: Date.now(), names: new Map(list.map((c) => [str(c.symbol).toUpperCase(), str(c.name) || str(c.symbol)])) };
    return nameCache.names;
  }

  async balances(): Promise<ExchangeBalance[]> {
    const list = rows((await this.priv('/v2.1/account/balance/all')).balances);
    return list.map((b) => ({
      currency: str(b.currency).toUpperCase(),
      qty: Dec.of(num(b.available)).add(num(b.limit)).toString(),
      avgPrice: num(b.average_price) === '0' ? null : num(b.average_price),
    }));
  }

  async verify() {
    await this.balances();
    return {};
  }

  async holdings(): Promise<BrokerHolding[]> {
    const [balances, names] = await Promise.all([this.balances(), this.names()]);
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

  private async tickers(): Promise<Record<string, unknown>[]> {
    return rows((await this.pub('/public/v2/ticker_new/KRW', { additional_data: 'true' })).tickers);
  }

  async quotes(refs: InstrumentRef[]): Promise<PriceQuote[]> {
    const wanted = new Set(refs.map((r) => r.symbol.toUpperCase()).filter(isCryptoSymbol));
    if (!wanted.size) return [];
    return (await this.tickers())
      .filter((t) => wanted.has(cryptoSymbol(str(t.target_currency))))
      .map((t) => ({
        symbol: cryptoSymbol(str(t.target_currency)),
        price: num(t.last),
        currency: 'KRW' as const,
        market: 'CRYPTO',
        asOf: t.timestamp ? new Date(Number(t.timestamp)).toISOString() : null,
        prevClose: num(t.yesterday_last) === '0' ? null : num(t.yesterday_last),
        volume: num(t.target_volume),
      }));
  }

  async instrument(symbol: string): Promise<Instrument | null> {
    if (!isCryptoSymbol(symbol)) return null;
    const name = (await this.names()).get(coinOf(symbol));
    return name ? { symbol: symbol.toUpperCase(), name, currency: 'KRW', market: 'CRYPTO' } : null;
  }

  async candles(ref: InstrumentRef, unit: CandleUnit, count: number): Promise<Candle[] | null> {
    if (!isCryptoSymbol(ref.symbol)) return null;
    const list = rows((await this.pub(`/public/v2/chart/KRW/${coinOf(ref.symbol)}`, { interval: INTERVAL[unit], size: String(Math.min(500, count)) })).chart);
    return list
      .map((c) => ({ time: new Date(Number(c.timestamp)).toISOString(), open: num(c.open), high: num(c.high), low: num(c.low), close: num(c.close), volume: num(c.target_volume) }))
      .sort((a, b) => a.time.localeCompare(b.time));
  }

  async dailyCloses(ref: InstrumentRef, since: string): Promise<DailyClose[]> {
    const days = Math.min(500, Math.ceil((Date.now() - Date.parse(since + 'T00:00:00Z')) / DAY) + 2);
    return ((await this.candles(ref, '1d', days)) ?? [])
      .map((b) => ({ date: new Date(Date.parse(b.time) + 9 * 3_600_000).toISOString().slice(0, 10), close: b.close }))
      .filter((c) => c.date >= since);
  }

  async intraday(ref: InstrumentRef): Promise<MinuteBar[]> {
    return ((await this.candles(ref, '5m', 144)) ?? []).map((b) => ({ time: b.time, close: b.close, volume: b.volume }));
  }

  async orderbook(ref: InstrumentRef): Promise<Orderbook | null> {
    if (!isCryptoSymbol(ref.symbol)) return null;
    const b = await this.pub(`/public/v2/orderbook/KRW/${coinOf(ref.symbol)}`, { size: '10' });
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
    const [tickers, names] = await Promise.all([this.tickers(), this.names()]);
    const rate = (t: Record<string, unknown>) => {
      const prev = Dec.of(num(t.yesterday_last));
      return prev.isPos() ? Dec.of(num(t.last)).sub(prev).div(prev) : Dec.ZERO;
    };
    const key = (t: Record<string, unknown>) => (type === 'AMOUNT' ? Dec.of(num(t.quote_volume)) : type === 'VOLUME' ? Dec.of(num(t.target_volume)) : rate(t));
    return tickers
      .sort((a, b) => (type === 'LOSERS' ? key(a).cmp(key(b)) : key(b).cmp(key(a))))
      .slice(0, 30)
      .map((t) => ({
        symbol: cryptoSymbol(str(t.target_currency)),
        name: names.get(str(t.target_currency).toUpperCase()) ?? str(t.target_currency).toUpperCase(),
        price: num(t.last),
        changeRate: rate(t).round(6).toString(),
        volume: num(t.target_volume),
        amount: num(t.quote_volume),
        currency: 'KRW' as const,
      }));
  }

  /** Walk a window newest-first using the "to_*" cursor until the page comes back short. */
  private async window(path: string, list: string, cursor: string, idKey: string, from: number, to: number, extra: Record<string, unknown> = {}) {
    const out: Record<string, unknown>[] = [];
    let before: string | undefined;
    for (let guard = 0; guard < 100; guard++) {
      const body = await this.priv(path, { size: 100, from_ts: from, to_ts: to, ...extra, ...(before ? { [cursor]: before } : {}) });
      const page = rows(body[list]);
      out.push(...page);
      if (page.length < 100) break;
      before = str(page[page.length - 1][idKey]);
    }
    return out;
  }

  async history(since: Date, until: Date) {
    const events: ExchangeEvent[] = [];
    for (let start = since.getTime(); start < until.getTime(); start += 90 * DAY) {
      const end = Math.min(start + 90 * DAY, until.getTime());
      for (const t of await this.window('/v2.1/order/completed_orders/all', 'completed_orders', 'to_trade_id', 'trade_id', start, end)) {
        if (str(t.quote_currency).toUpperCase() !== 'KRW') continue;
        const coin = str(t.target_currency).toUpperCase();
        const feeInCoin = !!str(t.fee_currency) && str(t.fee_currency).toUpperCase() !== 'KRW';
        events.push({
          id: str(t.trade_id),
          kind: t.is_ask ? 'SELL' : 'BUY',
          at: new Date(Number(t.timestamp)).toISOString(),
          currency: coin,
          qty: num(t.qty),
          price: num(t.price),
          fee: num(t.fee),
          feeInCoin,
        });
      }
      for (const t of await this.window('/v2.1/transaction/krw/history', 'transactions', 'to_id', 'id', start, end)) {
        const status = str(t.status);
        if (status !== 'DEPOSIT_COMPLETE' && status !== 'WITHDRAWAL_COMPLETE') continue;
        const kind = status === 'DEPOSIT_COMPLETE' ? 'DEPOSIT' : 'WITHDRAW';
        events.push({ id: `KRW:${str(t.id)}`, kind, at: new Date(Number(t.created_at)).toISOString(), currency: 'KRW', qty: num(t.amount), price: null, fee: num(t.fee) });
      }
      for (const t of await this.window('/v2.1/transaction/coin/history', 'transactions', 'to_id', 'id', start, end)) {
        const status = str(t.status);
        if (status !== 'DEPOSIT_SUCCESS' && status !== 'WITHDRAWAL_SUCCESS') continue;
        const kind = status === 'DEPOSIT_SUCCESS' ? 'DEPOSIT' : 'WITHDRAW';
        events.push({ id: `COIN:${str(t.id)}`, kind, at: new Date(Number(t.created_at)).toISOString(), currency: str(t.currency).toUpperCase(), qty: num(t.amount), price: null, fee: num(t.fee) });
      }
    }
    return { since, events: events.filter((e) => e.at >= since.toISOString() && e.at < until.toISOString()) };
  }
}
