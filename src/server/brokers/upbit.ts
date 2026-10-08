/**
 * 업비트 Open API (https://docs.upbit.com). Bithumb's API 2.0 follows the
 * same shape, so its adapter extends this one (see ./bithumb).
 *
 * Private calls carry a JWT whose query_hash is the SHA-512 of the
 * un-encoded query string. Only KRW markets are read: holdings and trades in
 * BTC/USDT markets would need another currency in the ledger.
 */
import { Dec } from '@/domain/decimal';
import { coinOf, cryptoSymbol, isCryptoSymbol, num } from '@/domain/broker-format';
import type { ExchangeBalance, ExchangeEvent } from '@/domain/exchange-replay';
import { backoff, fetchJson, rows, sleep, str, throttle } from './http';
import { encodedQuery, jwt, nonce, rawQuery, sha512Hex } from './sign';
import {
  BrokerApiError,
  type BrokerAdapter,
  type BrokerHolding,
  type BrokerId,
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

type Params = [string, string][];
const DAY = 86_400_000;

const marketCache = new Map<string, { at: number; names: Map<string, string> }>();

export function parseUpbitBalances(list: unknown): ExchangeBalance[] {
  return rows(list).map((a) => ({
    currency: str(a.currency).toUpperCase(),
    qty: Dec.of(num(a.balance)).add(num(a.locked)).toString(),
    avgPrice: str(a.unit_currency || 'KRW') === 'KRW' && num(a.avg_buy_price) !== '0' ? num(a.avg_buy_price) : null,
  }));
}

export class UpbitAdapter implements BrokerAdapter {
  readonly broker: BrokerId = 'UPBIT';
  readonly kind = 'crypto' as const;
  protected base = 'https://api.upbit.com';
  protected label = '업비트';

  constructor(
    protected readonly cfg: ConnectionConfig,
    _store?: TokenStore,
  ) {}

  /** JWT for a private call; Bithumb adds a timestamp claim and signs with HS256. */
  protected token(query: string): string {
    const payload: Record<string, unknown> = { access_key: this.cfg.appKey, nonce: nonce() };
    if (query) Object.assign(payload, { query_hash: sha512Hex(query), query_hash_alg: 'SHA512' });
    return jwt(payload, this.cfg.secret, 'HS512');
  }

  protected async request(path: string, params: Params = [], auth = true, base = this.base) {
    const qs = encodedQuery(params);
    for (let attempt = 0; ; attempt++) {
      // Private calls: 30/s per key; quotation calls are limited per IP, so share one slot.
      await throttle(auth ? `${this.broker}:${this.cfg.id}` : `${this.broker}:public`, auth ? 40 : 110);
      const headers: Record<string, string> = { accept: 'application/json' };
      if (auth) headers.authorization = `Bearer ${this.token(rawQuery(params))}`;
      const r = await fetchJson(this.broker, `${base}${path}${qs ? `?${qs}` : ''}`, { headers });
      if (r.status === 200) return r.body as unknown;
      if ((r.status === 429 || r.status >= 500) && attempt < 3) {
        await sleep(backoff(attempt));
        continue;
      }
      const err = (r.body.error ?? {}) as { name?: string; message?: string };
      const msg = err.message || err.name || `${this.label} API 오류 (${r.status})`;
      throw new BrokerApiError(r.status === 401 ? `${this.label} 인증 실패: ${msg} (키·허용 IP·권한을 확인하세요)` : msg, this.broker, r.status, err.name ?? '');
    }
  }

  /** KRW market code -> Korean name, refreshed hourly. */
  protected async names(): Promise<Map<string, string>> {
    const c = marketCache.get(this.broker);
    if (c && Date.now() - c.at < 3_600_000) return c.names;
    const list = rows(await this.request('/v1/market/all', [['isDetails', 'false']], false));
    const names = new Map(list.filter((m) => str(m.market).startsWith('KRW-')).map((m) => [str(m.market), str(m.korean_name) || str(m.english_name)]));
    marketCache.set(this.broker, { at: Date.now(), names });
    return names;
  }

  async balances(): Promise<ExchangeBalance[]> {
    return parseUpbitBalances(await this.request('/v1/accounts'));
  }

  async verify() {
    await this.balances();
    return {};
  }

  async holdings(): Promise<BrokerHolding[]> {
    const [balances, names] = await Promise.all([this.balances(), this.names()]);
    return balances
      .filter((b) => b.currency !== 'KRW' && Dec.of(b.qty).isPos() && names.has(cryptoSymbol(b.currency)))
      .map((b) => ({
        symbol: cryptoSymbol(b.currency),
        name: names.get(cryptoSymbol(b.currency)) ?? b.currency,
        currency: 'KRW' as const,
        market: 'CRYPTO',
        quantity: b.qty,
        averagePrice: b.avgPrice ?? '0',
        lastPrice: null,
      }));
  }

  async quotes(refs: InstrumentRef[]): Promise<PriceQuote[]> {
    const markets = [...new Set(refs.map((r) => r.symbol.toUpperCase()).filter(isCryptoSymbol))];
    const out: PriceQuote[] = [];
    for (let i = 0; i < markets.length; i += 50) {
      const list = rows(await this.request('/v1/ticker', [['markets', markets.slice(i, i + 50).join(',')]], false));
      for (const t of list) {
        out.push({
          symbol: str(t.market),
          price: num(t.trade_price),
          currency: 'KRW',
          market: 'CRYPTO',
          asOf: t.timestamp ? new Date(Number(t.timestamp)).toISOString() : null,
          prevClose: num(t.prev_closing_price) === '0' ? null : num(t.prev_closing_price),
          volume: num(t.acc_trade_volume),
        });
      }
    }
    return out;
  }

  async instrument(symbol: string): Promise<Instrument | null> {
    if (!isCryptoSymbol(symbol)) return null;
    const name = (await this.names()).get(symbol.toUpperCase());
    return name ? { symbol: symbol.toUpperCase(), name, currency: 'KRW', market: 'CRYPTO' } : null;
  }

  protected candlePath(unit: CandleUnit): string | null {
    const minutes = { '1m': 1, '5m': 5, '15m': 15, '60m': 60, '240m': 240 }[unit as string];
    return minutes ? `/v1/candles/minutes/${minutes}` : unit === '1d' ? '/v1/candles/days' : unit === '1w' ? '/v1/candles/weeks' : null;
  }

  /** `to` value that continues a candle listing before this bar. */
  protected pageTo(c: Record<string, unknown>): string {
    return str(c.candle_date_time_utc) + 'Z';
  }

  async candles(ref: InstrumentRef, unit: CandleUnit, count: number): Promise<Candle[] | null> {
    const path = this.candlePath(unit);
    if (!path || !isCryptoSymbol(ref.symbol)) return null;
    const bars = new Map<string, Candle>();
    let to = '';
    for (let page = 0; page < 5 && bars.size < count; page++) {
      const params: Params = [['market', ref.symbol.toUpperCase()], ['count', String(Math.min(200, count - bars.size))]];
      if (to) params.push(['to', to]);
      const list = rows(await this.request(path, params, false));
      if (!list.length) break;
      for (const c of list) {
        const time = new Date(str(c.candle_date_time_utc) + 'Z').toISOString();
        bars.set(time, { time, open: num(c.opening_price), high: num(c.high_price), low: num(c.low_price), close: num(c.trade_price), volume: num(c.candle_acc_trade_volume) });
      }
      to = this.pageTo(list[list.length - 1]);
    }
    return [...bars.values()].sort((a, b) => a.time.localeCompare(b.time)).slice(-count);
  }

  async dailyCloses(ref: InstrumentRef, since: string): Promise<DailyClose[]> {
    const days = Math.min(1000, Math.ceil((Date.now() - Date.parse(since + 'T00:00:00Z')) / DAY) + 2);
    const bars = (await this.candles(ref, '1d', days)) ?? [];
    // Daily candles start at 00:00 UTC (09:00 KST); keyed by their KST date
    return bars.map((b) => ({ date: new Date(Date.parse(b.time) + 9 * 3_600_000).toISOString().slice(0, 10), close: b.close })).filter((c) => c.date >= since);
  }

  /** The last 12 hours in 5-minute bars for the board's mini chart (crypto trades around the clock). */
  async intraday(ref: InstrumentRef): Promise<MinuteBar[]> {
    const bars = (await this.candles(ref, '5m', 144)) ?? [];
    return bars.map((b) => ({ time: b.time, close: b.close, volume: b.volume }));
  }

  async orderbook(ref: InstrumentRef): Promise<Orderbook | null> {
    if (!isCryptoSymbol(ref.symbol)) return null;
    const [book] = rows(await this.request('/v1/orderbook', [['markets', ref.symbol.toUpperCase()]], false));
    if (!book) return null;
    const units = rows(book.orderbook_units).slice(0, 10);
    return {
      asks: units.map((u) => ({ price: num(u.ask_price), volume: num(u.ask_size) })).filter((l) => l.price !== '0'),
      bids: units.map((u) => ({ price: num(u.bid_price), volume: num(u.bid_size) })).filter((l) => l.price !== '0'),
      currency: 'KRW',
      asOf: book.timestamp ? new Date(Number(book.timestamp)).toISOString() : null,
    };
  }

  protected async allKrwTickers(): Promise<Record<string, unknown>[]> {
    return rows(await this.request('/v1/ticker/all', [['quote_currencies', 'KRW']], false));
  }

  async rankings(market: RankingMarket, type: RankingType): Promise<RankingRow[] | null> {
    if (market !== 'CRYPTO') return null;
    const [tickers, names] = await Promise.all([this.allKrwTickers(), this.names()]);
    const key = (t: Record<string, unknown>) =>
      Dec.of(num(type === 'AMOUNT' ? t.acc_trade_price_24h : type === 'VOLUME' ? t.acc_trade_volume_24h : t.signed_change_rate));
    const sorted = tickers.filter((t) => str(t.market).startsWith('KRW-')).sort((a, b) => (type === 'LOSERS' ? key(a).cmp(key(b)) : key(b).cmp(key(a))));
    return sorted.slice(0, 30).map((t) => ({
      symbol: str(t.market),
      name: names.get(str(t.market)) ?? coinOf(str(t.market)),
      price: num(t.trade_price),
      changeRate: num(t.signed_change_rate),
      volume: num(t.acc_trade_volume_24h),
      amount: num(t.acc_trade_price_24h),
      currency: 'KRW',
    }));
  }

  /** Closed orders with fills, in 7-day windows (the API's maximum range). */
  protected async orderEvents(since: Date, until: Date): Promise<ExchangeEvent[]> {
    const events: ExchangeEvent[] = [];
    for (let start = since.getTime(); start < until.getTime(); start += 7 * DAY) {
      const end = Math.min(start + 7 * DAY, until.getTime());
      let from = start;
      for (let guard = 0; guard < 50; guard++) {
        const list = rows(
          await this.request('/v1/orders/closed', [
            ['start_time', String(from)],
            ['end_time', String(end)],
            ['limit', '1000'],
            ['order_by', 'asc'],
          ]),
        );
        for (const o of list) {
          if (!str(o.market).startsWith('KRW-') || num(o.executed_volume) === '0') continue;
          // Average fill price needs the order's trades (the list does not carry executed funds)
          const detail = (await this.request('/v1/order', [['uuid', str(o.uuid)]])) as Record<string, unknown>;
          const trades = rows(detail.trades);
          const funds = Dec.sum(trades.map((t) => num(t.funds)));
          const vol = Dec.sum(trades.map((t) => num(t.volume)));
          const qty = vol.isPos() ? vol : Dec.of(num(o.executed_volume));
          const price = vol.isPos() ? funds.div(vol).round(8) : Dec.of(num(o.price));
          const last = trades.map((t) => str(t.created_at)).filter(Boolean).sort().at(-1) ?? str(o.created_at);
          events.push({
            id: str(o.uuid),
            kind: str(o.side) === 'bid' ? 'BUY' : 'SELL',
            at: new Date(last).toISOString(),
            currency: coinOf(str(o.market)),
            qty: qty.toString(),
            price: price.toString(),
            fee: num(o.paid_fee),
          });
        }
        if (list.length < 1000) break;
        from = Date.parse(str(list[list.length - 1].created_at)) + 1;
      }
    }
    return events;
  }

  /** Completed deposits or withdrawals (all currencies), newest first until older than `since`. */
  protected async transferEvents(kind: 'DEPOSIT' | 'WITHDRAW', since: Date, until: Date): Promise<ExchangeEvent[]> {
    const path = kind === 'DEPOSIT' ? '/v1/deposits' : '/v1/withdraws';
    const done = kind === 'DEPOSIT' ? 'ACCEPTED' : 'DONE';
    const events: ExchangeEvent[] = [];
    for (let page = 1; page <= 100; page++) {
      const list = rows(await this.request(path, [['limit', '100'], ['page', String(page)], ['order_by', 'desc']]));
      let older = false;
      for (const t of list) {
        const at = new Date(str(t.done_at) || str(t.created_at));
        if (at < since) {
          older = true;
          continue;
        }
        if (at >= until || str(t.state).toUpperCase() !== done) continue;
        events.push({ id: str(t.uuid), kind, at: at.toISOString(), currency: str(t.currency).toUpperCase(), qty: num(t.amount), price: null, fee: num(t.fee) });
      }
      if (older || list.length < 100) break;
    }
    return events;
  }

  async history(since: Date, until: Date) {
    const [orders, deposits, withdrawals] = [await this.orderEvents(since, until), await this.transferEvents('DEPOSIT', since, until), await this.transferEvents('WITHDRAW', since, until)];
    return { since, events: [...orders, ...deposits, ...withdrawals] };
  }
}

