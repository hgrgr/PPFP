/**
 * FRED with the user's free API key (FRED_API_KEY on the server as a fallback): upcoming US data
 * releases for 경제 지표 일정, series search and the user's 내 지표 시트. Series values come from
 * fredgraph.csv, which needs no key.
 */
import { cleanSheet, FOMC_DAYS, headline, majorOf, parseReleaseDates, parseSeriesSearch, transform, type Point, type ReleaseDate, type SheetItem, type Transform } from '@/domain/fred';
import { parseFredCsv } from '@/domain/benchmark';
import { kstDate, prisma } from '../db';
import { clearServiceKey, serviceKey, setServiceKey } from './api-keys';
import { noteCall, outcomeOf } from './api-usage';
import { UserError } from './portfolios';

const API = 'https://api.stlouisfed.org/fred';
const HOUR = 3_600_000;

async function fredKey(userId: string): Promise<string> {
  const k = await serviceKey(userId, 'fred', 'FRED_API_KEY');
  if (!k) throw new UserError('FRED API 키가 필요합니다. 연동 · 설정의 FRED 칸에 넣으세요.');
  return k.key;
}

async function get(userId: string, url: string): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(30_000) });
  } catch (e) {
    noteCall(userId, 'fred', 'error');
    throw e;
  }
  noteCall(userId, 'fred', outcomeOf(res.status));
  return res;
}

async function api<T>(userId: string, path: string, params: Record<string, string>): Promise<T> {
  const key = await fredKey(userId);
  const res = await get(userId, `${API}/${path}?${new URLSearchParams({ api_key: key, file_type: 'json', ...params })}`);
  const body = (await res.json().catch(() => null)) as (T & { error_message?: string }) | null;
  if (res.status === 400 && body?.error_message && /api_key/i.test(body.error_message)) throw new UserError('FRED가 API 키를 받지 않았습니다. 연동 · 설정에서 키를 확인하세요.');
  if (!res.ok || !body) throw new Error(`FRED ${res.status}: ${body?.error_message ?? ''}`);
  return body;
}

const csvCache = new Map<string, { at: number; points: Point[] }>();
/** A series' observations since 2000, six hours in memory */
async function observations(userId: string, id: string): Promise<Point[]> {
  const hit = csvCache.get(id);
  if (hit && Date.now() - hit.at < 6 * HOUR) return hit.points;
  const res = await get(userId, `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(id)}&cosd=2000-01-01`);
  if (!res.ok) throw new Error(`FRED ${id} HTTP ${res.status}`);
  const points = parseFredCsv(await res.text()).map((c) => ({ date: c.date, value: c.close }));
  csvCache.set(id, { at: Date.now(), points });
  return points;
}

export interface CalendarRow {
  date: string;
  id: number;
  name: string;
  major: { label: string; about: string; series: string; show: Transform; unit: string; latest: { date: string; value: number; prev: number | null } | null };
}

let calCache: { at: number; rows: ReleaseDate[] } | null = null;

/** The major releases from a week ago to five weeks ahead (FRED pages them 1,000 at a time), plus FOMC decisions */
export async function calendarView(userId: string): Promise<{ rows: CalendarRow[]; today: string }> {
  const today = kstDate();
  const from = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  const to = new Date(Date.now() + 35 * 86_400_000).toISOString().slice(0, 10);
  if (!calCache || Date.now() - calCache.at > 6 * HOUR) {
    const all: ReleaseDate[] = [];
    for (let offset = 0; offset < 5000; offset += 1000) {
      const body = await api<{ count?: number }>(userId, 'releases/dates', { realtime_start: from, realtime_end: to, include_release_dates_with_no_data: 'true', order_by: 'release_date', sort_order: 'asc', limit: '1000', offset: String(offset) });
      const page = parseReleaseDates(body);
      all.push(...page);
      if (page.length < 1000 || all.length >= (body.count ?? 0)) break;
    }
    const seen = new Set<string>();
    calCache = { at: Date.now(), rows: all.filter((r) => majorOf(r.id) && !seen.has(`${r.id}|${r.date}`) && seen.add(`${r.id}|${r.date}`)) };
  }
  const majors = new Map<string, Awaited<ReturnType<typeof headline>>>();
  const used = [...new Set(calCache.rows.map((r) => majorOf(r.id)!))];
  const fomc = { id: -1, label: 'FOMC 금리 결정', about: '연준 기준금리(상단), 한국 시각 다음 날 새벽 3시 발표', series: 'DFEDTARU', show: 'level' as Transform, unit: '%' };
  await Promise.all([...used, fomc].map(async (m) => majors.set(m.series, headline(await observations(userId, m.series).catch(() => []), m.show))));
  const rows: CalendarRow[] = calCache.rows.map((r) => {
    const m = majorOf(r.id)!;
    return { date: r.date, id: r.id, name: r.name, major: { label: m.label, about: m.about, series: m.series, show: m.show, unit: m.unit, latest: majors.get(m.series) ?? null } };
  });
  for (const d of FOMC_DAYS) if (d >= from && d <= to) rows.push({ date: d, id: -1, name: 'FOMC', major: { ...fomc, latest: majors.get(fomc.series) ?? null } });
  rows.sort((a, b) => a.date.localeCompare(b.date));
  return { today, rows };
}

export async function searchSeries(userId: string, q: string) {
  const text = q.trim().slice(0, 100);
  if (!text) return [];
  const body = await api<unknown>(userId, 'series/search', { search_text: text, limit: '20', order_by: 'popularity', sort_order: 'desc' });
  return parseSeriesSearch(body);
}

const sheetKey = (userId: string) => `sheet:${userId}`;

export async function readSheet(userId: string): Promise<SheetItem[]> {
  const row = await prisma.appSetting.findUnique({ where: { key: sheetKey(userId) } });
  return cleanSheet(row ? JSON.parse(row.value) : []);
}

export async function saveSheet(userId: string, items: unknown): Promise<SheetItem[]> {
  const clean = cleanSheet(items);
  const value = JSON.stringify(clean);
  await prisma.appSetting.upsert({ where: { key: sheetKey(userId) }, create: { key: sheetKey(userId), value }, update: { value } });
  return clean;
}

export interface SheetView {
  items: (SheetItem & { points: Point[]; latest: { date: string; value: number; prev: number | null } | null })[];
}

/** The sheet's series, transformed, last ten years for the charts */
export async function sheetView(userId: string): Promise<SheetView> {
  const items = await readSheet(userId);
  const since = `${Number(kstDate().slice(0, 4)) - 10}-01-01`;
  return {
    items: await Promise.all(
      items.map(async (i) => {
        const pts = await observations(userId, i.id).catch(() => []);
        const t = transform(pts, i.transform);
        return { ...i, points: t.filter((p) => p.date >= since), latest: headline(pts, i.transform) };
      }),
    ),
  };
}

/** The user's FRED key, checked with one call before it is stored */
export async function saveFredKey(userId: string, input: { key?: string; clear?: boolean }) {
  const key = input.key?.trim();
  if (key) {
    if (!/^[0-9a-f]{32}$/i.test(key)) throw new UserError('FRED API 키(영문·숫자 32자)를 그대로 붙여 넣으세요.');
    let ok = false;
    try {
      const res = await fetch(`${API}/series?series_id=GDP&api_key=${encodeURIComponent(key)}&file_type=json`, { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
      ok = res.ok;
    } catch {
      throw new UserError('FRED에 연결하지 못했습니다. 잠시 뒤 다시 저장하세요.');
    }
    if (!ok) throw new UserError('FRED가 이 키를 받지 않았습니다. 키를 다시 확인하세요.');
    await setServiceKey(userId, 'fred', key);
    calCache = null;
  } else if (input.clear) await clearServiceKey(userId, 'fred');
}
