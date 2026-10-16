/**
 * 리스크 분석: how much the portfolio as it stands now would have moved, from its listed holdings'
 * daily closes. Today's weights are held fixed over the history (a what-if, not the account's
 * actual record). Returns, volatility, value at risk, drawdown, risk contributions, correlations
 * and exposures to factor proxies by least squares. Pure.
 */

export interface Close {
  date: string;
  close: number;
}

/**
 * Daily simple returns on a common calendar (the dates `calendar` lists), each series carried
 * forward over its own market's holidays. Dates before a series starts are dropped for all.
 */
export function alignedReturns(series: Map<string, Close[]>, calendar: string[]): { dates: string[]; returns: Map<string, number[]> } {
  const keys = [...series.keys()];
  const start = keys.reduce((a, k) => {
    const first = series.get(k)?.[0]?.date;
    return first && first > a ? first : a;
  }, '');
  const days = calendar.filter((d) => d >= start);
  const levels = new Map<string, number[]>();
  for (const k of keys) {
    const s = series.get(k) ?? [];
    const out: number[] = [];
    let j = 0;
    let last = NaN;
    for (const d of days) {
      while (j < s.length && s[j].date <= d) last = s[j++].close;
      out.push(last);
    }
    levels.set(k, out);
  }
  const returns = new Map<string, number[]>();
  for (const [k, l] of levels) returns.set(k, l.slice(1).map((v, i) => (l[i] > 0 && v > 0 ? v / l[i] - 1 : 0)));
  return { dates: days.slice(1), returns };
}

/** Prices in another currency converted with an FX series (KRW per USD) on the same days */
export function convert(closes: Close[], fx: Close[]): Close[] {
  let j = 0;
  let rate = NaN;
  const out: Close[] = [];
  for (const c of closes) {
    while (j < fx.length && fx[j].date <= c.date) rate = fx[j++].close;
    if (Number.isFinite(rate)) out.push({ date: c.date, close: c.close * rate });
  }
  return out;
}

const mean = (v: number[]) => v.reduce((a, x) => a + x, 0) / (v.length || 1);
function cov(a: number[], b: number[]): number {
  const ma = mean(a), mb = mean(b);
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - ma) * (b[i] - mb);
  return s / Math.max(1, a.length - 1);
}
export const stdev = (v: number[]) => Math.sqrt(cov(v, v));

/** The fixed-weight portfolio's daily returns */
export function portfolioReturns(returns: Map<string, number[]>, weights: Map<string, number>): number[] {
  const keys = [...weights.keys()].filter((k) => returns.has(k));
  const n = returns.get(keys[0])?.length ?? 0;
  const out = new Array(n).fill(0);
  for (const k of keys) {
    const r = returns.get(k)!, w = weights.get(k)!;
    for (let i = 0; i < n; i++) out[i] += w * r[i];
  }
  return out;
}

export interface RiskStats {
  /** annualized */
  vol: number;
  /** compound annual growth of the fixed-weight portfolio */
  cagr: number;
  /** 1-day 95% historical value at risk and expected shortfall (positive = loss) */
  var95: number;
  cvar95: number;
  maxDrawdown: number;
  drawdownFrom: string | null;
  drawdownTo: string | null;
  worstDay: { date: string; ret: number } | null;
  sharpe: number | null;
}

export function riskStats(r: number[], dates: string[], rf = 0.03): RiskStats {
  const vol = stdev(r) * Math.sqrt(252);
  const growth = r.reduce((a, x) => a * (1 + x), 1);
  const years = r.length / 252;
  const cagr = years > 0 ? growth ** (1 / years) - 1 : 0;
  const sorted = [...r].sort((a, b) => a - b);
  const k = Math.max(0, Math.floor(sorted.length * 0.05) - 1);
  const tail = sorted.slice(0, k + 1);
  let peak = 1, level = 1, maxDd = 0, peakAt = 0, from: number | null = null, to: number | null = null;
  r.forEach((x, i) => {
    level *= 1 + x;
    if (level > peak) {
      peak = level;
      peakAt = i;
    }
    const dd = level / peak - 1;
    if (dd < maxDd) {
      maxDd = dd;
      from = peakAt;
      to = i;
    }
  });
  let worst: RiskStats['worstDay'] = null;
  r.forEach((x, i) => {
    if (!worst || x < worst.ret) worst = { date: dates[i], ret: x };
  });
  return {
    vol,
    cagr,
    var95: sorted.length ? -sorted[k] : 0,
    cvar95: tail.length ? -mean(tail) : 0,
    maxDrawdown: maxDd,
    drawdownFrom: from === null ? null : dates[from],
    drawdownTo: to === null ? null : dates[to],
    worstDay: worst,
    sharpe: vol ? (cagr - rf) / vol : null,
  };
}

/** Each holding's share of the portfolio's variance (sums to 1): w_i · (Σw)_i / σ²ₚ */
export function riskContributions(returns: Map<string, number[]>, weights: Map<string, number>): Map<string, number> {
  const keys = [...weights.keys()].filter((k) => returns.has(k));
  const sigma = keys.map((a) => keys.map((b) => cov(returns.get(a)!, returns.get(b)!)));
  const w = keys.map((k) => weights.get(k)!);
  const sw = sigma.map((row) => row.reduce((a, s, j) => a + s * w[j], 0));
  const variance = w.reduce((a, x, i) => a + x * sw[i], 0);
  return new Map(keys.map((k, i) => [k, variance ? (w[i] * sw[i]) / variance : 0]));
}

export function correlation(a: number[], b: number[]): number {
  const d = stdev(a) * stdev(b);
  return d ? cov(a, b) / d : 0;
}

/** Solve A x = b by Gaussian elimination with partial pivoting (small systems) */
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-14) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/** Least squares y = α + Σ βⱼ xⱼ: betas, alpha (daily) and R² */
export function regress(y: number[], xs: number[][]): { alpha: number; betas: number[]; r2: number } | null {
  const n = y.length, k = xs.length;
  if (n < k + 10) return null;
  const X = (i: number) => [1, ...xs.map((x) => x[i])];
  const XtX = Array.from({ length: k + 1 }, () => new Array(k + 1).fill(0));
  const Xty = new Array(k + 1).fill(0);
  for (let i = 0; i < n; i++) {
    const row = X(i);
    for (let a = 0; a <= k; a++) {
      Xty[a] += row[a] * y[i];
      for (let b = 0; b <= k; b++) XtX[a][b] += row[a] * row[b];
    }
  }
  const coef = solve(XtX, Xty);
  if (!coef) return null;
  const my = mean(y);
  let ssr = 0, sst = 0;
  for (let i = 0; i < n; i++) {
    const fit = X(i).reduce((a, v, j) => a + v * coef[j], 0);
    ssr += (y[i] - fit) ** 2;
    sst += (y[i] - my) ** 2;
  }
  return { alpha: coef[0], betas: coef.slice(1), r2: sst ? 1 - ssr / sst : 0 };
}

/** Beta to one benchmark over a rolling window, sampled every `step` days */
export function rollingBeta(y: number[], x: number[], dates: string[], window: number, step: number): { date: string; beta: number }[] {
  const out: { date: string; beta: number }[] = [];
  for (let e = window; e <= y.length; e += step) {
    const ys = y.slice(e - window, e), xsl = x.slice(e - window, e);
    const v = cov(xsl, xsl);
    if (v) out.push({ date: dates[e - 1], beta: Number((cov(ys, xsl) / v).toFixed(3)) });
  }
  return out;
}
