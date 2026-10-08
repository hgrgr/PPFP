/** Comparing a portfolio's time-weighted return with benchmarks, and who contributed what. */

export interface Close {
  date: string;
  close: number;
}

/** The value at or before `date` in a date-sorted list (null before the first). */
export function asOf<T extends { date: string }>(list: T[], date: string): T | null {
  let lo = 0;
  let hi = list.length - 1;
  let ans: T | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].date <= date) {
      ans = list[mid];
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/**
 * A benchmark's cumulative return on each of `dates`, from the first date. `fx` converts
 * foreign closes to KRW (omit for local-currency returns). Null until the benchmark has data.
 */
export function benchmarkReturns(dates: string[], closes: Close[], fx?: Close[]): (number | null)[] {
  const krw = (d: string) => {
    const c = asOf(closes, d);
    if (!c) return null;
    if (!fx) return c.close;
    const r = asOf(fx, d) ?? fx[0];
    return r ? c.close * r.close : null;
  };
  const base = dates.length ? krw(dates[0]) : null;
  return dates.map((d) => {
    const v = krw(d);
    return base && v !== null ? v / base - 1 : null;
  });
}

export interface ContributionInput {
  key: string;
  label: string;
  group: string;
  startKrw: number;
  endKrw: number;
  /** Cash the position paid out in the period (sales, dividends) less what was put in (buys), KRW */
  cashKrw: number;
}

/**
 * Each position's P&L over the period (end − start + cash out − cash in) and its share of
 * the portfolio's starting value. The parts add up to the simple (not time-weighted) return.
 */
export function contributions(rows: ContributionInput[], startTotal: number) {
  const out = rows
    .map((r) => {
      const pnl = r.endKrw - r.startKrw + r.cashKrw;
      return { key: r.key, label: r.label, group: r.group, pnlKrw: Math.round(pnl), contributionPct: startTotal > 0 ? (pnl / startTotal) * 100 : null };
    })
    .filter((r) => Math.abs(r.pnlKrw) >= 1)
    .sort((a, b) => b.pnlKrw - a.pnlKrw);
  const groups = new Map<string, { label: string; pnlKrw: number }>();
  for (const r of out) {
    const g = groups.get(r.group) ?? { label: r.group, pnlKrw: 0 };
    g.pnlKrw += r.pnlKrw;
    groups.set(r.group, g);
  }
  const byGroup = [...groups.values()]
    .map((g) => ({ ...g, contributionPct: startTotal > 0 ? (g.pnlKrw / startTotal) * 100 : null }))
    .sort((a, b) => b.pnlKrw - a.pnlKrw);
  return { rows: out, byGroup, totalPnlKrw: out.reduce((s, r) => s + r.pnlKrw, 0) };
}
