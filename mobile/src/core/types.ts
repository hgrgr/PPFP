/**
 * What the app keeps on the phone. Money and quantities are decimal strings (read with Dec),
 * dates ISO strings; ids are random. The shapes follow the web app's tables loosely, so
 * the same data can go to a PPFP server as its import sheets.
 */
import type { LotMethod } from '@/domain/lots';
import type { TxnType } from '@/domain/ledger';

export const ASSET_TYPES = ['KR_STOCK', 'US_STOCK', 'CRYPTO', 'BOND', 'CASH', 'REAL_ESTATE', 'FUND', 'ALTERNATIVE', 'LIABILITY'] as const;
export type AssetType = (typeof ASSET_TYPES)[number];
export const ASSET_TYPE_LABEL: Record<AssetType, string> = {
  KR_STOCK: '국내 주식·ETF',
  US_STOCK: '해외 주식·ETF',
  CRYPTO: '가상자산',
  BOND: '채권',
  CASH: '현금·예금',
  REAL_ESTATE: '부동산',
  FUND: '펀드',
  ALTERNATIVE: '대안자산',
  LIABILITY: '부채',
};
/** Types with a market price the app can fetch; the rest are valued by hand. */
export const LISTED_TYPES: AssetType[] = ['KR_STOCK', 'US_STOCK', 'CRYPTO'];

export interface Portfolio {
  id: string;
  name: string;
  lotMethod: LotMethod;
  archived: boolean;
  createdAt: string;
}

export interface Asset {
  id: string;
  type: AssetType;
  /** 005930, AAPL, KRW-BTC; null for an asset valued by hand */
  symbol: string | null;
  name: string;
  currency: 'KRW' | 'USD';
  /** Last known unit price in its currency */
  price: string | null;
  priceAt: string | null;
  /** upbit, kis, manual … */
  priceSource: string | null;
  /** Sub-kind for the balance sheet: MORTGAGE, TERM_DEPOSIT, VEHICLE … (src/domain/net-worth) */
  kind?: string | null;
  createdAt: string;
}

export interface Txn {
  id: string;
  portfolioId: string;
  assetId: string | null;
  type: TxnType;
  /** ISO date-time (KST written with its offset) */
  tradeAt: string;
  qty: string | null;
  /** Unit price for BUY / SELL / VALUATION */
  price: string | null;
  /** Cash amount for DEPOSIT / WITHDRAW / DIVIDEND / INTEREST / FEE / TAX */
  amount: string | null;
  fee: string;
  tax: string;
  currency: 'KRW' | 'USD';
  /** KRW per USD for USD trades */
  fxRate: string | null;
  /** BUY paid from (SELL paid into) the portfolio's cash; false = money from outside */
  useCash: boolean;
  /** SPLIT: new shares per old share */
  ratio: string | null;
  lotMethod: LotMethod | null;
  memo: string;
  createdAt: string;
  /** The id this trade has on a PPFP server, once uploaded or downloaded */
  serverId?: string | null;
}

export interface Note {
  id: string;
  body: string;
  pinned: boolean;
  createdAt: string;
}

export interface Journal {
  id: string;
  assetId: string | null;
  title: string;
  status: 'OPEN' | 'CLOSED';
  targetPrice: string;
  basePrice: string | null;
  stopPrice: string | null;
  dueDate: string | null;
  body: string;
  createdAt: string;
}

export interface Loan {
  id: string;
  /** The LIABILITY asset this loan describes */
  assetId: string;
  principal: number;
  annualRate: number;
  startDate: string;
  months: number;
  method: 'AMORTIZING' | 'EQUAL_PRINCIPAL' | 'BULLET';
  graceMonths: number;
  paymentDay: number;
}

export interface Goal {
  id: string;
  name: string;
  target: number;
  targetDate: string;
  monthly: number;
}

export interface PriceAlert {
  id: string;
  assetId: string;
  direction: 'ABOVE' | 'BELOW';
  price: string;
  active: boolean;
  firedAt: string | null;
  createdAt: string;
}

export interface Notice {
  id: string;
  kind: 'PRICE' | 'SERVER' | 'INFO';
  title: string;
  body: string;
  at: string;
  read: boolean;
}

/** One value of the whole book per day, kept as the app is used, for the trend chart */
export interface DayValue {
  date: string;
  value: number;
  invested: number;
}

export interface Setting {
  key: string;
  value: unknown;
}
