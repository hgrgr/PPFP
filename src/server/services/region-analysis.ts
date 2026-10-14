/**
 * 지역 분석 views: loads the R-ONE and ECOS series a view needs (through indicators.ts, so they
 * share its cache and keys) and builds the view from domain/region-analysis.ts.
 */
import { changeOver, clip, rollingSum, type ChartData, type Point, type SeriesReq } from '@/domain/indicators';
import {
  compareChart,
  compareRatioChart,
  correlationMatrix,
  corrChart,
  CPI_REQ,
  demandChart,
  diffOver,
  honeycombPath,
  lagCorrelation,
  MACROS,
  priceChart,
  quadrantPath,
  ratioChart,
  regionReqs,
  regionSeries,
  roneRegion,
  seasonality,
  SIDO_KEYS,
  strongestLag,
  summarize,
  techMain,
  techOsc,
  tradeChart,
  unsoldReq,
  type PathPoint,
  type Quadrant,
  type RegionSummary,
  type RoneRegion,
  type RoneSet,
} from '@/domain/region-analysis';
import { kstDate } from '../db';
import { readSeries, refreshSeries, type Missing } from './indicators';
import { UserError } from './portfolios';

interface Loaded {
  get: (id: string) => Point[];
  missing: Missing[];
  errors: string[];
}

async function load(userId: string, reqs: (SeriesReq | null)[]): Promise<Loaded> {
  const uniq = [...new Map(reqs.filter((r): r is SeriesReq => !!r).map((r) => [r.id, r])).values()];
  const { missing, errors } = await refreshSeries(userId, uniq);
  const series = await readSeries(uniq.map((r) => r.id));
  return { get: (id) => series.get(id) ?? [], missing, errors };
}

function setsOf(r: RoneRegion, sets: RoneSet[], get: (id: string) => Point[]) {
  const ids = regionSeries(r, sets);
  const s: Partial<Record<RoneSet, Point[]>> = {};
  for (const k of sets) s[k] = ids[k] ? get(ids[k]!.id) : [];
  return { s, ids };
}

function regionOrThrow(key: string): RoneRegion {
  const r = roneRegion(key);
  if (!r) throw new UserError('없는 지역입니다.');
  return r;
}

const cut = (c: ChartData, years: number): ChartData => ({ ...c, rows: clip(c.rows, years, kstDate()) });
/** The first day of the month `years` before this one ('' for all) */
const since = (years: number) => (years ? `${Number(kstDate().slice(0, 4)) - years}${kstDate().slice(4, 7)}-01` : '');

const ALL_SETS: RoneSet[] = ['price', 'jeonse', 'median', 'ratio', 'demand', 'jdemand', 'conv', 'trade'];

export interface OneView {
  region: { key: string; label: string };
  summary: RegionSummary;
  charts: { price: ChartData; ratio: ChartData; demand: ChartData; trade: ChartData; techMain: ChartData; techOsc: ChartData };
  quadrant: (PathPoint & { q: Quadrant })[];
  honeycomb: (PathPoint & { phase: number })[];
  season: ReturnType<typeof seasonality>;
  missing: Missing[];
  errors: string[];
}

/** One region in depth */
export async function oneView(userId: string, key: string, years: number): Promise<OneView> {
  const r = regionOrThrow(key);
  const unsold = unsoldReq(r);
  const { get, missing, errors } = await load(userId, [...regionReqs(r, ALL_SETS), CPI_REQ, unsold]);
  const { s, ids } = setsOf(r, ALL_SETS, get);
  const demandFrom = ids.demand && ids.demand.from.key !== r.key ? ids.demand.from.label : '';
  return {
    region: { key: r.key, label: r.label },
    summary: summarize(r, s),
    charts: {
      price: cut(priceChart(s), years),
      ratio: cut(ratioChart(s), years),
      demand: cut(demandChart(s, demandFrom), years),
      trade: cut(tradeChart(s, unsold ? get(unsold.id) : [], r.sido), years),
      techMain: cut(techMain(s.price ?? [], s.trade ?? []), years),
      techOsc: cut(techOsc(s.price ?? [], s.trade ?? []), years),
    },
    quadrant: quadrantPath(s.price ?? [], s.jeonse ?? [], 3, 36),
    honeycomb: honeycombPath(s.price ?? [], s.trade ?? [], { window: 6, last: 36, cpi: get(CPI_REQ.id) }),
    season: seasonality(s.trade ?? [], 6),
    missing,
    errors,
  };
}

export interface CompareView {
  regions: { key: string; label: string }[];
  summaries: RegionSummary[];
  price: ChartData;
  ratio: ChartData;
  /** Correlation of monthly price changes over the period shown */
  corr: (number | null)[][];
  missing: Missing[];
  errors: string[];
}

/** Several regions side by side */
export async function compareView(userId: string, keys: string[], years: number): Promise<CompareView> {
  const regions = [...new Set(keys)].slice(0, 8).map(regionOrThrow);
  if (!regions.length) throw new UserError('비교할 지역을 고르세요.');
  const sets: RoneSet[] = ['price', 'jeonse', 'median', 'ratio', 'trade'];
  const { get, missing, errors } = await load(userId, regions.flatMap((r) => regionReqs(r, sets)));
  const all = regions.map((r) => ({ region: r, ...setsOf(r, sets, get).s }));
  const from = since(years) || (all.map((x) => x.price?.[0]?.date ?? '').sort().at(-1) ?? '');
  return {
    regions: regions.map((r) => ({ key: r.key, label: r.label })),
    summaries: all.map((x) => summarize(x.region, x)),
    price: compareChart(all.map((x) => ({ region: x.region, price: x.price ?? [] })), from),
    ratio: cut(compareRatioChart(all.map((x) => ({ region: x.region, ratio: x.ratio ?? [] }))), years),
    corr: correlationMatrix(all.map((x) => ({ key: x.region.key, pts: changeOver(x.price ?? [], 1) })), from),
    missing,
    errors,
  };
}

export interface CycleView {
  window: number;
  real: boolean;
  /** Each region's latest place and its path over the last 24 months */
  rows: { key: string; label: string; date: string | null; x: number | null; y: number | null; phase: number | null; name: string | null; path: PathPoint[] }[];
  missing: Missing[];
  errors: string[];
}

/** Every 시도 (or the given regions) on the honeycomb */
export async function cycleView(userId: string, keys: string[] | null, window: 6 | 12, real: boolean): Promise<CycleView> {
  const regions = (keys?.length ? [...new Set(keys)].slice(0, 24) : SIDO_KEYS).map(regionOrThrow);
  const sets: RoneSet[] = ['price', 'trade'];
  const { get, missing, errors } = await load(userId, [...regions.flatMap((r) => regionReqs(r, sets)), real ? CPI_REQ : null]);
  const cpi = real ? get(CPI_REQ.id) : undefined;
  return {
    window,
    real,
    rows: regions.map((r) => {
      const { s } = setsOf(r, sets, get);
      const path = honeycombPath(s.price ?? [], s.trade ?? [], { window, last: 24, cpi });
      const last = path.at(-1);
      return { key: r.key, label: r.label, date: last?.date ?? null, x: last?.x ?? null, y: last?.y ?? null, phase: last?.phase ?? null, name: last?.label ?? null, path };
    }),
    missing,
    errors,
  };
}

export interface CorrView {
  region: { key: string; label: string };
  macro: { key: string; label: string; about: string; unit: '%' | '%p' };
  lags: { lag: number; r: number | null; n: number }[];
  best: { lag: number; r: number; n: number } | null;
  /** r at lag 0 */
  now: number | null;
  chart: ChartData;
  missing: Missing[];
  errors: string[];
}

/** A macro series against a region's prices, at every lead and lag up to three years */
export async function corrView(userId: string, key: string, macroKey: string, years: number): Promise<CorrView> {
  const r = regionOrThrow(key);
  const m = MACROS.find((x) => x.key === macroKey);
  if (!m) throw new UserError('없는 지표입니다.');
  const unsold = macroKey === 'unsold' ? unsoldReq(r) : null;
  const sets: RoneSet[] = ['price', 'jeonse', 'trade'];
  const { get, missing, errors } = await load(userId, [...regionReqs(r, sets), m.req, unsold]);
  const { s } = setsOf(r, sets, get);
  const raw = macroKey === 'trade' ? rollingSum(s.trade ?? [], 12) : macroKey === 'jeonse' ? (s.jeonse ?? []) : macroKey === 'unsold' ? (unsold ? get(unsold.id) : []) : m.req ? get(m.req.id) : [];
  const macro = m.change === 'diff' ? diffOver(raw, 12) : changeOver(raw, 12);
  const price = changeOver(s.price ?? [], 12);
  const from = since(years);
  const lags = lagCorrelation(macro, price, 36, from);
  const unit = m.change === 'diff' ? '%p' : '%';
  return {
    region: { key: r.key, label: r.label },
    macro: { key: m.key, label: m.label, about: m.about, unit },
    lags,
    best: strongestLag(lags),
    now: lags.find((l) => l.lag === 0)?.r ?? null,
    chart: cut(corrChart(price, macro, m.label, unit), years),
    missing,
    errors,
  };
}
