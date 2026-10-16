/**
 * 글로벌 매크로 data: OECD composite leading indicators (SDMX, no key), World Bank indicators
 * (no key), FRED (no key), CFTC Commitments of Traders (Socrata, no key), 한국은행 ECOS (the
 * user's key) and Yahoo Finance closes. Each source's answer is kept in AppSetting and used stale
 * when the source fails.
 */
import {
  cliFrames,
  cliPhase,
  COT_CONTRACTS,
  cotSummary,
  contributionRows,
  COUNTRIES,
  CYCLE_INDICATORS,
  cyclePhases,
  KR_GDP,
  monthly,
  parseCot,
  parseOecdCsv,
  parseWorldBank,
  rrg,
  US_GDP,
  WB_INDICATORS,
  weekly,
  type CliFrame,
  type CliPhase,
  type CotSummary,
  type Point,
  type RrgPoint,
} from '@/domain/macro';
import { BENCHMARK_ETF, returnsOf, SECTOR_ETFS, yieldId, type Period } from '@/domain/market-overview';
import { kstDate, prisma } from '../db';
import { serviceKey } from './api-keys';
import { noteCall, outcomeOf } from './api-usage';
import { dailyCloses } from './market-overview';

const UA = { 'user-agent': 'Mozilla/5.0 (PPFP)' };
const HOUR = 3_600_000;

async function get(userId: string, url: string, service: string, retry = true): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, { headers: UA, cache: 'no-store', signal: AbortSignal.timeout(45_000) });
  } catch (e) {
    noteCall(userId, service, 'error');
    throw e;
  }
  noteCall(userId, service, outcomeOf(res.status), res.headers);
  // OECD's API answers 500 now and then; once more after a pause usually works
  if (res.status >= 500 && retry) {
    await new Promise((r) => setTimeout(r, 3000));
    return get(userId, url, service, false);
  }
  if (!res.ok) throw new Error(`${service} HTTP ${res.status}`);
  return res;
}

const inflight = new Map<string, Promise<unknown>>();

/** A source's parsed answer kept in AppSetting for `ttl`, the stale copy used when it fails */
async function cached<T>(key: string, ttl: number, load: () => Promise<T>, errors: string[], label: string): Promise<T | null> {
  const row = await prisma.appSetting.findUnique({ where: { key } });
  const old = row ? (JSON.parse(row.value) as { at: string; value: T }) : null;
  if (old && Date.now() - Date.parse(old.at) < ttl) return old.value;
  let p = inflight.get(key) as Promise<T> | undefined;
  if (!p) {
    p = (async () => {
      const value = await load();
      const v = JSON.stringify({ at: new Date().toISOString(), value });
      await prisma.appSetting.upsert({ where: { key }, create: { key, value: v }, update: { value: v } });
      return value;
    })().finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  try {
    return await p;
  } catch (e) {
    const msg = e instanceof Error ? e.message.replace(/\s+/g, ' ') : '받지 못했습니다';
    console.error('[macro]', label, msg);
    errors.push(`${label}: ${msg.length > 160 ? `${msg.slice(0, 160)}…` : msg}`);
    return old?.value ?? null;
  }
}

type Packed = Record<string, [string, number][]>;
const pack = (m: Map<string, Point[]>): Packed => Object.fromEntries([...m].map(([k, v]) => [k, v.map((p) => [p.date, p.value] as [string, number])]));
const unpack = (p: Packed | null): Map<string, Point[]> => new Map(Object.entries(p ?? {}).map(([k, v]) => [k, v.map(([date, value]) => ({ date, value }))]));

/** FRED series one to a CSV, four at a time (several of mixed frequency come back zipped) */
async function fredMany(userId: string, codes: string[], from: string): Promise<Map<string, Point[]>> {
  const out = new Map<string, Point[]>();
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, codes.length) }, async () => {
      while (next < codes.length) {
        const code = codes[next++];
        for (const [k, v] of await fredCsv(userId, [code], from)) out.set(k, v);
      }
    }),
  );
  return out;
}

async function fredCsv(userId: string, codes: string[], from: string): Promise<Map<string, Point[]>> {
  const text = await (await get(userId, `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${codes.join(',')}&cosd=${from}`, 'fred')).text();
  if (text.startsWith('PK')) throw new Error('FRED가 CSV 대신 압축 파일을 보냈습니다');
  const lines = text.split(/\r?\n/);
  const head = (lines[0] ?? '').split(',');
  const out = new Map<string, Point[]>(head.slice(1).map((h) => [h, []]));
  for (const l of lines.slice(1)) {
    const c = l.split(',');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(c[0] ?? '')) continue;
    head.slice(1).forEach((h, i) => {
      const v = Number(c[i + 1]);
      if (c[0] >= from && c[i + 1] && c[i + 1] !== '.' && Number.isFinite(v)) out.get(h)!.push({ date: c[0], value: v });
    });
  }
  return out;
}

// ------------------------------------------------------------------ countries

export interface CountryRow {
  iso: string;
  label: string;
  cli: { date: string; level: number; change3: number; phase: CliPhase } | null;
  wb: Record<string, { year: string; value: number } | null>;
  index: { symbol: string; label: string; returns: Partial<Record<Period, number | null>> };
  y10: number | null;
}

export interface CountriesView {
  rows: CountryRow[];
  frames: CliFrame;
  errors: string[];
}

const Y10: Record<string, 'US' | 'KR' | 'JP' | 'DE' | 'UK'> = { USA: 'US', KOR: 'KR', JPN: 'JP', DEU: 'DE', GBR: 'UK' };

export async function countriesView(userId: string): Promise<CountriesView> {
  const errors: string[] = [];
  const isos = COUNTRIES.map((c) => c.iso);
  const [cliRaw, wbRaw, closes, y10rows] = await Promise.all([
    cached('macro:cli', 12 * HOUR, async () => pack(parseOecdCsv(await (await get(userId, 'https://sdmx.oecd.org/public/rest/data/OECD.SDD.STES,DSD_STES@DF_CLI/.M.LI...AA...H?startPeriod=2015-01&dimensionAtObservation=AllDimensions&format=csvfilewithlabels', 'oecd')).text())), errors, 'OECD 경기선행지수'),
    cached(
      'macro:wb',
      24 * HOUR,
      async () => {
        const out: Record<string, Record<string, { year: string; value: number }>> = {};
        const y = Number(kstDate().slice(0, 4));
        for (const ind of WB_INDICATORS) {
          const m = parseWorldBank(await (await get(userId, `https://api.worldbank.org/v2/country/${isos.join(';')}/indicator/${ind.code}?format=json&date=${y - 6}:${y}&per_page=1000`, 'worldbank')).json());
          out[ind.key] = Object.fromEntries(m);
        }
        return out;
      },
      errors,
      '세계은행',
    ),
    dailyCloses(userId, COUNTRIES.map((c) => c.index), '2y'),
    prisma.priceDaily.findMany({ where: { symbol: { in: Object.values(Y10).map((c) => yieldId(c, '10Y')) } }, orderBy: { date: 'desc' }, distinct: ['symbol'], select: { symbol: true, close: true } }),
  ]);
  const cli = unpack(cliRaw);
  const y10 = new Map(y10rows.map((r) => [r.symbol, Number(r.close)]));
  const rows: CountryRow[] = COUNTRIES.map((c) => {
    const s = cli.get(c.iso) ?? [];
    const last = s.at(-1);
    const back = s.at(-4);
    const r = returnsOf((closes.get(c.index) ?? []).map((x) => x));
    return {
      iso: c.iso,
      label: c.label,
      cli: last && back ? { date: last.date, level: last.value, change3: Number((last.value - back.value).toFixed(3)), phase: cliPhase(last.value, last.value - back.value) } : null,
      wb: Object.fromEntries(WB_INDICATORS.map((i) => [i.key, wbRaw?.[i.key]?.[c.iso] ?? null])),
      index: { symbol: c.index, label: c.indexLabel, returns: { '1M': r['1M'], YTD: r.YTD, '1Y': r['1Y'] } },
      y10: Y10[c.iso] ? (y10.get(yieldId(Y10[c.iso], '10Y')) ?? null) : null,
    };
  });
  return { rows, frames: cliFrames(cli, isos.filter((i) => cli.has(i)), 60), errors };
}

// ------------------------------------------------------------------ US cycle

export interface CycleView {
  months: string[];
  rows: { code: string; label: string; group: string; invert: boolean; yoy: boolean; phases: (CliPhase | null)[]; last: { date: string; value: number } | null }[];
  /** share of indicators in 확장 or 회복 each month */
  breadth: (number | null)[];
  errors: string[];
}

export async function cycleView(userId: string): Promise<CycleView> {
  const errors: string[] = [];
  const raw = await cached('macro:cycle', 12 * HOUR, async () => pack(await fredMany(userId, CYCLE_INDICATORS.map((i) => i.code), '2004-01-01')), errors, 'FRED');
  const data = unpack(raw);
  const all = new Set<string>();
  const phased = CYCLE_INDICATORS.map((ind) => {
    const pts = monthly(data.get(ind.code) ?? []);
    const ph = cyclePhases(pts, ind);
    for (const d of ph.keys()) all.add(d);
    return { ind, pts, ph };
  });
  const counts = new Map<string, number>();
  for (const { ph } of phased) for (const d of ph.keys()) counts.set(d, (counts.get(d) ?? 0) + 1);
  const months = [...all].filter((d) => (counts.get(d) ?? 0) >= phased.length / 2).sort().slice(-120);
  const rows = phased.map(({ ind, pts, ph }) => ({ code: ind.code, label: ind.label, group: ind.group, invert: !!ind.invert, yoy: !!ind.yoy, phases: months.map((m) => ph.get(m) ?? null), last: pts.at(-1) ?? null }));
  const breadth = months.map((_, k) => {
    const known = rows.map((r) => r.phases[k]).filter((p): p is CliPhase => !!p);
    return known.length >= 5 ? known.filter((p) => p === '확장' || p === '회복').length / known.length : null;
  });
  return { months, rows, breadth, errors };
}

// ------------------------------------------------------------------ sector rotation

export interface RotationView {
  weeks: string[];
  sectors: { symbol: string; label: string; points: (RrgPoint | null)[] }[];
}

export async function rotationView(userId: string): Promise<RotationView> {
  const closes = await dailyCloses(userId, [...SECTOR_ETFS.map((s) => s.symbol), BENCHMARK_ETF.symbol], '5y');
  const bench = weekly(closes.get(BENCHMARK_ETF.symbol) ?? []);
  const series = SECTOR_ETFS.map((s) => ({ s, pts: rrg(weekly(closes.get(s.symbol) ?? []), bench) }));
  const weeks = [...new Set(series.flatMap((x) => x.pts.map((p) => p.date)))].sort().slice(-104);
  return {
    weeks,
    sectors: series.map(({ s, pts }) => {
      const m = new Map(pts.map((p) => [p.date, p]));
      return { symbol: s.symbol, label: s.label, points: weeks.map((w) => m.get(w) ?? null) };
    }),
  };
}

// ------------------------------------------------------------------ CFTC

export interface CotView {
  contracts: { code: string; label: string; group: string; summary: CotSummary | null; history: { date: string; net: number; netPct: number }[] }[];
  errors: string[];
}

export async function cotView(userId: string): Promise<CotView> {
  const errors: string[] = [];
  const from = `${Number(kstDate().slice(0, 4)) - 6}-01-01`;
  const where = `cftc_contract_market_code in(${COT_CONTRACTS.map((c) => `'${c.code}'`).join(',')}) AND report_date_as_yyyy_mm_dd >= '${from}'`;
  const raw = await cached(
    'macro:cot',
    12 * HOUR,
    async () => {
      const q = new URLSearchParams({ $select: 'cftc_contract_market_code,report_date_as_yyyy_mm_dd,open_interest_all,noncomm_positions_long_all,noncomm_positions_short_all', $where: where, $limit: '50000' });
      const rows = (await (await get(userId, `https://publicreporting.cftc.gov/resource/6dca-aqww.json?${q}`, 'cftc')).json()) as Record<string, string>[];
      const m = parseCot(rows);
      return Object.fromEntries([...m].map(([k, v]) => [k, v.map((r) => [r.date, r.oi, r.long, r.short] as [string, number, number, number])]));
    },
    errors,
    'CFTC',
  );
  return {
    contracts: COT_CONTRACTS.map((c) => {
      const rows = (raw?.[c.code] ?? []).map(([date, oi, long, short]) => ({ date, oi, long, short }));
      return { ...c, summary: cotSummary(rows), history: rows.slice(-260).map((r) => ({ date: r.date, net: r.long - r.short, netPct: r.oi ? (r.long - r.short) / r.oi : 0 })) };
    }),
    errors,
  };
}

// ------------------------------------------------------------------ GDP contributions

export interface GdpView {
  us: { parts: { key: string; label: string }[]; rows: Record<string, number | string | null>[] };
  kr: { parts: { key: string; label: string }[]; rows: Record<string, number | string | null>[] } | null;
  missing: 'ECOS'[];
  errors: string[];
}

export async function gdpView(userId: string): Promise<GdpView> {
  const errors: string[] = [];
  const ecos = await serviceKey(userId, 'ecos', 'ECOS_API_KEY');
  const [usRaw, krRaw] = await Promise.all([
    cached('macro:gdp-us', 12 * HOUR, async () => pack(await fredMany(userId, [US_GDP.total, ...US_GDP.parts.map((p) => p.code)], '2010-01-01')), errors, 'FRED GDP'),
    ecos
      ? cached(
          'macro:gdp-kr',
          12 * HOUR,
          async () => {
            const y = Number(kstDate().slice(0, 4));
            const out = new Map<string, Point[]>();
            for (const p of KR_GDP) {
              const b = (await (await get(userId, `https://ecos.bok.or.kr/api/StatisticSearch/${encodeURIComponent(ecos.key)}/json/kr/1/1000/200Y125/Q/2010Q1/${y}Q4/${p.code}`, 'ecos')).json()) as {
                StatisticSearch?: { row?: { TIME?: string; DATA_VALUE?: string }[] };
                RESULT?: { MESSAGE?: string };
              };
              if (!b.StatisticSearch) throw new Error(`ECOS: ${b.RESULT?.MESSAGE ?? '응답을 읽지 못했습니다'}`);
              out.set(
                p.key,
                (b.StatisticSearch.row ?? []).flatMap((r) => {
                  const m = /^(\d{4})Q([1-4])$/.exec(r.TIME ?? '');
                  const v = Number(r.DATA_VALUE);
                  return m && r.DATA_VALUE !== '' && Number.isFinite(v) ? [{ date: `${m[1]}-${String((Number(m[2]) - 1) * 3 + 1).padStart(2, '0')}-01`, value: v }] : [];
                }),
              );
            }
            return pack(out);
          },
          errors,
          'ECOS 성장기여도',
        )
      : Promise.resolve(null),
  ]);
  const us = unpack(usRaw);
  const kr = unpack(krRaw);
  return {
    us: { parts: US_GDP.parts.map((p) => ({ key: p.key, label: p.label })), rows: contributionRows(US_GDP.parts.map((p) => ({ key: p.key, points: us.get(p.code) ?? [] })), us.get(US_GDP.total) ?? null, 24) },
    kr: krRaw ? { parts: KR_GDP.map((p) => ({ key: p.key, label: p.label })), rows: contributionRows(KR_GDP.map((p) => ({ key: p.key, points: kr.get(p.key) ?? [] })), null, 24) } : null,
    missing: ecos ? [] : ['ECOS'],
    errors,
  };
}
