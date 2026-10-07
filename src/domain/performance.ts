/**
 * Period analysis over a daily series of (value, external flow).
 *
 * Convention: a flow recorded on day t is already included in value_t.
 * Daily return r_t = (value_t − flow_t) / value_{t−1} − 1.
 * Time-weighted return chains the daily returns, so deposits and
 * withdrawals do not show up as performance.
 */
import { Dec } from './decimal';

export interface SeriesPoint {
  date: string;
  value: Dec;
  flow: Dec;
}

export interface PeriodSummary {
  startDate: string;
  endDate: string;
  startValue: Dec;
  endValue: Dec;
  /** Sum of external flows after the start date up to and including the end date. */
  netFlow: Dec;
  /** endValue − startValue − netFlow */
  pnl: Dec;
  /** Time-weighted return as a fraction (0.05 = 5%). */
  twr: Dec;
  /** Largest peak-to-trough fall of the TWR index inside the period, as a negative fraction or 0. */
  maxDrawdown: Dec;
}

/** Index of the last point whose date is <= `date`, or -1. */
export function indexAtOrBefore(series: SeriesPoint[], date: string): number {
  let lo = 0, hi = series.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid].date <= date) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

export function dailyReturn(prev: SeriesPoint, cur: SeriesPoint): Dec {
  if (!prev.value.isPos()) return Dec.ZERO;
  return cur.value.sub(cur.flow).div(prev.value).sub(1);
}

/** Cumulative TWR index (starts at 1) for every point of the series. */
export function twrIndex(series: SeriesPoint[]): Dec[] {
  const idx: Dec[] = [];
  series.forEach((p, i) => {
    if (i === 0) idx.push(Dec.ONE);
    else idx.push(idx[i - 1].mul(Dec.ONE.add(dailyReturn(series[i - 1], p))));
  });
  return idx;
}

export function summarize(series: SeriesPoint[], startDate: string, endDate: string): PeriodSummary | null {
  if (series.length === 0) return null;
  let s = indexAtOrBefore(series, startDate);
  const e = indexAtOrBefore(series, endDate);
  if (e < 0) return null;
  if (s < 0) s = 0; // period starts before history: start at first point
  if (s > e) s = e;
  const startValue = s === 0 && series[0].date > startDate ? Dec.ZERO : series[s].value;
  // If history starts inside the period, the very first point's flow counts too.
  const includeFirst = s === 0 && series[0].date > startDate;
  let netFlow = Dec.ZERO;
  for (let i = includeFirst ? s : s + 1; i <= e; i++) netFlow = netFlow.add(series[i].flow);
  let growth = Dec.ONE, peak = Dec.ONE, mdd = Dec.ZERO;
  for (let i = s + 1; i <= e; i++) {
    growth = growth.mul(Dec.ONE.add(dailyReturn(series[i - 1], series[i])));
    if (growth.gt(peak)) peak = growth;
    const dd = growth.div(peak).sub(1);
    if (dd.lt(mdd)) mdd = dd;
  }
  const endValue = series[e].value;
  return {
    startDate: series[s].date,
    endDate: series[e].date,
    startValue,
    endValue,
    netFlow,
    pnl: endValue.sub(startValue).sub(netFlow),
    twr: growth.sub(1),
    maxDrawdown: mdd,
  };
}

/** Add several series point-by-point (same dates assumed after alignment), each scaled by a weight. */
export function combineSeries(parts: { weight: Dec; series: SeriesPoint[] }[]): SeriesPoint[] {
  const dates = new Set<string>();
  for (const p of parts) for (const pt of p.series) dates.add(pt.date);
  const sorted = [...dates].sort();
  return sorted.map((date) => {
    let value = Dec.ZERO, flow = Dec.ZERO;
    for (const p of parts) {
      const i = indexAtOrBefore(p.series, date);
      if (i < 0) continue;
      const pt = p.series[i];
      value = value.add(pt.value.mul(p.weight));
      // a flow only belongs to its own date
      if (pt.date === date) flow = flow.add(pt.flow.mul(p.weight));
    }
    return { date, value, flow };
  });
}

/** Evenly thin a series to at most `max` points, always keeping the first and last. */
export function downsample<T>(points: T[], max: number): T[] {
  if (points.length <= max || max < 2) return points;
  const out: T[] = [];
  for (let k = 0; k < max; k++) out.push(points[Math.round((k * (points.length - 1)) / (max - 1))]);
  return out;
}
