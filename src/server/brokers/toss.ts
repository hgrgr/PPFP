/** 토스증권 Open API, adapted to the common broker interface. The HTTP client lives in ../toss/client. */
import { cleanSymbol, isKrSymbol, num, usMarketOf, zonedDate } from '@/domain/broker-format';
import { TossApiError, TossClient, type TossHoldingItem } from '../toss/client';
import { kstDate } from '../db';
import {
  BrokerApiError,
  type BrokerAdapter,
  type BrokerHolding,
  type ConnectionConfig,
  type DailyClose,
  type Instrument,
  type IndexCode,
  type IndexQuote,
  type InstrumentRef,
  type Candle,
  type CandleUnit,
  type MinuteBar,
  type Orderbook,
  type PriceQuote,
  type RankingMarket,
  type RankingRow,
  type RankingType,
  type TokenStore,
} from './types';

const TOSS_INDEX: Partial<Record<IndexCode, string>> = { KOSPI: 'KOSPI', KOSDAQ: 'KOSDAQ' };
/** Toss has no realtime window for gainers/losers; a one-day window is the same as "today". */
const TOSS_RANKING: Record<RankingType, { type: string; duration: string }> = {
  AMOUNT: { type: 'MARKET_TRADING_AMOUNT', duration: 'realtime' },
  VOLUME: { type: 'MARKET_TRADING_VOLUME', duration: 'realtime' },
  GAINERS: { type: 'TOP_GAINERS', duration: '1d' },
  LOSERS: { type: 'TOP_LOSERS', duration: '1d' },
};

export function parseTossHoldings(items: TossHoldingItem[]): BrokerHolding[] {
  return items
    .filter((i) => num(i.quantity) !== '0')
    .map((i) => ({
      symbol: i.symbol.toUpperCase(),
      name: i.name || i.symbol,
      currency: i.currency,
      market: i.marketCountry === 'KR' ? 'KRX' : null,
      quantity: num(i.quantity),
      averagePrice: num(i.averagePurchasePrice),
      lastPrice: num(i.lastPrice),
    }));
}

function wrap(e: unknown): never {
  if (e instanceof TossApiError) throw new BrokerApiError(e.message, 'TOSS', e.status, e.code);
  throw e;
}

export class TossAdapter implements BrokerAdapter {
  readonly broker = 'TOSS' as const;
  readonly kind = 'stock' as const;
  private readonly client: TossClient;

  constructor(private readonly cfg: ConnectionConfig, store: TokenStore) {
    this.client = new TossClient({ clientId: cfg.appKey, clientSecret: cfg.secret }, store);
  }

  private async accountSeq(): Promise<number> {
    if (this.cfg.accountNo) return Number(this.cfg.accountNo);
    const accounts = await this.client.accounts();
    const seq = accounts.find((a) => a.accountType === 'BROKERAGE')?.accountSeq ?? accounts[0]?.accountSeq;
    if (seq === undefined) throw new BrokerApiError('토스증권에서 증권 계좌를 찾지 못했습니다.', 'TOSS', 404, 'no-account');
    return seq;
  }

  async verify() {
    try {
      await this.client.token(true);
      const accounts = await this.client.accounts();
      const seq = accounts.find((a) => a.accountType === 'BROKERAGE')?.accountSeq ?? accounts[0]?.accountSeq ?? null;
      return { accountNo: seq === null ? null : String(seq) };
    } catch (e) {
      wrap(e);
    }
  }

  async holdings(): Promise<BrokerHolding[]> {
    try {
      return parseTossHoldings((await this.client.holdings(await this.accountSeq())).items);
    } catch (e) {
      wrap(e);
    }
  }

  async quotes(refs: InstrumentRef[]): Promise<PriceQuote[]> {
    const symbols = refs.map((r) => cleanSymbol(r.symbol)).filter((s): s is string => !!s);
    if (!symbols.length) return [];
    try {
      const prices = await this.client.prices(symbols);
      return prices.map((p) => ({ symbol: p.symbol.toUpperCase(), price: num(p.lastPrice), currency: p.currency, market: null, asOf: p.timestamp }));
    } catch (e) {
      wrap(e);
    }
  }

  async instrument(symbol: string): Promise<Instrument | null> {
    try {
      const [info] = await this.client.stocks([symbol]);
      if (!info) return null;
      return {
        symbol,
        name: info.name,
        currency: info.currency,
        market: isKrSymbol(symbol) ? info.market : (usMarketOf(info.market) ?? info.market),
        englishName: info.englishName,
        delisted: info.status === 'DELISTED',
      };
    } catch (e) {
      wrap(e);
    }
  }

  async dailyCloses(ref: InstrumentRef, since: string): Promise<DailyClose[]> {
    try {
      const candles = await this.client.dailyCandles(ref.symbol, since);
      return candles.map((c) => ({ date: kstDate(new Date(c.timestamp)), close: num(c.closePrice) }));
    } catch (e) {
      wrap(e);
    }
  }

  async usdKrw(): Promise<string | null> {
    try {
      return num((await this.client.exchangeRate('USD', 'KRW')).midRate);
    } catch (e) {
      wrap(e);
    }
  }

  async indices(codes: IndexCode[]): Promise<IndexQuote[]> {
    const wanted = codes.filter((c) => TOSS_INDEX[c]);
    if (!wanted.length) return [];
    try {
      const prices = await this.client.indicatorPrices(wanted.map((c) => TOSS_INDEX[c]!));
      const out: IndexQuote[] = [];
      for (const code of wanted) {
        const p = prices.find((x) => x.symbol === TOSS_INDEX[code]);
        if (!p || num(p.lastPrice) === '0') continue;
        // Newest daily candle is the current session; the one before it holds the previous close.
        const { candles } = await this.client.indicatorCandles(TOSS_INDEX[code]!, '1d', 2);
        out.push({ code, price: num(p.lastPrice), prevClose: candles[1] ? num(candles[1].closePrice) : null, asOf: p.timestamp });
      }
      return out;
    } catch (e) {
      wrap(e);
    }
  }

  async rankings(market: RankingMarket, type: RankingType): Promise<RankingRow[] | null> {
    if (market === 'CRYPTO') return null;
    try {
      const { type: t, duration } = TOSS_RANKING[type];
      const { rankings } = await this.client.rankings(t, market, duration, 30);
      if (!rankings.length) return [];
      // Rankings carry no names; one batch lookup fills them in.
      const names = new Map((await this.client.stocks(rankings.map((r) => r.symbol)).catch(() => [])).map((s) => [s.symbol.toUpperCase(), s.name]));
      return rankings.map((r) => ({
        symbol: r.symbol.toUpperCase(),
        name: names.get(r.symbol.toUpperCase()) ?? null,
        price: num(r.price.lastPrice),
        changeRate: r.price.changeRate === null ? null : num(r.price.changeRate),
        volume: num(r.tradingVolume),
        amount: num(r.tradingAmount),
        currency: r.currency,
      }));
    } catch (e) {
      wrap(e);
    }
  }

  async intraday(ref: InstrumentRef): Promise<MinuteBar[]> {
    try {
      const zone = isKrSymbol(ref.symbol) ? 'Asia/Seoul' : 'America/New_York';
      const bars: MinuteBar[] = [];
      let before: string | undefined;
      let session: string | null = null;
      // A regular session is ~390 one-minute bars; 200 per page.
      for (let page = 0; page < 3; page++) {
        const r = await this.client.candles(ref.symbol, '1m', 200, before);
        for (const c of r.candles) {
          const day = zonedDate(c.timestamp, zone);
          session ??= day;
          if (day !== session) return bars.reverse();
          bars.push({ time: new Date(c.timestamp).toISOString(), close: num(c.closePrice), volume: num(c.volume) });
        }
        if (!r.nextBefore || !r.candles.length) break;
        before = r.nextBefore;
      }
      return bars.reverse();
    } catch (e) {
      wrap(e);
    }
  }

  async orderbook(ref: InstrumentRef): Promise<Orderbook | null> {
    try {
      const o = await this.client.orderbook(ref.symbol);
      return {
        asks: o.asks.map((a) => ({ price: num(a.price), volume: num(a.volume) })),
        bids: o.bids.map((b) => ({ price: num(b.price), volume: num(b.volume) })),
        currency: o.currency,
        asOf: o.timestamp,
      };
    } catch (e) {
      wrap(e);
    }
  }

  /** Toss publishes 1-minute and daily candles only; other intervals are rolled up from these. */
  async candles(ref: InstrumentRef, unit: CandleUnit, count: number): Promise<Candle[] | null> {
    if (unit !== '1m' && unit !== '1d') return null;
    try {
      const out: Candle[] = [];
      let before: string | undefined;
      for (let page = 0; page < 6 && out.length < count; page++) {
        const r = await this.client.candles(ref.symbol, unit, 200, before);
        for (const c of r.candles) {
          // 1m timestamps mark the end of the bar; daily ones the trading date at local midnight
          const start = unit === '1m' ? new Date(Date.parse(c.timestamp) - 60_000).toISOString() : new Date(c.timestamp).toISOString();
          out.push({ time: start, open: num(c.openPrice), high: num(c.highPrice), low: num(c.lowPrice), close: num(c.closePrice), volume: num(c.volume) });
        }
        if (!r.nextBefore || !r.candles.length) break;
        before = r.nextBefore;
      }
      return out.sort((a, b) => a.time.localeCompare(b.time)).slice(-count);
    } catch (e) {
      wrap(e);
    }
  }
}
