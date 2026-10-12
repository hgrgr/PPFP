/** Comparing a portfolio's time-weighted return with benchmarks, and who contributed what. */

export interface Close {
  date: string;
  close: number;
}

/** The value at or before `date` in a date-sorted list (null before the first). */
export function asOf<T extends { date: string }>(list: T[], date: string): T | null {
  let lo = 0;
  let hi = list.length - 1;
  let ans: T | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].date <= date) {
      ans = list[mid];
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/**
 * A benchmark's cumulative return on each of `dates`, from the first date. `fx` converts
 * foreign closes to KRW (omit for local-currency returns). Null until the benchmark has data.
 */
export function benchmarkReturns(dates: string[], closes: Close[], fx?: Close[]): (number | null)[] {
  const krw = (d: string) => {
    const c = asOf(closes, d);
    if (!c) return null;
    if (!fx) return c.close;
    const r = asOf(fx, d) ?? fx[0];
    return r ? c.close * r.close : null;
  };
  const base = dates.length ? krw(dates[0]) : null;
  return dates.map((d) => {
    const v = krw(d);
    return base && v !== null ? v / base - 1 : null;
  });
}

export interface ContributionInput {
  key: string;
  label: string;
  group: string;
  startKrw: number;
  endKrw: number;
  /** Cash the position paid out in the period (sales, dividends) less what was put in (buys), KRW */
  cashKrw: number;
}

/**
 * Each position's P&L over the period (end − start + cash out − cash in) and its share of
 * the portfolio's starting value. The parts add up to the simple (not time-weighted) return.
 */
export function contributions(rows: ContributionInput[], startTotal: number) {
  const out = rows
    .map((r) => {
      const pnl = r.endKrw - r.startKrw + r.cashKrw;
      return { key: r.key, label: r.label, group: r.group, pnlKrw: Math.round(pnl), contributionPct: startTotal > 0 ? (pnl / startTotal) * 100 : null };
    })
    .filter((r) => Math.abs(r.pnlKrw) >= 1)
    .sort((a, b) => b.pnlKrw - a.pnlKrw);
  const groups = new Map<string, { label: string; pnlKrw: number }>();
  for (const r of out) {
    const g = groups.get(r.group) ?? { label: r.group, pnlKrw: 0 };
    g.pnlKrw += r.pnlKrw;
    groups.set(r.group, g);
  }
  const byGroup = [...groups.values()]
    .map((g) => ({ ...g, contributionPct: startTotal > 0 ? (g.pnlKrw / startTotal) * 100 : null }))
    .sort((a, b) => b.pnlKrw - a.pnlKrw);
  return { rows: out, byGroup, totalPnlKrw: out.reduce((s, r) => s + r.pnlKrw, 0) };
}

export type BenchmarkSource = 'BROKER' | 'YAHOO' | 'FRED' | 'ECOS';

/** A series to compare with: an index ETF, an index, or a monthly macro index (prices, money, housing). */
export interface BenchmarkDef {
  key: string;
  label: string;
  sub: string;
  group: '주가지수' | '원자재' | '물가' | '통화량' | '부동산';
  region: 'KR' | 'US';
  source: BenchmarkSource;
  /** BROKER: symbol · YAHOO: symbol · FRED: series id · ECOS: "STAT/CYCLE/ITEM" */
  code: string;
  /** USD prices turn into KRW returns with the day's rate when viewing in 원화; macro indexes never */
  currency: 'KRW' | 'USD' | 'IDX';
  monthly?: boolean;
}

export const BENCHMARK_CATALOG: BenchmarkDef[] = [
  { key: '069500', label: '코스피 200', sub: 'KODEX 200 (ETF)', group: '주가지수', region: 'KR', source: 'BROKER', code: '069500', currency: 'KRW' },
  { key: 'YH:^KS11', label: '코스피', sub: 'KOSPI 지수', group: '주가지수', region: 'KR', source: 'YAHOO', code: '^KS11', currency: 'KRW' },
  { key: 'YH:^KQ11', label: '코스닥', sub: 'KOSDAQ 지수', group: '주가지수', region: 'KR', source: 'YAHOO', code: '^KQ11', currency: 'KRW' },
  { key: 'VOO', label: 'S&P 500', sub: 'Vanguard S&P 500 ETF', group: '주가지수', region: 'US', source: 'BROKER', code: 'VOO', currency: 'USD' },
  { key: 'YH:^GSPC', label: 'S&P 500 지수', sub: 'S&P 500 (^GSPC)', group: '주가지수', region: 'US', source: 'YAHOO', code: '^GSPC', currency: 'USD' },
  { key: 'QQQ', label: '나스닥 100', sub: 'Invesco QQQ (ETF)', group: '주가지수', region: 'US', source: 'BROKER', code: 'QQQ', currency: 'USD' },
  { key: 'YH:^IXIC', label: '나스닥 종합', sub: 'NASDAQ Composite', group: '주가지수', region: 'US', source: 'YAHOO', code: '^IXIC', currency: 'USD' },
  { key: 'YH:GC=F', label: '금', sub: 'COMEX 금 선물 근월물', group: '원자재', region: 'US', source: 'YAHOO', code: 'GC=F', currency: 'USD' },
  { key: 'ECOS:901Y009/M/0', label: '한국 소비자물가', sub: '소비자물가지수 총지수 (통계청, 월)', group: '물가', region: 'KR', source: 'ECOS', code: '901Y009/M/0', currency: 'IDX', monthly: true },
  { key: 'FRED:CPIAUCSL', label: '미국 소비자물가', sub: 'CPI-U, 계절조정 (BLS, 월)', group: '물가', region: 'US', source: 'FRED', code: 'CPIAUCSL', currency: 'IDX', monthly: true },
  { key: 'ECOS:161Y005/M/BBHS00', label: '한국 M2 통화량', sub: 'M2 평잔, 계절조정 (한국은행, 월)', group: '통화량', region: 'KR', source: 'ECOS', code: '161Y005/M/BBHS00', currency: 'IDX', monthly: true },
  { key: 'FRED:M2SL', label: '미국 M2 통화량', sub: 'M2, 계절조정 (연준, 월)', group: '통화량', region: 'US', source: 'FRED', code: 'M2SL', currency: 'IDX', monthly: true },
  { key: 'ECOS:901Y062/M/P63AC', label: '아파트 매매가격 (전국)', sub: 'KB 주택매매가격지수 · 아파트 (월)', group: '부동산', region: 'KR', source: 'ECOS', code: '901Y062/M/P63AC', currency: 'IDX', monthly: true },
  { key: 'ECOS:901Y062/M/P63ACA', label: '아파트 매매가격 (서울)', sub: 'KB 주택매매가격지수 · 서울 아파트 (월)', group: '부동산', region: 'KR', source: 'ECOS', code: '901Y062/M/P63ACA', currency: 'IDX', monthly: true },
  { key: 'ECOS:901Y089/M/100', label: '아파트 실거래가 (전국)', sub: '한국부동산원 아파트 매매 실거래가격지수 (월)', group: '부동산', region: 'KR', source: 'ECOS', code: '901Y089/M/100', currency: 'IDX', monthly: true },
  { key: 'FRED:CSUSHPINSA', label: '미국 주택가격', sub: 'S&P 케이스-실러 전국 주택가격지수 (월)', group: '부동산', region: 'US', source: 'FRED', code: 'CSUSHPINSA', currency: 'IDX', monthly: true },
];

/** Shown until the user picks their own */
export const DEFAULT_BENCHMARKS = ['069500', 'VOO', 'QQQ'];

/** The user's picks in catalog order, unknown keys dropped; the defaults when none. */
export function pickedBenchmarks(keys: string[]): BenchmarkDef[] {
  const want = new Set(keys.length ? keys : DEFAULT_BENCHMARKS);
  return BENCHMARK_CATALOG.filter((b) => want.has(b.key));
}

/** Yahoo Finance chart (interval=1d) → daily closes, dated in the exchange's time zone. */
export function parseYahooHistory(body: unknown): Close[] {
  const r = (body as { chart?: { result?: unknown[] } } | null)?.chart?.result?.[0] as
    | { meta?: { gmtoffset?: number }; timestamp?: number[]; indicators?: { quote?: { close?: (number | null)[] }[] } }
    | undefined;
  const ts = r?.timestamp ?? [];
  const closes = r?.indicators?.quote?.[0]?.close ?? [];
  const offset = r?.meta?.gmtoffset ?? 0;
  const out = new Map<string, number>();
  ts.forEach((t, i) => {
    const c = closes[i];
    if (typeof c === 'number' && c > 0) out.set(new Date((t + offset) * 1000).toISOString().slice(0, 10), Number(c.toPrecision(10)));
  });
  return [...out].map(([date, close]) => ({ date, close })).sort((a, b) => a.date.localeCompare(b.date));
}

/** FRED fredgraph.csv: "observation_date,ID" then "2025-01-01,318.961" ("." when missing). */
export function parseFredCsv(text: string): Close[] {
  return text
    .split(/\r?\n/)
    .slice(1)
    .map((l) => l.split(','))
    .filter((p) => /^\d{4}-\d{2}-\d{2}$/.test(p[0] ?? '') && Number.isFinite(Number(p[1])) && p[1] !== '' && p[1] !== '.')
    .map((p) => ({ date: p[0], close: Number(p[1]) }));
}

/** 한국은행 ECOS StatisticSearch (monthly): TIME "202501" → the first of the month. */
export function parseEcos(body: unknown): { closes: Close[]; error: string | null } {
  const b = body as { StatisticSearch?: { row?: { TIME?: string; DATA_VALUE?: string }[] }; RESULT?: { CODE?: string; MESSAGE?: string } } | null;
  if (!b?.StatisticSearch) return { closes: [], error: b?.RESULT?.MESSAGE ?? null };
  const closes = (b.StatisticSearch.row ?? [])
    .filter((r) => /^\d{6}$/.test(r.TIME ?? '') && Number.isFinite(Number(r.DATA_VALUE)) && r.DATA_VALUE !== '')
    .map((r) => ({ date: `${r.TIME!.slice(0, 4)}-${r.TIME!.slice(4)}-01`, close: Number(r.DATA_VALUE) }))
    .sort((a, b) => a.date.localeCompare(b.date));
  return { closes, error: null };
}
