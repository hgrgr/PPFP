/**
 * Common shape of every brokerage OpenAPI adapter. Each adapter is read-only:
 * account holdings plus whatever market data that broker documents. Nothing
 * here places orders.
 */
import type { BrokerId, BrokerKind } from '@/lib/brokers';
import type { Candle, CandleUnit } from '@/domain/candles';
import type { ExchangeBalance, ExchangeEvent } from '@/domain/exchange-replay';
import type { CommodityDef, CommodityQuote } from '@/domain/commodities';

export type { BrokerId, BrokerKind, Candle, CandleUnit, ExchangeBalance, ExchangeEvent };
export type Currency = 'KRW' | 'USD';

export interface BrokerHolding {
  /** KRX 6-character code or US ticker */
  symbol: string;
  name: string;
  currency: Currency;
  /** 'KRX', a US market name, or null when the broker does not say */
  market: string | null;
  quantity: string;
  /** Broker's average purchase price, in `currency` */
  averagePrice: string;
  lastPrice: string | null;
}

export interface Instrument {
  symbol: string;
  name: string;
  currency: Currency;
  market: string | null;
  englishName?: string;
  delisted?: boolean;
}

export interface InstrumentRef {
  symbol: string;
  market: string | null;
}

export interface PriceQuote {
  symbol: string;
  price: string;
  currency: Currency;
  /** Market the quote came from (useful for US symbols whose exchange was unknown) */
  market: string | null;
  asOf: string | null;
  /** Previous session's close, when the quote response carries it */
  prevClose?: string | null;
  /** Shares traded so far today */
  volume?: string | null;
}

export type IndexCode = 'KOSPI' | 'KOSDAQ' | 'NASDAQ' | 'SP500' | 'DOW';

export interface IndexQuote {
  code: IndexCode;
  price: string;
  prevClose: string | null;
  asOf: string | null;
}

export type RankingType = 'AMOUNT' | 'VOLUME' | 'GAINERS' | 'LOSERS';
export type RankingMarket = 'KR' | 'US' | 'CRYPTO';

export interface RankingRow {
  symbol: string;
  name: string | null;
  price: string;
  /** Change versus the previous close as a fraction (0.0125 = +1.25%) */
  changeRate: string | null;
  volume: string | null;
  /** Traded value in the stock's currency */
  amount: string | null;
  currency: Currency;
}

export interface MinuteBar {
  /** Bar time as an ISO instant */
  time: string;
  close: string;
  volume: string | null;
}

export interface OrderbookLevel {
  price: string;
  volume: string;
}

export interface Orderbook {
  /** Best (lowest) ask first */
  asks: OrderbookLevel[];
  /** Best (highest) bid first */
  bids: OrderbookLevel[];
  currency: Currency;
  asOf: string | null;
}

export interface DailyClose {
  /** YYYY-MM-DD (exchange-local trading date) */
  date: string;
  close: string;
}

export interface BrokerAdapter {
  readonly broker: BrokerId;
  /** Stock brokers price listed stocks; crypto exchanges price "KRW-*" coins. */
  readonly kind: BrokerKind;
  /** Issue a token and make one cheap authenticated call. Returns the account to remember, if the broker reports one. */
  verify(): Promise<{ accountNo?: string | null }>;
  holdings(): Promise<BrokerHolding[]>;
  quotes?(refs: InstrumentRef[]): Promise<PriceQuote[]>;
  instrument?(symbol: string): Promise<Instrument | null>;
  dailyCloses?(ref: InstrumentRef, since: string): Promise<DailyClose[]>;
  usdKrw?(): Promise<string | null>;
  /** Major indices this broker publishes; codes it does not cover are left out. */
  indices?(codes: IndexCode[]): Promise<IndexQuote[]>;
  /** Top stocks by the given measure, or null when this broker has no such ranking. */
  rankings?(market: RankingMarket, type: RankingType): Promise<RankingRow[] | null>;
  /** One-minute bars of the most recent session, oldest first. */
  intraday?(ref: InstrumentRef): Promise<MinuteBar[]>;
  orderbook?(ref: InstrumentRef): Promise<Orderbook | null>;
  /** Up to `count` bars of `unit`, oldest first; null when this broker does not publish that interval. */
  candles?(ref: InstrumentRef, unit: CandleUnit, count: number): Promise<Candle[] | null>;
  /** Gold, oil, index futures…: `contract` is the futures contract (GCZ26) or the KRX code. Null when this broker does not publish it. */
  commodity?(def: CommodityDef, contract: string): Promise<CommodityQuote | null>;
  /** Crypto exchanges: every balance including KRW, for replaying history. */
  balances?(): Promise<ExchangeBalance[]>;
  /**
   * Crypto exchanges: filled trades and completed deposits/withdrawals from `since` until `until`.
   * `since` in the result is where the history really starts (some exchanges keep only recent records).
   */
  history?(since: Date, until: Date): Promise<{ since: Date; events: ExchangeEvent[] }>;
}

export class BrokerApiError extends Error {
  constructor(
    message: string,
    readonly broker: BrokerId,
    readonly status = 0,
    readonly code = '',
  ) {
    super(message);
    this.name = 'BrokerApiError';
  }
}

export interface StoredToken {
  token: string;
  /** epoch ms */
  expiresAt: number;
}

/** Where an adapter keeps its access token between requests and restarts. */
export interface TokenStore {
  load(): Promise<StoredToken | null>;
  save(token: StoredToken): Promise<void>;
}

export interface ConnectionConfig {
  /** Stable key for caches and throttling (connection id, or app key before saving) */
  id: string;
  appKey: string;
  secret: string;
  accountNo: string | null;
  paper: boolean;
}

export function memoryTokenStore(): TokenStore & { current: StoredToken | null } {
  const store = {
    current: null as StoredToken | null,
    async load() {
      return store.current;
    },
    async save(t: StoredToken) {
      store.current = t;
    },
  };
  return store;
}
