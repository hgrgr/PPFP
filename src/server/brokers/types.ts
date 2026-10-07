/**
 * Common shape of every brokerage OpenAPI adapter. Each adapter is read-only:
 * account holdings plus whatever market data that broker documents. Nothing
 * here places orders.
 */
import type { BrokerId } from '@/lib/brokers';

export type { BrokerId };
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
}

export interface DailyClose {
  /** YYYY-MM-DD (exchange-local trading date) */
  date: string;
  close: string;
}

export interface BrokerAdapter {
  readonly broker: BrokerId;
  /** Issue a token and make one cheap authenticated call. Returns the account to remember, if the broker reports one. */
  verify(): Promise<{ accountNo?: string | null }>;
  holdings(): Promise<BrokerHolding[]>;
  quotes?(refs: InstrumentRef[]): Promise<PriceQuote[]>;
  instrument?(symbol: string): Promise<Instrument | null>;
  dailyCloses?(ref: InstrumentRef, since: string): Promise<DailyClose[]>;
  usdKrw?(): Promise<string | null>;
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
