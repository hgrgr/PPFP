/**
 * 시장 개요 data. Daily closes come from Yahoo Finance's spark endpoint (20 symbols a call, no key);
 * the S&P 500's members and weights from the SPDR holdings sheet and Wikipedia's constituents
 * table; government bond yields from FRED, 한국은행 ECOS (the user's key), 일본 재무성, 독일
 * 분데스방크 and 영란은행. Market data is the same for every user, so the caches are global.
 */
import ExcelJS from 'exceljs';
import {
  BENCHMARK_ETF,
  curveFrames,
  groupMap,
  MARKET_ASSETS,
  parseBoeCsv,
  parseBundesbankCsv,
  parseMofCsv,
  parseSp500Members,
  parseSpark,
  parseSpdrHoldings,
  PERIODS,
  returnFrames,
  returnsOf,
  SECTOR_ETFS,
  STYLE_BOX,
  TENORS,
  yahooSymbols,
  yahooTicker,
  yieldId,
  yieldRow,
  YIELD_COUNTRIES,
  type Close,
  type CurveFrames,
  type Holding,
  type MapSector,
  type Member,
  type Period,
  type YieldCountry,
  type YieldRow,
} from '@/domain/market-overview';
import { dbDate, kstDate, prisma } from '../db';
import { serviceKey } from './api-keys';
import { noteCall, outcomeOf } from './api-usage';

const UA = { 'user-agent': 'Mozilla/5.0 (PPFP)' };
const SPARK_TTL = 15 * 60_000;
const MAP_TTL = 60 * 60_000;
const DAY_MS = 86_400_000;

async function get(userId: string, url: string, service: string, init: RequestInit = {}): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, { headers: UA, cache: 'no-store', signal: AbortSignal.timeout(30_000), ...init });
  } catch (e) {
    noteCall(userId, service, 'error');
    throw e;
  }
  noteCall(userId, service, outcomeOf(res.status), res.headers);
  if (!res.ok) throw new Error(`${service} HTTP ${res.status}`);
  return res;
}

// ------------------------------------------------------------------ daily closes

const closeCache = new Map<string, { at: number; range: string; closes: Close[] }>();
const RANGE_DAYS: Record<string, number> = { '2y': 730, '5y': 1826 };

/** Daily closes for Yahoo symbols over `range`, from a 15-minute cache; symbols Yahoo does not know come back empty. */
async function dailyCloses(userId: string, symbols: string[], range: '2y' | '5y'): Promise<Map<string, Close[]>> {
  const out = new Map<string, Close[]>();
  const need: string[] = [];
  for (const s of new Set(symbols)) {
    const c = closeCache.get(s);
    if (c && Date.now() - c.at < SPARK_TTL && RANGE_DAYS[c.range] >= RANGE_DAYS[range]) out.set(s, c.closes);
    else need.push(s);
  }
  const batches: string[][] = [];
  for (let i = 0; i < need.length; i += 20) batches.push(need.slice(i, i + 20));
  let next = 0;
  const errors: string[] = [];
  await Promise.all(
    Array.from({ length: Math.min(4, batches.length) }, async () => {
      while (next < batches.length) {
        const b = batches[next++];
        try {
          const res = await get(userId, `https://query1.finance.yahoo.com/v8/finance/spark?symbols=${b.map(encodeURIComponent).join(',')}&range=${range}&interval=1d`, 'yahoo');
          const got = parseSpark(await res.json());
          for (const s of b) {
            const closes = got.get(s) ?? [];
            closeCache.set(s, { at: Date.now(), range, closes });
            out.set(s, closes);
          }
        } catch (e) {
          errors.push(e instanceof Error ? e.message : String(e));
          // Keep what was there before rather than a blank
          for (const s of b) {
            const old = closeCache.get(s);
            if (old) out.set(s, old.closes);
          }
        }
      }
    }),
  );
  if (errors.length) console.error('[market-overview] spark', errors.slice(0, 3).join(' · '));
  return out;
}

const lastDate = (series: Iterable<Close[]>) => {
  let d: string | null = null;
  for (const c of series) {
    const x = c.at(-1)?.date;
    if (x && (!d || x > d)) d = x;
  }
  return d;
};

// ------------------------------------------------------------------ sectors and styles

export interface EtfRow {
  symbol: string;
  label: string;
  last: number | null;
  returns: Record<Period, number | null>;
}
export interface SectorsView {
  asOf: string | null;
  sectors: EtfRow[];
  benchmark: EtfRow;
  style: { size: string; cells: EtfRow[] }[];
  /** month-end replay for each period: dates and symbol → frame → return */
  frames: Record<Period, { dates: string[]; values: Record<string, (number | null)[]> }>;
}

export async function sectorsView(userId: string): Promise<SectorsView> {
  const defs = [...SECTOR_ETFS, BENCHMARK_ETF, ...STYLE_BOX.flatMap((r) => r.cells)];
  const series = await dailyCloses(userId, defs.map((d) => d.symbol), '5y');
  const row = (d: { symbol: string; label: string }): EtfRow => {
    const c = series.get(d.symbol) ?? [];
    return { symbol: d.symbol, label: d.label, last: c.at(-1)?.close ?? null, returns: returnsOf(c) };
  };
  const symbols = defs.map((d) => d.symbol);
  const frames = Object.fromEntries(PERIODS.map((p) => [p, returnFrames(series, symbols, p, 36)])) as SectorsView['frames'];
  return {
    asOf: lastDate(series.values()),
    sectors: SECTOR_ETFS.map(row),
    benchmark: row(BENCHMARK_ETF),
    style: STYLE_BOX.map((r) => ({ size: r.size, cells: r.cells.map(row) })),
    frames,
  };
}

// ------------------------------------------------------------------ S&P 500 map

const SPY_HOLDINGS = 'https://www.ssga.com/library-content/products/fund-data/etfs/us/holdings-daily-us-en-spy.xlsx';
const SP500_WIKI = 'https://en.wikipedia.org/wiki/List_of_S%26P_500_companies';

/** A slow-moving list (members, weights) kept in AppSetting for a day, and used stale when the source fails. */
async function daily<T>(key: string, load: () => Promise<T>, ok: (v: T) => boolean): Promise<T> {
  const row = await prisma.appSetting.findUnique({ where: { key } });
  const old = row ? (JSON.parse(row.value) as { at: string; value: T }) : null;
  if (old && Date.now() - Date.parse(old.at) < DAY_MS) return old.value;
  try {
    const value = await load();
    if (!ok(value)) throw new Error('받은 목록이 비어 있습니다');
    const v = JSON.stringify({ at: new Date().toISOString(), value });
    await prisma.appSetting.upsert({ where: { key }, create: { key, value: v }, update: { value: v } });
    return value;
  } catch (e) {
    if (old) return old.value;
    throw e;
  }
}

async function spyHoldings(userId: string): Promise<Holding[]> {
  return daily(
    'mo:spy-holdings',
    async () => {
      const res = await get(userId, SPY_HOLDINGS, 'ssga', { headers: { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36' } });
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await res.arrayBuffer());
      const rows: unknown[][] = [];
      wb.worksheets[0]?.eachRow((r) => rows.push((r.values as unknown[]).slice(1)));
      return parseSpdrHoldings(rows);
    },
    (v) => v.length > 50,
  );
}

async function sp500Members(userId: string): Promise<Member[]> {
  return daily('mo:sp500-members', async () => parseSp500Members(await (await get(userId, SP500_WIKI, 'wikipedia')).text()), (v) => v.length > 50);
}

const MAP_PERIODS: Period[] = ['1D', '1W', '1M', '3M', '6M', 'YTD', '1Y'];
let mapCache: { at: number; view: MapView } | null = null;
let mapPending: Promise<MapView> | null = null;

export interface MapView {
  asOf: string | null;
  holdingsOf: string;
  periods: Period[];
  sectors: MapSector[];
}

export async function mapView(userId: string): Promise<MapView> {
  if (mapCache && Date.now() - mapCache.at < MAP_TTL) return mapCache.view;
  mapPending ??= (async () => {
    const [holdings, members] = await Promise.all([spyHoldings(userId), sp500Members(userId)]);
    const inIndex = new Set(members.map((m) => m.symbol));
    const held = holdings.filter((h) => inIndex.has(h.ticker));
    const series = await dailyCloses(userId, held.map((h) => yahooTicker(h.ticker)), '2y');
    const returns = new Map(held.map((h) => [h.ticker, Object.fromEntries(MAP_PERIODS.map((p) => [p, returnsOf(series.get(yahooTicker(h.ticker)) ?? [])[p]]))]));
    const view: MapView = { asOf: lastDate(series.values()), holdingsOf: kstDate(), periods: MAP_PERIODS, sectors: groupMap(held, members, returns, MAP_PERIODS) };
    mapCache = { at: Date.now(), view };
    return view;
  })().finally(() => {
    mapPending = null;
  });
  return mapPending;
}

// ------------------------------------------------------------------ government bond yields

const YLD_FRESH_MS = 12 * 3_600_000;
const yieldInflight = new Map<string, Promise<void>>();

/** Month-end points before the last 400 days, every day after: what the table and the curve replay need */
function thin(points: Close[]): Close[] {
  const cut = new Date(Date.now() - 400 * DAY_MS).toISOString().slice(0, 10);
  return points.filter((p, i) => p.date >= cut || i === points.length - 1 || points[i + 1].date.slice(0, 7) !== p.date.slice(0, 7));
}

async function storeYields(country: YieldCountry['key'], byTenor: Map<string, Close[]>) {
  const ops = [];
  for (const [tenor, pts] of byTenor) {
    if (!pts.length) continue;
    const id = yieldId(country, tenor as (typeof TENORS)[number]);
    const sorted = thin([...pts].sort((a, b) => a.date.localeCompare(b.date)));
    ops.push(prisma.priceDaily.deleteMany({ where: { symbol: id } }));
    ops.push(prisma.priceDaily.createMany({ data: sorted.map((p) => ({ symbol: id, date: dbDate(p.date), close: p.close.toString(), currency: 'IDX', source: `YLD-${country}` })), skipDuplicates: true }));
  }
  if (!ops.length) throw new Error('받은 금리가 없습니다');
  const at = new Date().toISOString();
  await prisma.$transaction([...ops, prisma.appSetting.upsert({ where: { key: `yld:${country}` }, create: { key: `yld:${country}`, value: at }, update: { value: at } })]);
}

/** Source tenor code → our tenor */
const byTenor = (c: YieldCountry, got: Map<string, Close[]>) => {
  const out = new Map<string, Close[]>();
  for (const t of TENORS) {
    const code = c.codes[t];
    if (code && got.get(code)?.length) out.set(t, got.get(code)!);
  }
  return out;
};

const FROM = '2000-01-01';

async function loadCountry(userId: string, c: YieldCountry, ecosKey: string | null): Promise<void> {
  const codes = Object.values(c.codes) as string[];
  if (c.key === 'US') {
    const text = await (await get(userId, `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${codes.join(',')}&cosd=${FROM}`, 'fred')).text();
    const lines = text.split(/\r?\n/);
    const head = (lines[0] ?? '').split(',');
    const got = new Map<string, Close[]>(head.slice(1).map((h) => [h, []]));
    for (const l of lines.slice(1)) {
      const p = l.split(',');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(p[0] ?? '')) continue;
      head.slice(1).forEach((h, i) => {
        const v = Number(p[i + 1]);
        if (p[i + 1] && p[i + 1] !== '.' && Number.isFinite(v)) got.get(h)!.push({ date: p[0], close: v });
      });
    }
    return storeYields('US', byTenor(c, got));
  }
  if (c.key === 'KR') {
    if (!ecosKey) throw new Error('ECOS 키 없음');
    const today = kstDate().replace(/-/g, '');
    const got = new Map<string, Close[]>();
    for (const code of codes) {
      const body = (await (await get(userId, `https://ecos.bok.or.kr/api/StatisticSearch/${encodeURIComponent(ecosKey)}/json/kr/1/100000/817Y002/D/${FROM.replace(/-/g, '')}/${today}/${code}`, 'ecos')).json()) as {
        StatisticSearch?: { row?: { TIME?: string; DATA_VALUE?: string }[] };
        RESULT?: { MESSAGE?: string };
      };
      if (!body.StatisticSearch) throw new Error(`ECOS: ${body.RESULT?.MESSAGE ?? '응답을 읽지 못했습니다'}`);
      got.set(
        code,
        (body.StatisticSearch.row ?? []).flatMap((r) => (/^\d{8}$/.test(r.TIME ?? '') && r.DATA_VALUE && Number.isFinite(Number(r.DATA_VALUE)) ? [{ date: `${r.TIME!.slice(0, 4)}-${r.TIME!.slice(4, 6)}-${r.TIME!.slice(6)}`, close: Number(r.DATA_VALUE) }] : [])),
      );
    }
    return storeYields('KR', byTenor(c, got));
  }
  if (c.key === 'JP') {
    // The history file ends with last month; this month's file has the rest
    const [all, now] = await Promise.all([
      get(userId, 'https://www.mof.go.jp/english/policy/jgbs/reference/interest_rate/historical/jgbcme_all.csv', 'mof').then((r) => r.text()),
      get(userId, 'https://www.mof.go.jp/english/policy/jgbs/reference/interest_rate/jgbcme.csv', 'mof').then((r) => r.text()).catch(() => ''),
    ]);
    const got = parseMofCsv(all);
    for (const [k, v] of parseMofCsv(now)) {
      const seen = new Set((got.get(k) ?? []).map((p) => p.date));
      got.set(k, [...(got.get(k) ?? []), ...v.filter((p) => !seen.has(p.date))]);
    }
    for (const [k, v] of got) got.set(k, v.filter((p) => p.date >= FROM));
    return storeYields('JP', byTenor(c, got));
  }
  if (c.key === 'DE') {
    const text = await (await get(userId, `https://api.statistiken.bundesbank.de/rest/data/BBSIS/D.I.ZST.ZI.EUR.S1311.B.A604.${codes.join('+')}.R.A.A._Z._Z.A?format=csv&lang=en&startPeriod=${FROM}`, 'bundesbank')).text();
    return storeYields('DE', byTenor(c, parseBundesbankCsv(text)));
  }
  const text = await (await get(userId, `https://www.bankofengland.co.uk/boeapps/database/_iadb-fromshowcolumns.asp?csv.x=yes&Datefrom=01/Jan/2000&Dateto=now&SeriesCodes=${codes.join(',')}&CSVF=TN&UsingCodes=Y&VPD=Y&VFD=N`, 'boe')).text();
  return storeYields('UK', byTenor(c, parseBoeCsv(text)));
}

export interface YieldsView {
  rows: YieldRow[];
  curves: CurveFrames;
  sources: { key: YieldCountry['key']; label: string; source: string }[];
  missing: 'ECOS'[];
  errors: string[];
}

export async function yieldsView(userId: string): Promise<YieldsView> {
  const ecos = await serviceKey(userId, 'ecos', 'ECOS_API_KEY');
  const errors: string[] = [];
  await Promise.all(
    YIELD_COUNTRIES.map(async (c) => {
      if (c.key === 'KR' && !ecos) return;
      const row = await prisma.appSetting.findUnique({ where: { key: `yld:${c.key}` } });
      if (row && Date.now() - Date.parse(row.value) < YLD_FRESH_MS) return;
      let p = yieldInflight.get(c.key);
      if (!p) {
        p = loadCountry(userId, c, ecos?.key ?? null).finally(() => yieldInflight.delete(c.key));
        yieldInflight.set(c.key, p);
      }
      await p.catch((e) => {
        const msg = e instanceof Error ? e.message.replace(/\s+/g, ' ') : '받지 못했습니다';
        console.error('[market-overview] yields', c.key, msg);
        errors.push(`${c.label}: ${msg.length > 160 ? `${msg.slice(0, 160)}…` : msg}`);
      });
    }),
  );
  const ids = YIELD_COUNTRIES.flatMap((c) => TENORS.filter((t) => c.codes[t]).map((t) => yieldId(c.key, t)));
  const rows = await prisma.priceDaily.findMany({ where: { symbol: { in: ids } }, orderBy: { date: 'asc' }, select: { symbol: true, date: true, close: true } });
  const series = new Map<string, Close[]>(ids.map((id) => [id, []]));
  for (const r of rows) series.get(r.symbol)!.push({ date: r.date.toISOString().slice(0, 10), close: Number(r.close) });
  return {
    rows: YIELD_COUNTRIES.map((c) => yieldRow(c, series)),
    curves: curveFrames(series, FROM),
    sources: YIELD_COUNTRIES.map((c) => ({ key: c.key, label: c.label, source: c.source })),
    missing: ecos ? [] : ['ECOS'],
    errors,
  };
}

// ------------------------------------------------------------------ period returns of what the user follows

export interface ReturnRow {
  symbol: string;
  name: string;
  group: string;
  /** link target on 실시간 시세, null for indices and the like */
  board: string | null;
  last: number | null;
  date: string | null;
  returns: Record<Period, number | null>;
  /** last 60 closes, for the small line */
  spark: number[];
}

export interface WatchView {
  rows: ReturnRow[];
}

export async function watchView(userId: string): Promise<WatchView> {
  const [lots, watch] = await Promise.all([
    prisma.lot.findMany({
      where: { qtyRemaining: { gt: 0 }, holding: { portfolio: { userId }, asset: { symbol: { not: null }, priceSource: 'BROKER' } } },
      select: { holding: { select: { asset: { select: { symbol: true, name: true, market: true } } } } },
    }),
    prisma.watchItem.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
  ]);
  const mine = new Map<string, { symbol: string; name: string; market: string | null; group: string }>();
  for (const l of lots) {
    const a = l.holding.asset;
    const s = a.symbol!.toUpperCase();
    if (!mine.has(s)) mine.set(s, { symbol: s, name: a.name, market: a.market, group: '보유' });
  }
  for (const w of watch) if (!mine.has(w.symbol)) mine.set(w.symbol, { symbol: w.symbol, name: w.name, market: w.market, group: '관심' });
  const candidates = new Map([...mine.values()].map((m) => [m.symbol, yahooSymbols(m.symbol, m.market)]));
  const series = await dailyCloses(userId, [...MARKET_ASSETS.map((a) => a.symbol), ...[...candidates.values()].flat()], '5y');
  const row = (symbol: string, name: string, group: string, closes: Close[], board: string | null): ReturnRow => ({
    symbol,
    name,
    group,
    board,
    last: closes.at(-1)?.close ?? null,
    date: closes.at(-1)?.date ?? null,
    returns: returnsOf(closes),
    spark: closes.slice(-60).map((c) => c.close),
  });
  const rows: ReturnRow[] = [];
  for (const m of mine.values()) {
    const ys = candidates.get(m.symbol) ?? [];
    const closes = ys.map((y) => series.get(y) ?? []).find((c) => c.length) ?? [];
    rows.push(row(m.symbol, m.name, m.group, closes, m.symbol));
  }
  for (const a of MARKET_ASSETS) rows.push(row(a.symbol, a.label, a.group, series.get(a.symbol) ?? [], null));
  return { rows };
}
