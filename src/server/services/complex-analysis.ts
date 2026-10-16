/**
 * 단지 분석 views: a 시군구's apartment deals (국토부 실거래가, kept month by month in RtmsMonth)
 * turned into the complex table, 급지 rankings, leading complexes, one complex's deals, the
 * user's starred complexes and the month's deal-count forecast from daily snapshots.
 */
import {
  complexDetail,
  complexRanking,
  complexRows,
  dongRanking,
  drawdownBuckets,
  forecastMonth,
  isNational,
  leaderSeries,
  type ComplexDetail,
  type ComplexRow,
  type Forecast,
  type Ranked,
  type Snapshot,
} from '@/domain/complex-analysis';
import { complexKey, MolitApiError, monthsBefore, readApartmentMeta, recentMonths, type AptTrade } from '@/domain/real-estate';
import { roneRegion, RONE_REGIONS, type RoneRegion } from '@/domain/region-analysis';
import { addMonths } from '@/domain/indicators';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { dbDate, kstDate, prisma } from '../db';
import { serviceKey } from './api-keys';
import { UserError } from './portfolios';
import { molitKey, monthTrades } from './real-estate';

/** Years of deals a view reads (the first view of a district asks the API once per month) */
export const COMPLEX_YEARS = [3, 5, 10] as const;
const PARALLEL = 4;

async function pool<T>(jobs: (() => Promise<T>)[], n = PARALLEL): Promise<T[]> {
  const out: T[] = new Array(jobs.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, jobs.length) }, async () => {
      while (next < jobs.length) {
        const i = next++;
        out[i] = await jobs[i]();
      }
    }),
  );
  return out;
}

function districtOf(key: string): RoneRegion {
  const r = roneRegion(key);
  if (!r) throw new UserError('없는 지역입니다.');
  if (!r.lawd.length) throw new UserError('단지 분석은 시군구를 골라야 합니다. 지역 칸에 구·시·군 이름을 넣으세요.');
  return r;
}

interface Deals {
  trades: AptTrade[];
  lawdOf: (t: AptTrade) => string;
  /** This month's and last month's reported counts per district, for the snapshot */
  recent: { lawd: string; ym: string; count: number }[];
}

/** Every apartment sale of the region's districts in the last `months` months */
async function regionDeals(userId: string, r: RoneRegion, months: number, key?: string): Promise<Deals> {
  const k = key ?? (await molitKey(userId));
  const today = kstDate();
  const yms = recentMonths(today, months);
  const owner = new Map<AptTrade, string>();
  const jobs = r.lawd.flatMap((lawd) => yms.map((ym) => async () => ({ lawd, ym, trades: await monthTrades(userId, k, 'apartment', lawd, ym, today) })));
  let parts: { lawd: string; ym: string; trades: AptTrade[] }[];
  try {
    parts = await pool(jobs);
  } catch (e) {
    if (e instanceof MolitApiError) throw new UserError(`실거래가를 가져오지 못했습니다: ${e.message}`);
    console.error('[complexes] deals failed', e instanceof Error ? e.message : e);
    throw new UserError('실거래가를 가져오지 못했습니다. 잠시 후 다시 시도하세요.');
  }
  const trades: AptTrade[] = [];
  for (const p of parts) for (const t of p.trades) {
    owner.set(t, p.lawd);
    trades.push(t);
  }
  const recent = parts.filter((p) => p.ym === yms[0] || p.ym === yms[1]).map((p) => ({ lawd: p.lawd, ym: p.ym, count: p.trades.filter((t) => !t.cancelled).length }));
  return { trades, lawdOf: (t) => owner.get(t) ?? r.lawd[0], recent };
}

/** Today's reported counts of this and last month (a view already read them) */
async function snapshot(recent: Deals['recent']) {
  const day = dbDate(kstDate());
  for (const s of recent) {
    await prisma.dealSnapshot.upsert({ where: { lawdCd_ym_day: { lawdCd: s.lawd, ym: s.ym, day } }, create: { lawdCd: s.lawd, ym: s.ym, day, count: s.count }, update: { count: s.count } });
  }
}

const VIEWED = (userId: string) => `complex:viewed:${userId}`;
/** Districts the user opened on 단지 분석, so the daily snapshot keeps counting them */
async function noteViewed(userId: string, lawds: string[]) {
  const row = await prisma.appSetting.findUnique({ where: { key: VIEWED(userId) } });
  const seen = { ...(row ? (JSON.parse(row.value) as Record<string, string>) : {}) };
  for (const l of lawds) seen[l] = kstDate();
  const value = JSON.stringify(seen);
  await prisma.appSetting.upsert({ where: { key: VIEWED(userId) }, create: { key: VIEWED(userId), value }, update: { value } });
}

async function regionForecast(r: RoneRegion, d: Deals): Promise<Forecast> {
  const today = kstDate();
  const rows = await prisma.dealSnapshot.findMany({ where: { lawdCd: { in: r.lawd } }, orderBy: { day: 'asc' } });
  const sum = new Map<string, Snapshot>();
  for (const s of rows) {
    const day = s.day.toISOString().slice(0, 10);
    const k = `${s.ym}|${day}`;
    const prev = sum.get(k);
    sum.set(k, { ym: s.ym, day, count: (prev?.count ?? 0) + s.count });
  }
  // A month is final once its reporting window (30 days after the deal) has passed: it ended 30+ days ago
  const settled = new Date(Date.parse(`${today}T00:00:00Z`) - 30 * 86_400_000).toISOString().slice(0, 7).replace('-', '');
  const finals: Record<string, number> = {};
  for (const t of d.trades) {
    const ym = t.date.slice(0, 7).replace('-', '');
    if (!t.cancelled && ym < settled) finals[ym] = (finals[ym] ?? 0) + 1;
  }
  return forecastMonth([...sum.values()], finals, today.slice(0, 7).replace('-', ''), today);
}

export interface ComplexView {
  region: { key: string; label: string; lawd: string[] };
  years: number;
  rows: ComplexRow[];
  buckets: { label: string; count: number }[];
  dongs: Ranked[];
  complexes: Ranked[];
  leaders: { keys: string[]; names: string[]; rows: Record<string, number | string | null>[] };
  forecast: Forecast;
  favorites: string[];
  deals: number;
}

export async function complexView(userId: string, key: string, years: number): Promise<ComplexView> {
  const r = districtOf(key);
  const y = (COMPLEX_YEARS as readonly number[]).includes(years) ? years : 5;
  const d = await regionDeals(userId, r, y * 12);
  await Promise.all([snapshot(d.recent), noteViewed(userId, r.lawd)]);
  const today = kstDate();
  const rows = complexRows(d.trades, d.lawdOf, today);
  // 대장: the five complexes with the highest 84㎡-class price per 평 over the last year
  const yearAgo = monthsBefore(today, 12);
  const national = d.trades.filter((t) => isNational(t.area) && t.date >= yearAgo);
  const leaders = complexRanking(national, today, 12, 2).slice(0, 5);
  const favs = await prisma.favoriteComplex.findMany({ where: { userId, lawdCd: { in: r.lawd } }, select: { lawdCd: true, complexKey: true } });
  return {
    region: { key: r.key, label: r.label, lawd: r.lawd },
    years: y,
    rows,
    buckets: drawdownBuckets(rows.filter((x) => x.deals1y > 0)),
    dongs: dongRanking(d.trades, today, 12),
    complexes: complexRanking(d.trades, today, 12, 3).slice(0, 30),
    leaders: { keys: leaders.map((l) => l.key), names: leaders.map((l) => l.name), rows: leaderSeries(d.trades, leaders.map((l) => l.key)) },
    forecast: await regionForecast(r, d),
    favorites: favs.map((f) => `${f.lawdCd}|${f.complexKey}`),
    deals: d.trades.filter((t) => !t.cancelled).length,
  };
}

export async function complexDetailView(userId: string, key: string, lawd: string, complex: string, years: number): Promise<ComplexDetail> {
  const r = districtOf(key);
  if (!r.lawd.includes(lawd)) throw new UserError('없는 단지입니다.');
  const y = (COMPLEX_YEARS as readonly number[]).includes(years) ? years : 5;
  const d = await regionDeals(userId, { ...r, lawd: [lawd] }, y * 12);
  const detail = complexDetail(d.trades, complex);
  if (!detail) throw new UserError('그 단지의 거래가 없습니다.');
  return detail;
}

export interface FavoriteView {
  id: string;
  region: string;
  regionLabel: string;
  lawdCd: string;
  complexKey: string;
  name: string;
  umdNm: string;
  /** The complex's 평형 rows (latest against high) */
  rows: ComplexRow[];
}

/** The user's starred complexes with their latest prices (ten years of their districts, so the 2021 highs count) */
export async function favoritesView(userId: string): Promise<FavoriteView[]> {
  const favs = await prisma.favoriteComplex.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
  if (!favs.length) return [];
  const key = await molitKey(userId);
  const today = kstDate();
  const byLawd = new Map<string, AptTrade[]>();
  for (const lawd of [...new Set(favs.map((f) => f.lawdCd))]) {
    const r = RONE_REGIONS.find((x) => x.lawd.length === 1 && x.lawd[0] === lawd) ?? ({ key: '', label: '', lawd: [lawd] } as unknown as RoneRegion);
    byLawd.set(lawd, (await regionDeals(userId, r, 120, key)).trades);
  }
  return favs.map((f) => {
    const own = (byLawd.get(f.lawdCd) ?? []).filter((t) => complexKey(t) === f.complexKey);
    return { id: f.id, region: f.region, regionLabel: roneRegion(f.region)?.label ?? f.region, lawdCd: f.lawdCd, complexKey: f.complexKey, name: f.name, umdNm: f.umdNm, rows: complexRows(own, () => f.lawdCd, today) };
  });
}

export async function setFavorite(userId: string, input: { region: string; lawdCd: string; complexKey: string; name: string; umdNm: string; on: boolean }) {
  const r = districtOf(input.region);
  if (!r.lawd.includes(input.lawdCd) || !input.complexKey || input.complexKey.length > 200) throw new UserError('없는 단지입니다.');
  const where = { userId_lawdCd_complexKey: { userId, lawdCd: input.lawdCd, complexKey: input.complexKey } };
  if (!input.on) {
    await prisma.favoriteComplex.deleteMany({ where: { userId, lawdCd: input.lawdCd, complexKey: input.complexKey } });
    return;
  }
  const data = { name: input.name.slice(0, 100), umdNm: input.umdNm.slice(0, 50), region: r.key };
  await prisma.favoriteComplex.upsert({ where, create: { userId, lawdCd: input.lawdCd, complexKey: input.complexKey, ...data }, update: data });
}

// ---------------------------------------------------------------- daily snapshot

const SNAPSHOT_DAY = 'complex:snapshot-day';

/**
 * Once a KST day: this and last month's reported apartment sales of every district someone
 * watches (linked apartments, starred complexes, districts opened on 단지 분석 in the last 45
 * days), each with that user's 공공데이터포털 key. Returns how many districts were counted.
 */
export async function runDealSnapshots(force = false): Promise<number> {
  const today = kstDate();
  const done = await prisma.appSetting.findUnique({ where: { key: SNAPSHOT_DAY } });
  if (!force && done?.value === today) return 0;
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - 45 * 86_400_000).toISOString().slice(0, 10);
  const users = await prisma.user.findMany({ select: { id: true } });
  const counted = new Set<string>();
  for (const u of users) {
    const k = await serviceKey(u.id, 'molit', 'DATA_GO_KR_API_KEY');
    if (!k) continue;
    const lawds = new Set<string>();
    const assets = await prisma.asset.findMany({ where: { userId: u.id, type: 'REAL_ESTATE', holdings: { some: {} } }, select: { meta: true } });
    for (const a of assets) {
      const m = readApartmentMeta(a.meta);
      if (m?.lawdCd) lawds.add(m.lawdCd);
    }
    for (const f of await prisma.favoriteComplex.findMany({ where: { userId: u.id }, select: { lawdCd: true } })) lawds.add(f.lawdCd);
    const viewed = await prisma.appSetting.findUnique({ where: { key: VIEWED(u.id) } });
    for (const [l, at] of Object.entries(viewed ? (JSON.parse(viewed.value) as Record<string, string>) : {})) if (at >= since) lawds.add(l);
    const todo = [...lawds].filter((l) => /^\d{5}$/.test(l) && !counted.has(l));
    if (!todo.length) continue;
    try {
      const d = await regionDeals(u.id, { key: '', label: '', lawd: todo } as unknown as RoneRegion, 2, k.key);
      await snapshot(d.recent);
      todo.forEach((l) => counted.add(l));
    } catch (e) {
      console.error('[complexes] snapshot failed', e instanceof Error ? e.message : e);
    }
  }
  await prisma.appSetting.upsert({ where: { key: SNAPSHOT_DAY }, create: { key: SNAPSHOT_DAY, value: today }, update: { value: today } });
  return counted.size;
}

// ---------------------------------------------------------------- nationwide drawdown map

/** Months read for the map: from 2020, so the 2021 highs are in */
const CRAWL_FROM = '202001';
/** API calls a day the crawler may spend (the 공공데이터포털 개발계정 allows 10,000 per service) */
const CRAWL_BUDGET = Number(process.env.PPFP_CRAWL_BUDGET) || 2500;
const DRAWDOWN_KEY = 'regions:drawdown';

export interface DistrictDrawdown {
  /** Share of complex·평형 traded in the last year that set a new high, % */
  newHigh: number;
  /** Median distance of those from their high, % */
  fromHigh: number;
  /** How many complex·평형 that is */
  rows: number;
}
export interface DrawdownView {
  values: Record<string, DistrictDrawdown>;
  /** Districts with every month since 2020 read, of all on the map */
  done: number;
  total: number;
  at: string | null;
}

function mapCodes(): string[] {
  const file = path.join(process.cwd(), 'public/maps/sigungu.json');
  const doc = JSON.parse(readFileSync(file, 'utf8')) as { features: { c: string }[] };
  return [...new Set(doc.features.map((f) => f.c))].sort();
}

function crawlMonths(today: string): string[] {
  const out: string[] = [];
  for (let d = `${CRAWL_FROM.slice(0, 4)}-${CRAWL_FROM.slice(4)}-01`; d <= `${today.slice(0, 7)}-01`; d = addMonths(d, 1)) out.push(d.slice(0, 7).replace('-', ''));
  return out;
}

/**
 * Once a day, a little more of every district's apartment sales since 2020 (district by district,
 * at most CRAWL_BUDGET calls, with the first user's key that has one), then the map's 신고가 비율
 * and 최고가 대비 for each district whose months are all read. Months already stored are not asked
 * again; the latest two are refreshed daily.
 */
export async function crawlDrawdowns(): Promise<DrawdownView> {
  const today = kstDate();
  const users = await prisma.user.findMany({ select: { id: true }, orderBy: { createdAt: 'asc' } });
  let owner: { id: string; key: string } | null = null;
  for (const u of users) {
    const k = await serviceKey(u.id, 'molit', 'DATA_GO_KR_API_KEY');
    if (k) {
      owner = { id: u.id, key: k.key };
      break;
    }
  }
  const codes = mapCodes();
  const months = crawlMonths(today);
  const recent = new Set(months.slice(-2));
  if (owner) {
    const have = await prisma.rtmsMonth.findMany({ where: { kind: 'apartment', ym: { gte: CRAWL_FROM } }, select: { lawdCd: true, ym: true, fetchedAt: true } });
    const stored = new Map(have.map((h) => [`${h.lawdCd}|${h.ym}`, h.fetchedAt.getTime()]));
    let calls = 0;
    // District by district, so the map fills in place by place
    outer: for (const code of codes) {
      for (const ym of months) {
        const at = stored.get(`${code}|${ym}`);
        const stale = at === undefined || (recent.has(ym) && Date.now() - at > 20 * 3_600_000);
        if (!stale) continue;
        if (calls >= CRAWL_BUDGET) break outer;
        calls++;
        try {
          await monthTrades(owner.id, owner.key, 'apartment', code, ym, today);
        } catch (e) {
          // The day's limit (22/23) or a broken service: stop and try again tomorrow
          console.error('[drawdown] crawl stopped', code, ym, e instanceof Error ? e.message : e);
          break outer;
        }
      }
    }
    console.log(`[drawdown] crawled ${calls} district-months`);
  }
  return computeDrawdowns(codes, months, today);
}

async function computeDrawdowns(codes: string[], months: string[], today: string): Promise<DrawdownView> {
  const values: Record<string, DistrictDrawdown> = {};
  let done = 0;
  for (const code of codes) {
    const rows = await prisma.rtmsMonth.findMany({ where: { kind: 'apartment', lawdCd: code, ym: { gte: CRAWL_FROM } }, select: { deals: true } });
    if (rows.length < months.length) continue;
    done++;
    const trades = rows.flatMap((r) => r.deals as unknown as AptTrade[]);
    const list = complexRows(trades, () => code, today).filter((x) => x.deals1y > 0);
    if (list.length < 3) continue;
    const hi = list.filter((x) => x.fromHigh >= -0.001).length;
    const sorted = list.map((x) => x.fromHigh).sort((a, b) => a - b);
    values[code] = { newHigh: (hi / list.length) * 100, fromHigh: sorted[Math.floor(sorted.length / 2)], rows: list.length };
  }
  const view: DrawdownView = { values, done, total: codes.length, at: new Date().toISOString() };
  const value = JSON.stringify(view);
  await prisma.appSetting.upsert({ where: { key: DRAWDOWN_KEY }, create: { key: DRAWDOWN_KEY, value }, update: { value } });
  return view;
}

/** The map's drawdown numbers as last computed (the daily crawl fills them in over about a week) */
export async function drawdownView(): Promise<DrawdownView> {
  const row = await prisma.appSetting.findUnique({ where: { key: DRAWDOWN_KEY } });
  return row ? (JSON.parse(row.value) as DrawdownView) : { values: {}, done: 0, total: mapCodes().length, at: null };
}
