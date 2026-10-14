/**
 * 지역 분석: one region of the apartment market in depth, several side by side, every 시도 on the
 * honeycomb cycle, and how a macro series leads or lags a region's prices.
 *
 * Everything here is a pure function of monthly series (dated on the first of the month, as in
 * indicators.ts), mostly 한국부동산원 R-ONE tables, so the screen, the tests and the demo agree.
 * Correlations are taken on changes (year-on-year %, or %p for rates), not on levels: two series
 * that both trend up correlate on levels whatever their relation.
 */
import { addMonths, changeOver, honeycombPhase, joinSeries, REGIONS, rollingSum, type ChartData, type Point, type SeriesReq } from './indicators';
import { RONE_REGION_ROWS } from './rone-regions';

// ---------------------------------------------------------------- regions and series

export type RoneSet = 'price' | 'jeonse' | 'median' | 'ratio' | 'demand' | 'jdemand' | 'conv' | 'trade';

export const RONE_SETS: Record<RoneSet, { table: string; label: string }> = {
  price: { table: 'A_2024_00045', label: '아파트 매매가격지수' },
  jeonse: { table: 'A_2024_00050', label: '아파트 전세가격지수' },
  median: { table: 'A_2024_00062', label: '아파트 중위 매매가격' },
  ratio: { table: 'A_2024_00073', label: '중위 매매가격 대비 전세가격' },
  demand: { table: 'A_2024_00076', label: '아파트 매매수급동향' },
  jdemand: { table: 'A_2024_00077', label: '아파트 전세수급동향' },
  conv: { table: 'A_2024_00156', label: '아파트 전월세 전환율' },
  trade: { table: 'A_2024_00554', label: '아파트 매매거래 (동·호수)' },
};
const SET_ORDER: RoneSet[] = ['price', 'jeonse', 'median', 'ratio', 'demand', 'jdemand', 'conv', 'trade'];

export interface RoneRegion {
  /** "서울", "서울>강남구", "경기>성남시>분당구" */
  key: string;
  /** "서울 강남구" */
  label: string;
  /** The 시도 (or the aggregate itself: 전국, 수도권 ...) */
  sido: string;
  /** 0 for 전국 and aggregates and 시도, 1 for 시군구, 2 for a 구 of a 시 */
  depth: number;
  /** CLS_ID in each table, 0 when the table has none */
  ids: Record<RoneSet, number>;
}

export const RONE_REGIONS: RoneRegion[] = RONE_REGION_ROWS.map(([key, ...ids]) => {
  const parts = key.split('>');
  return { key, label: parts.join(' '), sido: parts[0], depth: parts.length - 1, ids: Object.fromEntries(SET_ORDER.map((s, i) => [s, ids[i]])) as Record<RoneSet, number> };
});
const BY_KEY = new Map(RONE_REGIONS.map((r) => [r.key, r]));

export const roneRegion = (key: string | null | undefined): RoneRegion | undefined => (key ? BY_KEY.get(key) : undefined);

const SIDO_ALIASES: Record<string, string> = { 서울특별시: '서울', 부산광역시: '부산', 대구광역시: '대구', 인천광역시: '인천', 광주광역시: '광주', 대전광역시: '대전', 울산광역시: '울산', 세종특별자치시: '세종', 경기도: '경기', 강원도: '강원', 강원특별자치도: '강원', 충청북도: '충북', 충청남도: '충남', 전라북도: '전북', 전북특별자치도: '전북', 전라남도: '전남', 경상북도: '경북', 경상남도: '경남', 제주특별자치도: '제주' };

/**
 * The most specific region an address falls in: "경기 성남시 분당구 구미동 187-3" → 경기>성남시>분당구,
 * "서울특별시 강남구 ..." → 서울>강남구, falling back to the 시 or the 시도.
 */
export function regionOfAddress(address: string): RoneRegion | undefined {
  const words = address.trim().split(/\s+/);
  if (!words.length) return undefined;
  words[0] = SIDO_ALIASES[words[0]] ?? words[0];
  for (let n = Math.min(3, words.length); n >= 1; n--) {
    const r = BY_KEY.get(words.slice(0, n).join('>'));
    if (r) return r;
  }
  return undefined;
}

/** The 시도 and 전국: the regions the honeycomb board shows by default */
export const SIDO_KEYS = RONE_REGIONS.filter((r) => r.depth === 0 && !['수도권', '지방권', '5대광역시'].includes(r.key)).map((r) => r.key);

/** The R-ONE series id (as indicators.ts stores it) of a table, region and item */
export const roneId = (table: string, cls: number, item = '100001') => `IND:RONE:${table}/${cls}/${item}`;
const roneReq = (table: string, cls: number): SeriesReq => ({ id: roneId(table, cls), source: 'RONE', code: `${table}/${cls}/100001`, freq: 'M' });

/**
 * Where a region's series of `set` comes from: its own row, or — for 수급동향, published for
 * 시도 only — its 시도's. Null when neither has one.
 */
export function sourceOf(r: RoneRegion, set: RoneSet): { region: RoneRegion; req: SeriesReq } | null {
  for (const cand of [r, BY_KEY.get(r.sido)]) {
    if (cand && cand.ids[set]) return { region: cand, req: roneReq(RONE_SETS[set].table, cand.ids[set]) };
  }
  return null;
}

/** The series ids of a region's sets (what to read after loading) */
export function regionSeries(r: RoneRegion, sets: RoneSet[]): Partial<Record<RoneSet, { id: string; from: RoneRegion }>> {
  const out: Partial<Record<RoneSet, { id: string; from: RoneRegion }>> = {};
  for (const s of sets) {
    const src = sourceOf(r, s);
    if (src) out[s] = { id: src.req.id, from: src.region };
  }
  return out;
}

export function regionReqs(r: RoneRegion, sets: RoneSet[]): SeriesReq[] {
  return sets.flatMap((s) => {
    const src = sourceOf(r, s);
    return src ? [src.req] : [];
  });
}

/** 소비자물가지수 총지수 (ECOS 901Y009), to turn prices into real prices */
export const CPI_REQ: SeriesReq = { id: 'IND:ECOS:901Y009/M/0', source: 'ECOS', code: '901Y009/M/0', freq: 'M' };

/** 미분양 of the region's 시도 (ECOS 901Y074), when the 시도 is one of indicators.ts's */
export function unsoldReq(r: RoneRegion): SeriesReq | null {
  const sido = REGIONS.find((x) => x.name === r.sido);
  if (!sido) return null;
  const code = `901Y074/M/${sido.unsold}`;
  return { id: `IND:ECOS:${code}`, source: 'ECOS', code, freq: 'M' };
}

/** Series to set against a region's prices on the 상관·시차 tab, each with how it is turned into a change */
export const MACROS: { key: string; label: string; req: SeriesReq | null; change: 'yoy' | 'diff'; about: string }[] = [
  { key: 'base', label: '기준금리', req: { id: 'IND:ECOS:722Y001/M/0101000', source: 'ECOS', code: '722Y001/M/0101000', freq: 'M' }, change: 'diff', about: '한국은행 기준금리, 1년 전과의 차이(%p)' },
  { key: 'mortgage', label: '주택담보대출 금리', req: { id: 'IND:ECOS:121Y006/M/BECBLA0302', source: 'ECOS', code: '121Y006/M/BECBLA0302', freq: 'M' }, change: 'diff', about: '예금은행 주택담보대출 금리(신규), 1년 전과의 차이(%p)' },
  { key: 'kr10y', label: '국고채 10년', req: { id: 'IND:ECOS:721Y001/M/5050000', source: 'ECOS', code: '721Y001/M/5050000', freq: 'M' }, change: 'diff', about: '국고채 10년 금리, 1년 전과의 차이(%p)' },
  { key: 'm2', label: 'M2 통화량', req: { id: 'IND:ECOS:161Y005/M/BBHS00', source: 'ECOS', code: '161Y005/M/BBHS00', freq: 'M' }, change: 'yoy', about: 'M2(광의통화) 평잔, 전년 대비 증가율' },
  { key: 'cpi', label: '소비자물가', req: CPI_REQ, change: 'yoy', about: '소비자물가지수, 전년 대비 상승률' },
  { key: 'unsold', label: '미분양 (그 시도)', req: null, change: 'yoy', about: '그 지역 시도의 미분양 주택, 전년 대비 증감률' },
  { key: 'trade', label: '거래량 (그 지역)', req: null, change: 'yoy', about: '그 지역 아파트 매매거래 12개월 합, 전년 대비 증감률' },
  { key: 'jeonse', label: '전세가격 (그 지역)', req: null, change: 'yoy', about: '그 지역 아파트 전세가격지수, 전년 대비 상승률' },
];

// ---------------------------------------------------------------- changes and moving windows

/** Difference from `months` earlier (for rates, in %p) */
export function diffOver(pts: Point[], months: number): Point[] {
  const m = new Map(pts.map((p) => [p.date, p.value]));
  return pts.flatMap((p) => {
    const prev = m.get(addMonths(p.date, -months));
    return prev === undefined ? [] : [{ date: p.date, value: p.value - prev }];
  });
}

/** The series as 100 at its first point on or after `from` (all of it when `from` is before it) */
export function rebase(pts: Point[], from = ''): Point[] {
  const start = pts.find((p) => p.date >= from);
  if (!start || !start.value) return [];
  return pts.filter((p) => p.date >= start.date).map((p) => ({ date: p.date, value: (p.value / start.value) * 100 }));
}

/** Simple moving average of the last `n` points */
export function sma(pts: Point[], n: number): Point[] {
  const out: Point[] = [];
  let sum = 0;
  pts.forEach((p, i) => {
    sum += p.value;
    if (i >= n) sum -= pts[i - n].value;
    if (i >= n - 1) out.push({ date: p.date, value: sum / n });
  });
  return out;
}

/** Relative strength index (Wilder's smoothing) over `n` periods, 0–100 */
export function rsi(pts: Point[], n = 14): Point[] {
  const out: Point[] = [];
  let gain = 0, loss = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = pts[i].value - pts[i - 1].value;
    const g = Math.max(d, 0), l = Math.max(-d, 0);
    if (i <= n) {
      gain += g / n;
      loss += l / n;
    } else {
      gain = (gain * (n - 1) + g) / n;
      loss = (loss * (n - 1) + l) / n;
    }
    if (i >= n) out.push({ date: pts[i].date, value: loss === 0 ? 100 : 100 - 100 / (1 + gain / loss) });
  }
  return out;
}

/**
 * Commodity channel index over `n` periods on a single series (the index itself as the typical
 * price): (price − its moving average) / (0.015 × mean absolute deviation). ±100 are the usual lines.
 */
export function cci(pts: Point[], n = 18): Point[] {
  const out: Point[] = [];
  for (let i = n - 1; i < pts.length; i++) {
    const win = pts.slice(i - n + 1, i + 1).map((p) => p.value);
    const mean = win.reduce((a, b) => a + b, 0) / n;
    const dev = win.reduce((a, b) => a + Math.abs(b - mean), 0) / n;
    if (dev > 0) out.push({ date: pts[i].date, value: (pts[i].value - mean) / (0.015 * dev) });
  }
  return out;
}

/**
 * Slow stochastic (n, k, d) on a single series: where the price sits in the range of the last `n`
 * points (0–100), smoothed over `k` (%K) and that again over `d` (%D). 80 and 20 are the usual lines.
 */
export function slowStochastic(pts: Point[], n = 18, k = 3, d = 6): { k: Point[]; d: Point[] } {
  const fast: Point[] = [];
  for (let i = n - 1; i < pts.length; i++) {
    const win = pts.slice(i - n + 1, i + 1).map((p) => p.value);
    const lo = Math.min(...win), hi = Math.max(...win);
    fast.push({ date: pts[i].date, value: hi === lo ? 50 : ((pts[i].value - lo) / (hi - lo)) * 100 });
  }
  const slowK = sma(fast, k);
  return { k: slowK, d: sma(slowK, d) };
}

/**
 * Money flow index over `n` periods: RSI weighted by volume (the index as the typical price, the
 * month's deals as the volume). 80 and 20 are the usual lines.
 */
export function mfi(price: Point[], volume: Point[], n = 14): Point[] {
  const vol = new Map(volume.map((p) => [p.date, p.value]));
  const rows = price.filter((p) => vol.has(p.date));
  const flows = rows.slice(1).map((p, i) => {
    const money = p.value * (vol.get(p.date) ?? 0);
    const d = p.value - rows[i].value;
    return { date: p.date, pos: d > 0 ? money : 0, neg: d < 0 ? money : 0 };
  });
  const out: Point[] = [];
  for (let i = n - 1; i < flows.length; i++) {
    const win = flows.slice(i - n + 1, i + 1);
    const pos = win.reduce((a, f) => a + f.pos, 0), neg = win.reduce((a, f) => a + f.neg, 0);
    out.push({ date: flows[i].date, value: neg === 0 ? 100 : 100 - 100 / (1 + pos / neg) });
  }
  return out;
}

// ---------------------------------------------------------------- correlation

/** Pearson correlation of paired values; null with fewer than 3 pairs or no variation */
export function pearson(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  let sx = 0, sy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i];
    sy += ys[i];
  }
  const mx = sx / n, my = sy / n;
  let cov = 0, vx = 0, vy = 0;
  for (let i = 0; i < n; i++) {
    cov += (xs[i] - mx) * (ys[i] - my);
    vx += (xs[i] - mx) ** 2;
    vy += (ys[i] - my) ** 2;
  }
  return vx > 0 && vy > 0 ? cov / Math.sqrt(vx * vy) : null;
}

/** Values of `a` and `b` on the dates both have, from `from` on */
export function paired(a: Point[], b: Point[], from = ''): [number[], number[]] {
  const m = new Map(b.map((p) => [p.date, p.value]));
  const xs: number[] = [], ys: number[] = [];
  for (const p of a) {
    const y = m.get(p.date);
    if (p.date >= from && y !== undefined) {
      xs.push(p.value);
      ys.push(y);
    }
  }
  return [xs, ys];
}

/** Correlation of every pair of series (on the dates each pair shares, from `from`) */
export function correlationMatrix(series: { key: string; pts: Point[] }[], from = ''): (number | null)[][] {
  return series.map((a) => series.map((b) => (a.key === b.key ? 1 : pearson(...paired(a.pts, b.pts, from)))));
}

/**
 * Correlation of x now with y `lag` months later, for every lag in −max…max. A strong r at a
 * positive lag means x has tended to move before y (it says nothing of cause).
 */
export function lagCorrelation(x: Point[], y: Point[], max = 36, from = ''): { lag: number; r: number | null; n: number }[] {
  const out: { lag: number; r: number | null; n: number }[] = [];
  for (let lag = -max; lag <= max; lag++) {
    const shifted = x.map((p) => ({ date: addMonths(p.date, lag), value: p.value }));
    const [xs, ys] = paired(shifted, y, from);
    out.push({ lag, r: pearson(xs, ys), n: xs.length });
  }
  return out;
}

/** The lag with the largest |r| among those with at least `minN` pairs */
export function strongestLag(list: { lag: number; r: number | null; n: number }[], minN = 24): { lag: number; r: number; n: number } | null {
  let best: { lag: number; r: number; n: number } | null = null;
  for (const l of list) if (l.r !== null && l.n >= minN && (!best || Math.abs(l.r) > Math.abs(best.r))) best = { lag: l.lag, r: l.r, n: l.n };
  return best;
}

// ---------------------------------------------------------------- phases

export interface Quadrant {
  n: 1 | 2 | 3 | 4;
  name: string;
  about: string;
}
/**
 * The sale/jeonse quadrant: x = 매매가격 change, y = 전세가격 change over the same months.
 * Read as a cycle that usually runs 2 → 1 → 4 → 3 → 2: 전세 rising first (실수요가 받쳐 줌),
 * then both, then 매매 alone (투자 수요, 갭 확대), then both falling.
 */
export function quadrant(sale: number, jeonse: number): Quadrant {
  if (sale >= 0 && jeonse >= 0) return { n: 1, name: '1사분면 동반 상승', about: '매매·전세가 함께 오름: 실수요와 투자 수요가 겹친 상승기' };
  if (sale < 0 && jeonse >= 0) return { n: 2, name: '2사분면 전세만 상승', about: '전세는 오르고 매매는 내림: 전세가율이 올라 매매 반등을 준비하는 시기' };
  if (sale < 0) return { n: 3, name: '3사분면 동반 하락', about: '매매·전세가 함께 내림: 수요가 약한 하락기' };
  return { n: 4, name: '4사분면 매매만 상승', about: '매매는 오르고 전세는 내림: 투자 수요가 앞서 전세가율이 떨어지는 과열·후퇴 초입' };
}

export interface PathPoint {
  date: string;
  x: number;
  y: number;
  label: string;
}

/** The last `last` months on the quadrant: sale and jeonse change over `months` each month */
export function quadrantPath(price: Point[], jeonse: Point[], months = 3, last = 24): (PathPoint & { q: Quadrant })[] {
  const sale = changeOver(price, months);
  const js = new Map(changeOver(jeonse, months).map((p) => [p.date, p.value]));
  return sale
    .flatMap((p) => {
      const y = js.get(p.date);
      if (y === undefined) return [];
      const q = quadrant(p.value, y);
      return [{ date: p.date, x: p.value, y, q, label: q.name }];
    })
    .slice(-last);
}

/**
 * The last `last` months on the honeycomb (indicators.ts honeycombPhase): x = deals of the last
 * `window` months against the `window` before (%), y = price change over `window` months (%). With
 * `cpi`, prices are deflated first (real prices, as the model is usually drawn).
 */
export function honeycombPath(price: Point[], trades: Point[], opts: { window?: number; last?: number; cpi?: Point[] } = {}): (PathPoint & { phase: number })[] {
  const w = opts.window ?? 6;
  let px = price;
  if (opts.cpi?.length) {
    const c = new Map(opts.cpi.map((p) => [p.date, p.value]));
    px = price.flatMap((p) => {
      const v = c.get(p.date);
      return v ? [{ date: p.date, value: (p.value / v) * 100 }] : [];
    });
  }
  const y = changeOver(px, w);
  const vol = new Map(changeOver(rollingSum(trades, w), w).map((p) => [p.date, p.value]));
  return y
    .flatMap((p) => {
      const x = vol.get(p.date);
      if (x === undefined) return [];
      const ph = honeycombPhase(p.value, x);
      return [{ date: p.date, x, y: p.value, phase: ph.n, label: ph.name }];
    })
    .slice(-(opts.last ?? 24));
}

// ---------------------------------------------------------------- summaries

export interface RegionSummary {
  key: string;
  label: string;
  date: string | null;
  /** 매매지수 change in % over 1, 3, 12 and 36 months */
  m1: number | null;
  m3: number | null;
  y1: number | null;
  y3: number | null;
  jeonseY1: number | null;
  /** Below the series' highest point, in % (0 at a new high), and when that was */
  fromPeak: number | null;
  peakDate: string | null;
  /** 중위 전세가율 (%) */
  ratio: number | null;
  /** Deals of the last 12 months against the 12 before (%) */
  tradeY1: number | null;
  /** Median sale price (억원) */
  median: number | null;
}

const lastOf = (pts: Point[]) => pts.at(-1) ?? null;
const at = (pts: Point[], date: string | undefined) => (date ? (pts.find((p) => p.date === date)?.value ?? null) : null);

export function summarize(r: RoneRegion, s: Partial<Record<RoneSet, Point[]>>): RegionSummary {
  const price = s.price ?? [];
  const last = lastOf(price);
  const peak = price.reduce<Point | null>((m, p) => (!m || p.value >= m.value ? p : m), null);
  const trade12 = rollingSum(s.trade ?? [], 12);
  return {
    key: r.key,
    label: r.label,
    date: last?.date ?? null,
    m1: at(changeOver(price, 1), last?.date),
    m3: at(changeOver(price, 3), last?.date),
    y1: at(changeOver(price, 12), last?.date),
    y3: at(changeOver(price, 36), last?.date),
    jeonseY1: lastOf(changeOver(s.jeonse ?? [], 12))?.value ?? null,
    fromPeak: last && peak ? (last.value / peak.value - 1) * 100 : null,
    peakDate: peak?.date ?? null,
    ratio: lastOf(s.ratio ?? [])?.value ?? null,
    tradeY1: lastOf(changeOver(trade12, 12))?.value ?? null,
    median: (() => {
      const m = lastOf(s.median ?? []);
      return m ? m.value / 100_000 : null; // 천원 → 억원
    })(),
  };
}

/**
 * Deals by calendar month, one column per year (`y2024` ...), and each month's average share of
 * a year's deals over the complete years: the market's busy and quiet months.
 */
export function seasonality(trades: Point[], years = 6): { rows: Record<string, number | string | null>[]; years: string[]; share: { month: number; pct: number }[] } {
  const by = new Map<string, Map<number, number>>();
  for (const p of trades) {
    const y = p.date.slice(0, 4), m = Number(p.date.slice(5, 7));
    if (!by.has(y)) by.set(y, new Map());
    by.get(y)!.set(m, p.value);
  }
  const all = [...by.keys()].sort();
  const shown = all.slice(-years);
  const rows = Array.from({ length: 12 }, (_, i) => Object.fromEntries([['month', `${i + 1}월`], ...shown.map((y) => [`y${y}`, by.get(y)?.get(i + 1) ?? null])]));
  const full = all.filter((y) => by.get(y)!.size === 12);
  const share = Array.from({ length: 12 }, (_, i) => {
    const parts = full.map((y) => {
      const months = by.get(y)!;
      const total = [...months.values()].reduce((a, b) => a + b, 0);
      return total ? (months.get(i + 1) ?? 0) / total : 0;
    });
    return { month: i + 1, pct: parts.length ? (parts.reduce((a, b) => a + b, 0) / parts.length) * 100 : 0 };
  });
  return { rows, years: shown, share };
}

// ---------------------------------------------------------------- charts for one region

const C = { a: 'var(--series-1)', b: 'var(--series-2)', c: 'var(--series-3)', d: 'var(--series-4)', e: 'var(--series-5)', f: 'var(--series-6)', g: 'var(--series-7)', muted: 'var(--muted)', ink: 'var(--ink)' };
export const SERIES_COLORS = [C.a, C.b, C.c, C.d, C.e, C.f, C.g];
const fmt = (v: number, digits = 2) => v.toLocaleString('ko-KR', { maximumFractionDigits: digits });
const latest = (label: string, pts: Point[], unit: string, digits = 2) => {
  const p = pts.at(-1);
  return p ? [{ label, value: `${fmt(p.value, digits)}${unit}`, date: p.date.slice(0, 7) }] : [];
};

/** 매매·전세 지수 with the monthly change of each */
export function priceChart(s: Partial<Record<RoneSet, Point[]>>): ChartData {
  const price = s.price ?? [], jeonse = s.jeonse ?? [];
  const dp = changeOver(price, 1), dj = changeOver(jeonse, 1);
  return {
    lines: [
      { key: 'price', label: '매매가격지수', color: C.a },
      { key: 'jeonse', label: '전세가격지수', color: C.b },
      { key: 'dp', label: '매매 월간 변동률', color: C.a, kind: 'bar', axis: 'right' },
      { key: 'dj', label: '전세 월간 변동률', color: C.b, kind: 'bar', axis: 'right' },
    ],
    rows: joinSeries({ price, jeonse, dp, dj }),
    unit: '',
    rightUnit: '%',
    latest: [...latest('매매지수', price, ''), ...latest('매매 월간', dp, '%'), ...latest('전세지수', jeonse, ''), ...latest('전세 월간', dj, '%')],
    note: '지수는 한국부동산원 기준시점(현재 2026년 6월 = 100) 기준입니다.',
  };
}

/** 중위 전세가율, with the 전월세 전환율 when the region has one */
export function ratioChart(s: Partial<Record<RoneSet, Point[]>>): ChartData {
  const ratio = s.ratio ?? [], conv = s.conv ?? [];
  return {
    lines: [{ key: 'ratio', label: '중위 전세가율', color: C.c }, ...(conv.length ? [{ key: 'conv', label: '전월세 전환율', color: C.d, axis: 'right' as const }] : [])],
    rows: joinSeries(conv.length ? { ratio, conv } : { ratio }),
    unit: '%',
    rightUnit: '%',
    latest: [...latest('전세가율', ratio, '%', 1), ...latest('전환율', conv, '%', 2)],
    note: '전세가율이 오르면 적은 자기자본으로 살 수 있어 매수 전환이 늘고, 떨어지면 매매가가 전세가보다 앞서 간 것입니다. 전환율은 전세를 월세로 바꿀 때의 연 이율입니다.',
  };
}

/** 매매·전세 수급지수 (100 = 공급과 수요가 같음) */
export function demandChart(s: Partial<Record<RoneSet, Point[]>>, from: string): ChartData {
  const demand = s.demand ?? [], jdemand = s.jdemand ?? [];
  return {
    lines: [
      { key: 'demand', label: '매매수급지수', color: C.a },
      { key: 'jdemand', label: '전세수급지수', color: C.b },
    ],
    rows: joinSeries({ demand, jdemand }),
    unit: '',
    refs: [{ y: 100, label: '100 = 수요·공급 균형' }],
    latest: [...latest('매매수급', demand, '', 1), ...latest('전세수급', jdemand, '', 1)],
    note: `중개업소 설문으로 만든 지수로 100보다 크면 사려는(빌리려는) 사람이 더 많다는 뜻입니다.${from ? ` ${from} 자료입니다(수급동향은 시도까지만 나옵니다).` : ''}`,
  };
}

/** Monthly deals with their 12-month moving average and the region's 시도 미분양 */
export function tradeChart(s: Partial<Record<RoneSet, Point[]>>, unsold: Point[], sido: string): ChartData {
  const trade = s.trade ?? [];
  const ma = sma(trade, 12);
  return {
    lines: [
      { key: 'trade', label: '월 매매거래', color: C.muted, kind: 'bar' },
      { key: 'ma', label: '12개월 평균', color: C.a },
      ...(unsold.length ? [{ key: 'unsold', label: `미분양 (${sido})`, color: C.d, axis: 'right' as const }] : []),
    ],
    rows: joinSeries(unsold.length ? { trade, ma, unsold } : { trade, ma }),
    unit: '건',
    rightUnit: '호',
    latest: [...latest('월 거래', trade, '건', 0), ...latest('12개월 평균', ma, '건', 0), ...latest('미분양', unsold, '호', 0)],
    note: '거래량은 신고일이 아니라 계약일 기준이라 최근 한두 달은 신고가 덜 들어와 낮게 보입니다.',
  };
}

/** Price with its 12- and 48-month averages, and the deals as bars */
export function techMain(price: Point[], trade: Point[]): ChartData {
  const ma12 = sma(price, 12), ma48 = sma(price, 48);
  return {
    lines: [
      { key: 'price', label: '매매가격지수', color: C.ink },
      { key: 'ma12', label: '12개월 이동평균', color: C.a },
      { key: 'ma48', label: '48개월 이동평균', color: C.d },
      { key: 'trade', label: '월 매매거래', color: C.muted, kind: 'bar', axis: 'right' },
    ],
    rows: joinSeries({ price, ma12, ma48, trade }),
    unit: '',
    rightUnit: '건',
    latest: [...latest('지수', price, ''), ...latest('12개월 평균', ma12, ''), ...latest('48개월 평균', ma48, '')],
    note: '지수가 12개월 평균 위에 있고 12개월 평균이 48개월 평균 위면 상승 추세, 그 반대면 하락 추세로 봅니다. 주식의 골든크로스·데드크로스와 같은 읽기입니다.',
  };
}

/** Oscillators: slow stochastic, MFI and RSI on one 0–100 scale, CCI on the right */
export function techOsc(price: Point[], trade: Point[]): ChartData {
  const st = slowStochastic(price, 18, 3, 6);
  const m = mfi(price, trade, 14);
  const r = rsi(price, 14);
  const c = cci(price, 18);
  return {
    lines: [
      { key: 'k', label: '스토캐스틱 %K (18,3)', color: C.a },
      { key: 'd', label: '스토캐스틱 %D (6)', color: C.a, dash: true },
      { key: 'mfi', label: 'MFI (14)', color: C.c },
      { key: 'rsi', label: 'RSI (14)', color: C.e },
      { key: 'cci', label: 'CCI (18)', color: C.d, axis: 'right' },
    ],
    rows: joinSeries({ k: st.k, d: st.d, mfi: m, rsi: r, cci: c }),
    unit: '',
    rightUnit: '',
    refs: [
      { y: 80, label: '80 과열' },
      { y: 20, label: '20 침체' },
    ],
    latest: [...latest('%K', st.k, '', 0), ...latest('MFI', m, '', 0), ...latest('RSI', r, '', 0), ...latest('CCI', c, '', 0)],
    note: '월간 지수에 주식의 보조지표를 얹은 것입니다. 80 위는 단기 과열, 20 아래는 단기 침체로 읽고, CCI는 ±100을 같은 뜻으로 봅니다. 아파트 가격은 주가보다 추세가 길어 과열 구간이 오래 이어지기도 하니 방향 전환을 확인하는 용도로 씁니다.',
  };
}

/** Several regions' 매매지수 as 100 at `from` */
export function compareChart(list: { region: RoneRegion; price: Point[] }[], from: string): ChartData {
  const cols: Record<string, Point[]> = {};
  list.forEach((x, i) => (cols[`r${i}`] = rebase(x.price, from)));
  return {
    lines: list.map((x, i) => ({ key: `r${i}`, label: x.region.label, color: SERIES_COLORS[i % SERIES_COLORS.length] })),
    rows: joinSeries(cols),
    unit: '',
    refs: [{ y: 100, label: '' }],
    latest: list.flatMap((x, i) => latest(x.region.label, cols[`r${i}`], '', 1)),
    note: `각 지역의 매매가격지수를 ${from.slice(0, 7)} = 100으로 맞췄습니다. 선의 높이 차이가 그 뒤로 오른 정도의 차이입니다.`,
  };
}

/** Several regions' 전세가율 */
export function compareRatioChart(list: { region: RoneRegion; ratio: Point[] }[]): ChartData {
  const cols: Record<string, Point[]> = {};
  list.forEach((x, i) => (cols[`r${i}`] = x.ratio));
  return {
    lines: list.map((x, i) => ({ key: `r${i}`, label: x.region.label, color: SERIES_COLORS[i % SERIES_COLORS.length] })),
    rows: joinSeries(cols),
    unit: '%',
    latest: list.flatMap((x, i) => latest(x.region.label, cols[`r${i}`], '%', 1)),
  };
}

/** A region's price change against a macro series' change, both year-on-year, on one chart */
export function corrChart(priceYoy: Point[], macro: Point[], macroLabel: string, unit: '%' | '%p'): ChartData {
  return {
    lines: [
      { key: 'price', label: '매매가격 전년 대비', color: C.a },
      { key: 'macro', label: `${macroLabel} (${unit === '%p' ? '1년 차이' : '전년 대비'})`, color: C.d, axis: 'right' },
    ],
    rows: joinSeries({ price: priceYoy, macro }),
    unit: '%',
    rightUnit: unit,
    refs: [{ y: 0, label: '' }],
    latest: [...latest('매매 전년 대비', priceYoy, '%', 1), ...latest(macroLabel, macro, unit, 2)],
  };
}
