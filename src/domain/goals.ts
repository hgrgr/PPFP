/**
 * Goal projections (Monte Carlo on monthly returns) and rebalancing backtests on daily
 * closes. Expected returns and volatilities are stated assumptions the user can change,
 * never forecasts.
 */

/** Long-run assumptions per asset type: annual expected return and volatility. */
export const ASSUMPTIONS: Record<string, { ret: number; vol: number }> = {
  KR_STOCK: { ret: 0.07, vol: 0.2 },
  US_STOCK: { ret: 0.08, vol: 0.17 },
  CRYPTO: { ret: 0.12, vol: 0.65 },
  BOND: { ret: 0.035, vol: 0.06 },
  CASH: { ret: 0.03, vol: 0.005 },
  CASH_BAL: { ret: 0.02, vol: 0 },
  REAL_ESTATE: { ret: 0.05, vol: 0.1 },
  FUND: { ret: 0.06, vol: 0.15 },
  ALTERNATIVE: { ret: 0.05, vol: 0.12 },
};
/** Assumed correlation between any two different risky asset types */
const RHO = 0.3;

/** Mix-weighted expected return and volatility from value per asset type. */
export function mixAssumptions(values: Record<string, number>): { ret: number; vol: number } {
  const total = Object.values(values).reduce((s, v) => s + Math.max(0, v), 0);
  if (total <= 0) return { ret: 0.05, vol: 0.12 };
  const parts = Object.entries(values)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => ({ w: v / total, ...(ASSUMPTIONS[k] ?? { ret: 0.05, vol: 0.12 }) }));
  const ret = parts.reduce((s, p) => s + p.w * p.ret, 0);
  let variance = 0;
  for (const a of parts) for (const b of parts) variance += a.w * b.w * a.vol * b.vol * (a === b ? 1 : RHO);
  return { ret, vol: Math.sqrt(variance) };
}

/** Small deterministic PRNG so the same inputs draw the same paths. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normal(rand: () => number) {
  const u = Math.max(rand(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

export interface GoalInput {
  start: number;
  monthly: number;
  months: number;
  target: number;
  ret: number;
  vol: number;
  /** Shown in today's money: values are deflated by this annual rate */
  inflation?: number;
  paths?: number;
  seed?: number;
}

const quantile = (sorted: number[], q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];

/**
 * Value at each year end (10th / 50th / 90th percentile and the no-volatility path), the
 * chance of reaching the target by the end, and the month the median path gets there.
 */
export function simulateGoal(g: GoalInput) {
  const paths = g.paths ?? 2000;
  const rand = mulberry32(g.seed ?? 42);
  const mu = Math.log(1 + g.ret) / 12 - (g.vol * g.vol) / 24;
  const sigma = g.vol / Math.sqrt(12);
  const defl = (m: number) => Math.pow(1 + (g.inflation ?? 0), m / 12);
  const checkpoints = new Set<number>();
  for (let m = 12; m < g.months; m += 12) checkpoints.add(m);
  checkpoints.add(g.months);
  const at: Map<number, number[]> = new Map([...checkpoints].map((m) => [m, []]));
  let reached = 0;
  const reachMonth: number[] = [];
  for (let p = 0; p < paths; p++) {
    let v = g.start;
    let hit = -1;
    for (let m = 1; m <= g.months; m++) {
      v = v * Math.exp(mu + sigma * normal(rand)) + g.monthly;
      const real = v / defl(m);
      if (hit < 0 && real >= g.target) hit = m;
      at.get(m)?.push(real);
    }
    if (hit >= 0) {
      reached++;
      reachMonth.push(hit);
    }
  }
  // The same plan with no ups and downs
  let flat = g.start;
  const flatAt = new Map<number, number>();
  for (let m = 1; m <= g.months; m++) {
    flat = flat * Math.pow(1 + g.ret, 1 / 12) + g.monthly;
    if (checkpoints.has(m)) flatAt.set(m, flat / defl(m));
  }
  const years = [...checkpoints].sort((a, b) => a - b).map((m) => {
    const s = at.get(m)!.sort((a, b) => a - b);
    return { month: m, p10: quantile(s, 0.1), p50: quantile(s, 0.5), p90: quantile(s, 0.9), expected: flatAt.get(m)! };
  });
  reachMonth.sort((a, b) => a - b);
  return {
    probability: reached / paths,
    medianReachMonth: reached >= paths / 2 ? quantile(reachMonth, 0.5 * (paths / reached)) : null,
    contributed: g.start + g.monthly * g.months,
    years,
  };
}

/** Monthly saving needed for the no-volatility path to reach the target (0 if already there). */
export function monthlyNeeded(start: number, target: number, months: number, ret: number): number {
  const r = Math.pow(1 + ret, 1 / 12) - 1;
  const grown = start * Math.pow(1 + r, months);
  if (grown >= target) return 0;
  const factor = r === 0 ? months : (Math.pow(1 + r, months) - 1) / r;
  return (target - grown) / factor;
}

// ---------------------------------------------------------------- rebalancing backtest

export type RebalanceRule = 'NONE' | 'MONTHLY' | 'QUARTERLY' | 'BAND';

export const RULE_LABEL: Record<RebalanceRule, string> = { NONE: '그대로 두기', MONTHLY: '매월 리밸런싱', QUARTERLY: '분기 리밸런싱', BAND: '허용 오차를 벗어날 때' };

/**
 * Simulates holding `weights` (summing to 1) over aligned daily prices (one row per day,
 * one column per asset, KRW). A column of null keeps the last price. Rebalancing trades are
 * assumed free. Returns the value path (start = 1) and summary statistics.
 */
export function backtest(dates: string[], prices: (number | null)[][], weights: number[], rule: RebalanceRule, band = 0.05) {
  const n = weights.length;
  const last = prices[0].map((p) => p ?? 0);
  if (last.some((p) => p <= 0)) throw new Error('first day needs a price for every asset');
  let units = weights.map((w, i) => w / last[i]);
  const values: number[] = [];
  let rebalances = 0;
  let turnover = 0;
  for (let d = 0; d < dates.length; d++) {
    for (let i = 0; i < n; i++) if (prices[d][i] !== null && prices[d][i]! > 0) last[i] = prices[d][i]!;
    const value = units.reduce((s, u, i) => s + u * last[i], 0);
    values.push(value);
    const monthChange = d > 0 && dates[d].slice(0, 7) !== dates[d - 1].slice(0, 7);
    const quarterChange = monthChange && ['01', '04', '07', '10'].includes(dates[d].slice(5, 7));
    const shares = units.map((u, i) => (u * last[i]) / value);
    const out = shares.some((s, i) => Math.abs(s - weights[i]) > band);
    const go = d > 0 && ((rule === 'MONTHLY' && monthChange) || (rule === 'QUARTERLY' && quarterChange) || (rule === 'BAND' && out));
    if (go) {
      turnover += shares.reduce((s, x, i) => s + Math.abs(x - weights[i]), 0) / 2;
      units = weights.map((w, i) => (w * value) / last[i]);
      rebalances++;
    }
  }
  const days = values.length;
  const total = values[days - 1] / values[0] - 1;
  const yearsSpan = Math.max(1 / 365, (Date.parse(dates[days - 1]) - Date.parse(dates[0])) / (365.25 * 86_400_000));
  const rets = values.slice(1).map((v, i) => Math.log(v / values[i]));
  const mean = rets.reduce((s, r) => s + r, 0) / Math.max(1, rets.length);
  const sd = Math.sqrt(rets.reduce((s, r) => s + (r - mean) ** 2, 0) / Math.max(1, rets.length - 1));
  let peak = values[0];
  let mdd = 0;
  for (const v of values) {
    peak = Math.max(peak, v);
    mdd = Math.min(mdd, v / peak - 1);
  }
  return {
    values: values.map((v) => v / values[0]),
    totalReturn: total,
    cagr: Math.pow(1 + total, 1 / yearsSpan) - 1,
    volatility: sd * Math.sqrt(252),
    maxDrawdown: mdd,
    rebalances,
    turnover,
  };
}
