/**
 * Strategy portfolios: they own nothing and take shares of account holdings instead, so one
 * stock held once in an account can sit in several strategies. A strategy either splits
 * holdings with the others (their shares add up to at most 100%) or, with overlap allowed,
 * takes them in full whatever the others took. Either way the account counts the holding
 * once; strategies only look at it. Pure: the service loads and stores.
 */
import { Dec } from './decimal';
import type { SeriesPoint } from './performance';

export const PORTFOLIO_KINDS = ['ACCOUNT', 'STRATEGY'] as const;
export type PortfolioKind = (typeof PORTFOLIO_KINDS)[number];
export const PORTFOLIO_KIND_LABEL: Record<PortfolioKind, string> = {
  ACCOUNT: '계좌 (종목을 직접 보유)',
  STRATEGY: '전략 (계좌의 종목을 나눠 담기)',
};

export interface MemberShare {
  strategyId: string;
  share: Dec;
  allowOverlap: boolean;
}

/**
 * Can `strategy` take `share` of a holding others already take? A splitting strategy needs
 * room among the splitting ones; one that allows overlap only needs 0 < share <= 100%.
 */
export function checkShare(others: MemberShare[], strategy: { id: string; allowOverlap: boolean }, share: Dec): { ok: true } | { ok: false; message: string; room: Dec } {
  if (!share.isPos() || share.gt(Dec.ONE)) return { ok: false, message: '담을 비율은 0%보다 크고 100% 이하로 정하세요.', room: Dec.ONE };
  if (strategy.allowOverlap) return { ok: true };
  const taken = Dec.sum(others.filter((o) => o.strategyId !== strategy.id && !o.allowOverlap).map((o) => o.share));
  const room = Dec.max(Dec.ZERO, Dec.ONE.sub(taken));
  if (share.gt(room)) {
    return { ok: false, room, message: `다른 전략이 이미 ${pct(taken)}를 담아 ${pct(room)}까지만 담을 수 있습니다. 겹쳐 담으려면 이 전략에서 *겹쳐 담기 허용*을 켜세요.` };
  }
  return { ok: true };
}

const pct = (d: Dec) => `${Number(d.mul(100).toFixed(2))}%`;

export interface Membership {
  strategyId: string;
  name: string;
  share: Dec;
  allowOverlap: boolean;
}

export interface OverlapInfo {
  strategies: Membership[];
  /** In two or more strategies */
  overlap: boolean;
  /** Sum of the shares; over 1 only with overlap allowed */
  total: Dec;
  /** "배당 60% · 성장 40%" */
  label: string;
}

export function overlapInfo(list: Membership[]): OverlapInfo {
  const strategies = [...list].sort((a, b) => b.share.cmp(a.share) || a.name.localeCompare(b.name));
  return {
    strategies,
    overlap: strategies.length >= 2,
    total: Dec.sum(strategies.map((s) => s.share)),
    label: strategies.map((s) => `${s.name} ${pct(s.share)}`).join(' · '),
  };
}

/** One day of the account snapshots: value by holding id, KRW */
export interface HoldingDay {
  date: string;
  holdings: Record<string, string>;
}

/** A buy or sale of a member holding: the strategy's money in (+) or out (−) */
export interface MemberTrade {
  date: string;
  holdingId: string;
  type: 'BUY' | 'SELL';
  qty: Dec;
  price: Dec;
  fee: Dec;
  tax: Dec;
  fxRate: Dec;
}

/** KRW the strategy's share of a trade brings in (buy, costs included) or takes out (sale, net) */
export function tradeFlow(t: MemberTrade, share: Dec): Dec {
  const gross = t.qty.mul(t.price);
  const amount = t.type === 'BUY' ? gross.add(t.fee).add(t.tax) : gross.sub(t.fee).sub(t.tax).neg();
  return amount.mul(t.fxRate).mul(share);
}

/**
 * The strategy's daily value and flows from its account holdings: each day's holding values
 * times the shares, and buys and sales of those holdings as money in and out (so adding
 * shares to a held stock is not counted as profit). Shares are today's for every day.
 */
export function strategySeries(days: HoldingDay[], trades: MemberTrade[], shares: Map<string, Dec>): SeriesPoint[] {
  const byDate = new Map<string, Dec>();
  for (const d of days) {
    let v = byDate.get(d.date) ?? Dec.ZERO;
    for (const [hid, value] of Object.entries(d.holdings)) {
      const s = shares.get(hid);
      if (s) v = v.add(Dec.of(value).mul(s));
    }
    byDate.set(d.date, v);
  }
  const dates = [...byDate.keys()].sort();
  const flows = new Map<string, Dec>();
  for (const t of trades) {
    const s = shares.get(t.holdingId);
    if (!s) continue;
    // A trade on a day without a snapshot (weekend) lands on the next one
    const day = dates.find((d) => d >= t.date);
    if (!day) continue;
    flows.set(day, (flows.get(day) ?? Dec.ZERO).add(tradeFlow(t, s)));
  }
  return dates.map((date) => ({ date, value: byDate.get(date)!, flow: flows.get(date) ?? Dec.ZERO }));
}
