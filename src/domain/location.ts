/**
 * 입지: how well placed each 시군구 is for living, from 통계청 KOSIS — 사설학원 and 의사 per thousand
 * people, average 근로소득 (국세청), jobs per resident, 재정자립도 and five years of population —
 * each ranked against every 시군구 and averaged into one score and a 급지 (1 = top fifth). 외국인 and
 * 고령인구 are shown beside them but not scored.
 *
 * KOSIS numbers its regions its own way (e-지방지표 "31020" 성남시, 국세통계 "A0101" 강남구), so rows
 * are matched to 지역 분석's regions by 시도 and name. These tables go down to 시 level: a 구 of a
 * 시 (분당구) takes its 시's values.
 */
import { RONE_REGIONS, shortSido } from './region-analysis';

export const LOCATION_TABLES = {
  academy: { org: '101', tbl: 'DT_1YL21191', itm: 'T10 T002', years: 6 },
  doctor: { org: '101', tbl: 'DT_1YL20981', itm: 'T10', years: 1 },
  fiscal: { org: '101', tbl: 'DT_1YL20921', itm: 'T20', years: 1 },
  jobs: { org: '101', tbl: 'DT_1YL15014', itm: 'T001', years: 1 },
  income: { org: '133', tbl: 'DT_133001N_4215', itm: 'T001 T002', years: 1, objL2: 'B01' },
  foreign: { org: '101', tbl: 'DT_1YL21271', itm: 'T10', years: 1 },
  elderly: { org: '101', tbl: 'DT_1YL20631', itm: 'T10', years: 1 },
} as const;
export type LocationTable = keyof typeof LOCATION_TABLES;

export const LOCATION_METRICS = [
  { key: 'academy', label: '사설학원', unit: '개/천명', digits: 2, about: '인구 천 명당 사설학원 수 — 학원가가 두터운 정도' },
  { key: 'doctor', label: '의사', unit: '명/천명', digits: 1, about: '인구 천 명당 의료기관에서 일하는 의사 수' },
  { key: 'income', label: '근로소득', unit: '만원', digits: 0, about: '그 시군구에 사는 근로자 1인당 연 급여총계 평균 (국세청 연말정산, 주소지 기준)' },
  { key: 'jobs', label: '일자리', unit: '명/100명', digits: 0, about: '주민 100명당 그 시군구에 있는 사업체 종사자 수 — 직장이 가까운 정도' },
  { key: 'fiscal', label: '재정자립도', unit: '%', digits: 1, about: '자체 수입으로 살림을 꾸리는 정도 (세입과목 개편 후 기준)' },
  { key: 'growth', label: '인구 5년', unit: '%', digits: 1, about: '주민등록인구의 5년 증감' },
  // Shown, not scored: neither is better or worse in itself
  { key: 'foreign', label: '외국인', unit: '명/천명', digits: 1, about: '인구 천 명당 등록외국인 수 — 공단·산업단지 일자리가 많은 곳에서 높습니다 (점수에는 넣지 않음)', unscored: true },
  { key: 'elderly', label: '고령인구', unit: '%', digits: 1, about: '65세 이상 인구 비율 (점수에는 넣지 않음)', unscored: true },
] as const;
export type LocationMetric = (typeof LOCATION_METRICS)[number]['key'];
const isScored = (m: (typeof LOCATION_METRICS)[number]) => !('unscored' in m && m.unscored);

export interface KosisRow {
  C1: string;
  C1_NM: string;
  C2?: string;
  ITM_ID: string;
  PRD_DE: string;
  DT: string;
}

const GWANGJU_GU = new Set(['동구', '서구', '남구', '북구', '광산구']);
/** e-지방지표 two-digit 시도 codes */
const SIDO_CODE: Record<string, string> = { '11': '서울', '21': '부산', '22': '대구', '23': '인천', '24': '광주', '25': '대전', '26': '울산', '29': '세종', '31': '경기', '32': '강원', '33': '충북', '34': '충남', '35': '전북', '36': '전남', '37': '경북', '38': '경남', '39': '제주' };

/** The 시도 of a 시군구 in a merged 전남광주 row: 광주's five 구, else 전남 */
export const splitJeonnam = (sido: string, name: string) => (/전남광주/.test(sido) ? (GWANGJU_GU.has(name) ? '광주' : '전남') : shortSido(sido));

/** "경기 여주군" → "여주군"; spaces inside names go */
const cleanName = (name: string) => name.replace(/^(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)\s+/, '').replace(/\(.*\)$/, '').replace(/\s+/g, '');
/** A 시도 listed under the merged 전남광주 code ("12" 광주광역시) */
const isSidoName = (name: string) => /(특별시|광역시|특별자치시|특별자치도|도)$/.test(name) && shortSido(name) !== name;

/** The region key of an e-지방지표 row ("31020" 성남시 → "경기>성남시"; "31" → "경기"), null for 전국 */
export function eRegionKey(code: string, name: string): string | null {
  if (code === '00') return null;
  if (code.length === 2) return code === '12' ? null : (SIDO_CODE[code] ?? shortSido(name));
  if (isSidoName(cleanName(name))) return shortSido(cleanName(name));
  const sido = code.startsWith('12') ? (GWANGJU_GU.has(cleanName(name)) ? '광주' : '전남') : SIDO_CODE[code.slice(0, 2)];
  if (!sido) return null;
  return sido === '세종' ? '세종' : `${sido}>${cleanName(name)}`;
}

/** Region keys of a 국세통계 table ("A01" 서울, "A0101" 강남구), from the 시도 rows' names */
export function taxRegionKeys(rows: KosisRow[]): Map<string, string> {
  const sido = new Map<string, string>();
  for (const r of rows) if (r.C1.length === 3 && r.C1 !== 'A00') sido.set(r.C1, r.C1_NM);
  const out = new Map<string, string>();
  for (const r of rows) {
    if (r.C1.length === 3 && r.C1 !== 'A00') out.set(r.C1, shortSido(r.C1_NM).replace(/^전남광주.*/, ''));
    if (r.C1.length === 5) {
      const s = sido.get(r.C1.slice(0, 3));
      if (!s) continue;
      const name = cleanName(r.C1_NM);
      if (isSidoName(name)) {
        out.set(r.C1, shortSido(name));
        continue;
      }
      const sd = /전남광주/.test(s) ? (GWANGJU_GU.has(name) ? '광주' : '전남') : shortSido(s);
      out.set(r.C1, sd === '세종' ? '세종' : `${sd}>${name}`);
    }
  }
  return out;
}

const num = (v: string) => {
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};
const latestOf = (rows: KosisRow[], itm: string) => {
  const years = rows.filter((r) => r.ITM_ID === itm).map((r) => r.PRD_DE).sort();
  return years.at(-1) ?? null;
};

export interface LocationValues {
  /** Per region key: each metric, the latest year it is from */
  values: Record<string, Partial<Record<LocationMetric, number>>>;
  years: Partial<Record<LocationMetric, string>>;
}

/** Every region's numbers from the five whole tables */
export function locationValues(t: Record<LocationTable, KosisRow[]>): LocationValues {
  const values: LocationValues['values'] = {};
  const years: LocationValues['years'] = {};
  const put = (key: string | null | undefined, m: LocationMetric, v: number | null) => {
    if (!key || v === null || !Number.isFinite(v)) return;
    (values[key] ??= {})[m] = v;
  };
  // 학원 table: rate per thousand, and the population it was taken on (latest and five years before)
  const ay = latestOf(t.academy, 'T10');
  years.academy = ay ?? undefined;
  const popYears = [...new Set(t.academy.filter((r) => r.ITM_ID === 'T002').map((r) => r.PRD_DE))].sort();
  const pLast = popYears.at(-1), pFirst = popYears.length >= 6 ? popYears.at(-6) : popYears[0];
  if (pLast && pFirst && pLast !== pFirst) years.growth = `${pFirst}~${pLast}`;
  const pop = new Map<string, number>();
  for (const r of t.academy) {
    const key = eRegionKey(r.C1, r.C1_NM);
    if (r.ITM_ID === 'T10' && r.PRD_DE === ay) put(key, 'academy', num(r.DT));
    if (r.ITM_ID === 'T002' && r.PRD_DE === pLast && key) pop.set(key, num(r.DT) ?? 0);
  }
  if (pLast && pFirst && pLast !== pFirst) {
    const before = new Map(t.academy.filter((r) => r.ITM_ID === 'T002' && r.PRD_DE === pFirst).map((r) => [eRegionKey(r.C1, r.C1_NM), num(r.DT)]));
    for (const [key, now] of pop) {
      const b = before.get(key);
      if (b) put(key, 'growth', (now / b - 1) * 100);
    }
  }
  const dy = latestOf(t.doctor, 'T10');
  years.doctor = dy ?? undefined;
  for (const r of t.doctor) if (r.PRD_DE === dy) put(eRegionKey(r.C1, r.C1_NM), 'doctor', num(r.DT));
  const fy = latestOf(t.fiscal, 'T20');
  years.fiscal = fy ?? undefined;
  for (const r of t.fiscal) if (r.PRD_DE === fy) put(eRegionKey(r.C1, r.C1_NM), 'fiscal', num(r.DT));
  for (const k of ['foreign', 'elderly'] as const) {
    const y = latestOf(t[k], 'T10');
    years[k] = y ?? undefined;
    for (const r of t[k]) if (r.PRD_DE === y) put(eRegionKey(r.C1, r.C1_NM), k, num(r.DT));
  }
  const jy = latestOf(t.jobs, 'T001');
  years.jobs = jy ?? undefined;
  for (const r of t.jobs) {
    if (r.PRD_DE !== jy) continue;
    const key = eRegionKey(r.C1, r.C1_NM);
    const p = key ? pop.get(key) : undefined;
    const n = num(r.DT);
    if (p && n !== null) put(key, 'jobs', (n / p) * 100);
  }
  // 국세통계: 급여총계 (백만원) ÷ 인원 → 만원 per worker
  const iy = latestOf(t.income, 'T001');
  years.income = iy ?? undefined;
  const keys = taxRegionKeys(t.income);
  const people = new Map<string, number>(), amount = new Map<string, number>();
  for (const r of t.income) {
    if (r.PRD_DE !== iy) continue;
    const v = num(r.DT);
    if (v === null) continue;
    if (r.ITM_ID === 'T001') people.set(r.C1, v);
    if (r.ITM_ID === 'T002') amount.set(r.C1, v);
  }
  for (const [c, n] of people) {
    const a = amount.get(c);
    if (a && n) put(keys.get(c), 'income', (a * 100) / n);
  }
  return { values, years };
}

export interface LocationRow {
  key: string;
  label: string;
  sido: string;
  /** Whether 지역 분석 has the region (군 without 한국부동산원 data do not) */
  linked: boolean;
  values: Partial<Record<LocationMetric, number>>;
  /** 0–100 against every 시군구, per metric and on average */
  pct: Partial<Record<LocationMetric, number>>;
  score: number | null;
  /** 1 (top fifth) to 5 */
  grade: number | null;
  rank: number | null;
}

/**
 * Every 시군구 (keys with a "시도>" part, the 시 level) with each metric's percentile among them, the
 * average of those (with at least four metrics) as the score, its rank and 급지.
 */
export function rankLocations(v: LocationValues): LocationRow[] {
  const keys = Object.keys(v.values).filter((k) => k.includes('>') || k === '세종');
  const pct: Record<string, Partial<Record<LocationMetric, number>>> = {};
  for (const m of LOCATION_METRICS) {
    const list = keys.flatMap((k) => (v.values[k][m.key] !== undefined ? [{ k, x: v.values[k][m.key]! }] : [])).sort((a, b) => a.x - b.x);
    list.forEach((e, i) => ((pct[e.k] ??= {})[m.key] = list.length > 1 ? (i / (list.length - 1)) * 100 : 50));
  }
  const known = new Set(RONE_REGIONS.map((r) => r.key));
  const scored = new Set(LOCATION_METRICS.filter(isScored).map((m) => m.key));
  const rows: LocationRow[] = keys.map((k) => {
    const ps = Object.entries(pct[k] ?? {}).filter(([m]) => scored.has(m as LocationMetric)).map(([, v]) => v);
    const score = ps.length >= 4 ? ps.reduce((a, b) => a + b, 0) / ps.length : null;
    return { key: k, label: k.replace('>', ' '), sido: k.split('>')[0], linked: known.has(k), values: v.values[k], pct: pct[k] ?? {}, score, grade: null, rank: null };
  });
  const ranked = rows.filter((r) => r.score !== null).sort((a, b) => b.score! - a.score!);
  ranked.forEach((r, i) => {
    r.rank = i + 1;
    r.grade = Math.min(5, Math.floor((i / ranked.length) * 5) + 1);
  });
  return rows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
}

/** The location row a region reads: its own, else its 시's (a 구 of a 시) */
export function locationOf(rows: Map<string, LocationRow>, key: string): LocationRow | null {
  const own = rows.get(key);
  if (own) return own;
  const parts = key.split('>');
  return parts.length === 3 ? (rows.get(parts.slice(0, 2).join('>')) ?? null) : null;
}
