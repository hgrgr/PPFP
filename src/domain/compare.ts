/**
 * 포트폴리오 비교: several return series (real portfolios, 가상 포트폴리오, indices) on one
 * calendar, with return, volatility, drawdown, Sharpe, correlations and calendar-year returns. Pure.
 */

export interface Series {
  key: string;
  label: string;
  kind: 'real' | 'virtual' | 'index';
  /** growth index on its own dates (any level; only ratios are used) */
  points: { date: string; index: number }[];
}

/** Each series carried forward onto the union of dates from the latest first date, rebased to 1 */
export function align(series: Series[]): { dates: string[]; values: Record<string, number[]> } {
  const live = series.filter((s) => s.points.length > 1);
  if (!live.length) return { dates: [], values: {} };
  const start = live.reduce((a, s) => (s.points[0].date > a ? s.points[0].date : a), '');
  const dates = [...new Set(live.flatMap((s) => s.points.map((p) => p.date)))].filter((d) => d >= start).sort();
  const values: Record<string, number[]> = {};
  for (const s of live) {
    let j = 0;
    let last = NaN;
    const out: number[] = [];
    for (const d of dates) {
      while (j < s.points.length && s.points[j].date <= d) last = s.points[j++].index;
      out.push(last);
    }
    const base = out.find((v) => Number.isFinite(v) && v > 0) ?? 1;
    values[s.key] = out.map((v) => (Number.isFinite(v) ? v / base : 1));
  }
  return { dates, values };
}

const mean = (v: number[]) => v.reduce((a, x) => a + x, 0) / (v.length || 1);
const sd = (v: number[]) => {
  const m = mean(v);
  return Math.sqrt(v.reduce((a, x) => a + (x - m) ** 2, 0) / Math.max(1, v.length - 1));
};
const returns = (v: number[]) => v.slice(1).map((x, i) => (v[i] > 0 ? x / v[i] - 1 : 0));

export interface Stats {
  total: number;
  cagr: number | null;
  vol: number | null;
  maxDrawdown: number;
  sharpe: number | null;
  best: number | null;
  worst: number | null;
}

/** Statistics of one aligned index; `perYear` is the number of observations in a year (252 daily, 52 weekly) */
export function stats(index: number[], dates: string[], perYear: number, rf = 0.03): Stats {
  const r = returns(index);
  const total = index.at(-1)! / index[0] - 1;
  const years = dates.length > 1 ? (Date.parse(dates.at(-1)!) - Date.parse(dates[0])) / (365.25 * 86_400_000) : 0;
  const cagr = years >= 0.5 ? (1 + total) ** (1 / years) - 1 : null;
  const vol = r.length > 10 ? sd(r) * Math.sqrt(perYear) : null;
  let peak = -Infinity, dd = 0;
  for (const v of index) {
    peak = Math.max(peak, v);
    dd = Math.min(dd, v / peak - 1);
  }
  return { total, cagr, vol, maxDrawdown: dd, sharpe: vol && cagr !== null ? (cagr - rf) / vol : null, best: r.length ? Math.max(...r) : null, worst: r.length ? Math.min(...r) : null };
}

export function correlation(a: number[], b: number[]): number | null {
  const ra = returns(a), rb = returns(b);
  if (ra.length < 10) return null;
  const ma = mean(ra), mb = mean(rb);
  let c = 0, va = 0, vb = 0;
  for (let i = 0; i < ra.length; i++) {
    c += (ra[i] - ma) * (rb[i] - mb);
    va += (ra[i] - ma) ** 2;
    vb += (rb[i] - mb) ** 2;
  }
  return va && vb ? c / Math.sqrt(va * vb) : null;
}

/** Return in each calendar year the dates cover (partial first and last years included, marked) */
export function yearly(index: number[], dates: string[]): { year: string; ret: number; partial: boolean }[] {
  const out: { year: string; ret: number; partial: boolean }[] = [];
  let startIdx = 0;
  for (let i = 1; i <= dates.length; i++) {
    if (i === dates.length || dates[i].slice(0, 4) !== dates[i - 1].slice(0, 4)) {
      const y = dates[i - 1].slice(0, 4);
      const base = startIdx === 0 ? index[0] : index[startIdx - 1];
      out.push({ year: y, ret: index[i - 1] / base - 1, partial: startIdx === 0 && dates[0].slice(5) > '01-10' || (i === dates.length && dates[i - 1].slice(5) < '12-20') });
      startIdx = i;
    }
  }
  return out;
}

/** Observations per year from the spacing of the dates */
export const perYearOf = (dates: string[]) => {
  if (dates.length < 3) return 252;
  const gap = (Date.parse(dates.at(-1)!) - Date.parse(dates[0])) / 86_400_000 / (dates.length - 1);
  return gap > 5 ? 52 : 252;
};
