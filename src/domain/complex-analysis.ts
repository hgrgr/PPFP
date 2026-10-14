/**
 * 단지 분석: the apartment complexes of a 시군구 read from its 국토부 실거래가 — each complex and
 * area's latest price against its highest, the 동 and complexes ranked by price per 평 (급지),
 * the leading complexes' prices over time, one complex's every deal, and the month's deal count
 * forecast from daily snapshots.
 *
 * Cancelled deals (해제) are left out everywhere. Prices are 원; per 평 is per 3.3㎡ of 전용면적.
 */
import { addMonths } from './indicators';
import { complexKey, monthsBefore, PYEONG, supplyPyeong, type AptTrade } from './real-estate';

// ---------------------------------------------------------------- areas

/** 주택법 size classes by 전용면적 */
export const AREA_CLASSES = [
  { key: 'S', label: '소형 (60㎡ 이하)', test: (a: number) => a <= 60 },
  { key: 'MS', label: '중소형 (60~85㎡)', test: (a: number) => a > 60 && a <= 85 },
  { key: 'ML', label: '중대형 (85~135㎡)', test: (a: number) => a > 85 && a <= 135 },
  { key: 'L', label: '대형 (135㎡ 초과)', test: (a: number) => a > 135 },
] as const;
export type AreaClass = (typeof AREA_CLASSES)[number]['key'];
export const areaClassOf = (area: number): AreaClass => AREA_CLASSES.find((c) => c.test(area))!.key;

/** One 평형 of a complex: deals within half a ㎡ count as the same type */
export const areaKey = (area: number) => Math.round(area);
export const areaName = (area: number) => `${areaKey(area)}㎡ (${supplyPyeong(area)}평형)`;

export const perPyeong = (t: Pick<AptTrade, 'price' | 'area'>) => (t.price / t.area) * PYEONG;

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const live = (trades: AptTrade[]) => trades.filter((t) => !t.cancelled && t.price > 0 && t.area > 0);

// ---------------------------------------------------------------- complexes and their areas

export interface ComplexRow {
  /** complexKey|areaKey */
  id: string;
  complex: string;
  lawdCd: string;
  name: string;
  umdNm: string;
  buildYear: number | null;
  area: number;
  areaLabel: string;
  cls: AreaClass;
  /** Deals in the period and in the last 12 months */
  deals: number;
  deals1y: number;
  last: { date: string; price: number; floor: number | null };
  /** Median of the last three months' deals, else the last deal */
  recent: number;
  high: { date: string; price: number; floor: number | null };
  /** recent against high, % (0 at a new high) */
  fromHigh: number;
  /** recent per 평 (원) */
  perPyeong: number;
}

/**
 * Every complex and 평형 with a deal in `trades` (one 시군구, any span): its last and highest
 * deal and where the recent price stands against that high.
 */
export function complexRows(trades: AptTrade[], lawdOf: (t: AptTrade) => string, today: string): ComplexRow[] {
  const groups = new Map<string, { lawd: string; list: AptTrade[] }>();
  for (const t of live(trades)) {
    const lawd = lawdOf(t);
    const id = `${lawd}|${complexKey(t)}|${areaKey(t.area)}`;
    const g = groups.get(id) ?? { lawd, list: [] };
    g.list.push(t);
    groups.set(id, g);
  }
  const yearAgo = monthsBefore(today, 12);
  const threeAgo = monthsBefore(today, 3);
  const rows: ComplexRow[] = [];
  for (const [id, { lawd, list }] of groups) {
    list.sort((a, b) => a.date.localeCompare(b.date));
    const last = list.at(-1)!;
    const high = list.reduce((m, t) => (t.price > m.price ? t : m), list[0]);
    const recentDeals = list.filter((t) => t.date >= threeAgo);
    const recent = median(recentDeals.map((t) => t.price)) ?? last.price;
    const area = median(list.map((t) => t.area))!;
    rows.push({
      id,
      complex: complexKey(last),
      lawdCd: lawd,
      name: last.aptNm,
      umdNm: last.umdNm,
      buildYear: last.buildYear ?? list.find((t) => t.buildYear)?.buildYear ?? null,
      area,
      areaLabel: areaName(area),
      cls: areaClassOf(area),
      deals: list.length,
      deals1y: list.filter((t) => t.date >= yearAgo).length,
      last: { date: last.date, price: last.price, floor: last.floor },
      recent,
      high: { date: high.date, price: high.price, floor: high.floor },
      fromHigh: (recent / high.price - 1) * 100,
      perPyeong: (recent / area) * PYEONG,
    });
  }
  return rows.sort((a, b) => b.perPyeong - a.perPyeong);
}

/** How many complex·평형 sit how far below their high */
export const DRAWDOWN_BUCKETS = [
  { label: '신고가', min: -0.0001, max: Infinity },
  { label: '−10% 이내', min: -10, max: -0.0001 },
  { label: '−10~20%', min: -20, max: -10 },
  { label: '−20~30%', min: -30, max: -20 },
  { label: '−30% 넘게', min: -Infinity, max: -30 },
];
export function drawdownBuckets(rows: Pick<ComplexRow, 'fromHigh'>[]): { label: string; count: number }[] {
  return DRAWDOWN_BUCKETS.map((b) => ({ label: b.label, count: rows.filter((r) => r.fromHigh > b.min && r.fromHigh <= b.max).length }));
}

// ---------------------------------------------------------------- 급지: 동 and complexes by price per 평

export interface Ranked {
  key: string;
  name: string;
  umdNm: string;
  /** Median price per 평 of the last `months` months (원) */
  perPyeong: number;
  deals: number;
  buildYear: number | null;
}

/** 동 by the median price per 평 of their deals in the last `months` months */
export function dongRanking(trades: AptTrade[], today: string, months = 12): Ranked[] {
  const since = monthsBefore(today, months);
  const by = new Map<string, AptTrade[]>();
  for (const t of live(trades)) if (t.date >= since) by.set(t.umdNm, [...(by.get(t.umdNm) ?? []), t]);
  return [...by]
    .map(([umd, list]) => ({ key: umd, name: umd, umdNm: umd, perPyeong: median(list.map(perPyeong))!, deals: list.length, buildYear: null }))
    .sort((a, b) => b.perPyeong - a.perPyeong);
}

/** Complexes by the median price per 평 of their deals in the last `months` months, at least `minDeals` */
export function complexRanking(trades: AptTrade[], today: string, months = 12, minDeals = 3): Ranked[] {
  const since = monthsBefore(today, months);
  const by = new Map<string, AptTrade[]>();
  for (const t of live(trades)) if (t.date >= since) by.set(complexKey(t), [...(by.get(complexKey(t)) ?? []), t]);
  return [...by]
    .filter(([, list]) => list.length >= minDeals)
    .map(([key, list]) => ({ key, name: list[0].aptNm, umdNm: list[0].umdNm, perPyeong: median(list.map(perPyeong))!, deals: list.length, buildYear: list[0].buildYear }))
    .sort((a, b) => b.perPyeong - a.perPyeong);
}

/** 국민평형: the 84㎡ type most complexes have, the usual yardstick for 대장 아파트 */
export const isNational = (area: number) => area >= 80 && area <= 86;

/**
 * Monthly median prices of the given complexes' 84㎡-class deals (or every deal, `all`), one
 * column per complex: the leading complexes side by side.
 */
export function leaderSeries(trades: AptTrade[], keys: string[], all = false): Record<string, number | string | null>[] {
  const want = new Set(keys);
  const by = new Map<string, Map<string, number[]>>();
  for (const t of live(trades)) {
    const k = complexKey(t);
    if (!want.has(k) || (!all && !isNational(t.area))) continue;
    const ym = `${t.date.slice(0, 7)}-01`;
    const m = by.get(ym) ?? new Map<string, number[]>();
    m.set(k, [...(m.get(k) ?? []), t.price]);
    by.set(ym, m);
  }
  const months = [...by.keys()].sort();
  if (!months.length) return [];
  const out: Record<string, number | string | null>[] = [];
  for (let d = months[0]; d <= months.at(-1)!; d = addMonths(d, 1)) {
    const m = by.get(d);
    out.push(Object.fromEntries([['date', d], ...keys.map((k, i) => [`c${i}`, m?.get(k) ? median(m.get(k)!)! / 1e8 : null])]));
  }
  return out;
}

// ---------------------------------------------------------------- one complex

export interface ComplexDetail {
  key: string;
  name: string;
  umdNm: string;
  jibun: string | null;
  buildYear: number | null;
  areas: { key: number; label: string; deals: number; high: number; last: number }[];
  /** Every deal, oldest first, price in 억원 */
  deals: { date: string; t: number; area: number; price: number; floor: number | null; direct: boolean }[];
  /** Monthly median per 평형 (억원), one column a<areaKey> */
  monthly: Record<string, number | string | null>[];
}

const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;

export function complexDetail(trades: AptTrade[], key: string): ComplexDetail | null {
  const own = live(trades)
    .filter((t) => complexKey(t) === key)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!own.length) return null;
  const areas = [...new Set(own.map((t) => areaKey(t.area)))].sort((a, b) => a - b);
  const by = new Map<string, Map<number, number[]>>();
  for (const t of own) {
    const ym = `${t.date.slice(0, 7)}-01`;
    const m = by.get(ym) ?? new Map<number, number[]>();
    m.set(areaKey(t.area), [...(m.get(areaKey(t.area)) ?? []), t.price]);
    by.set(ym, m);
  }
  const months = [...by.keys()].sort();
  const monthly: Record<string, number | string | null>[] = [];
  for (let d = months[0]; d <= months.at(-1)!; d = addMonths(d, 1)) {
    const m = by.get(d);
    monthly.push(Object.fromEntries([['date', d], ...areas.map((a) => [`a${a}`, m?.get(a) ? median(m.get(a)!)! / 1e8 : null])]));
  }
  const last = own.at(-1)!;
  return {
    key,
    name: last.aptNm,
    umdNm: last.umdNm,
    jibun: last.jibun,
    buildYear: last.buildYear,
    areas: areas.map((a) => {
      const list = own.filter((t) => areaKey(t.area) === a);
      return { key: a, label: areaName(list[0].area), deals: list.length, high: Math.max(...list.map((t) => t.price)), last: list.at(-1)!.price };
    }),
    deals: own.map((t) => ({ date: t.date, t: dayNumber(t.date), area: areaKey(t.area), price: t.price / 1e8, floor: t.floor, direct: t.dealing === '직거래' })),
    monthly,
  };
}

// ---------------------------------------------------------------- month count forecast

export interface Snapshot {
  /** YYYYMM */
  ym: string;
  /** YYYY-MM-DD */
  day: string;
  count: number;
}

/** Days from the first of `ym` to `day` (the 1st is day 1) */
export function dayOfMonthRun(ym: string, day: string): number {
  return Math.round(dayNumber(day) - dayNumber(`${ym.slice(0, 4)}-${ym.slice(4)}-01`)) + 1;
}

export interface Forecast {
  ym: string;
  /** Reported so far and on which day of the month's run */
  known: number;
  day: number;
  /** null until earlier months have a snapshot on the same day */
  estimate: number | null;
  /** final ÷ reported-by-that-day of each earlier month used */
  ratios: { ym: string; ratio: number }[];
  /** Cumulative reported count by day, one column per month (m<YYYYMM>), for the chart */
  rows: Record<string, number | null>[];
  months: string[];
}

/**
 * This month's deal count from what has been reported so far: the count on day `day` of the
 * month's run times how much earlier months grew from that day to their final count
 * (`finals`, counted from the deals once a month is old enough), the median of up to six.
 */
export function forecastMonth(snaps: Snapshot[], finals: Record<string, number>, ym: string, today: string): Forecast {
  const runOf = new Map<string, Map<number, number>>();
  for (const s of snaps) {
    const m = runOf.get(s.ym) ?? new Map<number, number>();
    m.set(dayOfMonthRun(s.ym, s.day), s.count);
    runOf.set(s.ym, m);
  }
  const day = dayOfMonthRun(ym, today);
  const own = runOf.get(ym);
  const knownDay = own ? Math.max(...[...own.keys()].filter((d) => d <= day)) : -Infinity;
  const known = own && Number.isFinite(knownDay) ? own.get(knownDay)! : 0;
  const near = (m: Map<number, number>, d: number) => m.get(d) ?? m.get(d - 1) ?? m.get(d + 1) ?? null;
  const ratios: { ym: string; ratio: number }[] = [];
  for (const [past, m] of [...runOf].sort((a, b) => b[0].localeCompare(a[0]))) {
    if (past >= ym || ratios.length >= 6) continue;
    const at = Number.isFinite(knownDay) ? near(m, knownDay) : null;
    const fin = finals[past];
    if (at && fin) ratios.push({ ym: past, ratio: fin / at });
  }
  const r = median(ratios.map((x) => x.ratio));
  const months = [...runOf.keys()].sort().slice(-4);
  const maxDay = Math.max(day, ...months.flatMap((m) => [...runOf.get(m)!.keys()]));
  const rows = Array.from({ length: Math.max(0, maxDay) }, (_, i) => Object.fromEntries([['day', i + 1], ...months.map((m) => [`m${m}`, runOf.get(m)!.get(i + 1) ?? null])]));
  return { ym, known, day: Number.isFinite(knownDay) ? knownDay : 0, estimate: r !== null && known ? Math.round(known * r) : null, ratios, rows, months };
}
