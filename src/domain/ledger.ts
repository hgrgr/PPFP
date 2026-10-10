/**
 * Replays a portfolio's transactions to get positions and cash at any date,
 * and builds the daily value series that period analysis reads.
 */
import { Dec } from './decimal';
import { QTY_DP } from './lots';

export const TXN_TYPES = [
  'BUY',
  'SELL',
  'DEPOSIT',
  'WITHDRAW',
  'DIVIDEND',
  'INTEREST',
  'FEE',
  'TAX',
  'SPLIT',
  'VALUATION',
  'REPAY',
] as const;
export type TxnType = (typeof TXN_TYPES)[number];

export const TXN_LABEL: Record<TxnType, string> = {
  BUY: '매수',
  SELL: '매도',
  DEPOSIT: '입금',
  WITHDRAW: '출금',
  DIVIDEND: '배당',
  INTEREST: '이자',
  FEE: '수수료',
  TAX: '세금',
  SPLIT: '분할·병합',
  VALUATION: '평가 갱신',
  REPAY: '상환·인출',
};

export interface LedgerTxn {
  id: string;
  type: TxnType;
  /** ISO date-time. Only the date part (YYYY-MM-DD, local business date) matters for daily series. */
  tradeAt: string;
  holdingId?: string | null;
  /** Units bought or sold (always positive). */
  qty?: Dec | null;
  /** SPLIT: new shares per old share. */
  splitRatio?: Dec | null;
  /** Currency of the cash movement / flow. */
  currency: string;
  /** Signed change of the portfolio's cash in `currency`. */
  cashDelta: Dec;
  /**
   * Signed money entering (+) or leaving (−) the portfolio from outside, in `currency`.
   * DEPOSIT/WITHDRAW, and buys/sells settled outside the portfolio's cash
   * (e.g. registering an apartment you already own).
   */
  flow: Dec;
}

export interface Positions {
  qty: Map<string, Dec>;
  cash: Map<string, Dec>;
}

export function dateOf(iso: string): string {
  return iso.slice(0, 10);
}

function sortTxns(txns: LedgerTxn[]): LedgerTxn[] {
  return [...txns].sort((a, b) => (a.tradeAt < b.tradeAt ? -1 : a.tradeAt > b.tradeAt ? 1 : a.id < b.id ? -1 : 1));
}

export function applyTxn(pos: Positions, t: LedgerTxn): void {
  if (!t.cashDelta.isZero()) {
    pos.cash.set(t.currency, (pos.cash.get(t.currency) ?? Dec.ZERO).add(t.cashDelta));
  }
  if (!t.holdingId) return;
  const cur = pos.qty.get(t.holdingId) ?? Dec.ZERO;
  if (t.type === 'BUY' && t.qty) pos.qty.set(t.holdingId, cur.add(t.qty));
  else if (t.type === 'SELL' && t.qty) pos.qty.set(t.holdingId, cur.sub(t.qty));
  else if (t.type === 'SPLIT' && t.splitRatio) pos.qty.set(t.holdingId, cur.mul(t.splitRatio).round(QTY_DP));
}

/** Positions after every transaction whose date is on or before `asOfDate` (YYYY-MM-DD). */
export function positionsAsOf(txns: LedgerTxn[], asOfDate: string): Positions {
  const pos: Positions = { qty: new Map(), cash: new Map() };
  for (const t of sortTxns(txns)) {
    if (dateOf(t.tradeAt) > asOfDate) break;
    applyTxn(pos, t);
  }
  return pos;
}

export interface HoldingRef {
  id: string;
  currency: string;
  /** Unit price in `currency` on (or most recently before) the date; null if unknown. */
  priceOn: (date: string) => Dec | null;
}

export interface DailyPoint {
  date: string;
  /** Total value in base currency (holdings + cash). */
  value: Dec;
  /** External flow on that date in base currency. */
  flow: Dec;
  /** Value by holding id in base currency. */
  byHolding: Map<string, Dec>;
  cash: Dec;
}

/**
 * Daily value series for one portfolio over `dates` (ascending YYYY-MM-DD).
 * `fxOn(currency, date)` returns base-currency units per one unit of currency.
 */
export function dailySeries(
  dates: string[],
  txns: LedgerTxn[],
  holdings: HoldingRef[],
  fxOn: (currency: string, date: string) => Dec,
): DailyPoint[] {
  const sorted = sortTxns(txns);
  const pos: Positions = { qty: new Map(), cash: new Map() };
  const byId = new Map(holdings.map((h) => [h.id, h]));
  let i = 0;
  const out: DailyPoint[] = [];
  // transactions before the first date only shape the starting positions
  for (const date of dates) {
    let flow = Dec.ZERO;
    while (i < sorted.length && dateOf(sorted[i].tradeAt) <= date) {
      const t = sorted[i];
      applyTxn(pos, t);
      if (dateOf(t.tradeAt) === date && !t.flow.isZero()) flow = flow.add(t.flow.mul(fxOn(t.currency, date)));
      i++;
    }
    const byHolding = new Map<string, Dec>();
    let value = Dec.ZERO;
    for (const [hid, q] of pos.qty) {
      if (q.isZero()) continue;
      const h = byId.get(hid);
      if (!h) continue;
      const p = h.priceOn(date);
      if (!p) continue;
      const v = q.mul(p).mul(fxOn(h.currency, date));
      byHolding.set(hid, v);
      value = value.add(v);
    }
    let cash = Dec.ZERO;
    for (const [ccy, amt] of pos.cash) cash = cash.add(amt.mul(fxOn(ccy, date)));
    value = value.add(cash);
    out.push({ date, value, flow, byHolding, cash });
  }
  return out;
}

/** Business days (Mon–Fri) from `from` to `to` inclusive, as YYYY-MM-DD. */
export function weekdays(from: string, to: string): string[] {
  const out: string[] = [];
  let t = Date.parse(from + 'T00:00:00Z');
  const end = Date.parse(to + 'T00:00:00Z');
  while (t <= end) {
    const d = new Date(t);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) out.push(d.toISOString().slice(0, 10));
    t += 86_400_000;
  }
  return out;
}
