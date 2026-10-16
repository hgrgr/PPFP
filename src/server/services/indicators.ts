/**
 * 분석 지표 data: loads the series the indicators need from FRED (no key), the New York Fed's
 * ACM file (no key), 한국은행 ECOS and 통계청 KOSIS (the user's free keys), and keeps them in
 * PriceDaily under their series id. A series is fetched again after FRESH_MS; when a source
 * fails, the stored copy is used.
 */
import { clip, indicatorById, parseAcm, parseEcosAny, parseKosis, parseLw, parseRone, parseRoneByClass, parseYahooMonthly, popCodes, watchFor, type AnalysisParams, type ChartData, type Point, type SeriesReq } from '@/domain/indicators';
import { parseFredCsv } from '@/domain/benchmark';
import ExcelJS from 'exceljs';
import { excelDate, readXls } from '@/domain/xls';
import { dbDate, kstDate, prisma } from '../db';
import { clearServiceKey, serviceKey, setServiceKey } from './api-keys';
import { noteCall, outcomeOf } from './api-usage';
import { UserError } from './portfolios';

const FRESH_MS = 12 * 3_600_000;
const ACM_URL = 'https://www.newyorkfed.org/medialibrary/media/research/data_indicators/ACMTermPremium.xls';
const LW_URL = 'https://www.newyorkfed.org/medialibrary/media/research/economists/williams/data/Laubach_Williams_current_estimates.xlsx';
const RONE_URL = 'https://www.reb.or.kr/r-one/openapi/SttsApiTblData.do';
const UA = { 'user-agent': 'Mozilla/5.0 (PPFP)' };

/** Why a series has no data: a key the user has not added, or a source error */
export type Missing = 'ECOS' | 'KOSIS' | 'RONE';

const inflight = new Map<string, Promise<void>>();

/** Bumped when what is stored for a series changes (2: FRED month-end instead of average), so it is fetched again */
const STORE_VERSION = 2;

async function fetchedAt(id: string): Promise<number> {
  const row = await prisma.appSetting.findUnique({ where: { key: `ind:${id}` } });
  const [at, v] = (row?.value ?? '').split(' ');
  return Number(v) === STORE_VERSION ? Date.parse(at) || 0 : 0;
}
async function markFetched(ids: string[]) {
  const at = `${new Date().toISOString()} ${STORE_VERSION}`;
  await prisma.$transaction(ids.map((id) => prisma.appSetting.upsert({ where: { key: `ind:${id}` }, create: { key: `ind:${id}`, value: at }, update: { value: at } })));
}

async function store(id: string, source: string, points: Point[]) {
  if (!points.length) return;
  await prisma.$transaction([
    prisma.priceDaily.deleteMany({ where: { symbol: id } }),
    prisma.priceDaily.createMany({ data: points.map((p) => ({ symbol: id, date: dbDate(p.date), close: p.value.toString(), currency: 'IDX', source })), skipDuplicates: true }),
  ]);
}

async function getText(url: string, userId: string, service: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(url, { headers: UA, cache: 'no-store', signal: AbortSignal.timeout(30_000) });
  } catch (e) {
    noteCall(userId, service, 'error');
    throw e;
  }
  noteCall(userId, service, outcomeOf(res.status), res.headers);
  if (!res.ok) throw new Error(`${service} HTTP ${res.status}`);
  return res.text();
}

const ym = (d: string) => d.slice(0, 7).replace('-', '');
function ecosRange(freq: SeriesReq['freq'], today: string): [string, string] {
  const y = today.slice(0, 4);
  if (freq === 'A') return ['1960', y];
  if (freq === 'Q') return ['1960Q1', `${y}Q4`];
  return ['196001', ym(today)];
}

async function loadFred(userId: string, r: SeriesReq) {
  // The month's last close, as the ACM file's monthly sheet is month-end, so cards that set the
  // market 10-year beside ACM's parts compare the same day
  const monthly = r.freq === 'M' ? '&fq=Monthly&fam=eop' : '';
  const pts = parseFredCsv(await getText(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(r.code)}&cosd=1950-01-01${monthly}`, userId, 'fred'));
  // A month still running shows its latest close so far
  await store(r.id, 'FRED', pts.map((p) => ({ date: p.date, value: p.close })));
}

async function loadEcos(userId: string, r: SeriesReq, key: string) {
  const [stat, cycle, ...items] = r.code.split('/');
  const [from, to] = ecosRange(r.freq, kstDate());
  const text = await getText(`https://ecos.bok.or.kr/api/StatisticSearch/${encodeURIComponent(key)}/json/kr/1/10000/${stat}/${cycle}/${from}/${to}/${items.join('/')}`, userId, 'ecos');
  const { points, error } = parseEcosAny(JSON.parse(text));
  if (error) throw new Error(`ECOS: ${error}`);
  await store(r.id, 'ECOS', points);
}

/** One call per region for all its ages (KOSIS returns a row per region × age × month). */
async function loadKosis(userId: string, reqs: SeriesReq[], key: string) {
  const byRegion = new Map<string, SeriesReq[]>();
  for (const r of reqs) {
    const [, , , region] = r.code.split('/');
    byRegion.set(region, [...(byRegion.get(region) ?? []), r]);
  }
  for (const [region, all] of byRegion) {
    // 세대수 (DT_1B040B3) has no age split: every item is fetched and the one named 세대수 kept
    for (const r of all.filter((x) => x.code.split('/')[1] === 'DT_1B040B3')) {
      const [orgId, tblId] = r.code.split('/');
      const q = new URLSearchParams({ method: 'getList', apiKey: key, orgId, tblId, itmId: 'ALL', objL1: region, format: 'json', jsonVD: 'Y', prdSe: 'M', startPrdDe: '201101', endPrdDe: ym(kstDate()) });
      const res = parseKosis(JSON.parse(await getText(`https://kosis.kr/openapi/Param/statisticsParameterData.do?${q}`, userId, 'kosis')));
      if (res.error && !res.rows.length) {
        if (res.code === '30') continue;
        throw new Error(res.error);
      }
      const names = [...new Set(res.rows.map((x) => x.item))];
      const name = names.find((n) => n.replace(/\s/g, '') === '세대수') ?? names.find((n) => n.includes('세대수') && !n.includes('당')) ?? names[0];
      await store(r.id, 'KOSIS', res.rows.filter((x) => x.region === region && x.item === name).map((x) => ({ date: x.date, value: x.value })).sort((a, b) => a.date.localeCompare(b.date)));
    }
    const list = all.filter((x) => x.code.split('/')[1] !== 'DT_1B040B3');
    if (!list.length) continue;
    const [orgId, tblId, itmId] = list[0].code.split('/');
    const ages = list.map((r) => r.code.split('/')[4]);
    const q = new URLSearchParams({ method: 'getList', apiKey: key, orgId, tblId, itmId, objL1: region, objL2: ages.join(' '), format: 'json', jsonVD: 'Y', prdSe: 'M', startPrdDe: '201101', endPrdDe: ym(kstDate()) });
    const text = await getText(`https://kosis.kr/openapi/Param/statisticsParameterData.do?${q}`, userId, 'kosis');
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error('KOSIS 응답을 읽지 못했습니다');
    }
    const { rows, error, code } = parseKosis(body);
    if (error && !rows.length) {
      // 30: no data, as for a region code the table does not have (강원·전북's old or new code)
      if (code === '30') continue;
      throw new Error(error);
    }
    for (const r of list) {
      const age = r.code.split('/')[4];
      await store(r.id, 'KOSIS', rows.filter((x) => x.region === region && x.age === age).map((x) => ({ date: x.date, value: x.value })).sort((a, b) => a.date.localeCompare(b.date)));
    }
  }
}

async function loadAcm(userId: string) {
  let res: Response;
  try {
    res = await fetch(ACM_URL, { headers: UA, cache: 'no-store', signal: AbortSignal.timeout(60_000) });
  } catch (e) {
    noteCall(userId, 'nyfed', 'error');
    throw e;
  }
  noteCall(userId, 'nyfed', outcomeOf(res.status));
  if (!res.ok) throw new Error(`nyfed HTTP ${res.status}`);
  const sheets = readXls(Buffer.from(await res.arrayBuffer()));
  const monthly = sheets.find((s) => /monthly/i.test(s.name)) ?? sheets[0];
  const cols = parseAcm(monthly?.rows ?? [], excelDate);
  if (!cols.get('ACMY10')?.length) throw new Error('ACM 파일에서 ACMY10을 찾지 못했습니다');
  for (const col of ['ACMY10', 'ACMTP10', 'ACMRNY10']) await store(`IND:ACM:${col}`, 'ACM', cols.get(col) ?? []);
  await markFetched(['IND:ACM:ACMY10', 'IND:ACM:ACMTP10', 'IND:ACM:ACMRNY10']);
}

/** A Yahoo Finance symbol's month-end closes since 1970. */
async function loadYahoo(userId: string, r: SeriesReq) {
  const now = Math.floor(Date.now() / 1000) + 86_400;
  const body = JSON.parse(await getText(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(r.code)}?period1=0&period2=${now}&interval=1mo`, userId, 'yahoo'));
  const pts = parseYahooMonthly(body);
  if (!pts.length) throw new Error('Yahoo: 받은 자료가 없습니다');
  await store(r.id, 'YAHOO', pts);
}

/** R-ONE calls in flight at once (the 지역 분석 board asks for dozens of series together) */
const RONE_PARALLEL = 4;
let roneRunning = 0;
const roneQueue: (() => void)[] = [];
async function roneSlot<T>(job: () => Promise<T>): Promise<T> {
  if (roneRunning >= RONE_PARALLEL) await new Promise<void>((go) => roneQueue.push(go));
  roneRunning++;
  try {
    return await job();
  } finally {
    roneRunning--;
    roneQueue.shift()?.();
  }
}

/** One R-ONE table, region (and group, for tables split by one) and item, every month since 2003, a thousand rows a page. */
async function loadRone(userId: string, r: SeriesReq, key: string) {
  await roneSlot(() => loadRoneNow(userId, r, key));
}
async function loadRoneNow(userId: string, r: SeriesReq, key: string) {
  const [table, cls, item, grp] = r.code.split('/');
  if (cls === '*') return loadRoneClasses(userId, table, item, grp, key);
  const points: Point[] = [];
  for (let page = 1; page <= 20; page++) {
    const quarterly = r.freq === 'Q';
    const q = new URLSearchParams({ KEY: key, Type: 'json', pIndex: String(page), pSize: '1000', STATBL_ID: table, DTACYCLE_CD: quarterly ? 'QY' : 'MM', CLS_ID: cls, ITM_ID: item, START_WRTTIME: '200301', ...(grp ? { GRP_ID: grp } : {}) });
    const res = parseRone(JSON.parse(await getText(`${RONE_URL}?${q}`, userId, 'rone')), quarterly);
    if (res.error) throw new Error(`R-ONE: ${res.error}`);
    points.push(...res.points);
    if (page * 1000 >= res.total) break;
  }
  await store(r.id, 'RONE', points.sort((a, b) => a.date.localeCompare(b.date)));
}

/**
 * Every class of an R-ONE table for one group (e.g. each buyer's residence of one region's
 * apartment sales), in one run of pages; each class is stored as `table/cls/item/grp`.
 */
async function loadRoneClasses(userId: string, table: string, item: string, grp: string, key: string) {
  const byClass = new Map<string, Point[]>();
  for (let page = 1; page <= 20; page++) {
    const q = new URLSearchParams({ KEY: key, Type: 'json', pIndex: String(page), pSize: '1000', STATBL_ID: table, DTACYCLE_CD: 'MM', ITM_ID: item, START_WRTTIME: '200301', ...(grp ? { GRP_ID: grp } : {}) });
    const res = parseRoneByClass(JSON.parse(await getText(`${RONE_URL}?${q}`, userId, 'rone')));
    if (res.error) throw new Error(`R-ONE: ${res.error}`);
    for (const [cls, pts] of res.byClass) byClass.set(cls, [...(byClass.get(cls) ?? []), ...pts]);
    if (page * 1000 >= res.total) break;
  }
  for (const [cls, pts] of byClass) await store(`IND:RONE:${table}/${cls}/${item}${grp ? `/${grp}` : ''}`, 'RONE', pts.sort((a, b) => a.date.localeCompare(b.date)));
}

/**
 * A whole R-ONE table (every region and class) from `start` (YYYYMM), not stored: for views over
 * every region at once, such as the map. Keys are "GRP/CLS" ("/CLS" for tables without groups).
 */
export async function roneTable(userId: string, table: string, start: string, item = '100001'): Promise<Map<string, Point[]>> {
  const k = await serviceKey(userId, 'rone', 'RONE_API_KEY');
  if (!k) throw new UserError('한국부동산원 R-ONE 인증키가 필요합니다. 연동 · 설정에서 넣으세요.');
  return roneSlot(async () => {
    const out = new Map<string, Point[]>();
    for (let page = 1; page <= 60; page++) {
      const q = new URLSearchParams({ KEY: k.key, Type: 'json', pIndex: String(page), pSize: '1000', STATBL_ID: table, DTACYCLE_CD: 'MM', ITM_ID: item, START_WRTTIME: start });
      const res = parseRoneByClass(JSON.parse(await getText(`${RONE_URL}?${q}`, userId, 'rone')), true);
      if (res.error) throw new Error(`R-ONE: ${res.error}`);
      for (const [key, pts] of res.byClass) out.set(key, [...(out.get(key) ?? []), ...pts]);
      if (page * 1000 >= res.total) break;
    }
    for (const pts of out.values()) pts.sort((a, b) => a.date.localeCompare(b.date));
    return out;
  });
}

/** A whole KOSIS table query (statisticsParameterData) as its rows, with the user's key */
export async function kosisTable(userId: string, params: Record<string, string>): Promise<Record<string, string>[]> {
  const k = await serviceKey(userId, 'kosis', 'KOSIS_API_KEY');
  if (!k) throw new UserError('통계청 KOSIS 인증키가 필요합니다. 연동 · 설정에서 넣으세요.');
  const q = new URLSearchParams({ method: 'getList', apiKey: k.key, format: 'json', jsonVD: 'Y', ...params });
  const body = JSON.parse(await getText(`https://kosis.kr/openapi/Param/statisticsParameterData.do?${q}`, userId, 'kosis')) as unknown;
  if (!Array.isArray(body)) {
    const e = body as { err?: unknown; errMsg?: unknown } | null;
    throw new Error(`KOSIS ${params.tblId}: ${typeof e?.errMsg === 'string' ? e.errMsg : (e?.err ?? '응답을 읽지 못했습니다')}`);
  }
  return body as Record<string, string>[];
}

/** The New York Fed's Laubach-Williams estimates (.xlsx): one-sided r* and output gap, quarterly. */
async function loadLw(userId: string) {
  let res: Response;
  try {
    res = await fetch(LW_URL, { headers: UA, cache: 'no-store', signal: AbortSignal.timeout(60_000) });
  } catch (e) {
    noteCall(userId, 'nyfed', 'error');
    throw e;
  }
  noteCall(userId, 'nyfed', outcomeOf(res.status));
  if (!res.ok) throw new Error(`nyfed HTTP ${res.status}`);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await res.arrayBuffer()) as unknown as ArrayBuffer);
  const ws = wb.getWorksheet('data') ?? wb.worksheets.find((w) => /data/i.test(w.name) && !/input/i.test(w.name));
  const rows: unknown[][] = [];
  ws?.eachRow({ includeEmpty: false }, (row) => rows.push((row.values as unknown[]).map((v) => (v && typeof v === 'object' && 'result' in v ? (v as { result: unknown }).result : v))));
  const { rstar, gap } = parseLw(rows);
  if (!rstar.length) throw new Error('Laubach-Williams 파일에서 rstar를 찾지 못했습니다');
  await store('IND:LW:rstar', 'LW', rstar);
  await store('IND:LW:gap', 'LW', gap);
  await markFetched(['IND:LW:rstar', 'IND:LW:gap']);
}

/**
 * Brings `reqs` up to date (those older than FRESH_MS). Returns the sources that could not be
 * read: a missing key ('ECOS', 'KOSIS') or an error message.
 */
export async function refreshSeries(userId: string, reqs: SeriesReq[]): Promise<{ missing: Missing[]; errors: string[] }> {
  const missing = new Set<Missing>();
  const errors: string[] = [];
  const stale: SeriesReq[] = [];
  for (const r of reqs) if (Date.now() - (await fetchedAt(r.id)) > FRESH_MS) stale.push(r);
  if (!stale.length) return { missing: [], errors: [] };
  const ecosKey = stale.some((r) => r.source === 'ECOS') ? await serviceKey(userId, 'ecos', 'ECOS_API_KEY') : null;
  const kosisKey = stale.some((r) => r.source === 'KOSIS') ? await serviceKey(userId, 'kosis', 'KOSIS_API_KEY') : null;
  const roneKey = stale.some((r) => r.source === 'RONE') ? await serviceKey(userId, 'rone', 'RONE_API_KEY') : null;
  const once = (id: string, job: () => Promise<void>) => {
    const running = inflight.get(id);
    if (running) return running;
    const p = job().finally(() => inflight.delete(id));
    inflight.set(id, p);
    return p;
  };
  const tasks: Promise<void>[] = [];
  const guard = (label: string, job: () => Promise<void>) =>
    job().catch((e) => {
      console.error('[indicators]', label, e instanceof Error ? e.message : e);
      // Database errors can quote whole rows: keep the screen's note short
      const msg = e instanceof Error ? e.message.replace(/\s+/g, ' ') : '받지 못했습니다';
      errors.push(`${label}: ${msg.length > 160 ? `${msg.slice(0, 160)}…` : msg}`);
    });
  for (const r of stale) {
    if (r.source === 'YAHOO') tasks.push(guard(r.code, () => once(r.id, async () => { await loadYahoo(userId, r); await markFetched([r.id]); })));
    else if (r.source === 'FRED') tasks.push(guard(r.code, () => once(r.id, async () => { await loadFred(userId, r); await markFetched([r.id]); })));
    else if (r.source === 'ECOS') {
      if (!ecosKey) missing.add('ECOS');
      else tasks.push(guard(`ECOS ${r.code}`, () => once(r.id, async () => { await loadEcos(userId, r, ecosKey.key); await markFetched([r.id]); })));
    }
  }
  if (stale.some((r) => r.source === 'ACM')) tasks.push(guard('뉴욕연준 ACM', () => once('ACM', () => loadAcm(userId))));
  if (stale.some((r) => r.source === 'LW')) tasks.push(guard('뉴욕연준 r*', () => once('LW', () => loadLw(userId))));
  for (const r of stale.filter((x) => x.source === 'RONE')) {
    if (!roneKey) missing.add('RONE');
    else tasks.push(guard(`R-ONE ${r.code}`, () => once(r.id, async () => { await loadRone(userId, r, roneKey.key); await markFetched([r.id]); })));
  }
  const kosis = stale.filter((r) => r.source === 'KOSIS');
  if (kosis.length) {
    if (!kosisKey) missing.add('KOSIS');
    else tasks.push(guard('KOSIS 인구', () => once(`KOSIS:${kosis.map((r) => r.id).join(',')}`, async () => { await loadKosis(userId, kosis, kosisKey.key); await markFetched(kosis.map((r) => r.id)); })));
  }
  await Promise.all(tasks);
  return { missing: [...missing], errors };
}

export async function readSeries(ids: string[]): Promise<Map<string, Point[]>> {
  const rows = await prisma.priceDaily.findMany({ where: { symbol: { in: ids } }, orderBy: { date: 'asc' }, select: { symbol: true, date: true, close: true } });
  const out = new Map<string, Point[]>(ids.map((id) => [id, []]));
  for (const r of rows) out.get(r.symbol)!.push({ date: r.date.toISOString().slice(0, 10), value: Number(r.close) });
  return out;
}

export interface IndicatorView {
  id: string;
  data: ChartData | null;
  missing: Missing[];
  errors: string[];
}

/** One indicator's chart for the user's params, clipped to the last `years` (0: all). */
export async function indicatorView(userId: string, id: string, params: AnalysisParams, years: number): Promise<IndicatorView> {
  const ind = indicatorById(id);
  if (!ind) throw new UserError('없는 지표입니다.');
  const reqs = ind.needs(params);
  const { missing, errors } = await refreshSeries(userId, reqs);
  const series = await readSeries(reqs.map((r) => r.id));
  const get = (sid: string) => series.get(sid) ?? [];
  const data = ind.build(get, params);
  const empty = !data.rows.some((r) => Object.entries(r).some(([k, v]) => k !== 'date' && v !== null));
  if (empty) return { id, data: null, missing, errors };
  // Watch points read the whole history; bands are cut to the period shown
  const watch = watchFor(id, data, get, params);
  const rows = clip(data.rows, years, kstDate());
  const first = String(rows[0]?.date ?? '');
  const bands = (watch.bands ?? []).filter((b) => b.to >= first).map((b) => ({ ...b, from: b.from < first ? first : b.from }));
  return { id, data: { ...data, rows, watch: watch.items, bands }, missing, errors };
}

/** Population regions offered besides the 시도: the 시군구 of the user's linked real estate */
export async function myPropertyDistricts(userId: string): Promise<{ code: string; name: string }[]> {
  const assets = await prisma.asset.findMany({ where: { userId, type: 'REAL_ESTATE', holdings: { some: {} } }, select: { meta: true } });
  const out = new Map<string, string>();
  for (const a of assets) {
    const m = a.meta as { lawdCd?: unknown; address?: unknown } | null;
    if (m && typeof m.lawdCd === 'string' && /^\d{5}$/.test(m.lawdCd) && popCodes(m.lawdCd).length) {
      // "경기 성남시 분당구 구미동 187-3" → "경기 성남시 분당구": the address without its 동 and 지번
      const words = typeof m.address === 'string' ? m.address.split(' ') : [];
      const addr = words.length >= 4 ? words.slice(0, -2).join(' ') : words.length ? words.slice(0, 2).join(' ') : m.lawdCd;
      out.set(m.lawdCd, addr);
    }
  }
  return [...out].map(([code, name]) => ({ code, name }));
}

/** The user's 통계청 KOSIS 인증키, checked against KOSIS before it is stored. */
export async function saveKosisKey(userId: string, input: { key?: string; clear?: boolean }) {
  const key = input.key?.trim();
  if (key) {
    if (!/^[A-Za-z0-9+/=]{16,120}$/.test(key)) throw new UserError('KOSIS 인증키를 그대로 붙여 넣으세요.');
    let ok = false;
    try {
      const q = new URLSearchParams({ method: 'getList', apiKey: key, orgId: '101', tblId: 'DT_1B04005N', itmId: 'T2', objL1: '00', objL2: '0', format: 'json', jsonVD: 'Y', prdSe: 'M', newEstPrdCnt: '1' });
      const res = await fetch(`https://kosis.kr/openapi/Param/statisticsParameterData.do?${q}`, { headers: UA, cache: 'no-store', signal: AbortSignal.timeout(15_000) });
      ok = parseKosis(JSON.parse(await res.text())).rows.length > 0;
    } catch {
      throw new UserError('통계청 KOSIS에 연결하지 못했습니다. 잠시 뒤 다시 저장하세요.');
    }
    if (!ok) throw new UserError('KOSIS가 이 인증키를 받지 않았습니다. 키를 다시 확인하세요.');
    await setServiceKey(userId, 'kosis', key);
    await prisma.appSetting.deleteMany({ where: { key: { startsWith: 'ind:IND:KOSIS:' } } });
  } else if (input.clear) await clearServiceKey(userId, 'kosis');
}

/** The user's 한국부동산원 R-ONE 인증키, checked against R-ONE before it is stored. */
export async function saveRoneKey(userId: string, input: { key?: string; clear?: boolean }) {
  const key = input.key?.trim();
  if (key) {
    if (key.length < 10 || key.length > 120 || /\s/.test(key)) throw new UserError('R-ONE 인증키를 그대로 붙여 넣으세요.');
    let res: ReturnType<typeof parseRone>;
    try {
      const q = new URLSearchParams({ KEY: key, Type: 'json', pIndex: '1', pSize: '12', STATBL_ID: 'A_2024_00076', DTACYCLE_CD: 'MM', CLS_ID: '500001', ITM_ID: '100001', START_WRTTIME: '202401', END_WRTTIME: '202412' });
      const r = await fetch(`${RONE_URL}?${q}`, { headers: UA, cache: 'no-store', signal: AbortSignal.timeout(15_000) });
      res = parseRone(JSON.parse(await r.text()));
    } catch {
      throw new UserError('한국부동산원 R-ONE에 연결하지 못했습니다. 잠시 뒤 다시 저장하세요.');
    }
    if (res.error || res.points.length < 6) throw new UserError(`R-ONE이 이 인증키를 받지 않았습니다${res.error ? `: ${res.error}` : ''}. 키를 다시 확인하세요.`);
    await setServiceKey(userId, 'rone', key);
    await prisma.appSetting.deleteMany({ where: { key: { startsWith: 'ind:IND:RONE:' } } });
  } else if (input.clear) await clearServiceKey(userId, 'rone');
}
