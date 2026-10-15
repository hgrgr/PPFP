/**
 * 거장 포트폴리오 data: each manager's 13F reports from SEC EDGAR (keyless, but the SEC wants a
 * contact in the User-Agent: SEC_USER_AGENT), parsed once and kept in AppSetting for good (a
 * filed report does not change), and CUSIP → ticker from OpenFIGI (keyless at 25 requests a
 * minute; OPENFIGI_API_KEY raises that). The reports are read again twice a day in the
 * background, so the screen opens on what is stored and fills in as reports arrive.
 */
import { kstDate, prisma } from '../db';
import {
  changesOf,
  cloneReturns,
  cloneStats,
  commonHoldings,
  consensus,
  figiTicker,
  fixUnits,
  guruByKey,
  GURUS,
  holdingsOf,
  infoTableFile,
  normalize,
  overlap,
  parseInfoTable,
  reportsThousands,
  type Change,
  type CloneQuarter,
  type Common,
  type Consensus,
  type Guru,
  type Holding,
  type Position,
} from '@/domain/gurus';
import { SECTOR_KO, yahooTicker } from '@/domain/market-overview';
import { noteCall, outcomeOf } from './api-usage';
import { dailyCloses, sp500Members } from './market-overview';
import { UserError } from './portfolios';

const UA = process.env.SEC_USER_AGENT || 'PPFP personal finance app sec-contact@ppfp.example';
const SUB_FRESH_MS = 12 * 3_600_000;
const SYSTEM = 'system';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** SEC asks for at most 10 requests a second */
let lastSec = 0;
async function sec(url: string, userId: string): Promise<Response> {
  const wait = lastSec + 150 - Date.now();
  lastSec = Math.max(Date.now(), lastSec + 150);
  if (wait > 0) await sleep(wait);
  let res: Response;
  try {
    res = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*' }, cache: 'no-store', signal: AbortSignal.timeout(30_000) });
  } catch (e) {
    noteCall(userId, 'sec', 'error');
    throw e;
  }
  noteCall(userId, 'sec', outcomeOf(res.status), res.headers);
  if (!res.ok) throw new Error(`SEC HTTP ${res.status}`);
  return res;
}

async function getJson<T>(key: string): Promise<T | null> {
  const row = await prisma.appSetting.findUnique({ where: { key } });
  return row ? (JSON.parse(row.value) as T) : null;
}
async function putJson(key: string, value: unknown) {
  const v = JSON.stringify(value);
  await prisma.appSetting.upsert({ where: { key }, create: { key, value: v }, update: { value: v } });
}

export interface Report {
  accession: string;
  period: string;
  filed: string;
}

/** A manager's original 13F-HR reports, newest quarter first, one per quarter */
async function reportsOf(g: Guru, userId: string): Promise<Report[]> {
  const key = `13f:sub:${g.cik}`;
  const old = await getJson<{ at: string; reports: Report[] }>(key);
  if (old && Date.now() - Date.parse(old.at) < SUB_FRESH_MS) return old.reports;
  try {
    const sub = (await (await sec(`https://data.sec.gov/submissions/CIK${String(g.cik).padStart(10, '0')}.json`, userId)).json()) as {
      filings: { recent: { form: string[]; accessionNumber: string[]; reportDate: string[]; filingDate: string[] } };
    };
    const r = sub.filings.recent;
    const seen = new Set<string>();
    const reports: Report[] = [];
    r.form.forEach((f, i) => {
      if (f !== '13F-HR' || seen.has(r.reportDate[i])) return;
      seen.add(r.reportDate[i]);
      reports.push({ accession: r.accessionNumber[i], period: r.reportDate[i], filed: r.filingDate[i] });
    });
    reports.sort((a, b) => b.period.localeCompare(a.period));
    await putJson(key, { at: new Date().toISOString(), reports });
    return reports;
  } catch (e) {
    if (old) return old.reports;
    throw e;
  }
}

type Packed = [string, string, number, number, string];
const pack = (p: Position[]): Packed[] => p.map((x) => [x.cusip, x.name, x.value, x.shares, x.putCall ?? '']);
const unpack = (p: Packed[]): Position[] => p.map(([cusip, name, value, shares, pc]) => ({ cusip, name, cls: '', value, shares, putCall: pc === 'PUT' || pc === 'CALL' ? pc : null }));

/** One report's positions, read from EDGAR the first time and kept */
async function positionsOf(g: Guru, r: Report, userId: string): Promise<Position[]> {
  const key = `13f:r:${r.accession}`;
  const hit = await getJson<Packed[]>(key);
  if (hit) return fixUnits(unpack(hit));
  const folder = `https://www.sec.gov/Archives/edgar/data/${g.cik}/${r.accession.replace(/-/g, '')}`;
  const index = (await (await sec(`${folder}/index.json`, userId)).json()) as { directory: { item: { name: string; size?: string }[] } };
  const file = infoTableFile(index.directory.item);
  if (!file) throw new Error(`${r.accession}: 정보표(XML)를 찾지 못했습니다`);
  const positions = fixUnits(parseInfoTable(await (await sec(`${folder}/${file}`, userId)).text(), reportsThousands(r.filed)));
  await putJson(key, pack(positions));
  return positions;
}

// ------------------------------------------------------------------ CUSIP → ticker

const FIGI_KEY = '13f:figi';
let figiMap: Map<string, string | null> | null = null;
async function tickers(): Promise<Map<string, string | null>> {
  figiMap ??= new Map(Object.entries((await getJson<Record<string, string | null>>(FIGI_KEY)) ?? {}));
  return figiMap;
}
let figiRunning: Promise<void> | null = null;

/** Look up unknown CUSIPs (most valuable first), 10 a request, within OpenFIGI's keyless limit */
function resolveCusips(cusips: string[], userId: string): Promise<void> {
  if (figiRunning) return figiRunning;
  figiRunning = (async () => {
    const map = await tickers();
    const todo = [...new Set(cusips)].filter((c) => !map.has(c));
    const key = process.env.OPENFIGI_API_KEY?.trim();
    const per = key ? 100 : 10;
    const gap = key ? 300 : 2600;
    for (let i = 0; i < todo.length; i += per) {
      const batch = todo.slice(i, i + per);
      let res: Response;
      try {
        res = await fetch('https://api.openfigi.com/v3/mapping', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(key ? { 'X-OPENFIGI-APIKEY': key } : {}) },
          body: JSON.stringify(batch.map((c) => ({ idType: 'ID_CUSIP', idValue: c }))),
          signal: AbortSignal.timeout(30_000),
        });
      } catch (e) {
        noteCall(userId, 'openfigi', 'error');
        console.error('[gurus] openfigi', e instanceof Error ? e.message : e);
        break;
      }
      noteCall(userId, 'openfigi', outcomeOf(res.status), res.headers);
      if (res.status === 429) {
        await sleep(60_000);
        i -= per;
        continue;
      }
      if (!res.ok) break;
      const answers = (await res.json()) as unknown[];
      batch.forEach((c, k) => map.set(c, figiTicker(answers[k])));
      await putJson(FIGI_KEY, Object.fromEntries(map));
      await sleep(gap);
    }
  })().finally(() => {
    figiRunning = null;
  });
  return figiRunning;
}

// ------------------------------------------------------------------ refresh

let refreshing: Promise<void> | null = null;
let progress = { done: 0, total: GURUS.length, at: 0 };

/** Each manager's latest two reports; then tickers for what they hold. Runs at most once at a time. */
export function refreshGurus(userId = SYSTEM): Promise<void> {
  if (refreshing) return refreshing;
  progress = { done: 0, total: GURUS.length, at: Date.now() };
  refreshing = (async () => {
    const cusips = new Map<string, number>();
    for (const g of GURUS) {
      try {
        const reports = (await reportsOf(g, userId)).slice(0, 2);
        for (const r of reports) for (const p of await positionsOf(g, r, userId)) if (!p.putCall) cusips.set(p.cusip, (cusips.get(p.cusip) ?? 0) + p.value);
      } catch (e) {
        console.error('[gurus]', g.key, e instanceof Error ? e.message : e);
      }
      progress.done++;
    }
    await putJson('13f:refreshed', { at: new Date().toISOString() });
    // Tickers can take a while (keyless OpenFIGI); the screen does not wait for them
    void resolveCusips([...cusips].sort((a, b) => b[1] - a[1]).map(([c]) => c), userId).catch((e) => console.error('[gurus] tickers', e));
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

async function refreshIfDue(userId: string) {
  const last = await getJson<{ at: string }>('13f:refreshed');
  if (!last || Date.now() - Date.parse(last.at) > SUB_FRESH_MS) void refreshGurus(userId).catch((e) => console.error('[gurus] refresh', e));
}

/** A manager's stored reports (no network): the latest `n` that are already parsed */
async function stored(g: Guru, n: number): Promise<{ report: Report; positions: Position[] }[]> {
  const sub = await getJson<{ reports: Report[] }>(`13f:sub:${g.cik}`);
  const out: { report: Report; positions: Position[] }[] = [];
  for (const r of sub?.reports.slice(0, n) ?? []) {
    const p = await getJson<Packed[]>(`13f:r:${r.accession}`);
    if (!p) break;
    out.push({ report: r, positions: fixUnits(unpack(p)) });
  }
  return out;
}

// ------------------------------------------------------------------ views

export interface GuruSummary {
  key: string;
  person: string;
  firm: string;
  style: string;
  sageId: string | null;
  period: string | null;
  filed: string | null;
  aum: number | null;
  count: number;
  top: { name: string; ticker: string | null; weight: number }[];
  /** half the sum of weight changes against the report before: how much of the book moved */
  turnover: number | null;
  buys: number;
  sells: number;
}

export interface SimilarGuru {
  key: string;
  score: number;
  shared: { ticker: string; mine: number; theirs: number }[];
}

export interface GurusView {
  progress: { done: number; total: number; running: boolean; tickers: boolean };
  quarter: string | null;
  gurus: GuruSummary[];
  buys: Consensus[];
  sells: Consensus[];
  common: Common[];
  similar: SimilarGuru[];
  mine: { count: number; value: number };
}

async function sageIds(userId: string): Promise<Map<string, string>> {
  const presets = GURUS.flatMap((g) => (g.sage ? [g.sage] : []));
  const rows = await prisma.sage.findMany({ where: { userId, preset: { in: presets } }, select: { id: true, preset: true } });
  return new Map(rows.map((r) => [r.preset!, r.id]));
}

/** The user's US-listed stocks by what they paid, for 나와 비슷한 거장 */
async function myUsWeights(userId: string): Promise<{ weights: Map<string, number>; value: number }> {
  const lots = await prisma.lot.findMany({
    where: { qtyRemaining: { gt: 0 }, holding: { portfolio: { userId }, asset: { symbol: { not: null }, currency: 'USD' } } },
    select: { qtyRemaining: true, unitCost: true, holding: { select: { asset: { select: { symbol: true } } } } },
  });
  const m = new Map<string, number>();
  for (const l of lots) {
    const t = l.holding.asset.symbol!.toUpperCase().replace(/-/g, '.');
    m.set(t, (m.get(t) ?? 0) + Number(l.qtyRemaining) * Number(l.unitCost));
  }
  const value = [...m.values()].reduce((a, v) => a + v, 0);
  return { weights: normalize(m), value };
}

export async function gurusView(userId: string): Promise<GurusView> {
  await refreshIfDue(userId);
  const [map, sages, mine] = await Promise.all([tickers(), sageIds(userId), myUsWeights(userId)]);
  const gurus: GuruSummary[] = [];
  const books: { key: string; holdings: Holding[] }[] = [];
  const changes: { key: string; changes: Change[] }[] = [];
  const periods = new Map<string, number>();
  for (const g of GURUS) {
    const [cur, prev] = await stored(g, 2);
    const holdings = cur ? holdingsOf(cur.positions, map) : [];
    const ch = cur && prev ? changesOf(holdingsOf(prev.positions, map), holdings) : [];
    if (cur) {
      books.push({ key: g.key, holdings });
      periods.set(cur.report.period, (periods.get(cur.report.period) ?? 0) + 1);
      // A stale report (a manager that stopped filing) still shows, but is left out of "this quarter"
      if (ch.length) changes.push({ key: g.key, changes: ch });
    }
    gurus.push({
      key: g.key,
      person: g.person,
      firm: g.firm,
      style: g.style,
      sageId: g.sage ? (sages.get(g.sage) ?? null) : null,
      period: cur?.report.period ?? null,
      filed: cur?.report.filed ?? null,
      aum: cur ? holdings.reduce((a, h) => a + h.value, 0) : null,
      count: holdings.length,
      top: holdings.slice(0, 5).map((h) => ({ name: h.name, ticker: h.ticker, weight: h.weight })),
      turnover: ch.length ? ch.reduce((a, c) => a + Math.abs(c.weight - c.prevWeight), 0) / 2 : null,
      buys: ch.filter((c) => c.kind === 'new' || c.kind === 'add').length,
      sells: ch.filter((c) => c.kind === 'sold' || c.kind === 'reduce').length,
    });
  }
  const quarter = [...periods].sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0]?.[0] ?? null;
  const current = new Set(gurus.filter((g) => g.period === quarter).map((g) => g.key));
  const latest = changes.filter((c) => current.has(c.key));
  const similar: SimilarGuru[] = mine.weights.size
    ? books
        .map((b) => {
          const theirs = new Map<string, number>();
          for (const h of b.holdings) if (h.ticker) theirs.set(h.ticker, (theirs.get(h.ticker) ?? 0) + h.weight);
          const o = overlap(mine.weights, theirs);
          return { key: b.key, score: o.score, shared: o.shared.slice(0, 6) };
        })
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 8)
    : [];
  return {
    progress: { done: refreshing ? progress.done : GURUS.length, total: GURUS.length, running: !!refreshing, tickers: !!figiRunning },
    quarter,
    gurus,
    buys: consensus(latest, 'buy', 20),
    sells: consensus(latest, 'sell', 20),
    common: commonHoldings(books.filter((b) => current.has(b.key))),
    similar,
    mine: { count: mine.weights.size, value: mine.value },
  };
}

export interface GuruDetail {
  guru: GuruSummary;
  holdings: (Holding & { change: Change | null; sector: string })[];
  sold: Change[];
  sectors: { sector: string; weight: number }[];
  /** quarter → the top holdings' weights, for the replay */
  history: { period: string; aum: number; top: { key: string; label: string; weight: number }[] }[];
  clone: { quarters: CloneQuarter[]; stats: ReturnType<typeof cloneStats> };
}

const QUARTERS = 8;
const TOP = 30;

export async function guruView(userId: string, key: string): Promise<GuruDetail> {
  const g = guruByKey(key);
  if (!g) throw new UserError('없는 거장입니다.');
  // Older reports are read on demand, once
  const reports = (await reportsOf(g, userId)).slice(0, QUARTERS);
  const books: { report: Report; positions: Position[] }[] = [];
  for (const r of reports) {
    try {
      books.push({ report: r, positions: await positionsOf(g, r, userId) });
    } catch (e) {
      console.error('[gurus]', g.key, r.accession, e instanceof Error ? e.message : e);
    }
  }
  if (!books.length) throw new UserError('이 거장의 13F 보고서를 아직 받지 못했습니다. 잠시 뒤 다시 열어 보세요.');
  const map = await tickers();
  // Tickers for the top of every quarter, so the copy portfolio can be priced (waits for at most ~30 lookups)
  const needed = [...new Set(books.flatMap((b) => holdingsOf(b.positions, map).slice(0, TOP).map((h) => h.cusip)))].filter((c) => !map.has(c));
  if (needed.length) await Promise.race([resolveCusips(needed, userId), sleep(90_000)]);
  const per = books.map((b) => ({ report: b.report, holdings: holdingsOf(b.positions, map) }));
  const [cur, prev] = per;
  const ch = prev ? changesOf(prev.holdings, cur.holdings) : [];
  const byCusip = new Map(ch.map((c) => [c.cusip, c]));
  const members = await sp500Members(userId).catch(() => []);
  const sectorOf = new Map(members.map((m) => [m.symbol.toUpperCase(), SECTOR_KO[m.sector] ?? m.sector]));
  const holdings = cur.holdings.map((h) => ({ ...h, change: byCusip.get(h.cusip) ?? null, sector: (h.ticker && sectorOf.get(h.ticker)) || '기타 · S&P 500 밖' }));
  const sectors = new Map<string, number>();
  for (const h of holdings) sectors.set(h.sector, (sectors.get(h.sector) ?? 0) + h.weight);

  // Copy portfolio: each report's top holdings, priced from Yahoo
  const tops = per.map((p) => ({ date: p.report.period, weights: new Map(p.holdings.slice(0, TOP).filter((h) => h.ticker).map((h) => [h.ticker!, h.weight])) }));
  const symbols = [...new Set(tops.flatMap((t) => [...t.weights.keys()]))];
  const closes = await dailyCloses(userId, [...symbols.map(yahooTicker), 'SPY'], '5y');
  const prices = new Map(symbols.map((s) => [s, closes.get(yahooTicker(s)) ?? []]));
  const quarters = cloneReturns(tops, prices, closes.get('SPY') ?? [], kstDate());

  // Replay: the union of each quarter's top 12, weights per quarter (oldest first)
  const label = (h: Holding) => h.ticker ?? h.name.split(' ').slice(0, 2).join(' ');
  const history = [...per].reverse().map((p) => ({
    period: p.report.period,
    aum: p.holdings.reduce((a, h) => a + h.value, 0),
    top: p.holdings.slice(0, 12).map((h) => ({ key: h.cusip, label: label(h), weight: h.weight })),
  }));
  const sages = g.sage ? await sageIds(userId) : new Map<string, string>();
  return {
    guru: {
      key: g.key,
      person: g.person,
      firm: g.firm,
      style: g.style,
      sageId: g.sage ? (sages.get(g.sage) ?? null) : null,
      period: cur.report.period,
      filed: cur.report.filed,
      aum: cur.holdings.reduce((a, h) => a + h.value, 0),
      count: cur.holdings.length,
      top: cur.holdings.slice(0, 5).map((h) => ({ name: h.name, ticker: h.ticker, weight: h.weight })),
      turnover: ch.length ? ch.reduce((a, c) => a + Math.abs(c.weight - c.prevWeight), 0) / 2 : null,
      buys: ch.filter((c) => c.kind === 'new' || c.kind === 'add').length,
      sells: ch.filter((c) => c.kind === 'sold' || c.kind === 'reduce').length,
    },
    holdings,
    sold: ch.filter((c) => c.kind === 'sold').sort((a, b) => b.prevWeight - a.prevWeight),
    sectors: [...sectors].map(([sector, weight]) => ({ sector, weight })).sort((a, b) => b.weight - a.weight),
    history,
    clone: { quarters, stats: cloneStats(quarters) },
  };
}
