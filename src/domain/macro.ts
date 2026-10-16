/**
 * 글로벌 매크로: countries side by side (OECD leading indicators, World Bank figures, stock
 * indices), the US business cycle as a heatmap of indicator phases, sector rotation (relative
 * rotation graph), futures positioning (CFTC Commitments of Traders) and what drove GDP growth.
 * Pure parsing and arithmetic; the service fetches.
 */

export interface Point {
  date: string;
  value: number;
}

// ------------------------------------------------------------------ countries

export interface Country {
  /** ISO3, as OECD and the World Bank write it */
  iso: string;
  label: string;
  /** main stock index on Yahoo Finance */
  index: string;
  indexLabel: string;
}

export const COUNTRIES: Country[] = [
  { iso: 'USA', label: '미국', index: '^GSPC', indexLabel: 'S&P 500' },
  { iso: 'KOR', label: '한국', index: '^KS11', indexLabel: '코스피' },
  { iso: 'JPN', label: '일본', index: '^N225', indexLabel: '닛케이 225' },
  { iso: 'CHN', label: '중국', index: '000001.SS', indexLabel: '상하이 종합' },
  { iso: 'DEU', label: '독일', index: '^GDAXI', indexLabel: 'DAX' },
  { iso: 'GBR', label: '영국', index: '^FTSE', indexLabel: 'FTSE 100' },
  { iso: 'FRA', label: '프랑스', index: '^FCHI', indexLabel: 'CAC 40' },
  { iso: 'ITA', label: '이탈리아', index: 'FTSEMIB.MI', indexLabel: 'FTSE MIB' },
  { iso: 'ESP', label: '스페인', index: '^IBEX', indexLabel: 'IBEX 35' },
  { iso: 'CAN', label: '캐나다', index: '^GSPTSE', indexLabel: 'S&P/TSX' },
  { iso: 'AUS', label: '호주', index: '^AXJO', indexLabel: 'ASX 200' },
  { iso: 'IND', label: '인도', index: '^NSEI', indexLabel: 'Nifty 50' },
  { iso: 'BRA', label: '브라질', index: '^BVSP', indexLabel: '보베스파' },
  { iso: 'MEX', label: '멕시코', index: '^MXX', indexLabel: 'IPC' },
  { iso: 'IDN', label: '인도네시아', index: '^JKSE', indexLabel: '자카르타 종합' },
  { iso: 'TUR', label: '튀르키예', index: 'XU100.IS', indexLabel: 'BIST 100' },
  { iso: 'ZAF', label: '남아공', index: '^J203.JO', indexLabel: 'JSE 전체' },
];

/** World Bank indicators: code, label, unit; `good` says which way is better for the color */
export const WB_INDICATORS: { code: string; key: string; label: string; good: 'up' | 'down' | null }[] = [
  { code: 'NY.GDP.MKTP.KD.ZG', key: 'gdp', label: '경제성장률', good: 'up' },
  { code: 'FP.CPI.TOTL.ZG', key: 'cpi', label: '물가상승률', good: null },
  { code: 'SL.UEM.TOTL.ZS', key: 'unemp', label: '실업률', good: 'down' },
  { code: 'GC.DOD.TOTL.GD.ZS', key: 'debt', label: '정부부채/GDP', good: 'down' },
  { code: 'BN.CAB.XOKA.GD.ZS', key: 'ca', label: '경상수지/GDP', good: 'up' },
];

/** OECD SDMX CSV with labels → area → monthly points (TIME_PERIOD "2026-08") */
export function parseOecdCsv(text: string): Map<string, Point[]> {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const out = new Map<string, Point[]>();
  if (!lines.length) return out;
  const head = splitCsv(lines[0]);
  const ai = head.indexOf('REF_AREA'), ti = head.indexOf('TIME_PERIOD'), vi = head.indexOf('OBS_VALUE');
  if (ai < 0 || ti < 0 || vi < 0) return out;
  for (const l of lines.slice(1)) {
    const c = splitCsv(l);
    const v = Number(c[vi]);
    if (!/^\d{4}-\d{2}$/.test(c[ti] ?? '') || c[vi] === '' || !Number.isFinite(v)) continue;
    const list = out.get(c[ai]) ?? [];
    out.set(c[ai], list);
    list.push({ date: `${c[ti]}-01`, value: v });
  }
  for (const l of out.values()) l.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** World Bank v2 JSON ([meta, rows]) → country → the latest year with a value */
export function parseWorldBank(body: unknown): Map<string, { year: string; value: number }> {
  const rows = Array.isArray(body) ? (body[1] as { countryiso3code?: string; date?: string; value?: number | null }[] | null) : null;
  const out = new Map<string, { year: string; value: number }>();
  for (const r of rows ?? []) {
    if (!r.countryiso3code || typeof r.value !== 'number' || !r.date) continue;
    const cur = out.get(r.countryiso3code);
    if (!cur || r.date > cur.year) out.set(r.countryiso3code, { year: r.date, value: r.value });
  }
  return out;
}

export type CliPhase = '확장' | '둔화' | '수축' | '회복';
export const PHASE_ABOUT: Record<CliPhase, string> = { 확장: '100 위, 오르는 중', 둔화: '100 위, 내리는 중', 수축: '100 아래, 내리는 중', 회복: '100 아래, 오르는 중' };

/** OECD's reading of a CLI: above or below 100 (long-term trend) and rising or falling over 3 months */
export function cliPhase(level: number, change3: number): CliPhase {
  if (level >= 100) return change3 >= 0 ? '확장' : '둔화';
  return change3 < 0 ? '수축' : '회복';
}

export interface CliFrame {
  dates: string[];
  /** iso → frame → [level − 100, 3-month change] */
  values: Record<string, ([number, number] | null)[]>;
}

/** Month frames of each country's CLI position (level − 100, 3-month change), the last `months` */
export function cliFrames(cli: Map<string, Point[]>, isos: string[], months: number): CliFrame {
  const all = [...new Set(isos.flatMap((i) => (cli.get(i) ?? []).map((p) => p.date)))].sort().slice(-months);
  const values: CliFrame['values'] = {};
  for (const iso of isos) {
    const s = cli.get(iso) ?? [];
    const at = new Map(s.map((p, k) => [p.date, k]));
    values[iso] = all.map((d) => {
      const k = at.get(d);
      if (k === undefined || k < 3) return null;
      return [Number((s[k].value - 100).toFixed(3)), Number((s[k].value - s[k - 3].value).toFixed(3))];
    });
  }
  return { dates: all, values };
}

// ------------------------------------------------------------------ US cycle heatmap

export interface CycleIndicator {
  code: string;
  label: string;
  group: string;
  /** compare year-over-year change instead of the level */
  yoy?: boolean;
  /** lower is better (unemployment, spreads) */
  invert?: boolean;
}

/** FRED monthly series that move with the business cycle */
export const CYCLE_INDICATORS: CycleIndicator[] = [
  { code: 'CFNAI', label: '시카고 연은 활동지수', group: '종합' },
  { code: 'INDPRO', label: '산업생산', group: '생산', yoy: true },
  { code: 'TCU', label: '설비가동률', group: '생산' },
  { code: 'AWHMAN', label: '제조업 주당 근로시간', group: '생산' },
  { code: 'DGORDER', label: '내구재 주문', group: '생산', yoy: true },
  { code: 'PAYEMS', label: '비농업 고용', group: '고용', yoy: true },
  { code: 'UNRATE', label: '실업률', group: '고용', invert: true },
  { code: 'ICSA', label: '신규 실업수당 청구', group: '고용', invert: true },
  { code: 'RSAFS', label: '소매판매', group: '소비', yoy: true },
  { code: 'UMCSENT', label: '미시간대 소비자심리', group: '소비' },
  { code: 'PCEC96', label: '실질 개인소비', group: '소비', yoy: true },
  { code: 'HOUST', label: '주택 착공', group: '주택' },
  { code: 'PERMIT', label: '건축 허가', group: '주택' },
  { code: 'T10Y3M', label: '장단기 금리차 (10년−3개월)', group: '금융' },
  { code: 'BAMLH0A0HYM2', label: '하이일드 스프레드', group: '금융', invert: true },
  { code: 'NFCI', label: '금융여건지수', group: '금융', invert: true },
  { code: 'M2SL', label: 'M2 통화량', group: '금융', yoy: true },
  { code: 'CPIAUCSL', label: '소비자물가', group: '물가', yoy: true, invert: true },
];

/**
 * Each month's phase of a series: above or below its 12-month average and rising or falling
 * against three months before (on the year-over-year change for `yoy` series, flipped for
 * `invert` ones so that 확장 always means good for the economy).
 */
export function cyclePhases(points: Point[], ind: Pick<CycleIndicator, 'yoy' | 'invert'>): Map<string, CliPhase> {
  let s = points;
  if (ind.yoy) {
    const at = new Map(points.map((p) => [p.date, p.value]));
    s = points.flatMap((p) => {
      const prev = at.get(`${Number(p.date.slice(0, 4)) - 1}${p.date.slice(4)}`);
      return prev ? [{ date: p.date, value: (p.value / prev - 1) * 100 }] : [];
    });
  }
  const sign = ind.invert ? -1 : 1;
  const out = new Map<string, CliPhase>();
  for (let k = 12; k < s.length; k++) {
    const avg = s.slice(k - 12, k).reduce((a, p) => a + p.value, 0) / 12;
    const above = sign * (s[k].value - avg) >= 0;
    const rising = sign * (s[k].value - s[k - 3].value) >= 0;
    out.set(s[k].date, above ? (rising ? '확장' : '둔화') : rising ? '회복' : '수축');
  }
  return out;
}

/** Weekly or daily FRED points → the last value of each month, dated on its first day */
export function monthly(points: Point[]): Point[] {
  const m = new Map<string, number>();
  for (const p of points) m.set(`${p.date.slice(0, 7)}-01`, p.value);
  return [...m].map(([date, value]) => ({ date, value })).sort((a, b) => a.date.localeCompare(b.date));
}

// ------------------------------------------------------------------ sector rotation

/** Weekly closes (Friday or the week's last day) from daily ones */
export function weekly(closes: { date: string; close: number }[]): { date: string; close: number }[] {
  const out: { date: string; close: number }[] = [];
  let week = '';
  for (const c of closes) {
    const d = new Date(`${c.date}T00:00:00Z`);
    const monday = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86_400_000).toISOString().slice(0, 10);
    if (monday === week) out[out.length - 1] = c;
    else {
      out.push(c);
      week = monday;
    }
  }
  return out;
}

export interface RrgPoint {
  date: string;
  ratio: number;
  momentum: number;
}

/**
 * A relative rotation graph in the spirit of JdK RS-Ratio: relative strength against the
 * benchmark, as a ratio to its own 26-week average (100 = in line), and that ratio's change over
 * four weeks (100 = steady). An approximation; the published indicator's formula is not public.
 */
export function rrg(asset: { date: string; close: number }[], bench: { date: string; close: number }[], window = 26, lag = 4): RrgPoint[] {
  const b = new Map(bench.map((c) => [c.date, c.close]));
  const rs = asset.flatMap((c) => (b.get(c.date) ? [{ date: c.date, v: c.close / b.get(c.date)! }] : []));
  const ratio: { date: string; r: number }[] = [];
  for (let k = window - 1; k < rs.length; k++) {
    const avg = rs.slice(k - window + 1, k + 1).reduce((a, x) => a + x.v, 0) / window;
    ratio.push({ date: rs[k].date, r: (100 * rs[k].v) / avg });
  }
  const out: RrgPoint[] = [];
  for (let k = lag; k < ratio.length; k++) out.push({ date: ratio[k].date, ratio: Number(ratio[k].r.toFixed(3)), momentum: Number((100 + ratio[k].r - ratio[k - lag].r).toFixed(3)) });
  return out;
}

export type Quadrant = '주도' | '약화' | '소외' | '개선';
export const quadrantOf = (p: { ratio: number; momentum: number }): Quadrant => (p.ratio >= 100 ? (p.momentum >= 100 ? '주도' : '약화') : p.momentum >= 100 ? '개선' : '소외');

// ------------------------------------------------------------------ CFTC positioning

export interface CotContract {
  code: string;
  label: string;
  group: string;
}

/** Legacy futures-only report, non-commercial (large speculators) positions */
export const COT_CONTRACTS: CotContract[] = [
  { code: '13874A', label: 'S&P 500 (E-mini)', group: '주가지수' },
  { code: '209742', label: '나스닥 100 (E-mini)', group: '주가지수' },
  { code: '1170E1', label: 'VIX', group: '주가지수' },
  { code: '042601', label: '미 국채 2년', group: '금리' },
  { code: '043602', label: '미 국채 10년', group: '금리' },
  { code: '098662', label: '달러 인덱스', group: '통화' },
  { code: '099741', label: '유로', group: '통화' },
  { code: '097741', label: '엔', group: '통화' },
  { code: '088691', label: '금', group: '원자재' },
  { code: '084691', label: '은', group: '원자재' },
  { code: '085692', label: '구리', group: '원자재' },
  { code: '067651', label: 'WTI 원유', group: '원자재' },
  { code: '133741', label: '비트코인 (CME)', group: '가상자산' },
];

export interface CotRow {
  date: string;
  oi: number;
  long: number;
  short: number;
}

/** CFTC Socrata rows → contract code → weekly rows, oldest first */
export function parseCot(rows: Record<string, string>[]): Map<string, CotRow[]> {
  const out = new Map<string, CotRow[]>();
  for (const r of rows) {
    const code = String(r.cftc_contract_market_code ?? '').trim();
    const date = String(r.report_date_as_yyyy_mm_dd ?? '').slice(0, 10);
    const oi = Number(r.open_interest_all), long = Number(r.noncomm_positions_long_all), short = Number(r.noncomm_positions_short_all);
    if (!code || !/^\d{4}-\d{2}-\d{2}$/.test(date) || ![oi, long, short].every(Number.isFinite)) continue;
    const list = out.get(code) ?? [];
    out.set(code, list);
    list.push({ date, oi, long, short });
  }
  for (const l of out.values()) l.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

export interface CotSummary {
  date: string;
  net: number;
  /** net as a share of open interest */
  netPct: number;
  /** where the net position sits in its last three years, 0 = the most short, 1 = the most long */
  index3y: number | null;
  change1w: number | null;
}

export function cotSummary(rows: CotRow[]): CotSummary | null {
  const last = rows.at(-1);
  if (!last) return null;
  const nets = rows.filter((r) => Date.parse(r.date) >= Date.parse(last.date) - 3 * 365 * 86_400_000).map((r) => r.long - r.short);
  const net = last.long - last.short;
  const lo = Math.min(...nets), hi = Math.max(...nets);
  const prev = rows.at(-2);
  return { date: last.date, net, netPct: last.oi ? net / last.oi : 0, index3y: nets.length >= 52 && hi > lo ? (net - lo) / (hi - lo) : null, change1w: prev ? net - (prev.long - prev.short) : null };
}

// ------------------------------------------------------------------ GDP contributions

export interface Contribution {
  key: string;
  label: string;
  /** FRED series or ECOS item code */
  code: string;
}

/** BEA contributions to the annualized quarterly change in US real GDP (percentage points) */
export const US_GDP: { total: string; parts: Contribution[] } = {
  total: 'A191RL1Q225SBEA',
  parts: [
    { key: 'pce', label: '개인소비', code: 'DPCERY2Q224SBEA' },
    { key: 'fixed', label: '고정투자', code: 'A007RY2Q224SBEA' },
    { key: 'inventory', label: '재고', code: 'A014RY2Q224SBEA' },
    { key: 'gov', label: '정부', code: 'A822RY2Q224SBEA' },
    { key: 'net', label: '순수출', code: 'A019RY2Q224SBEA' },
  ],
};

/** 한국은행 지출항목별 성장기여도 (계절조정, 전기 대비, %p): ECOS 200Y125 */
export const KR_GDP: Contribution[] = [
  { key: 'pce', label: '민간소비', code: '1010110' },
  { key: 'gov', label: '정부소비', code: '1010120' },
  { key: 'construction', label: '건설투자', code: '1020111' },
  { key: 'equipment', label: '설비투자', code: '1020112' },
  { key: 'ip', label: '지식재산투자', code: '1020113' },
  { key: 'inventory', label: '재고', code: '1020120' },
  { key: 'net', label: '순수출', code: '1060150' },
];

/** Quarterly rows for a stacked chart: one row per quarter with each part and the total */
export function contributionRows(parts: { key: string; points: Point[] }[], total: Point[] | null, quarters: number): Record<string, number | string | null>[] {
  const dates = [...new Set(parts.flatMap((p) => p.points.map((x) => x.date)))].sort().slice(-quarters);
  const at = parts.map((p) => ({ key: p.key, m: new Map(p.points.map((x) => [x.date, x.value])) }));
  const t = total ? new Map(total.map((x) => [x.date, x.value])) : null;
  return dates.map((d) => {
    const row: Record<string, number | string | null> = { date: d };
    let sum = 0;
    for (const p of at) {
      const v = p.m.get(d) ?? null;
      row[p.key] = v;
      sum += v ?? 0;
    }
    row.total = t ? (t.get(d) ?? null) : Number(sum.toFixed(2));
    return row;
  });
}
