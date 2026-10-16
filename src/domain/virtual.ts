/**
 * 가상 포트폴리오: paper purchases of things the user does not own, on past dates, valued from
 * price histories in won. Nothing here touches the real book (Portfolio/Lot/Transaction). Pure.
 */

export type VKind = 'STOCK' | 'FUND' | 'BOND' | 'COMMODITY' | 'CRYPTO' | 'REAL_ESTATE' | 'FIXED' | 'CASH';

export const KIND_LABEL: Record<VKind, string> = {
  STOCK: '주식',
  FUND: 'ETF · 펀드',
  BOND: '채권 (ETF)',
  COMMODITY: '원자재',
  CRYPTO: '가상자산',
  REAL_ESTATE: '부동산 (지역 아파트 지수)',
  FIXED: '예금 · 채권 (고정 금리)',
  CASH: '현금',
};
export const KINDS = Object.keys(KIND_LABEL) as VKind[];
/** Kinds priced from a Yahoo Finance symbol */
export const MARKET_KINDS: VKind[] = ['STOCK', 'FUND', 'BOND', 'COMMODITY', 'CRYPTO'];

/** Quick picks per kind: Yahoo symbol and a name */
export const PRESETS: Partial<Record<VKind, { symbol: string; name: string }[]>> = {
  FUND: [
    { symbol: '069500.KS', name: 'KODEX 200' },
    { symbol: 'SPY', name: 'SPDR S&P 500 ETF' },
    { symbol: 'QQQ', name: 'Invesco QQQ (나스닥 100)' },
    { symbol: 'VT', name: 'Vanguard Total World' },
    { symbol: 'SCHD', name: 'Schwab US Dividend Equity' },
  ],
  BOND: [
    { symbol: '148070.KS', name: 'KOSEF 국고채10년' },
    { symbol: '114260.KS', name: 'KODEX 국고채3년' },
    { symbol: 'TLT', name: 'iShares 20+년 미국채' },
    { symbol: 'IEF', name: 'iShares 7-10년 미국채' },
    { symbol: 'SHY', name: 'iShares 1-3년 미국채' },
    { symbol: 'LQD', name: 'iShares 투자등급 회사채' },
  ],
  COMMODITY: [
    { symbol: 'GC=F', name: '금 선물' },
    { symbol: 'SI=F', name: '은 선물' },
    { symbol: 'CL=F', name: 'WTI 원유 선물' },
    { symbol: 'HG=F', name: '구리 선물' },
    { symbol: '132030.KS', name: 'KODEX 골드선물(H)' },
    { symbol: 'GLD', name: 'SPDR Gold Shares' },
  ],
  CRYPTO: [
    { symbol: 'BTC-KRW', name: '비트코인 (원화)' },
    { symbol: 'ETH-KRW', name: '이더리움 (원화)' },
    { symbol: 'BTC-USD', name: '비트코인 (달러)' },
  ],
  STOCK: [
    { symbol: '005930.KS', name: '삼성전자' },
    { symbol: '000660.KS', name: 'SK하이닉스' },
    { symbol: 'AAPL', name: 'Apple' },
    { symbol: 'NVDA', name: 'NVIDIA' },
    { symbol: 'MSFT', name: 'Microsoft' },
  ],
};

export const BENCHMARKS: { symbol: string; name: string }[] = [
  { symbol: '^KS11', name: '코스피' },
  { symbol: '^GSPC', name: 'S&P 500 (원화)' },
  { symbol: '^IXIC', name: '나스닥 (원화)' },
  { symbol: 'GC=F', name: '금 (원화)' },
];

export interface Close {
  date: string;
  close: number;
}

/** Last close on or before `date` */
export function closeAt(s: Close[], date: string): Close | null {
  let lo = 0, hi = s.length - 1, hit = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (s[mid].date <= date) {
      hit = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return hit < 0 ? null : s[hit];
}

/**
 * Drop glitches in a price history: points more than 40% away from the median of the eleven
 * around them (Yahoo's won-dollar history has stretches around 0.1 among 1,100s).
 */
export function dropSpikes(s: Close[]): Close[] {
  return s.filter((c, i) => {
    const win = s.slice(Math.max(0, i - 5), i + 6).map((x) => x.close).sort((a, b) => a - b);
    const med = win[Math.floor(win.length / 2)];
    return Math.abs(c.close / med - 1) <= 0.4;
  });
}

/** Exchange rates do not move several-fold: drop points more than 60% from the series median (Yahoo has months of 0.11 in KRW=X) */
export function cleanFx(s: Close[]): Close[] {
  if (!s.length) return s;
  const med = [...s].map((c) => c.close).sort((a, b) => a - b)[Math.floor(s.length / 2)];
  return s.filter((c) => Math.abs(c.close / med - 1) <= 0.6);
}

/** A dollar series in won with the KRW per USD rate on (or before) each day */
export function toKrw(s: Close[], fx: Close[]): Close[] {
  return s.flatMap((c) => {
    const r = closeAt(fx, c.date);
    return r ? [{ date: c.date, close: c.close * r.close }] : [];
  });
}

export interface VPosition {
  id: string;
  kind: VKind;
  name: string;
  buyDate: string;
  sellDate: string | null;
  mode: 'AMOUNT' | 'QTY';
  amount: number | null;
  qty: number | null;
  rate: number | null;
}

export interface PositionResult {
  id: string;
  /** won paid on the buy date */
  cost: number | null;
  /** price in won used at the buy (and at the sale) */
  buyPrice: number | null;
  sellPrice: number | null;
  units: number | null;
  /** value on each calendar day (null before the buy) */
  values: (number | null)[];
  /** why it could not be valued */
  problem: string | null;
}

const DAY = 86_400_000;
const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / DAY;

/**
 * One position over the calendar. Market kinds buy `amount` won (or `qty` units) at the close on
 * or before the buy date; REAL_ESTATE follows its index from the buy month; FIXED compounds daily
 * at `rate`; CASH stays. After a sale the proceeds are held as cash.
 */
export function valuePosition(p: VPosition, series: Close[] | null, calendar: string[]): PositionResult {
  const empty = (problem: string): PositionResult => ({ id: p.id, cost: null, buyPrice: null, sellPrice: null, units: null, values: calendar.map(() => null), problem });
  const end = p.sellDate;
  if (p.kind === 'CASH' || p.kind === 'FIXED') {
    if (!p.amount || p.amount <= 0) return empty('금액이 없습니다');
    const r = p.kind === 'FIXED' ? (p.rate ?? 0) : 0;
    const at = (d: string) => p.amount! * (1 + r) ** (Math.max(0, days(p.buyDate, d)) / 365);
    const sold = end ? at(end) : null;
    return { id: p.id, cost: p.amount, buyPrice: null, sellPrice: null, units: null, values: calendar.map((d) => (d < p.buyDate ? null : end && d >= end ? sold : at(d))), problem: null };
  }
  if (!series?.length) return empty('시세 이력을 받지 못했습니다');
  const buy = closeAt(series, p.buyDate);
  if (!buy || days(buy.date, p.buyDate) > (p.kind === 'REAL_ESTATE' ? 62 : 14)) return empty(`${p.buyDate}의 시세가 없습니다(자료가 ${series[0].date}부터 있습니다)`);
  let units: number;
  let cost: number;
  if (p.mode === 'QTY' && p.kind !== 'REAL_ESTATE') {
    if (!p.qty || p.qty <= 0) return empty('수량이 없습니다');
    units = p.qty;
    cost = p.qty * buy.close;
  } else {
    if (!p.amount || p.amount <= 0) return empty('금액이 없습니다');
    units = p.amount / buy.close;
    cost = p.amount;
  }
  const sell = end ? closeAt(series, end) : null;
  const sellValue = sell ? units * sell.close : null;
  return {
    id: p.id,
    cost,
    buyPrice: buy.close,
    sellPrice: sell?.close ?? null,
    units: p.kind === 'REAL_ESTATE' ? null : units,
    values: calendar.map((d) => {
      if (d < p.buyDate) return null;
      if (end && d >= end) return sellValue;
      const c = closeAt(series, d);
      return c ? units * c.close : null;
    }),
    problem: null,
  };
}

export interface PortfolioPath {
  dates: string[];
  value: number[];
  invested: number[];
  /** time-weighted index from 1 (new money does not count as gain) */
  twr: number[];
  /** the same cash flows put into the benchmark */
  bench: (number | null)[];
}

/** Sum the positions; new purchases are cash flows for the time-weighted index and the benchmark */
export function portfolioPath(positions: { p: VPosition; r: PositionResult }[], calendar: string[], bench: Close[] | null): PortfolioPath {
  const ok = positions.filter((x) => !x.r.problem && x.r.cost);
  const value: number[] = [], invested: number[] = [], twr: number[] = [], benchV: (number | null)[] = [];
  let index = 1, prev = 0, units = 0;
  calendar.forEach((d, i) => {
    let v = 0, inv = 0, flow = 0;
    for (const { p, r } of ok) {
      if (d < p.buyDate) continue;
      v += r.values[i] ?? 0;
      inv += r.cost!;
      if (i === 0 ? d >= p.buyDate : calendar[i - 1] < p.buyDate) flow += r.cost!;
    }
    if (prev > 0) index *= (v - flow) / prev;
    prev = v;
    value.push(v);
    invested.push(inv);
    twr.push(index);
    if (bench) {
      const b = closeAt(bench, d);
      if (b && flow) units += flow / b.close;
      benchV.push(b ? units * b.close : null);
    } else benchV.push(null);
  });
  return { dates: calendar, value, invested, twr, bench: benchV };
}

/** Weekdays from `from` to `to` (inclusive), the chart's calendar */
export function weekdays(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += DAY) {
    const w = new Date(t).getUTCDay();
    if (w !== 0 && w !== 6) out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

/** Max drawdown of a value path, ignoring days with new money (uses the time-weighted index) */
export function maxDrawdown(twr: number[]): number {
  let peak = -Infinity, dd = 0;
  for (const v of twr) {
    peak = Math.max(peak, v);
    dd = Math.min(dd, v / peak - 1);
  }
  return dd;
}
