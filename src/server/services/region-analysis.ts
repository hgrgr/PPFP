/**
 * 지역 분석 views: loads the R-ONE and ECOS series a view needs (through indicators.ts, so they
 * share its cache and keys) and builds the view from domain/region-analysis.ts.
 */
import { changeOver, clip, indicatorById, REGIONS, rollingSum, type ChartData, type Point, type SeriesReq } from '@/domain/indicators';
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
  rtpiChart,
  rtpiSource,
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
import { ageChart, BUYER_CLASSES, buyerReq, classId, ownerChart, peersOf, permitChart, permitIds, permitReq, rankRow, residenceChart, sizeChart, type RankRow } from '@/domain/buyer-trends';
import { mapValues, timelineFrames, type RegionValues, type TimelineFrames } from '@/domain/region-map';
import { LOCATION_TABLES, locationValues, rankLocations, type KosisRow, type LocationRow, type LocationTable, type LocationValues } from '@/domain/location';
import { addMonths } from '@/domain/indicators';
import { kstDate, prisma } from '../db';
import { kosisTable, readSeries, refreshSeries, roneTable, type Missing } from './indicators';
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
  charts: { price: ChartData; rtpi: ChartData; population: ChartData; supply: ChartData; afford: ChartData; ratio: ChartData; demand: ChartData; trade: ChartData; techMain: ChartData; techOsc: ChartData };
  quadrant: (PathPoint & { q: Quadrant })[];
  honeycomb: (PathPoint & { phase: number })[];
  season: ReturnType<typeof seasonality>;
  missing: Missing[];
  errors: string[];
}

/** The KOSIS 주민등록 code of a region: its 시도's, its own 시군구 code, or a split 시's ("41130" for 성남시) */
function popRegion(r: RoneRegion): string | null {
  if (r.key === '전국') return '00';
  if (r.depth === 0) return REGIONS.find((x) => x.name === r.sido)?.code ?? (r.lawd[0] ?? null);
  if (r.lawd.length === 1) return r.lawd[0];
  return r.lawd[0] ? `${r.lawd[0].slice(0, 4)}0` : null;
}

/** One region in depth */
export async function oneView(userId: string, key: string, years: number): Promise<OneView> {
  const r = regionOrThrow(key);
  const unsold = unsoldReq(r);
  const rtpi = rtpiSource(r);
  const pop = indicatorById('population')!;
  const supply = indicatorById('supply')!, afford = indicatorById('affordability')!;
  const sidoCode = REGIONS.find((x) => x.name === r.sido)?.code ?? null;
  const sidoParams = { region: sidoCode ?? '00', incomeBase: 'region' as const };
  const popParams = { region: popRegion(r) ?? '00', incomeBase: 'region' as const };
  const { get, missing, errors } = await load(userId, [...regionReqs(r, ALL_SETS), CPI_REQ, unsold, rtpi?.req ?? null, ...(popRegion(r) ? pop.needs(popParams) : []), ...(sidoCode ? [...supply.needs(sidoParams), ...afford.needs(sidoParams)] : [])]);
  const { s, ids } = setsOf(r, ALL_SETS, get);
  const demandFrom = ids.demand && ids.demand.from.key !== r.key ? ids.demand.from.label : '';
  return {
    region: { key: r.key, label: r.label },
    summary: summarize(r, s),
    charts: {
      price: cut(priceChart(s), years),
      rtpi: cut(rtpiChart(s.price ?? [], rtpi ? get(rtpi.req.id) : [], rtpi, r), years),
      population: cut(popRegion(r) ? pop.build(get, popParams) : { lines: [], rows: [], unit: '', latest: [] }, years),
      supply: cut(sidoCode ? supply.build(get, sidoParams) : { lines: [], rows: [], unit: '', latest: [] }, years),
      afford: cut(sidoCode ? afford.build(get, sidoParams) : { lines: [], rows: [], unit: '', latest: [] }, years),
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
  /** Each region's latest place and its path over the last 60 months */
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
      // Five years, for the animation; the latest point is the region's place now
      const path = honeycombPath(s.price ?? [], s.trade ?? [], { window, last: 60, cpi });
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

export interface BuyersView {
  region: { key: string; label: string };
  residence: ChartData;
  age: ChartData;
  owner: ChartData;
  permit: ChartData;
  size: ChartData;
  ranking: RankRow[];
  rankBy: 'outside' | 'otherSido';
  missing: Missing[];
  errors: string[];
}

/** Who buys the region's apartments, and the region beside its peers on outsider buying */
export async function buyersView(userId: string, key: string, years: number): Promise<BuyersView> {
  const r = regionOrThrow(key);
  if (!r.groups.residence) throw new UserError('이 지역은 매입자 통계가 없습니다. 시도나 시군구를 고르세요.');
  const peers = peersOf(r);
  const reqs = [buyerReq(r, 'residence'), buyerReq(r, 'age'), buyerReq(r, 'owner'), buyerReq(r, 'size'), permitReq(r), ...peers.map((p) => buyerReq(p, 'residence'))].filter((x): x is SeriesReq => !!x);
  const { missing, errors } = await refreshSeries(userId, [...new Map(reqs.map((x) => [x.id, x])).values()]);
  // A request loads every class; read each class's own series
  const ids = [...BUYER_CLASSES.residence.flatMap((c) => [r, ...peers].map((p) => classId(p, 'residence', c))), ...BUYER_CLASSES.age.map((c) => classId(r, 'age', c)), ...BUYER_CLASSES.owner.map((c) => classId(r, 'owner', c)), ...BUYER_CLASSES.size.map((c) => classId(r, 'size', c)), ...permitIds(r)];
  const series = await readSeries([...new Set(ids)]);
  const get = (id: string) => series.get(id) ?? [];
  return {
    region: { key: r.key, label: r.label },
    residence: cut(residenceChart(r, get), years),
    age: cut(ageChart(r, get), years),
    owner: cut(ownerChart(r, get), years),
    permit: cut(permitChart(r, get), years),
    size: cut(sizeChart(r, get), years),
    // 시도 side by side: by buyers from other 시도; 시군구: by buyers from outside the 시군구
    ranking: peers.map((p) => rankRow(p, get)).sort((a, b) => (peers[0]?.depth === 0 ? (b.otherSido ?? -1) - (a.otherSido ?? -1) : (b.outside ?? -1) - (a.outside ?? -1))),
    rankBy: peers[0]?.depth === 0 ? 'otherSido' : 'outside',
    missing,
    errors,
  };
}

export interface MapView {
  values: RegionValues;
  /** The month most regions' prices are for */
  date: string | null;
  at: string;
}

const MAP_KEY = 'regions:map';
const MAP_FRESH_MS = 12 * 3_600_000;

/** Every region's map numbers, from whole R-ONE tables, kept for 12 hours */
export async function mapView(userId: string): Promise<MapView> {
  const row = await prisma.appSetting.findUnique({ where: { key: MAP_KEY } });
  if (row) {
    const cached = JSON.parse(row.value) as MapView;
    if (Date.now() - Date.parse(cached.at) < MAP_FRESH_MS) return cached;
  }
  const today = kstDate();
  const start = (months: number) => addMonths(`${today.slice(0, 7)}-01`, -months).slice(0, 7).replace('-', '');
  const [price, ratio, trade, residence] = await Promise.all([
    roneTable(userId, 'A_2024_00045', start(15)),
    roneTable(userId, 'A_2024_00073', start(4)),
    roneTable(userId, 'A_2024_00554', start(27)),
    roneTable(userId, 'A_2024_00609', start(14)),
  ]);
  const values = mapValues({ price, ratio, trade, residence });
  const dates = Object.values(values).flatMap((v) => (v.date ? [v.date] : [])).sort();
  const view: MapView = { values, date: dates[Math.floor(dates.length / 2)] ?? null, at: new Date().toISOString() };
  const value = JSON.stringify(view);
  await prisma.appSetting.upsert({ where: { key: MAP_KEY }, create: { key: MAP_KEY, value }, update: { value } });
  return view;
}

export interface LocationView {
  rows: LocationRow[];
  years: LocationValues['years'];
  at: string;
}

const LOCATION_KEY = 'regions:location';
const LOCATION_FRESH_MS = 24 * 3_600_000;

/** Every 시군구's 입지 numbers and score, from five whole KOSIS tables, kept for a day */
export async function locationView(userId: string): Promise<LocationView> {
  const row = await prisma.appSetting.findUnique({ where: { key: LOCATION_KEY } });
  if (row) {
    const cached = JSON.parse(row.value) as LocationView;
    if (Date.now() - Date.parse(cached.at) < LOCATION_FRESH_MS) return cached;
  }
  const tables = await Promise.all(
    (Object.entries(LOCATION_TABLES) as [LocationTable, (typeof LOCATION_TABLES)[LocationTable]][]).map(async ([k, t]) => {
      const params: Record<string, string> = { orgId: t.org, tblId: t.tbl, itmId: t.itm, objL1: 'ALL', prdSe: 'Y', newEstPrdCnt: String(t.years) };
      if ('objL2' in t) params.objL2 = t.objL2;
      return [k, (await kosisTable(userId, params)) as unknown as KosisRow[]] as const;
    }),
  );
  const v = locationValues(Object.fromEntries(tables) as Record<LocationTable, KosisRow[]>);
  const view: LocationView = { rows: rankLocations(v), years: v.years, at: new Date().toISOString() };
  const value = JSON.stringify(view);
  await prisma.appSetting.upsert({ where: { key: LOCATION_KEY }, create: { key: LOCATION_KEY, value }, update: { value } });
  return view;
}

const TIMELINE_KEY = 'regions:timeline';
const TIMELINE_MONTHS = 72;

/** Six years of every region's map metrics, month by month, for the map's time-lapse; kept 12 hours */
export async function timelineView(userId: string): Promise<TimelineFrames & { at: string }> {
  const row = await prisma.appSetting.findUnique({ where: { key: TIMELINE_KEY } });
  if (row) {
    const cached = JSON.parse(row.value) as TimelineFrames & { at: string };
    if (Date.now() - Date.parse(cached.at) < MAP_FRESH_MS) return cached;
  }
  const today = kstDate();
  const start = (months: number) => addMonths(`${today.slice(0, 7)}-01`, -months).slice(0, 7).replace('-', '');
  // Changes need a year (deals two) before the first frame
  const [price, ratio, trade] = await Promise.all([
    roneTable(userId, 'A_2024_00045', start(TIMELINE_MONTHS + 16)),
    roneTable(userId, 'A_2024_00073', start(TIMELINE_MONTHS + 4)),
    roneTable(userId, 'A_2024_00554', start(TIMELINE_MONTHS + 28)),
  ]);
  const view = { ...timelineFrames({ price, ratio, trade }, TIMELINE_MONTHS), at: new Date().toISOString() };
  const value = JSON.stringify(view);
  await prisma.appSetting.upsert({ where: { key: TIMELINE_KEY }, create: { key: TIMELINE_KEY, value }, update: { value } });
  return view;
}
