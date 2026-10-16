/**
 * Portfolio evaluation metrics from a series of periodic returns (daily, weekly or quarterly),
 * optionally against a benchmark's returns over the same periods. One set of definitions for the
 * dashboard, 포트폴리오 비교 and 거장 포트폴리오. Pure.
 *
 * Conventions: returns are simple (0.01 = 1%); annualization multiplies means by `perYear` and
 * standard deviations by √perYear; the risk-free rate is annual and turned into a per-period rate.
 */

export interface Metrics {
  periods: number;
  perYear: number;
  // 수익
  total: number;
  cagr: number | null;
  // 위험
  vol: number | null;
  downsideVol: number | null;
  maxDrawdown: number;
  /** periods from the peak before the deepest drawdown until back above it (null: not recovered yet) */
  drawdownLength: number | null;
  recovered: boolean;
  var95: number | null;
  cvar95: number | null;
  ulcer: number | null;
  skew: number | null;
  kurtosis: number | null;
  // 위험 대비 성과
  sharpe: number | null;
  sortino: number | null;
  calmar: number | null;
  omega: number | null;
  winRate: number | null;
  best: number | null;
  worst: number | null;
  // 시장 대비 (null without a benchmark)
  beta: number | null;
  alpha: number | null;
  treynor: number | null;
  correlation: number | null;
  trackingError: number | null;
  informationRatio: number | null;
  upCapture: number | null;
  downCapture: number | null;
  /** share of periods the portfolio beat the benchmark */
  hitRate: number | null;
  excess: number | null;
}

const mean = (v: number[]) => v.reduce((a, x) => a + x, 0) / (v.length || 1);
function sd(v: number[]): number {
  if (v.length < 2) return NaN;
  const m = mean(v);
  return Math.sqrt(v.reduce((a, x) => a + (x - m) ** 2, 0) / (v.length - 1));
}
const finite = (v: number) => (Number.isFinite(v) ? v : null);

/** Simple returns from a growth index (any level) */
export const toReturns = (index: number[]) => index.slice(1).map((x, i) => (index[i] > 0 ? x / index[i] - 1 : 0));

/** Observations per year from the average spacing of ISO dates */
export function perYearOf(dates: string[]): number {
  if (dates.length < 3) return 252;
  const gap = (Date.parse(dates.at(-1)!) - Date.parse(dates[0])) / 86_400_000 / (dates.length - 1);
  return gap > 60 ? 4 : gap > 20 ? 12 : gap > 4 ? 52 : 252;
}

/** At least this many periods before volatility-based figures mean anything */
const MIN = { 252: 40, 52: 20, 12: 12, 4: 6 } as Record<number, number>;

export function metrics(r: number[], perYear: number, bench: number[] | null = null, rfAnnual = 0.03): Metrics {
  const n = r.length;
  const rf = (1 + rfAnnual) ** (1 / perYear) - 1;
  const enough = n >= (MIN[perYear] ?? 20);
  const growth = r.reduce((a, x) => a * (1 + x), 1);
  const total = growth - 1;
  const years = n / perYear;
  const cagr = years >= 0.5 ? growth ** (1 / years) - 1 : null;
  const vol = enough ? finite(sd(r) * Math.sqrt(perYear)) : null;
  // Downside deviation against the risk-free rate, over all periods (Sortino's definition)
  const down = r.map((x) => Math.min(0, x - rf));
  const downsideVol = enough ? finite(Math.sqrt(mean(down.map((x) => x * x))) * Math.sqrt(perYear)) : null;

  // Drawdowns on the growth path
  let level = 1, peak = 1, peakAt = -1, maxDd = 0, ddPeakAt = -1, ddTroughAt = -1, sumSq = 0;
  const path: number[] = [];
  r.forEach((x, i) => {
    level *= 1 + x;
    path.push(level);
    if (level > peak) {
      peak = level;
      peakAt = i;
    }
    const dd = level / peak - 1;
    sumSq += (dd * 100) ** 2;
    if (dd < maxDd) {
      maxDd = dd;
      ddPeakAt = peakAt;
      ddTroughAt = i;
    }
  });
  let drawdownLength: number | null = null, recovered = true;
  if (maxDd < 0) {
    const peakLevel = ddPeakAt >= 0 ? path[ddPeakAt] : 1;
    const back = path.findIndex((v, i) => i > ddTroughAt && v >= peakLevel);
    recovered = back >= 0;
    drawdownLength = recovered ? back - ddPeakAt : null;
  }
  const ulcer = n ? Math.sqrt(sumSq / n) / 100 : null;

  const sorted = [...r].sort((a, b) => a - b);
  const k = Math.max(0, Math.floor(n * 0.05) - 1);
  const var95 = enough ? -sorted[k] : null;
  const cvar95 = enough ? -mean(sorted.slice(0, k + 1)) : null;
  const m = mean(r), s = sd(r);
  const skew = enough && s ? finite(mean(r.map((x) => ((x - m) / s) ** 3))) : null;
  const kurtosis = enough && s ? finite(mean(r.map((x) => ((x - m) / s) ** 4)) - 3) : null;

  const excessMean = (mean(r) - rf) * perYear;
  const sharpe = vol ? excessMean / vol : null;
  const sortino = downsideVol ? excessMean / downsideVol : null;
  const calmar = cagr !== null && maxDd < 0 ? cagr / -maxDd : null;
  const gains = r.reduce((a, x) => a + Math.max(0, x - rf), 0), losses = r.reduce((a, x) => a + Math.max(0, rf - x), 0);
  const omega = enough && losses > 0 ? gains / losses : null;
  const winRate = n ? r.filter((x) => x > 0).length / n : null;

  let beta = null, alpha = null, treynor = null, correlation = null, trackingError = null, informationRatio = null, upCapture = null, downCapture = null, hitRate = null, excess = null;
  if (bench && bench.length === n && n >= 3) {
    const mb = mean(bench);
    let cov = 0, vb = 0, vp = 0;
    for (let i = 0; i < n; i++) {
      cov += (r[i] - m) * (bench[i] - mb);
      vb += (bench[i] - mb) ** 2;
      vp += (r[i] - m) ** 2;
    }
    beta = vb ? cov / vb : null;
    correlation = vb && vp ? cov / Math.sqrt(vb * vp) : null;
    // Jensen's alpha, annualized
    alpha = beta !== null ? (m - rf - beta * (mb - rf)) * perYear : null;
    treynor = beta ? excessMean / beta : null;
    const diff = r.map((x, i) => x - bench[i]);
    const te = sd(diff) * Math.sqrt(perYear);
    trackingError = enough ? finite(te) : null;
    informationRatio = trackingError ? (mean(diff) * perYear) / trackingError : null;
    const up = bench.map((b, i) => (b > 0 ? i : -1)).filter((i) => i >= 0);
    const dn = bench.map((b, i) => (b < 0 ? i : -1)).filter((i) => i >= 0);
    const geo = (idx: number[], arr: number[]) => idx.reduce((a, i) => a * (1 + arr[i]), 1) ** (1 / Math.max(1, idx.length)) - 1;
    upCapture = up.length ? finite(geo(up, r) / geo(up, bench)) : null;
    downCapture = dn.length ? finite(geo(dn, r) / geo(dn, bench)) : null;
    hitRate = diff.filter((x) => x > 0).length / n;
    const bGrowth = bench.reduce((a, x) => a * (1 + x), 1);
    excess = total - (bGrowth - 1);
  }
  return {
    periods: n,
    perYear,
    total,
    cagr,
    vol,
    downsideVol,
    maxDrawdown: maxDd,
    drawdownLength,
    recovered,
    var95,
    cvar95,
    ulcer,
    skew,
    kurtosis,
    sharpe: sharpe === null ? null : finite(sharpe),
    sortino: sortino === null ? null : finite(sortino),
    calmar: calmar === null ? null : finite(calmar),
    omega,
    winRate,
    best: n ? sorted.at(-1)! : null,
    worst: n ? sorted[0] : null,
    beta,
    alpha,
    treynor: treynor === null ? null : finite(treynor),
    correlation,
    trackingError,
    informationRatio: informationRatio === null ? null : finite(informationRatio),
    upCapture,
    downCapture,
    hitRate,
    excess,
  };
}

/** Labels, units and how to read each metric (Korean), for tables and tooltips */
export const METRIC_INFO: Record<Exclude<keyof Metrics, 'periods' | 'perYear' | 'recovered'>, { label: string; unit: '%' | 'x' | 'n' | 'p'; about: string; better: 'up' | 'down' | null }> = {
  total: { label: '누적 수익률', unit: '%', about: '기간 전체 수익률', better: 'up' },
  cagr: { label: '연 수익률', unit: '%', about: '1년으로 환산한 복리 수익률(기간 6개월 이상)', better: 'up' },
  vol: { label: '변동성', unit: '%', about: '수익률 표준편차의 연 환산. 클수록 많이 흔들림', better: 'down' },
  downsideVol: { label: '하방 변동성', unit: '%', about: '무위험 수익률보다 못한 기간만 센 변동성', better: 'down' },
  maxDrawdown: { label: '최대 낙폭', unit: '%', about: '고점에서 가장 크게 빠진 폭', better: 'up' },
  drawdownLength: { label: '낙폭 회복 기간', unit: 'p', about: '최대 낙폭 직전 고점에서 그 고점을 되찾기까지 걸린 기간', better: 'down' },
  var95: { label: 'VaR 95%', unit: '%', about: '스무 번에 한 번쯤 이보다 더 잃는 한 기간 손실', better: 'down' },
  cvar95: { label: 'CVaR 95%', unit: '%', about: 'VaR를 넘는 나쁜 기간들의 평균 손실', better: 'down' },
  ulcer: { label: '울서 지수', unit: '%', about: '낙폭의 깊이와 길이를 함께 잰 값(낙폭 제곱 평균의 제곱근)', better: 'down' },
  skew: { label: '왜도', unit: 'x', about: '음수면 큰 손실 쪽 꼬리가 긺', better: 'up' },
  kurtosis: { label: '초과 첨도', unit: 'x', about: '클수록 극단적인 날이 자주 나옴', better: 'down' },
  sharpe: { label: '샤프 지수', unit: 'x', about: '(수익률 − 무위험) ÷ 변동성. 위험 한 단위당 초과수익', better: 'up' },
  sortino: { label: '소르티노 지수', unit: 'x', about: '샤프와 같되 손실 쪽 변동성만으로 나눔', better: 'up' },
  calmar: { label: '칼마 지수', unit: 'x', about: '연 수익률 ÷ 최대 낙폭', better: 'up' },
  omega: { label: '오메가 비율', unit: 'x', about: '무위험 수익률 위 이익의 합 ÷ 아래 손실의 합. 1보다 크면 이익 쪽이 큼', better: 'up' },
  winRate: { label: '오른 기간 비율', unit: '%', about: '수익이 난 기간의 비율', better: 'up' },
  best: { label: '최고 기간', unit: '%', about: '한 기간에 가장 크게 오른 폭', better: 'up' },
  worst: { label: '최저 기간', unit: '%', about: '한 기간에 가장 크게 빠진 폭', better: 'up' },
  beta: { label: '베타', unit: 'x', about: '기준 지수가 1% 움직일 때 함께 움직이는 정도', better: null },
  alpha: { label: '알파 (연)', unit: '%', about: '베타로 설명되는 것보다 더 번 수익(젠센 알파)', better: 'up' },
  treynor: { label: '트레이너 지수', unit: 'x', about: '초과수익 ÷ 베타. 시장 위험 한 단위당 수익', better: 'up' },
  correlation: { label: '상관계수', unit: 'x', about: '기준 지수와 같이 움직인 정도', better: null },
  trackingError: { label: '추적오차', unit: '%', about: '기준 지수와 수익률 차이의 변동성', better: null },
  informationRatio: { label: '정보비율', unit: 'x', about: '기준 대비 초과수익 ÷ 추적오차. 꾸준히 이겼는지', better: 'up' },
  upCapture: { label: '상승 포착률', unit: '%', about: '기준이 오른 기간에 그 상승의 몇 %를 따라갔나', better: 'up' },
  downCapture: { label: '하락 포착률', unit: '%', about: '기준이 내린 기간에 그 하락의 몇 %를 같이 맞았나(낮을수록 방어)', better: 'down' },
  hitRate: { label: '기준을 이긴 기간', unit: '%', about: '기준 지수보다 수익이 높았던 기간의 비율', better: 'up' },
  excess: { label: '기준 대비 초과', unit: '%', about: '누적 수익률 − 기준 지수 누적 수익률', better: 'up' },
};

export const METRIC_GROUPS: { key: string; label: string; keys: (keyof typeof METRIC_INFO)[] }[] = [
  { key: 'return', label: '수익 · 위험', keys: ['total', 'cagr', 'vol', 'downsideVol', 'maxDrawdown', 'drawdownLength', 'var95', 'cvar95'] },
  { key: 'ratio', label: '위험 대비 성과', keys: ['sharpe', 'sortino', 'calmar', 'omega', 'ulcer', 'winRate', 'skew', 'kurtosis'] },
  { key: 'market', label: '기준 지수 대비', keys: ['excess', 'beta', 'alpha', 'treynor', 'informationRatio', 'trackingError', 'upCapture', 'downCapture', 'hitRate', 'correlation'] },
];

/** A metric's value as text: % with sign for returns, two decimals for ratios, periods for lengths */
export function formatMetric(key: keyof typeof METRIC_INFO, v: number | null, periodName = '일'): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const info = METRIC_INFO[key];
  if (info.unit === '%') return `${['total', 'cagr', 'alpha', 'excess', 'best', 'worst', 'maxDrawdown'].includes(key) && v > 0 ? '+' : ''}${(v * 100).toFixed(Math.abs(v) < 0.1 && key !== 'winRate' && key !== 'hitRate' ? 2 : 1)}%`;
  if (info.unit === 'p') return `${Math.round(v)}${periodName}`;
  return v.toFixed(2);
}

/** The last value of each ISO week (Monday-based), for comparing markets that close at different hours */
export function weeklyIndex(dates: string[], index: number[]): number[] {
  const out: number[] = [];
  let week = '';
  dates.forEach((d, i) => {
    const t = new Date(`${d}T00:00:00Z`);
    const monday = new Date(t.getTime() - ((t.getUTCDay() + 6) % 7) * 86_400_000).toISOString().slice(0, 10);
    if (monday === week) out[out.length - 1] = index[i];
    else {
      out.push(index[i]);
      week = monday;
    }
  });
  return out;
}

const MARKET_KEYS = ['beta', 'alpha', 'treynor', 'correlation', 'trackingError', 'informationRatio', 'upCapture', 'downCapture', 'hitRate'] as const;

/**
 * Daily metrics with the benchmark-relative ones taken from weekly returns: Korean and US markets
 * close hours apart, so day-by-day returns of the two barely line up (beta near 0) while weekly
 * ones do. `excess` stays the cumulative difference.
 */
export function metricsWithWeeklyMarket(dates: string[], index: number[], bench: number[] | null, rfAnnual = 0.03): Metrics {
  const per = perYearOf(dates);
  const daily = metrics(toReturns(index), per, bench ? toReturns(bench) : null, rfAnnual);
  if (!bench || per !== 252) return daily;
  const w = metrics(toReturns(weeklyIndex(dates, index)), 52, toReturns(weeklyIndex(dates, bench)), rfAnnual);
  const out = { ...daily };
  for (const k of MARKET_KEYS) (out as Record<string, unknown>)[k] = w[k];
  return out;
}
