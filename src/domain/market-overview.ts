/**
 * 시장 개요: period returns of sector and style ETFs, the S&P 500 drawn as a map of its members,
 * government bond yields of five countries and the period returns of held and watched stocks.
 * Pure parsing and arithmetic; the service fetches.
 */

export interface Close {
  date: string;
  close: number;
}

export const PERIODS = ['1D', '1W', '1M', '3M', '6M', 'YTD', '1Y', '3Y'] as const;
export type Period = (typeof PERIODS)[number];
export const PERIOD_LABEL: Record<Period, string> = { '1D': '1일', '1W': '1주', '1M': '1개월', '3M': '3개월', '6M': '6개월', YTD: '연초 이후', '1Y': '1년', '3Y': '3년' };

const iso = (d: Date) => d.toISOString().slice(0, 10);
function minusMonths(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return iso(d);
}

/** The day a period's return is measured from: the base is the last close on or before it. 1D is the close before the latest. */
export function periodStart(latest: string, p: Exclude<Period, '1D'>): string {
  if (p === '1W') return iso(new Date(Date.parse(`${latest}T00:00:00Z`) - 7 * 86_400_000));
  if (p === 'YTD') return `${Number(latest.slice(0, 4)) - 1}-12-31`;
  return minusMonths(latest, { '1M': 1, '3M': 3, '6M': 6, '1Y': 12, '3Y': 36 }[p]);
}

/** Last close on or before `date` (closes sorted by date) */
function closeAt(closes: Close[], date: string): Close | null {
  let lo = 0, hi = closes.length - 1, hit = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (closes[mid].date <= date) {
      hit = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return hit < 0 ? null : closes[hit];
}

/**
 * A period's return as a fraction, measured up to the close on `asOf` (default the latest).
 * null when the series does not reach back far enough (a base more than ten days before the
 * period's start would overstate it).
 */
export function periodReturn(closes: Close[], p: Period, asOf?: string): number | null {
  const end = asOf ? closeAt(closes, asOf) : closes.at(-1);
  if (!end) return null;
  let base: Close | null;
  if (p === '1D') {
    const i = closes.indexOf(end);
    base = i > 0 ? closes[i - 1] : null;
  } else {
    const start = periodStart(end.date, p);
    base = closeAt(closes, start);
    if (base && Date.parse(start) - Date.parse(base.date) > 10 * 86_400_000) base = null;
  }
  return base && base.close > 0 ? end.close / base.close - 1 : null;
}

export function returnsOf(closes: Close[], asOf?: string): Record<Period, number | null> {
  return Object.fromEntries(PERIODS.map((p) => [p, periodReturn(closes, p, asOf)])) as Record<Period, number | null>;
}

/** Yahoo Finance spark (up to 20 symbols a call): symbol → daily closes, dated by the session's UTC day. */
export function parseSpark(body: unknown): Map<string, Close[]> {
  const out = new Map<string, Close[]>();
  if (!body || typeof body !== 'object') return out;
  for (const [sym, v] of Object.entries(body as Record<string, { timestamp?: number[]; close?: (number | null)[] }>)) {
    if (!v || !Array.isArray(v.timestamp) || !Array.isArray(v.close)) continue;
    const byDay = new Map<string, number>();
    v.timestamp.forEach((t, i) => {
      const c = v.close![i];
      if (typeof c === 'number' && c > 0) byDay.set(iso(new Date(t * 1000)), Number(c.toPrecision(8)));
    });
    out.set(sym, [...byDay].map(([date, close]) => ({ date, close })).sort((a, b) => a.date.localeCompare(b.date)));
  }
  return out;
}

/** The Yahoo symbol for a held or watched stock: KRX codes on .KS or .KQ, Upbit coins in won. */
export function yahooSymbols(symbol: string, market: string | null): string[] {
  const s = symbol.toUpperCase();
  if (/^KRW-[A-Z0-9]+$/.test(s)) return [`${s.slice(4)}-KRW`];
  if (/^[0-9][0-9A-Z]{5}$/.test(s)) return /KOSDAQ|코스닥|KQ/i.test(market ?? '') ? [`${s}.KQ`] : /KOSPI|코스피|KS/i.test(market ?? '') ? [`${s}.KS`] : [`${s}.KS`, `${s}.KQ`];
  return [s.replace(/\./g, '-').replace(/\//g, '-')];
}

// ------------------------------------------------------------------ sectors and styles

export interface EtfDef {
  symbol: string;
  label: string;
}

/** The eleven S&P 500 sector SPDRs */
export const SECTOR_ETFS: EtfDef[] = [
  { symbol: 'XLK', label: '정보기술' },
  { symbol: 'XLC', label: '커뮤니케이션' },
  { symbol: 'XLY', label: '경기소비재' },
  { symbol: 'XLF', label: '금융' },
  { symbol: 'XLV', label: '헬스케어' },
  { symbol: 'XLI', label: '산업재' },
  { symbol: 'XLP', label: '필수소비재' },
  { symbol: 'XLE', label: '에너지' },
  { symbol: 'XLB', label: '소재' },
  { symbol: 'XLRE', label: '부동산' },
  { symbol: 'XLU', label: '유틸리티' },
];
export const BENCHMARK_ETF: EtfDef = { symbol: 'SPY', label: 'S&P 500' };

/** Russell style box: rows large / mid / small, columns value / blend / growth */
export const STYLE_BOX: { size: string; cells: [EtfDef, EtfDef, EtfDef] }[] = [
  { size: '대형', cells: [{ symbol: 'IWD', label: '대형 가치' }, { symbol: 'IWB', label: '대형 혼합' }, { symbol: 'IWF', label: '대형 성장' }] },
  { size: '중형', cells: [{ symbol: 'IWS', label: '중형 가치' }, { symbol: 'IWR', label: '중형 혼합' }, { symbol: 'IWP', label: '중형 성장' }] },
  { size: '소형', cells: [{ symbol: 'IWN', label: '소형 가치' }, { symbol: 'IWM', label: '소형 혼합' }, { symbol: 'IWO', label: '소형 성장' }] },
];
export const STYLE_COLS = ['가치', '혼합', '성장'];

/** Indices, rates, currencies and commodities for the period-return table */
export const MARKET_ASSETS: (EtfDef & { group: string })[] = [
  { group: '주가지수', symbol: '^GSPC', label: 'S&P 500' },
  { group: '주가지수', symbol: '^IXIC', label: '나스닥' },
  { group: '주가지수', symbol: '^DJI', label: '다우존스' },
  { group: '주가지수', symbol: '^RUT', label: '러셀 2000' },
  { group: '주가지수', symbol: '^KS11', label: '코스피' },
  { group: '주가지수', symbol: '^KQ11', label: '코스닥' },
  { group: '주가지수', symbol: '^N225', label: '닛케이 225' },
  { group: '주가지수', symbol: '^STOXX50E', label: '유로스톡스 50' },
  { group: '주가지수', symbol: '000001.SS', label: '상하이 종합' },
  { group: '주가지수', symbol: '^HSI', label: '항셍' },
  { group: '환율', symbol: 'DX-Y.NYB', label: '달러 인덱스' },
  { group: '환율', symbol: 'KRW=X', label: '원/달러' },
  { group: '환율', symbol: 'JPY=X', label: '엔/달러' },
  { group: '원자재', symbol: 'GC=F', label: '금' },
  { group: '원자재', symbol: 'CL=F', label: 'WTI 원유' },
  { group: '원자재', symbol: 'HG=F', label: '구리' },
  { group: '가상자산', symbol: 'BTC-USD', label: '비트코인' },
];

/**
 * Month-end frames of a period's return for each symbol, for replaying how the board changed:
 * the last trading day of each month in the last `months` months, then the latest day.
 */
export function returnFrames(series: Map<string, Close[]>, symbols: string[], p: Period, months: number): { dates: string[]; values: Record<string, (number | null)[]> } {
  const days = [...new Set(symbols.flatMap((s) => (series.get(s) ?? []).map((c) => c.date)))].sort();
  if (!days.length) return { dates: [], values: {} };
  const latest = days.at(-1)!;
  const ends: string[] = [];
  for (let i = 0; i < days.length; i++) if (i === days.length - 1 || days[i + 1].slice(0, 7) !== days[i].slice(0, 7)) ends.push(days[i]);
  const from = minusMonths(latest, months);
  const dates = ends.filter((d) => d > from);
  if (dates.at(-1) !== latest) dates.push(latest);
  const values: Record<string, (number | null)[]> = {};
  for (const s of symbols) {
    const c = series.get(s) ?? [];
    values[s] = dates.map((d) => (c.length && c[0].date <= d ? periodReturn(c, p, d) : null));
  }
  return { dates, values };
}

// ------------------------------------------------------------------ S&P 500 map

export interface Holding {
  ticker: string;
  name: string;
  /** percent of the fund */
  weight: number;
}

/** SPDR holdings sheet (rows of cells): the header row has Name, Ticker and Weight; cash and odd lines are dropped. */
export function parseSpdrHoldings(rows: unknown[][]): Holding[] {
  const text = (v: unknown) => (v === null || v === undefined ? '' : typeof v === 'object' && 'text' in (v as object) ? String((v as { text: unknown }).text) : String(v)).trim();
  const head = rows.findIndex((r) => r.some((c) => text(c) === 'Ticker') && r.some((c) => text(c) === 'Weight'));
  if (head < 0) return [];
  const cols = rows[head].map(text);
  const [ti, ni, wi] = [cols.indexOf('Ticker'), cols.indexOf('Name'), cols.indexOf('Weight')];
  const out: Holding[] = [];
  for (const r of rows.slice(head + 1)) {
    const ticker = text(r[ti]).toUpperCase();
    const weight = Number(text(r[wi]));
    if (!/^[A-Z][A-Z.]{0,6}$/.test(ticker) || !Number.isFinite(weight) || weight <= 0) continue;
    out.push({ ticker, name: text(r[ni]), weight });
  }
  return out;
}

export interface Member {
  symbol: string;
  name: string;
  sector: string;
  industry: string;
  cik: string | null;
}

const decode = (s: string) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').trim();

/** Wikipedia "List of S&P 500 companies": the constituents table's symbol, name, GICS sector and sub-industry. */
export function parseSp500Members(html: string): Member[] {
  const start = html.indexOf('id="constituents"');
  if (start < 0) return [];
  const end = html.indexOf('</table>', start);
  const table = html.slice(start, end < 0 ? undefined : end);
  const out: Member[] = [];
  for (const row of table.split(/<tr[\s>]/).slice(1)) {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => decode(m[1]));
    if (cells.length < 4 || !/^[A-Z][A-Z.]{0,6}$/.test(cells[0])) continue;
    const cik = cells.find((c) => /^\d{10}$/.test(c)) ?? null;
    out.push({ symbol: cells[0], name: cells[1], sector: cells[2], industry: cells[3], cik });
  }
  return out;
}

export const SECTOR_KO: Record<string, string> = {
  'Information Technology': '정보기술',
  'Communication Services': '커뮤니케이션',
  'Consumer Discretionary': '경기소비재',
  Financials: '금융',
  'Health Care': '헬스케어',
  Industrials: '산업재',
  'Consumer Staples': '필수소비재',
  Energy: '에너지',
  Materials: '소재',
  'Real Estate': '부동산',
  Utilities: '유틸리티',
};

/** SPDR tickers write share classes with a dot (BRK.B), Wikipedia the same; Yahoo uses a dash. */
export const yahooTicker = (t: string) => t.replace(/\./g, '-');

export interface MapStock {
  symbol: string;
  name: string;
  weight: number;
  returns: Partial<Record<Period, number | null>>;
}
export interface MapIndustry {
  name: string;
  weight: number;
  stocks: MapStock[];
}
export interface MapSector {
  name: string;
  label: string;
  weight: number;
  returns: Partial<Record<Period, number | null>>;
  industries: MapIndustry[];
}

/** Members grouped by sector and industry, sized by their weight in the fund; a sector's return is its weight-averaged return. */
export function groupMap(holdings: Holding[], members: Member[], returns: Map<string, Partial<Record<Period, number | null>>>, periods: readonly Period[]): MapSector[] {
  const bySym = new Map(members.map((m) => [m.symbol.toUpperCase(), m]));
  const sectors = new Map<string, Map<string, MapStock[]>>();
  for (const h of holdings) {
    const m = bySym.get(h.ticker);
    if (!m) continue;
    const ind = sectors.get(m.sector) ?? new Map<string, MapStock[]>();
    sectors.set(m.sector, ind);
    const list = ind.get(m.industry) ?? [];
    ind.set(m.industry, list);
    // Two share classes of one company (GOOGL, GOOG) stay two boxes
    list.push({ symbol: h.ticker, name: m.name, weight: h.weight, returns: returns.get(h.ticker) ?? {} });
  }
  const out: MapSector[] = [];
  for (const [name, inds] of sectors) {
    const industries = [...inds].map(([n, stocks]) => ({ name: n, stocks: stocks.sort((a, b) => b.weight - a.weight), weight: stocks.reduce((a, s) => a + s.weight, 0) })).sort((a, b) => b.weight - a.weight);
    const all = industries.flatMap((i) => i.stocks);
    const weight = all.reduce((a, s) => a + s.weight, 0);
    const ret: Partial<Record<Period, number | null>> = {};
    for (const p of periods) {
      const known = all.filter((s) => typeof s.returns[p] === 'number');
      const w = known.reduce((a, s) => a + s.weight, 0);
      ret[p] = w > weight / 2 ? known.reduce((a, s) => a + s.weight * (s.returns[p] as number), 0) / w : null;
    }
    out.push({ name, label: SECTOR_KO[name] ?? name, weight, returns: ret, industries });
  }
  return out.sort((a, b) => b.weight - a.weight);
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Squarified treemap (Bruls, Huizing, van Wijk): one rectangle per value, in the given order, filling `box`. */
export function squarify(values: number[], box: Rect): Rect[] {
  const total = values.reduce((a, v) => a + Math.max(0, v), 0);
  const out: Rect[] = new Array(values.length);
  if (!total || box.w <= 0 || box.h <= 0) {
    for (let i = 0; i < values.length; i++) out[i] = { x: box.x, y: box.y, w: 0, h: 0 };
    return out;
  }
  const scale = (box.w * box.h) / total;
  const areas = values.map((v) => Math.max(0, v) * scale);
  let { x, y, w, h } = box;
  let i = 0;
  const worst = (row: number[], side: number) => {
    const s = row.reduce((a, v) => a + v, 0);
    if (!s || !side) return Infinity;
    const max = Math.max(...row), min = Math.min(...row);
    return Math.max((side * side * max) / (s * s), (s * s) / (side * side * min || 1e-9));
  };
  while (i < areas.length) {
    const side = Math.min(w, h);
    const row = [areas[i]];
    let j = i + 1;
    while (j < areas.length && worst([...row, areas[j]], side) <= worst(row, side)) row.push(areas[j++]);
    const sum = row.reduce((a, v) => a + v, 0);
    if (w >= h) {
      // A column down the left
      const cw = h ? sum / h : 0;
      let yy = y;
      row.forEach((a, k) => {
        const rh = cw ? a / cw : 0;
        out[i + k] = { x, y: yy, w: cw, h: rh };
        yy += rh;
      });
      x += cw;
      w -= cw;
    } else {
      const rh = w ? sum / w : 0;
      let xx = x;
      row.forEach((a, k) => {
        const cw = rh ? a / rh : 0;
        out[i + k] = { x: xx, y, w: cw, h: rh };
        xx += cw;
      });
      y += rh;
      h -= rh;
    }
    i = j;
  }
  return out;
}

// ------------------------------------------------------------------ government bond yields

export const TENORS = ['1Y', '2Y', '3Y', '5Y', '10Y', '20Y', '30Y'] as const;
export type Tenor = (typeof TENORS)[number];
export const TENOR_YEARS: Record<Tenor, number> = { '1Y': 1, '2Y': 2, '3Y': 3, '5Y': 5, '10Y': 10, '20Y': 20, '30Y': 30 };

export interface YieldCountry {
  key: 'US' | 'KR' | 'JP' | 'DE' | 'UK';
  label: string;
  source: string;
  /** tenor → the source's code */
  codes: Partial<Record<Tenor, string>>;
}

export const YIELD_COUNTRIES: YieldCountry[] = [
  { key: 'US', label: '미국', source: 'FRED (미 재무부 고시 수익률)', codes: { '1Y': 'DGS1', '2Y': 'DGS2', '3Y': 'DGS3', '5Y': 'DGS5', '10Y': 'DGS10', '20Y': 'DGS20', '30Y': 'DGS30' } },
  { key: 'KR', label: '한국', source: '한국은행 ECOS 817Y002 (국고채 시장금리)', codes: { '1Y': '010190000', '2Y': '010195000', '3Y': '010200000', '5Y': '010200001', '10Y': '010210000', '20Y': '010220000', '30Y': '010230000' } },
  { key: 'JP', label: '일본', source: '일본 재무성 JGB 금리', codes: { '1Y': '1Y', '2Y': '2Y', '3Y': '3Y', '5Y': '5Y', '10Y': '10Y', '20Y': '20Y', '30Y': '30Y' } },
  { key: 'DE', label: '독일', source: '독일 분데스방크 (연방채 무이표 수익률, Svensson)', codes: { '1Y': 'R01XX', '2Y': 'R02XX', '3Y': 'R03XX', '5Y': 'R05XX', '10Y': 'R10XX', '20Y': 'R20XX', '30Y': 'R30XX' } },
  { key: 'UK', label: '영국', source: '영란은행 (국채 액면 수익률)', codes: { '5Y': 'IUDSNPY', '10Y': 'IUDMNPY', '20Y': 'IUDLNPY' } },
];

export const yieldId = (c: YieldCountry['key'], t: Tenor) => `YLD:${c}:${t}`;

const num = (s: string | undefined) => {
  const v = Number(String(s ?? '').trim());
  return s !== undefined && String(s).trim() !== '' && Number.isFinite(v) ? v : null;
};

/** 일본 재무성 jgbcme CSV: "Date,1Y,2Y,…" with dates "2026/10/1" and "-" for none. */
export function parseMofCsv(text: string): Map<string, Close[]> {
  const lines = text.split(/\r?\n/);
  const hi = lines.findIndex((l) => /^Date,/.test(l));
  const out = new Map<string, Close[]>();
  if (hi < 0) return out;
  const head = lines[hi].split(',').map((s) => s.trim());
  for (const l of lines.slice(hi + 1)) {
    const c = l.split(',');
    const m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(c[0]?.trim() ?? '');
    if (!m) continue;
    const date = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    head.forEach((h, i) => {
      const v = i ? num(c[i]) : null;
      if (v === null) return;
      const list = out.get(h) ?? [];
      out.set(h, list);
      list.push({ date, close: v });
    });
  }
  return out;
}

/** 분데스방크 time-series CSV (several series side by side, a flags column after each): code part → closes. */
export function parseBundesbankCsv(text: string): Map<string, Close[]> {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const head = (lines[0] ?? '').split(',').map((s) => s.replace(/"/g, ''));
  const cols = head.flatMap((h, i) => {
    const m = /\.(R\d\dXX)\./.exec(h);
    return m && !h.endsWith('_FLAGS') ? [{ i, code: m[1] }] : [];
  });
  const out = new Map<string, Close[]>(cols.map((c) => [c.code, []]));
  for (const l of lines) {
    const c = l.split(',');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(c[0] ?? '')) continue;
    for (const col of cols) {
      const v = num(c[col.i]);
      if (v !== null) out.get(col.code)!.push({ date: c[0], close: v });
    }
  }
  return out;
}

const MON: Record<string, string> = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };

/** 영란은행 IADB CSV: "DATE,IUDSNPY,…" with dates "04 Jan 2000". */
export function parseBoeCsv(text: string): Map<string, Close[]> {
  const lines = text.split(/\r?\n/);
  const head = (lines[0] ?? '').split(',').map((s) => s.trim());
  const out = new Map<string, Close[]>(head.slice(1).map((h) => [h, []]));
  for (const l of lines.slice(1)) {
    const c = l.split(',');
    const m = /^(\d{2}) ([A-Z][a-z]{2}) (\d{4})$/.exec(c[0]?.trim() ?? '');
    if (!m || !MON[m[2]]) continue;
    const date = `${m[3]}-${MON[m[2]]}-${m[1]}`;
    head.slice(1).forEach((h, i) => {
      const v = num(c[i + 1]);
      if (v !== null) out.get(h)!.push({ date, close: v });
    });
  }
  return out;
}

export interface YieldRow {
  country: YieldCountry['key'];
  label: string;
  date: string | null;
  /** tenor → level in percent */
  level: Partial<Record<Tenor, number | null>>;
  /** tenor → change in percentage points since 1W / 1M / 1Y */
  change: Record<'1W' | '1M' | '1Y', Partial<Record<Tenor, number | null>>>;
}

/** Latest level of each tenor and how far it moved; changes are against the close on or before the period's start. */
export function yieldRow(c: YieldCountry, series: Map<string, Close[]>): YieldRow {
  const level: YieldRow['level'] = {};
  const change: YieldRow['change'] = { '1W': {}, '1M': {}, '1Y': {} };
  let date: string | null = null;
  for (const t of TENORS) {
    if (!c.codes[t]) continue;
    const s = series.get(yieldId(c.key, t)) ?? [];
    const last = s.at(-1);
    level[t] = last?.close ?? null;
    if (last && (!date || last.date > date)) date = last.date;
    for (const p of ['1W', '1M', '1Y'] as const) {
      const base = last ? closeAt(s, periodStart(last.date, p)) : null;
      change[p][t] = last && base && Date.parse(periodStart(last.date, p)) - Date.parse(base.date) <= 10 * 86_400_000 ? Number((last.close - base.close).toFixed(3)) : null;
    }
  }
  return { country: c.key, label: c.label, date, level, change };
}

export interface CurveFrames {
  /** month-end dates, the last one the latest day */
  dates: string[];
  /** country → frame → tenor → level */
  curves: Partial<Record<YieldCountry['key'], Partial<Record<Tenor, number | null>>[]>>;
}

/** Each country's curve at every month end since `from`, and on the latest day. */
export function curveFrames(series: Map<string, Close[]>, from: string): CurveFrames {
  const days = new Set<string>();
  for (const [id, s] of series) if (id.startsWith('YLD:US:') || id.startsWith('YLD:KR:')) for (const p of s) if (p.date >= from) days.add(p.date);
  const sorted = [...days].sort();
  const dates: string[] = [];
  for (let i = 0; i < sorted.length; i++) if (i === sorted.length - 1 || sorted[i + 1].slice(0, 7) !== sorted[i].slice(0, 7)) dates.push(sorted[i]);
  const curves: CurveFrames['curves'] = {};
  for (const c of YIELD_COUNTRIES) {
    const frames = dates.map((d) => {
      const f: Partial<Record<Tenor, number | null>> = {};
      for (const t of TENORS) {
        if (!c.codes[t]) continue;
        const s = series.get(yieldId(c.key, t)) ?? [];
        const hit = closeAt(s, d);
        // A value older than a month (a series that stopped) is not today's curve
        f[t] = hit && Date.parse(d) - Date.parse(hit.date) <= 31 * 86_400_000 ? hit.close : null;
      }
      return f;
    });
    if (frames.some((f) => Object.values(f).some((v) => v !== null))) curves[c.key] = frames;
  }
  return { dates, curves };
}
