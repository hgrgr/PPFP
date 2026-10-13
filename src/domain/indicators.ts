/**
 * 분석 지표: macro series for rates, real estate and stocks, and the charts built from them.
 *
 * Every series is brought to one point per period, dated on the period's first day: daily
 * FRED series as the month's last close (fredgraph's fq=Monthly&fam=eop, as the ACM file's
 * monthly sheet is month-end), ECOS and KOSIS as published
 * (monthly, quarterly "2025-04-01", annual "2025-01-01"). Charts are pure functions of those
 * series, so the screen, the tests and the demo agree.
 *
 * The long-rate cards start from the market 10-year yield and explain it two standard ways
 * instead of one sum: the expected path of short rates + the term premium (Adrian, Crump &
 * Moench 2013, New York Fed; a few bp of model residual remain), and the real (TIPS) yield +
 * breakeven inflation (Fisher; exact).
 * "Trust in the Fed" is not a residual of either; the market's usual gauge is the 5y5y
 * forward inflation expectation staying near 2% (anchored expectations).
 */

export type IndicatorSource = 'FRED' | 'ECOS' | 'KOSIS' | 'ACM' | 'RONE' | 'LW';
export type Freq = 'M' | 'Q' | 'A';

export interface Point {
  date: string;
  value: number;
}

/** One series to load. `id` is also its storage key (PriceDaily.symbol). */
export interface SeriesReq {
  id: string;
  source: IndicatorSource;
  /** FRED: series id · ECOS: "STAT/CYCLE/ITEM1[/ITEM2...]" · KOSIS: "orgId/tblId/itmId/objL1/objL2" · ACM: column (ACMY10, ACMTP10, ACMRNY10) · RONE: "STATBL_ID/CLS_ID/ITM_ID" · LW: column (rstar, gap) */
  code: string;
  freq: Freq;
}

const fred = (code: string, freq: Freq = 'M'): SeriesReq => ({ id: `IND:FRED:${code}`, source: 'FRED', code, freq });
const ecos = (code: string): SeriesReq => {
  const cycle = code.split('/')[1] as Freq;
  return { id: `IND:ECOS:${code}`, source: 'ECOS', code, freq: cycle };
};
const acm = (col: string): SeriesReq => ({ id: `IND:ACM:${col}`, source: 'ACM', code: col, freq: 'M' });
/** 한국부동산원 R-ONE 통계표 (monthly), one region and item */
const rone = (table: string, cls: string, item = '100001'): SeriesReq => ({ id: `IND:RONE:${table}/${cls}/${item}`, source: 'RONE', code: `${table}/${cls}/${item}`, freq: 'M' });
/** New York Fed Laubach-Williams estimates (quarterly): one-sided r* or the output gap */
const lw = (col: 'rstar' | 'gap'): SeriesReq => ({ id: `IND:LW:${col}`, source: 'LW', code: col, freq: 'Q' });
const kosisPop = (region: string, age: string): SeriesReq => ({ id: `IND:KOSIS:pop:${region}:${age}`, source: 'KOSIS', code: `101/DT_1B04005N/T2/${region}/${age}`, freq: 'M' });

// ---------------------------------------------------------------- regions

/** 시도 (and 전국) with each source's code for it. */
export interface Region {
  code: string;
  name: string;
  /** ECOS 291Y524 시도별 주택 시가총액 */
  value: string;
  /** ECOS 901Y106 주택수 */
  stock: string;
  /** ECOS 903Y201/903Y001 시도 */
  income: string;
  /** ECOS 901Y074 미분양 */
  unsold: string;
  /** ECOS 901Y105 인허가 */
  permit: string;
  /** KOSIS 행정구역 codes, tried in order (강원·전북 changed codes when they became 특별자치도) */
  kosis: string[];
  /** R-ONE region (CLS_ID) in the 주택가격동향 tables (가격지수, 수급동향, 전세가율) */
  rone: string;
  /** R-ONE region in the 아파트거래현황 table, which numbers regions its own way; null when it has none now */
  roneTrade: string | null;
}

export const REGIONS: Region[] = [
  { code: '00', name: '전국', value: 'REG00', stock: 'HALL', income: 'B0500', unsold: 'I410A', permit: 'ALL', kosis: ['00'], rone: '500001', roneTrade: '500001' },
  { code: '11', name: '서울', value: 'REG11', stock: 'HSEO', income: 'B0511', unsold: 'I410B', permit: 'SEO', kosis: ['11'], rone: '500008', roneTrade: '500002' },
  { code: '41', name: '경기', value: 'REG41', stock: 'HGYE', income: 'B0531', unsold: 'I410I', permit: 'GYE', kosis: ['41'], rone: '500009', roneTrade: '500010' },
  { code: '28', name: '인천', value: 'REG28', stock: 'HINC', income: 'B0523', unsold: 'I410E', permit: 'INC', kosis: ['28'], rone: '500010', roneTrade: '500005' },
  { code: '26', name: '부산', value: 'REG26', stock: 'HBUS', income: 'B0521', unsold: 'I410C', permit: 'BUS', kosis: ['26'], rone: '500011', roneTrade: '500003' },
  { code: '27', name: '대구', value: 'REG27', stock: 'HDEG', income: 'B0522', unsold: 'I410D', permit: 'DEG', kosis: ['27'], rone: '500012', roneTrade: '500004' },
  { code: '29', name: '광주', value: 'REG29', stock: 'HGWA', income: 'B0524', unsold: 'I410F', permit: 'GWA', kosis: ['29'], rone: '500013', roneTrade: null },
  { code: '30', name: '대전', value: 'REG30', stock: 'HDEJ', income: 'B0525', unsold: 'I410G', permit: 'DEJ', kosis: ['30'], rone: '500014', roneTrade: '500007' },
  { code: '31', name: '울산', value: 'REG31', stock: 'HULS', income: 'B0526', unsold: 'I410H', permit: 'ULS', kosis: ['31'], rone: '500015', roneTrade: '500008' },
  { code: '36', name: '세종', value: 'REG36', stock: 'HGAN', income: 'B0529', unsold: 'I410L', permit: 'SEJ', kosis: ['36'], rone: '500016', roneTrade: '500009' },
  { code: '42', name: '강원', value: 'REG42', stock: 'HSEJ', income: 'B0532', unsold: 'I410J', permit: 'GAN', kosis: ['51', '42'], rone: '500017', roneTrade: '500011' },
  { code: '43', name: '충북', value: 'REG43', stock: 'HCHB', income: 'B0533', unsold: 'I410K', permit: 'CHB', kosis: ['43'], rone: '500018', roneTrade: '500012' },
  { code: '44', name: '충남', value: 'REG44', stock: 'HCHN', income: 'B0534', unsold: 'I410S', permit: 'CHN', kosis: ['44'], rone: '500019', roneTrade: '500013' },
  { code: '45', name: '전북', value: 'REG45', stock: 'HJNB', income: 'B0535', unsold: 'I410M', permit: 'JNB', kosis: ['52', '45'], rone: '500020', roneTrade: '500014' },
  { code: '46', name: '전남', value: 'REG46', stock: 'HJNN', income: 'B0536', unsold: 'I410N', permit: 'JNN', kosis: ['46'], rone: '500021', roneTrade: null },
  { code: '47', name: '경북', value: 'REG47', stock: 'HKYB', income: 'B0537', unsold: 'I410O', permit: 'KYB', kosis: ['47'], rone: '500022', roneTrade: '500016' },
  { code: '48', name: '경남', value: 'REG48', stock: 'HKYN', income: 'B0538', unsold: 'I410P', permit: 'KYN', kosis: ['48'], rone: '500023', roneTrade: '500017' },
  { code: '50', name: '제주', value: 'REG51', stock: 'HJEJ', income: 'B0539', unsold: 'I410Q', permit: 'JEJ', kosis: ['50'], rone: '500024', roneTrade: '500019' },
];
// ECOS 901Y106 names 강원 "HSEJ" and 세종 "HGAN" (as its item list reads); kept as published.
// R-ONE's 아파트거래현황 has no current 광주·전남 rows (their old codes are empty since the 2026 전남광주 merger).

/** The 시도 of a code: a 시도 itself, or the 시도 a 5-digit 시군구 (법정동 LAWD_CD) belongs to. */
export function regionOf(code: string | undefined): Region {
  let c = code ?? '';
  if (/^\d{5}$/.test(c)) c = c.slice(0, 2);
  // 강원·전북 got new codes as 특별자치도 (51, 52)
  if (c === '51') c = '42';
  if (c === '52') c = '45';
  return REGIONS.find((r) => r.code === c) ?? REGIONS[1];
}

/** 가구주 연령 (ECOS 903Y206 / 903Y006, 전국) for the PIR's income side */
export const INCOME_BASES = [
  { key: 'region', label: '그 지역 전체 가구' },
  { key: 'B1601', label: '전국 · 가구주 29세 이하' },
  { key: 'B1602', label: '전국 · 가구주 30대' },
  { key: 'B1603', label: '전국 · 가구주 40대' },
  { key: 'B1604', label: '전국 · 가구주 50대' },
] as const;
export type IncomeBase = (typeof INCOME_BASES)[number]['key'];

/** KOSIS 5세 연령 codes summed into decades */
export const AGE_BANDS = [
  { key: '0', label: '0~9세', codes: ['5', '10'] },
  { key: '10', label: '10대', codes: ['15', '20'] },
  { key: '20', label: '20대', codes: ['25', '30'] },
  { key: '30', label: '30대', codes: ['35', '40'] },
  { key: '40', label: '40대', codes: ['45', '50'] },
  { key: '50', label: '50대', codes: ['55', '60'] },
] as const;

// ---------------------------------------------------------------- params and charts

export interface AnalysisParams {
  /** 시도 code (REGIONS) or a 5-digit 시군구 code for population */
  region: string;
  incomeBase: IncomeBase;
}

export interface ChartLine {
  key: string;
  label: string;
  color: string;
  kind?: 'line' | 'area' | 'bar';
  /** Areas with the same stack id pile up */
  stack?: string;
  axis?: 'right';
  dash?: boolean;
}

export interface ChartData {
  lines: ChartLine[];
  rows: Record<string, number | string | null>[];
  unit: string;
  rightUnit?: string;
  /** Horizontal guides, e.g. 0 or a 2% target */
  refs?: { y: number; label: string }[];
  /** What the latest point says, one line per series, for the card's summary */
  latest: { label: string; value: string; date: string }[];
  note?: string;
}

export type Group = 'rates' | 'cycle' | 'realestate' | 'liquidity' | 'stocks';
export const GROUPS: { key: Group; label: string }[] = [
  { key: 'rates', label: '금리' },
  { key: 'cycle', label: '경기 사이클' },
  { key: 'realestate', label: '부동산' },
  { key: 'liquidity', label: '유동성 · 수급' },
  { key: 'stocks', label: '주식 · 위험' },
];

export interface Indicator {
  id: string;
  group: Group;
  title: string;
  /** Why it matters and how to read it */
  about: string;
  source: string;
  /** Shown before turned on by the user */
  defaultOn: boolean;
  /** Uses the region picker / the income basis */
  usesRegion?: 'sido' | 'any';
  usesIncome?: boolean;
  needs: (p: AnalysisParams) => SeriesReq[];
  build: (get: (id: string) => Point[], p: AnalysisParams) => ChartData;
}

const C = { a: 'var(--series-1)', b: 'var(--series-2)', c: 'var(--series-3)', d: 'var(--series-4)', e: 'var(--series-5)', f: 'var(--series-6)', g: 'var(--series-7)', ink: 'var(--ink)', muted: 'var(--muted)' };

/** Rows keyed by date with one column per named series; dates sorted, missing values null. */
export function joinSeries(cols: Record<string, Point[]>): Record<string, number | string | null>[] {
  const byDate = new Map<string, Record<string, number | string | null>>();
  for (const [k, pts] of Object.entries(cols)) {
    for (const p of pts) {
      const row = byDate.get(p.date) ?? { date: p.date };
      row[k] = p.value;
      byDate.set(p.date, row);
    }
  }
  const keys = Object.keys(cols);
  return [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date))).map((r) => Object.fromEntries([['date', r.date], ...keys.map((k) => [k, r[k] ?? null])]));
}

/** a op b on the dates both have */
export function combine(a: Point[], b: Point[], op: (x: number, y: number) => number | null): Point[] {
  const m = new Map(b.map((p) => [p.date, p.value]));
  return a.flatMap((p) => {
    const y = m.get(p.date);
    if (y === undefined) return [];
    const v = op(p.value, y);
    return v === null || !Number.isFinite(v) ? [] : [{ date: p.date, value: v }];
  });
}

/** Change against the same period a year earlier, in % */
export function yoy(pts: Point[]): Point[] {
  const m = new Map(pts.map((p) => [p.date, p.value]));
  return pts.flatMap((p) => {
    const prev = m.get(`${Number(p.date.slice(0, 4)) - 1}${p.date.slice(4)}`);
    return prev ? [{ date: p.date, value: (p.value / prev - 1) * 100 }] : [];
  });
}

/** Sum of several series on the dates all of them have */
export function sumAll(list: Point[][]): Point[] {
  if (!list.length) return [];
  return list.slice(1).reduce((acc, s) => combine(acc, s, (x, y) => x + y), list[0]);
}

/** Moves every point by `years` (an income reported for the previous year, dated as that year) */
export const shiftYears = (pts: Point[], years: number): Point[] => pts.map((p) => ({ date: `${Number(p.date.slice(0, 4)) + years}${p.date.slice(4)}`, value: p.value }));

/** Two tables that continue each other (903Y001 to 2016, 903Y201 from 2017): the later wins */
export const splice = (older: Point[], newer: Point[]): Point[] => {
  const first = newer[0]?.date ?? '9999';
  return [...older.filter((p) => p.date < first), ...newer];
};

/** "2026-09-01" moved by `months` (whole months, first of the month) */
export function addMonths(date: string, months: number): string {
  const [y, m] = date.split('-').map(Number);
  const k = y * 12 + (m - 1) + months;
  return `${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, '0')}-01`;
}

/** Every point moved `months` later (a pipeline drawn where it lands) */
export const shiftMonths = (pts: Point[], months: number): Point[] => pts.map((p) => ({ date: addMonths(p.date, months), value: p.value }));

/** Sum of each month and the `n` − 1 before it; months with a gap in that window are left out */
export function rollingSum(pts: Point[], n: number): Point[] {
  const m = new Map(pts.map((p) => [p.date, p.value]));
  return pts.flatMap((p) => {
    let sum = 0;
    for (let k = 0; k < n; k++) {
      const v = m.get(addMonths(p.date, -k));
      if (v === undefined) return [];
      sum += v;
    }
    return [{ date: p.date, value: sum }];
  });
}

/** Change from `months` earlier, in % */
export function changeOver(pts: Point[], months: number): Point[] {
  const m = new Map(pts.map((p) => [p.date, p.value]));
  return pts.flatMap((p) => {
    const prev = m.get(addMonths(p.date, -months));
    return prev ? [{ date: p.date, value: (p.value / prev - 1) * 100 }] : [];
  });
}

/** Mean of each calendar year that has all 12 months, dated on 1 January */
export function yearlyMean(pts: Point[]): Point[] {
  const by = new Map<string, number[]>();
  for (const p of pts) by.set(p.date.slice(0, 4), [...(by.get(p.date.slice(0, 4)) ?? []), p.value]);
  return [...by].filter(([, v]) => v.length === 12).map(([y, v]) => ({ date: `${y}-01-01`, value: v.reduce((a, b) => a + b, 0) / 12 }));
}

export type CyclePhase = '확장' | '둔화' | '수축' | '회복';
/**
 * The business cycle phase from a cycle component around 100 (통계청 선행지수 순환변동치): above
 * 100 and rising is expansion, above and falling a slowdown, below and falling contraction, below
 * and rising recovery. `change` is over the last three months.
 */
export function cyclePhase(level: number, change: number): CyclePhase {
  if (level >= 100) return change >= 0 ? '확장' : '둔화';
  return change < 0 ? '수축' : '회복';
}

/**
 * The housing market's phase on the honeycomb cycle (Janssen et al. 1994, 벌집순환모형): prices and
 * trading volume turn around each other through six phases. `price` and `volume` are % changes
 * (price over six months; volume of the last six months against the six before); a price within
 * ±`flat`% counts as flat.
 */
export function honeycombPhase(price: number, volume: number, flat = 0.5): { n: number; name: string } {
  const up = volume >= 0;
  if (price > flat) return up ? { n: 1, name: '1국면 회복기 (가격↑ 거래↑)' } : { n: 2, name: '2국면 활황기 (가격↑ 거래↓)' };
  if (price < -flat) return up ? { n: 5, name: '5국면 불황기 (가격↓ 거래↑)' } : { n: 4, name: '4국면 침체기 (가격↓ 거래↓)' };
  return up ? { n: 6, name: '6국면 회복 진입기 (가격→ 거래↑)' } : { n: 3, name: '3국면 침체 진입기 (가격→ 거래↓)' };
}

/**
 * A housing affordability index in the way of 주택금융공사's K-HAI: the monthly repayment on a
 * loan of `ltv` of the house, over `years` at `rate` %, as a share of monthly income, against 25%
 * (100 = repayments take a quarter of income). Inputs are averages here, not HF's medians.
 */
export function affordability(price: number, income: number, rate: number, ltv = 0.479, years = 20): number {
  const r = rate / 100 / 12;
  const n = years * 12;
  const loan = price * ltv;
  const payment = r === 0 ? loan / n : (loan * r) / (1 - (1 + r) ** -n);
  return (payment / (income / 12) / 0.25) * 100;
}

const fmt = (v: number, digits = 2) => v.toLocaleString('ko-KR', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
const period = (date: string, freq: Freq) => (freq === 'A' ? date.slice(0, 4) : freq === 'Q' ? `${date.slice(0, 4)} ${Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1}분기` : date.slice(0, 7));
function latestOf(series: { label: string; pts: Point[]; unit: string; freq?: Freq; digits?: number }[]) {
  return series.flatMap((s) => {
    const p = s.pts.at(-1);
    return p ? [{ label: s.label, value: `${fmt(p.value, s.digits)}${s.unit}`, date: period(p.date, s.freq ?? 'M') }] : [];
  });
}

const popReqs = (p: AnalysisParams) => {
  const codes = popCodes(p.region);
  return codes.flatMap((r) => ['0', ...AGE_BANDS.flatMap((b) => b.codes)].map((age) => kosisPop(r, age)));
};
/** KOSIS codes for a picked region: a 시도's (with its old code as a fallback) or a 시군구's */
export function popCodes(region: string): string[] {
  if (/^\d{5}$/.test(region)) return [region];
  return regionOf(region).kosis;
}
/** The first KOSIS code of the region that has data */
function popSeries(get: (id: string) => Point[], region: string, age: string): Point[] {
  for (const r of popCodes(region)) {
    const pts = get(kosisPop(r, age).id);
    if (pts.length) return pts;
  }
  return [];
}

export const INDICATORS: Indicator[] = [
  // ------------------------------------------------------------ rates
  {
    id: 'us-10y-acm',
    group: 'rates',
    title: '미국 10년 금리 분해 ① 기대 단기금리 + 기간 프리미엄',
    about:
      '시장의 10년 국채금리(검은 선)를 앞으로 10년 동안 단기금리가 평균 얼마일지에 대한 기대(파란 선)와, 장기채를 들고 있는 대가로 더 받는 기간 프리미엄(막대)으로 나눕니다. 기대 단기금리는 다시 지금의 단기금리(3개월 국채, 회색 면적)와 앞으로 단기금리가 오르거나 내릴 것이라는 기대(둘 사이의 간격)로 나뉩니다. 기대 단기금리와 기간 프리미엄은 뉴욕연준 ACM 모형의 추정치이고, 둘의 합과 시장 금리 사이에 남는 몇 bp는 모형 잔차입니다. 금리가 오를 때 어느 부분이 올렸는지 보면, 지금의 정책금리 때문인지, 앞으로의 인상·인하 기대 때문인지, 장기채를 꺼리는 수급 때문인지(기간 프리미엄) 구분할 수 있습니다.',
    source: '뉴욕연준 ACM Term Premium (월말), FRED: DGS10, DGS3MO, 연방기금금리 (월말)',
    defaultOn: true,
    needs: () => [acm('ACMTP10'), acm('ACMRNY10'), fred('DGS10'), fred('DGS3MO'), fred('DFF')],
    build: (get) => {
      const n = get('IND:FRED:DGS10'), tp = get('IND:ACM:ACMTP10'), rn = get('IND:ACM:ACMRNY10'), bill = get('IND:FRED:DGS3MO'), ff = get('IND:FRED:DFF');
      // The expected path splits into where short rates are now and where they are expected to go
      const path = combine(rn, bill, (a, b) => a - b);
      // What the two ACM parts leave of the market yield: the fit error of the model, and that ACM
      // models zero-coupon yields while DGS10 is the yield of coupon-paying bonds
      const residual = combine(n, combine(rn, tp, (a, b) => a + b), (a, b) => a - b);
      return {
        lines: [
          { key: 'bill', label: '지금의 단기금리 (3개월 국채)', color: C.muted, kind: 'area' },
          { key: 'rn', label: '기대 단기금리 (앞으로 10년 평균)', color: C.a },
          { key: 'tp', label: '기간 프리미엄', color: C.b, kind: 'bar' },
          { key: 'n', label: '10년 국채금리 (시장)', color: C.ink },
          { key: 'ff', label: '연방기금금리', color: C.muted, dash: true },
        ],
        rows: joinSeries({ bill, rn, tp, n, ff }),
        unit: '%',
        refs: [{ y: 0, label: '' }],
        latest: latestOf([
          { label: '10년 금리 (시장)', pts: n, unit: '%' },
          { label: '= 지금의 단기금리', pts: bill, unit: '%' },
          { label: '+ 앞으로의 변화 기대', pts: path, unit: '%p' },
          { label: '+ 기간 프리미엄', pts: tp, unit: '%p' },
          { label: '+ 모형 잔차', pts: residual, unit: '%p' },
        ]),
        note: '지금의 단기금리 + 앞으로의 변화 기대 = 기대 단기금리(파란 선)입니다. 모든 값은 그달 마지막 거래일 기준입니다. 모형 잔차는 ACM이 쿠폰 없는 채권 금리를 모형으로 맞춘 값이라 생기는 작은 차이입니다.',
      };
    },
  },
  {
    id: 'us-10y-fisher',
    group: 'rates',
    title: '미국 10년 금리 분해 ② 실질금리 + 기대인플레이션',
    about:
      '같은 시장 10년 국채금리를 물가연동국채(TIPS) 금리, 곧 실질금리와 기대인플레이션(BEI = 명목 − TIPS)으로 나눕니다. 이 분해는 모형 없이 시장 가격만으로 정확히 맞아떨어집니다. 실질금리가 오르면 성장주·장기자산의 할인율이 올라 부담이 커지고, 기대인플레이션이 오르면 물가 우려가 금리를 끌어올리는 것입니다.',
    source: 'FRED: DGS10, DFII10 (월말)',
    defaultOn: true,
    needs: () => [fred('DGS10'), fred('DFII10')],
    build: (get) => {
      const n = get('IND:FRED:DGS10'), r = get('IND:FRED:DFII10');
      // Breakeven straight from the same two closes (as FRED's T10YIE is), so the parts add up exactly
      const b = combine(n, r, (x, y) => x - y);
      return {
        lines: [
          { key: 'b', label: '기대인플레이션 (BEI 10년)', color: C.d, kind: 'area' },
          { key: 'r', label: '실질금리 (TIPS 10년)', color: C.c },
          { key: 'n', label: '10년 국채금리 (시장)', color: C.ink },
        ],
        rows: joinSeries({ r, b, n }),
        unit: '%',
        refs: [{ y: 0, label: '' }],
        latest: latestOf([
          { label: '10년 금리 (시장)', pts: n, unit: '%' },
          { label: '실질금리', pts: r, unit: '%' },
          { label: '기대인플레이션', pts: b, unit: '%' },
        ]),
        note: '모든 값은 그달 마지막 거래일 기준입니다.',
      };
    },
  },
  {
    id: 'us-anchor',
    group: 'rates',
    title: '연준에 대한 신뢰: 5년 뒤 5년 기대인플레이션',
    about:
      '시장이 5년 뒤부터 5년간 예상하는 물가상승률(5y5y)입니다. 단기 물가가 흔들려도 이 값이 연준 목표 2% 근처에 머물면 시장이 연준을 믿는 것이고(기대가 고정됨), 오래 벗어나면 신뢰가 흔들리는 신호입니다. 연준 신뢰를 금리의 나머지 값으로 계산하지 않는 이유는, 그 나머지에 모형 오차와 다른 위험이 함께 섞이기 때문입니다.',
    source: 'FRED: T5YIFR (월말)',
    defaultOn: true,
    needs: () => [fred('T5YIFR')],
    build: (get) => {
      const f = get('IND:FRED:T5YIFR');
      return {
        lines: [{ key: 'f', label: '5y5y 기대인플레이션', color: C.e }],
        rows: joinSeries({ f }),
        unit: '%',
        refs: [{ y: 2, label: '연준 목표 2%' }],
        latest: latestOf([{ label: '5y5y', pts: f, unit: '%' }]),
      };
    },
  },
  {
    id: 'us-curve',
    group: 'rates',
    title: '미국 장단기 금리차',
    about:
      '10년 금리에서 3개월·2년 금리를 뺀 값입니다. 0 아래로 뒤집히면(역전) 시장이 앞으로 금리 인하, 곧 경기 둔화를 예상한다는 뜻이라 경기침체 예측에 가장 많이 쓰입니다(뉴욕연준은 10년−3개월을 씁니다). 역전이 풀리며 다시 벌어질 때 침체가 시작된 경우가 많았습니다.',
    source: 'FRED: T10Y3M, T10Y2Y (월말)',
    defaultOn: true,
    needs: () => [fred('T10Y3M'), fred('T10Y2Y')],
    build: (get) => {
      const a = get('IND:FRED:T10Y3M'), b = get('IND:FRED:T10Y2Y');
      return {
        lines: [
          { key: 'a', label: '10년 − 3개월', color: C.a },
          { key: 'b', label: '10년 − 2년', color: C.b },
        ],
        rows: joinSeries({ a, b }),
        unit: '%p',
        refs: [{ y: 0, label: '역전' }],
        latest: latestOf([
          { label: '10년−3개월', pts: a, unit: '%p' },
          { label: '10년−2년', pts: b, unit: '%p' },
        ]),
      };
    },
  },
  {
    id: 'kr-rates',
    group: 'rates',
    title: '한국 기준금리와 국고채',
    about:
      '한국은행 기준금리와 국고채 3년·10년 금리입니다. 3년물은 앞으로의 기준금리 기대를, 10년물은 거기에 장기 성장·물가 전망과 기간 프리미엄을 더한 값을 반영합니다. 한국은 ACM 같은 공식 분해가 없어 10년−3년 차이로 기울기를 봅니다.',
    source: '한국은행 ECOS: 722Y001, 721Y001',
    defaultOn: true,
    needs: () => [ecos('722Y001/M/0101000'), ecos('721Y001/M/5020000'), ecos('721Y001/M/5050000')],
    build: (get) => {
      const base = get('IND:ECOS:722Y001/M/0101000'), y3 = get('IND:ECOS:721Y001/M/5020000'), y10 = get('IND:ECOS:721Y001/M/5050000');
      const slope = combine(y10, y3, (a, b) => a - b);
      return {
        lines: [
          { key: 'base', label: '기준금리', color: C.ink, dash: true },
          { key: 'y3', label: '국고채 3년', color: C.a },
          { key: 'y10', label: '국고채 10년', color: C.b },
          { key: 'slope', label: '10년 − 3년', color: C.e, kind: 'bar', axis: 'right' },
        ],
        rows: joinSeries({ base, y3, y10, slope }),
        unit: '%',
        rightUnit: '%p',
        latest: latestOf([
          { label: '기준금리', pts: base, unit: '%' },
          { label: '국고채 3년', pts: y3, unit: '%', digits: 3 },
          { label: '국고채 10년', pts: y10, unit: '%', digits: 3 },
        ]),
      };
    },
  },
  {
    id: 'kr-inflation-exp',
    group: 'rates',
    title: '한국 기대인플레이션과 실질 기준금리',
    about:
      '소비자가 예상하는 1년 뒤 물가상승률(한국은행 소비자동향조사)과, 기준금리에서 그것을 뺀 실질 기준금리입니다. 실질 기준금리가 0 아래면 통화정책이 여전히 완화적이라는 뜻입니다.',
    source: '한국은행 ECOS: 511Y003, 722Y001',
    defaultOn: false,
    needs: () => [ecos('511Y003/M/FMB'), ecos('722Y001/M/0101000')],
    build: (get) => {
      const e = get('IND:ECOS:511Y003/M/FMB'), base = get('IND:ECOS:722Y001/M/0101000');
      const real = combine(base, e, (a, b) => a - b);
      return {
        lines: [
          { key: 'e', label: '기대인플레이션 (1년)', color: C.d },
          { key: 'real', label: '실질 기준금리', color: C.a },
        ],
        rows: joinSeries({ e, real }),
        unit: '%',
        refs: [{ y: 0, label: '' }],
        latest: latestOf([
          { label: '기대인플레이션', pts: e, unit: '%', digits: 1 },
          { label: '실질 기준금리', pts: real, unit: '%', digits: 1 },
        ]),
      };
    },
  },
  {
    id: 'mortgage',
    group: 'rates',
    title: '주택담보대출 금리',
    about: '한국 예금은행의 신규 주택담보대출 금리와 미국 30년 고정 모기지 금리입니다. 집값을 움직이는 자금 비용입니다.',
    source: '한국은행 ECOS 121Y006, FRED MORTGAGE30US',
    defaultOn: false,
    needs: () => [ecos('121Y006/M/BECBLA0302'), fred('MORTGAGE30US')],
    build: (get) => {
      const kr = get('IND:ECOS:121Y006/M/BECBLA0302'), us = get('IND:FRED:MORTGAGE30US');
      return {
        lines: [
          { key: 'kr', label: '한국 주담대 (신규)', color: C.a },
          { key: 'us', label: '미국 30년 모기지', color: C.b },
        ],
        rows: joinSeries({ kr, us }),
        unit: '%',
        latest: latestOf([
          { label: '한국 주담대', pts: kr, unit: '%' },
          { label: '미국 30년', pts: us, unit: '%' },
        ]),
      };
    },
  },

  // ------------------------------------------------------------ real estate
  {
    id: 'population',
    group: 'realestate',
    title: '수요: 지역 인구와 연령대',
    about:
      '지역 전체 인구와 0~50대를 10년 단위로 나눈 인구입니다. 집을 사는 주된 연령은 20~50대이고, 0~19세는 학군 수요와 10~20년 뒤의 수요를 보여 줍니다. 인구보다 가구 수가 주택 수요에 더 가깝지만, 주민등록 연령별 인구는 시군구까지 매달 나와 지역의 수요 흐름을 보기에 좋습니다. 30~40대가 줄어드는 지역은 매수 수요가 약해질 수 있고, 어린 연령대가 줄면 학군 수요와 장래 수요가 함께 줄어듭니다.',
    source: '통계청 KOSIS 주민등록인구 (DT_1B04005N, 행정안전부)',
    defaultOn: true,
    usesRegion: 'any',
    needs: popReqs,
    build: (get, p) => {
      const total = popSeries(get, p.region, '0');
      const bands = AGE_BANDS.map((b) => ({ ...b, pts: sumAll(b.codes.map((c) => popSeries(get, p.region, c))) }));
      const cols: Record<string, Point[]> = { total: total.map((x) => ({ ...x, value: x.value / 10_000 })) };
      for (const b of bands) cols[`a${b.key}`] = b.pts.map((x) => ({ ...x, value: x.value / 10_000 }));
      // 20~50대 keep their colors; the younger bands take pink and violet, apart from the greens
      const colors = [C.e, C.g, C.a, C.b, C.c, C.d];
      const growth = yoy(total);
      return {
        lines: [...bands.map((b, i) => ({ key: `a${b.key}`, label: b.label, color: colors[i], kind: 'area' as const, stack: 's' })), { key: 'total', label: '총인구', color: C.ink, axis: 'right' as const }],
        rows: joinSeries(cols),
        unit: '만 명',
        rightUnit: '만 명',
        latest: [
          ...latestOf([{ label: '총인구', pts: cols.total, unit: '만 명', digits: 1 }]),
          ...latestOf([{ label: '1년 증감', pts: growth, unit: '%', digits: 2 }]),
          ...latestOf(bands.map((b) => ({ label: b.label, pts: cols[`a${b.key}`], unit: '만 명', digits: 1 }))),
        ],
      };
    },
  },
  {
    id: 'pir',
    group: 'realestate',
    title: '자금: 소득 대비 주택가격 (PIR)',
    about:
      '지역의 평균 주택 가치(주택 시가총액 ÷ 주택 수)가 가구 연소득의 몇 배인지입니다. 높을수록 소득으로 집을 사기 어렵다는 뜻이고, 과거 평균보다 많이 높으면 가격이 소득을 앞서간 것입니다. 소득은 가계금융복지조사의 가구 평균 경상소득입니다. 연령대별 소득은 시도별로 나오지 않아, 연령을 고르면 그 지역 집값을 전국 그 연령대 가구 소득으로 나눕니다(예: 서울 집값 ÷ 전국 29세 이하 가구 소득).',
    source: '한국은행 ECOS: 291Y524, 901Y106, 903Y201·903Y001, 903Y206·903Y006',
    defaultOn: true,
    usesRegion: 'sido',
    usesIncome: true,
    needs: (p) => {
      const r = regionOf(p.region);
      const income = p.incomeBase === 'region' ? [ecos(`903Y001/A/T01/A0100/${r.income}/C04`), ecos(`903Y201/A/T01/A0100/${r.income}/C04`)] : [ecos(`903Y006/A/T01/A0100/${p.incomeBase}/C04`), ecos(`903Y206/A/T01/A0100/${p.incomeBase}/C04`)];
      return [ecos(`291Y524/A/${r.value}`), ecos(`901Y106/A/${r.stock}`), ...income];
    },
    build: (get, p) => {
      const r = regionOf(p.region);
      const value = get(`IND:ECOS:291Y524/A/${r.value}`); // 십억원, year end
      const stock = get(`IND:ECOS:901Y106/A/${r.stock}`); // 천호
      const [older, newer] = p.incomeBase === 'region' ? [`903Y001/A/T01/A0100/${r.income}/C04`, `903Y201/A/T01/A0100/${r.income}/C04`] : [`903Y006/A/T01/A0100/${p.incomeBase}/C04`, `903Y206/A/T01/A0100/${p.incomeBase}/C04`];
      // 경상소득(전년도): the survey of year Y reports income of Y−1
      const income = shiftYears(splice(get(`IND:ECOS:${older}`), get(`IND:ECOS:${newer}`)), -1); // 만원
      const avgValue = combine(value, stock, (v, s) => (s > 0 ? (v * 1e9) / (s * 1e3) / 1e4 : null)); // 만원 per house
      const pir = combine(avgValue, income, (v, i) => (i > 0 ? v / i : null));
      const mean = pir.length ? pir.reduce((a, b) => a + b.value, 0) / pir.length : null;
      const incomeLabel = INCOME_BASES.find((b) => b.key === p.incomeBase)?.label ?? '';
      return {
        lines: [
          { key: 'pir', label: `PIR (${r.name} 주택 ÷ ${p.incomeBase === 'region' ? `${r.name} 가구` : incomeLabel.replace('전국 · ', '전국 ')} 소득)`, color: C.a, kind: 'bar' },
          { key: 'v', label: `${r.name} 평균 주택가치`, color: C.ink, axis: 'right' },
        ],
        rows: joinSeries({ pir, v: avgValue.map((x) => ({ ...x, value: x.value / 10_000 })) }),
        unit: '배',
        rightUnit: '억원',
        refs: mean ? [{ y: Number(mean.toFixed(1)), label: `기간 평균 ${mean.toFixed(1)}배` }] : undefined,
        latest: latestOf([
          { label: 'PIR', pts: pir, unit: '배', freq: 'A', digits: 1 },
          { label: '평균 주택가치', pts: avgValue.map((x) => ({ ...x, value: x.value / 10_000 })), unit: '억원', freq: 'A', digits: 2 },
          { label: '가구 연소득', pts: income, unit: '만원', freq: 'A', digits: 0 },
        ]),
        note: '평균 주택가치는 단독·연립을 포함한 모든 주택의 평균이라, 아파트 시세보다 낮게 나옵니다. 흐름과 지역 간 비교로 보세요.',
      };
    },
  },
  {
    id: 'household-debt',
    group: 'realestate',
    title: '자금: 민간 부채',
    about:
      'GDP 대비 가계부채와 민간 비금융부문(가계+기업) 부채입니다(국제결제은행 BIS 기준). 가계부채가 소득보다 빨리 늘면 집값을 떠받치던 대출 여력이 줄고, 금리가 오를 때 충격이 커집니다. 한국은 미국보다 가계부채 비율이 높습니다.',
    source: 'BIS (FRED: QKRHAM770A, QUSHAM770A, QKRPAM770A), 한국은행 ECOS 151Y001',
    defaultOn: true,
    needs: () => [fred('QKRHAM770A', 'Q'), fred('QUSHAM770A', 'Q'), fred('QKRPAM770A', 'Q'), ecos('151Y001/Q/1000000')],
    build: (get) => {
      const kr = get('IND:FRED:QKRHAM770A'), us = get('IND:FRED:QUSHAM770A'), pr = get('IND:FRED:QKRPAM770A');
      const credit = get('IND:ECOS:151Y001/Q/1000000').map((p) => ({ ...p, value: p.value / 1000 })); // 십억원 → 조원
      return {
        lines: [
          { key: 'kr', label: '한국 가계부채 / GDP', color: C.a },
          { key: 'us', label: '미국 가계부채 / GDP', color: C.b },
          { key: 'pr', label: '한국 민간부채 / GDP', color: C.c, dash: true },
          { key: 'credit', label: '한국 가계신용 (조원)', color: C.muted, axis: 'right' },
        ],
        rows: joinSeries({ kr, us, pr, credit }),
        unit: '% GDP',
        rightUnit: '조원',
        latest: latestOf([
          { label: '한국 가계', pts: kr, unit: '%', freq: 'Q', digits: 1 },
          { label: '한국 민간', pts: pr, unit: '%', freq: 'Q', digits: 1 },
          { label: '가계신용', pts: credit, unit: '조원', freq: 'Q', digits: 0 },
        ]),
      };
    },
  },
  {
    id: 'liquidity',
    group: 'realestate',
    title: '자금: 통화량(M2)과 집값',
    about:
      'M2 통화량 증가율과 아파트 매매가격 상승률(1년 전 대비)입니다. 돈이 빠르게 풀리면 자산 가격이 뒤따라 오르는 경우가 많아, 두 선의 간격과 시차를 봅니다.',
    source: '한국은행 ECOS: 161Y005 (M2 평잔, 계절조정), 901Y062 (KB 아파트 매매가격지수)',
    defaultOn: true,
    needs: () => [ecos('161Y005/M/BBHS00'), ecos('901Y062/M/P63AC'), ecos('901Y062/M/P63ACA')],
    build: (get) => {
      const m2 = yoy(get('IND:ECOS:161Y005/M/BBHS00')), apt = yoy(get('IND:ECOS:901Y062/M/P63AC')), seoul = yoy(get('IND:ECOS:901Y062/M/P63ACA'));
      return {
        lines: [
          { key: 'm2', label: 'M2 증가율', color: C.e },
          { key: 'apt', label: '아파트값 (전국)', color: C.a },
          { key: 'seoul', label: '아파트값 (서울)', color: C.b },
        ],
        rows: joinSeries({ m2, apt, seoul }),
        unit: '% (1년)',
        refs: [{ y: 0, label: '' }],
        latest: latestOf([
          { label: 'M2', pts: m2, unit: '%', digits: 1 },
          { label: '전국 아파트', pts: apt, unit: '%', digits: 1 },
          { label: '서울 아파트', pts: seoul, unit: '%', digits: 1 },
        ]),
      };
    },
  },
  {
    id: 'supply',
    group: 'realestate',
    title: '공급: 인허가와 미분양',
    about:
      '수요와 자금만으로는 가격이 정해지지 않아 공급을 함께 봅니다. 주택 인허가는 2~3년 뒤 입주 물량의 선행지표이고, 미분양이 쌓이면 그 지역의 공급이 수요를 넘었다는 신호입니다. 인허가는 12개월 합계입니다.',
    source: '한국은행 ECOS: 901Y105 (주택건설인허가), 901Y074 (미분양주택, 국토교통부)',
    defaultOn: true,
    usesRegion: 'sido',
    needs: (p) => {
      const r = regionOf(p.region);
      return [ecos(`901Y105/M/${r.permit}`), ecos(`901Y074/M/${r.unsold}`)];
    },
    build: (get, p) => {
      const r = regionOf(p.region);
      const permits = get(`IND:ECOS:901Y105/M/${r.permit}`);
      const sum12 = permits.flatMap((x, i) => (i >= 11 ? [{ date: x.date, value: permits.slice(i - 11, i + 1).reduce((a, b) => a + b.value, 0) / 1000 }] : []));
      const unsold = get(`IND:ECOS:901Y074/M/${r.unsold}`).map((x) => ({ ...x, value: x.value / 1000 }));
      return {
        lines: [
          { key: 'permit', label: `${r.name} 인허가 (12개월 합)`, color: C.a, kind: 'area' },
          { key: 'unsold', label: `${r.name} 미분양`, color: C.d, axis: 'right' },
        ],
        rows: joinSeries({ permit: sum12, unsold }),
        unit: '천 호',
        rightUnit: '천 호',
        latest: latestOf([
          { label: '인허가 12개월', pts: sum12, unit: '천 호', digits: 1 },
          { label: '미분양', pts: unsold, unit: '천 호', digits: 1 },
        ]),
      };
    },
  },
  {
    id: 'housing-sentiment',
    group: 'realestate',
    title: '심리: 주택가격전망',
    about: '1년 뒤 집값이 오를지 묻는 소비자동향조사의 주택가격전망지수입니다. 100보다 크면 오를 거라는 가구가 더 많습니다. 실제 가격에 몇 달 앞서 움직이는 경우가 많습니다.',
    source: '한국은행 ECOS: 511Y002 FMFB',
    defaultOn: false,
    needs: () => [ecos('511Y002/M/FMFB/99988')],
    build: (get) => {
      const s = get('IND:ECOS:511Y002/M/FMFB/99988');
      return { lines: [{ key: 's', label: '주택가격전망 CSI', color: C.a }], rows: joinSeries({ s }), unit: '', refs: [{ y: 100, label: '기준 100' }], latest: latestOf([{ label: '주택가격전망', pts: s, unit: '', digits: 0 }]) };
    },
  },

  // ------------------------------------------------------------ stocks and risk
  {
    id: 'kospi-erp',
    group: 'stocks',
    title: '한국 주식 위험프리미엄 (KOSPI)',
    about:
      'KOSPI 이익수익률(1 ÷ PER)에서 국고채 10년 금리를 뺀 값입니다. 주식이 채권보다 얼마나 더 벌어 주리라 기대되는지를 보여 주는 가장 흔한 근사치로, 높을수록 주식이 상대적으로 싸고 낮을수록 비쌉니다(Fed 모형의 변형).',
    source: '한국은행 ECOS: 901Y014 (KOSPI PER), 721Y001',
    defaultOn: true,
    needs: () => [ecos('901Y014/M/1110000'), ecos('721Y001/M/5050000')],
    build: (get) => {
      const per = get('IND:ECOS:901Y014/M/1110000');
      const ey = per.filter((p) => p.value > 0).map((p) => ({ date: p.date, value: 100 / p.value }));
      const y10 = get('IND:ECOS:721Y001/M/5050000');
      const erp = combine(ey, y10, (a, b) => a - b);
      return {
        lines: [
          { key: 'erp', label: '위험프리미엄', color: C.a, kind: 'area' },
          { key: 'ey', label: '이익수익률 (1/PER)', color: C.b },
          { key: 'y10', label: '국고채 10년', color: C.muted, dash: true },
        ],
        rows: joinSeries({ erp, ey, y10 }),
        unit: '%',
        refs: [{ y: 0, label: '' }],
        latest: latestOf([
          { label: '위험프리미엄', pts: erp, unit: '%p', digits: 2 },
          { label: 'PER', pts: per, unit: '배', digits: 1 },
        ]),
      };
    },
  },
  {
    id: 'us-buffett',
    group: 'stocks',
    title: '미국 주식 시가총액 / GDP (버핏 지표)',
    about: '미국 기업 주식의 시장가치 합계를 명목 GDP로 나눈 값입니다. 경제 규모에 비해 주식이 얼마나 비싸게 거래되는지를 보며, 과거 평균보다 크게 높으면 장기 기대수익률이 낮아지는 경향이 있습니다.',
    source: 'FRED: NCBEILQ027S (연준 금융계정), GDP',
    defaultOn: true,
    needs: () => [fred('NCBEILQ027S', 'Q'), fred('GDP', 'Q')],
    build: (get) => {
      const ratio = combine(get('IND:FRED:NCBEILQ027S'), get('IND:FRED:GDP'), (m, g) => (g > 0 ? (m / 1000 / g) * 100 : null));
      const mean = ratio.length ? ratio.reduce((a, b) => a + b.value, 0) / ratio.length : null;
      return {
        lines: [{ key: 'r', label: '시가총액 / GDP', color: C.a, kind: 'area' }],
        rows: joinSeries({ r: ratio }),
        unit: '%',
        refs: mean ? [{ y: Math.round(mean), label: `기간 평균 ${Math.round(mean)}%` }] : undefined,
        latest: latestOf([{ label: '시가총액/GDP', pts: ratio, unit: '%', freq: 'Q', digits: 0 }]),
      };
    },
  },
  {
    id: 'risk-appetite',
    group: 'stocks',
    title: '위험 선호: 하이일드 스프레드와 VIX',
    about: '하이일드 회사채가 국채보다 더 받는 금리(신용 스프레드)와 S&P 500 옵션의 내재 변동성(VIX)입니다. 둘이 함께 뛰면 시장이 위험을 피하고 있다는 뜻이고, 낮게 눌려 있으면 낙관이 강한 것입니다.',
    source: 'FRED: BAMLH0A0HYM2 (ICE BofA), VIXCLS (월말)',
    defaultOn: true,
    needs: () => [fred('BAMLH0A0HYM2'), fred('VIXCLS')],
    build: (get) => {
      const hy = get('IND:FRED:BAMLH0A0HYM2'), vix = get('IND:FRED:VIXCLS');
      return {
        lines: [
          { key: 'hy', label: '하이일드 스프레드', color: C.d },
          { key: 'vix', label: 'VIX', color: C.a, axis: 'right' },
        ],
        rows: joinSeries({ hy, vix }),
        unit: '%p',
        rightUnit: 'VIX',
        latest: latestOf([
          { label: '하이일드', pts: hy, unit: '%p' },
          { label: 'VIX', pts: vix, unit: '', digits: 1 },
        ]),
      };
    },
  },
  {
    id: 'financial-conditions',
    group: 'stocks',
    title: '금융 여건 (시카고 연준 NFCI)',
    about: '금리·신용·주식·레버리지 105개 지표를 묶은 미국 금융 여건 지수입니다. 0보다 작으면 평균보다 돈 빌리기 쉬운(완화적) 상태, 크면 긴축적인 상태입니다.',
    source: 'FRED: NFCI (월말)',
    defaultOn: false,
    needs: () => [fred('NFCI')],
    build: (get) => {
      const n = get('IND:FRED:NFCI');
      return { lines: [{ key: 'n', label: 'NFCI', color: C.c, kind: 'area' }], rows: joinSeries({ n }), unit: '', refs: [{ y: 0, label: '평균' }], latest: latestOf([{ label: 'NFCI', pts: n, unit: '', digits: 2 }]) };
    },
  },

  // ------------------------------------------------------------ rates (added)
  {
    id: 'policy-path',
    group: 'rates',
    title: '시장이 예상하는 기준금리 방향',
    about:
      '2년 국채(한국은 3년) 금리는 앞으로 2~3년 기준금리가 평균 얼마일지에 대한 기대를 거의 그대로 담습니다. 그래서 이 금리에서 지금 기준금리를 빼면, 0보다 크면 시장이 인상을, 작으면 인하를 예상한다는 뜻입니다. 월가는 금리선물(CME FedWatch)로 같은 것을 보지만 선물 자료가 유료라, 무료로 받을 수 있는 이 차이로 대신합니다. 작은 기간 프리미엄이 섞여 있어 0 근처는 "동결"로 읽습니다.',
    source: 'FRED: DGS2, DFF (월말), 한국은행 ECOS: 721Y001, 722Y001',
    defaultOn: true,
    needs: () => [fred('DGS2'), fred('DFF'), ecos('721Y001/M/5020000'), ecos('722Y001/M/0101000')],
    build: (get) => {
      const us = combine(get('IND:FRED:DGS2'), get('IND:FRED:DFF'), (a, b) => a - b);
      const kr = combine(get('IND:ECOS:721Y001/M/5020000'), get('IND:ECOS:722Y001/M/0101000'), (a, b) => a - b);
      return {
        lines: [
          { key: 'us', label: '미국: 2년 국채 − 연방기금금리', color: C.a },
          { key: 'kr', label: '한국: 국고채 3년 − 기준금리', color: C.b },
        ],
        rows: joinSeries({ us, kr }),
        unit: '%p',
        refs: [{ y: 0, label: '0보다 크면 인상, 작으면 인하 기대' }],
        latest: latestOf([
          { label: '미국', pts: us, unit: '%p' },
          { label: '한국', pts: kr, unit: '%p' },
        ]),
      };
    },
  },
  {
    id: 'kr-us-gap',
    group: 'rates',
    title: '한미 금리차와 원/달러',
    about:
      '한국 금리에서 미국 금리를 뺀 값입니다. 미국 금리가 더 높으면(음수) 달러 자산의 이자가 더 많아 외국인 자금이 빠져나가기 쉽고 원화가 약해지는 압력이 생깁니다. 그래서 한국은행이 기준금리를 정할 때 늘 함께 보는 지표입니다. 원/달러 환율(오른쪽 축)을 같이 봅니다.',
    source: '한국은행 ECOS: 722Y001, 721Y001, FRED: DFF, DGS10, DEXKOUS (월말)',
    defaultOn: true,
    needs: () => [ecos('722Y001/M/0101000'), fred('DFF'), ecos('721Y001/M/5050000'), fred('DGS10'), fred('DEXKOUS')],
    build: (get) => {
      const policy = combine(get('IND:ECOS:722Y001/M/0101000'), get('IND:FRED:DFF'), (a, b) => a - b);
      const long = combine(get('IND:ECOS:721Y001/M/5050000'), get('IND:FRED:DGS10'), (a, b) => a - b);
      const fx = get('IND:FRED:DEXKOUS');
      return {
        lines: [
          { key: 'policy', label: '기준금리 차 (한국 − 미국)', color: C.a, kind: 'area' },
          { key: 'long', label: '10년 국채 금리차', color: C.b },
          { key: 'fx', label: '원/달러', color: C.ink, axis: 'right' },
        ],
        rows: joinSeries({ policy, long, fx }),
        unit: '%p',
        rightUnit: '원',
        refs: [{ y: 0, label: '' }],
        latest: latestOf([
          { label: '기준금리 차', pts: policy, unit: '%p' },
          { label: '10년물 차', pts: long, unit: '%p' },
          { label: '원/달러', pts: fx, unit: '원', digits: 1 },
        ]),
      };
    },
  },
  {
    id: 'neutral-rate',
    group: 'rates',
    title: '미국 실질 기준금리와 중립금리(r*)',
    about:
      '중립금리(r*)는 경기를 부양하지도 누르지도 않는 실질금리 수준입니다. 실질 기준금리(연방기금금리 − 근원 PCE 물가상승률)가 r*보다 높으면 통화정책이 긴축적이라 경기와 물가를 누르고, 낮으면 완화적입니다. 막대는 그 차이입니다(+ = 긴축). r*는 뉴욕연준이 분기마다 내는 Laubach-Williams 모형 추정치로, 추정 오차가 커서 1%p 안팎의 차이는 크게 읽지 않습니다.',
    source: '뉴욕연준 Laubach-Williams r* (분기, 단측 추정), FRED: DFF, PCEPILFE',
    defaultOn: true,
    needs: () => [lw('rstar'), fred('DFF'), fred('PCEPILFE')],
    build: (get) => {
      const rstar = get('IND:LW:rstar');
      const core = yoy(get('IND:FRED:PCEPILFE'));
      const real = combine(get('IND:FRED:DFF'), core, (a, b) => a - b);
      const stance = combine(real, rstar, (a, b) => a - b);
      return {
        lines: [
          { key: 'stance', label: '실질 기준금리 − r* (+ 긴축)', color: C.b, kind: 'bar' },
          { key: 'real', label: '실질 기준금리', color: C.a },
          { key: 'rstar', label: '중립금리 r*', color: C.ink, dash: true },
        ],
        rows: joinSeries({ stance, real, rstar }),
        unit: '%',
        refs: [{ y: 0, label: '' }],
        latest: latestOf([
          { label: '실질 기준금리', pts: real, unit: '%' },
          { label: 'r*', pts: rstar, unit: '%', freq: 'Q' },
          { label: '차이', pts: stance, unit: '%p', freq: 'Q' },
        ]),
      };
    },
  },
  {
    id: 'taylor',
    group: 'rates',
    title: '테일러 준칙 금리와 실제 기준금리',
    about:
      '테일러 준칙은 물가와 경기로 "적정 기준금리"를 계산하는 공식입니다: 중립금리 + 물가상승률 + 0.5 × (물가 − 2%) + 0.5 × 산출갭. 실제 기준금리가 이보다 낮으면 연준이 경기·물가에 비해 느슨하게, 높으면 빡빡하게 운용하는 것입니다. 물가는 근원 PCE, 중립금리와 산출갭은 뉴욕연준 Laubach-Williams 추정치를 씁니다(분기).',
    source: '뉴욕연준 Laubach-Williams (r*, 산출갭), FRED: PCEPILFE, DFF',
    defaultOn: true,
    needs: () => [lw('rstar'), lw('gap'), fred('PCEPILFE'), fred('DFF')],
    build: (get) => {
      const core = yoy(get('IND:FRED:PCEPILFE'));
      const base = combine(get('IND:LW:rstar'), core, (r, pi) => r + pi + 0.5 * (pi - 2));
      const taylor = combine(base, get('IND:LW:gap'), (b, g) => b + 0.5 * g);
      const ff = get('IND:FRED:DFF');
      const diff = combine(ff, taylor, (a, b) => a - b);
      return {
        lines: [
          { key: 'taylor', label: '테일러 준칙 금리', color: C.b },
          { key: 'ff', label: '실제 연방기금금리', color: C.ink },
        ],
        rows: joinSeries({ taylor, ff }),
        unit: '%',
        refs: [{ y: 0, label: '' }],
        latest: latestOf([
          { label: '테일러 금리', pts: taylor, unit: '%', freq: 'Q' },
          { label: '실제 기준금리', pts: ff, unit: '%' },
          { label: '실제 − 준칙', pts: diff, unit: '%p', freq: 'Q' },
        ]),
      };
    },
  },
  {
    id: 'kr-credit',
    group: 'rates',
    title: '한국 신용 스프레드',
    about:
      '회사채가 국채보다 얼마나 더 받는지(AA− 3년 − 국고채 3년), 비우량(BBB−)이 우량(AA−)보다 얼마나 더 받는지, 기업어음(CP)이 은행 양도성예금증서(CD)보다 얼마나 더 받는지입니다. 이 차이가 갑자기 벌어지면 돈을 빌려주는 쪽이 위험을 피한다는 뜻으로, 2022년 레고랜드 사태 때 CP−CD가 크게 뛰었습니다.',
    source: '한국은행 ECOS: 721Y001 (회사채 AA−·BBB−, 국고채 3년, CP·CD 91일)',
    defaultOn: true,
    needs: () => [ecos('721Y001/M/7020000'), ecos('721Y001/M/7030000'), ecos('721Y001/M/5020000'), ecos('721Y001/M/4020000'), ecos('721Y001/M/2010000')],
    build: (get) => {
      const aa = get('IND:ECOS:721Y001/M/7020000'), bbb = get('IND:ECOS:721Y001/M/7030000');
      const credit = combine(aa, get('IND:ECOS:721Y001/M/5020000'), (a, b) => a - b);
      const quality = combine(bbb, aa, (a, b) => a - b);
      const cp = combine(get('IND:ECOS:721Y001/M/4020000'), get('IND:ECOS:721Y001/M/2010000'), (a, b) => a - b);
      return {
        lines: [
          { key: 'credit', label: '회사채 AA− − 국고채 3년', color: C.a },
          { key: 'cp', label: 'CP − CD (91일)', color: C.d },
          { key: 'quality', label: 'BBB− − AA− (오른쪽 축)', color: C.b, axis: 'right' },
        ],
        rows: joinSeries({ credit, cp, quality }),
        unit: '%p',
        rightUnit: '%p',
        refs: [{ y: 0, label: '' }],
        latest: latestOf([
          { label: 'AA− − 국고', pts: credit, unit: '%p', digits: 3 },
          { label: 'CP − CD', pts: cp, unit: '%p' },
          { label: 'BBB− − AA−', pts: quality, unit: '%p', digits: 2 },
        ]),
      };
    },
  },

  // ------------------------------------------------------------ business cycle
  {
    id: 'kr-leading',
    group: 'cycle',
    title: '한국 경기선행·동행지수 순환변동치와 경기 국면',
    about:
      '통계청 경기종합지수에서 장기 추세를 뺀 순환변동치입니다. 100보다 크면 경기가 추세보다 좋은 것이고, 선행지수는 보통 6~9개월 앞서 움직입니다. 선행지수가 100 위에서 오르면 확장, 100 위에서 내리면 둔화, 100 아래에서 내리면 수축, 100 아래에서 오르면 회복으로 국면을 나눕니다(최근 3개월 변화 기준). 한국 경기 판단에 가장 널리 쓰는 공식 지표입니다.',
    source: '한국은행 ECOS: 901Y067 (통계청 경기종합지수)',
    defaultOn: true,
    needs: () => [ecos('901Y067/M/I16E'), ecos('901Y067/M/I16D')],
    build: (get) => {
      const lead = get('IND:ECOS:901Y067/M/I16E'), coin = get('IND:ECOS:901Y067/M/I16D');
      const last = lead.at(-1);
      const before = last ? lead.find((p) => p.date === addMonths(last.date, -3)) : undefined;
      const phase = last && before ? cyclePhase(last.value, last.value - before.value) : null;
      return {
        lines: [
          { key: 'lead', label: '선행지수 순환변동치', color: C.a },
          { key: 'coin', label: '동행지수 순환변동치', color: C.ink },
        ],
        rows: joinSeries({ lead, coin }),
        unit: '',
        refs: [{ y: 100, label: '추세 100' }],
        latest: [
          ...(phase && last ? [{ label: '경기 국면 (선행 기준)', value: phase, date: last.date.slice(0, 7) }] : []),
          ...latestOf([
            { label: '선행', pts: lead, unit: '', digits: 1 },
            { label: '동행', pts: coin, unit: '', digits: 1 },
          ]),
        ],
      };
    },
  },
  {
    id: 'us-recession',
    group: 'cycle',
    title: '미국 침체 신호: 샴 룰과 실업수당 청구',
    about:
      '샴 룰은 실업률의 3개월 평균이 지난 12개월 최저보다 0.5%p 이상 오르면 경기침체가 시작된 것으로 봅니다. 1970년 이후 침체를 거의 모두 실시간으로 잡아냈습니다. 신규 실업수당 청구(4주 평균)는 매주 나오는 가장 빠른 고용 지표로, 꾸준히 늘면 해고가 늘고 있다는 신호입니다.',
    source: 'FRED: SAHMREALTIME, IC4WSA (월말)',
    defaultOn: true,
    needs: () => [fred('SAHMREALTIME'), fred('IC4WSA')],
    build: (get) => {
      const sahm = get('IND:FRED:SAHMREALTIME');
      const claims = get('IND:FRED:IC4WSA').map((p) => ({ ...p, value: p.value / 10_000 }));
      return {
        lines: [
          { key: 'sahm', label: '샴 룰 지표', color: C.b, kind: 'area' },
          { key: 'claims', label: '신규 실업수당 청구 (4주 평균)', color: C.ink, axis: 'right' },
        ],
        rows: joinSeries({ sahm, claims }),
        unit: '%p',
        rightUnit: '만 건',
        refs: [{ y: 0.5, label: '침체 신호 0.5' }],
        latest: latestOf([
          { label: '샴 룰', pts: sahm, unit: '%p' },
          { label: '실업수당 청구', pts: claims, unit: '만 건', digits: 1 },
        ]),
      };
    },
  },
  {
    id: 'kr-exports',
    group: 'cycle',
    title: '한국 수출',
    about:
      '한국 경제는 수출 비중이 커서 수출 증가율이 경기와 코스피 이익을 가장 먼저 알려 줍니다. 막대는 1년 전 같은 달 대비 증가율, 선은 월 수출액입니다. 반도체가 수출의 큰 몫이라 반도체 경기와 함께 움직입니다.',
    source: '한국은행 ECOS: 901Y118 (관세청 수출입 총괄)',
    defaultOn: true,
    needs: () => [ecos('901Y118/M/T002')],
    build: (get) => {
      const amount = get('IND:ECOS:901Y118/M/T002');
      const growth = yoy(amount);
      const bn = amount.map((p) => ({ ...p, value: p.value / 100_000 }));
      return {
        lines: [
          { key: 'growth', label: '수출 증가율 (1년 전 대비)', color: C.a, kind: 'bar' },
          { key: 'bn', label: '수출액', color: C.ink, axis: 'right' },
        ],
        rows: joinSeries({ growth, bn }),
        unit: '%',
        rightUnit: '억 달러',
        refs: [{ y: 0, label: '' }],
        latest: latestOf([
          { label: '증가율', pts: growth, unit: '%', digits: 1 },
          { label: '수출액', pts: bn, unit: '억 달러', digits: 0 },
        ]),
      };
    },
  },
  {
    id: 'lending-standards',
    group: 'cycle',
    title: '은행 대출태도',
    about:
      '은행이 대출 기준을 조이는지 푸는지 묻는 서베이입니다. 은행이 돈줄을 조이면 몇 분기 뒤 투자와 소비가 줄어 경기가 꺾이는 경우가 많아, 신용 사이클을 읽는 핵심 지표입니다. 미국은 조인다는 은행 비율에서 푼다는 비율을 뺀 값(+ = 강화)이고, 한국은행 지수는 + 가 완화라 부호를 바꿔 같은 방향(+ = 강화)으로 그렸습니다.',
    source: 'FRED: DRTSCILM (연준 SLOOS, 대·중기업 대출), 한국은행 ECOS: 514Y001 (대출행태서베이)',
    defaultOn: true,
    needs: () => [fred('DRTSCILM', 'Q'), ecos('514Y001/Q/AA'), ecos('514Y001/Q/AA04')],
    build: (get) => {
      const us = get('IND:FRED:DRTSCILM');
      const kr = get('IND:ECOS:514Y001/Q/AA').map((p) => ({ ...p, value: -p.value }));
      const krHome = get('IND:ECOS:514Y001/Q/AA04').map((p) => ({ ...p, value: -p.value }));
      return {
        lines: [
          { key: 'us', label: '미국 기업대출 (강화 − 완화, %)', color: C.a },
          { key: 'kr', label: '한국 은행 종합 (부호 바꿈)', color: C.b },
          { key: 'krHome', label: '한국 가계 주택대출 (부호 바꿈)', color: C.d, dash: true },
        ],
        rows: joinSeries({ us, kr, krHome }),
        unit: '',
        refs: [{ y: 0, label: '+ 강화 / − 완화' }],
        latest: latestOf([
          { label: '미국', pts: us, unit: '', freq: 'Q', digits: 1 },
          { label: '한국 종합', pts: kr, unit: '', freq: 'Q', digits: 0 },
          { label: '한국 주택', pts: krHome, unit: '', freq: 'Q', digits: 0 },
        ]),
      };
    },
  },

  // ------------------------------------------------------------ real estate (added)
  {
    id: 'jeonse-growth',
    group: 'realestate',
    title: '전세가격 상승률',
    about:
      'KB 아파트 전세가격의 1년 상승률을 매매가격과 함께 봅니다. 전세는 실제 거주 수요라 투기 거품이 적고, 전세가가 오르면 매매가와의 차이(갭)가 줄어 매매 수요로 옮겨 가기 쉬워 "전세가가 매매가를 밀어 올린다"고 합니다. 전세 상승률이 매매 상승률보다 높게 이어지면 매매가 상승 압력으로 읽습니다.',
    source: '한국은행 ECOS: 901Y063, 901Y062 (KB 주택가격지수)',
    defaultOn: true,
    needs: () => [ecos('901Y063/M/P64AC'), ecos('901Y063/M/P64ACA'), ecos('901Y062/M/P63AC'), ecos('901Y062/M/P63ACA')],
    build: (get) => {
      const jn = yoy(get('IND:ECOS:901Y063/M/P64AC')), js = yoy(get('IND:ECOS:901Y063/M/P64ACA'));
      const sn = yoy(get('IND:ECOS:901Y062/M/P63AC')), ss = yoy(get('IND:ECOS:901Y062/M/P63ACA'));
      return {
        lines: [
          { key: 'js', label: '서울 아파트 전세', color: C.a },
          { key: 'jn', label: '전국 아파트 전세', color: C.c },
          { key: 'ss', label: '서울 아파트 매매', color: C.a, dash: true },
          { key: 'sn', label: '전국 아파트 매매', color: C.c, dash: true },
        ],
        rows: joinSeries({ js, jn, ss, sn }),
        unit: '% (1년)',
        refs: [{ y: 0, label: '' }],
        latest: latestOf([
          { label: '서울 전세', pts: js, unit: '%', digits: 1 },
          { label: '서울 매매', pts: ss, unit: '%', digits: 1 },
          { label: '전국 전세', pts: jn, unit: '%', digits: 1 },
          { label: '전국 매매', pts: sn, unit: '%', digits: 1 },
        ]),
      };
    },
  },
  {
    id: 'jeonse-ratio',
    group: 'realestate',
    title: '전세가율 (매매가 대비 전세가)',
    about:
      '아파트 중위 매매가격 대비 중위 전세가격의 비율입니다. 높으면 적은 돈으로 집을 살 수 있어(갭) 매수 수요가 붙기 쉽고 가격 하락을 받쳐 주며, 낮으면 매매가가 실거주 가치보다 많이 올랐다는 신호로 봅니다. 서울은 보통 전국보다 낮습니다.',
    source: '한국부동산원 R-ONE: 전국주택가격동향조사 (중위 매매가격 대비 전세가격, 아파트)',
    defaultOn: true,
    usesRegion: 'sido',
    needs: (p) => {
      const r = regionOf(p.region);
      return [rone('A_2024_00073', r.rone), rone('A_2024_00073', '500001')];
    },
    build: (get, p) => {
      const r = regionOf(p.region);
      const here = get(`IND:RONE:A_2024_00073/${r.rone}/100001`), all = get('IND:RONE:A_2024_00073/500001/100001');
      return {
        lines: [
          { key: 'here', label: `${r.name} 전세가율`, color: C.a },
          ...(r.rone === '500001' ? [] : [{ key: 'all', label: '전국 전세가율', color: C.muted, dash: true }]),
        ],
        rows: joinSeries(r.rone === '500001' ? { here } : { here, all }),
        unit: '%',
        latest: latestOf([
          { label: `${r.name}`, pts: here, unit: '%', digits: 1 },
          ...(r.rone === '500001' ? [] : [{ label: '전국', pts: all, unit: '%', digits: 1 }]),
        ]),
      };
    },
  },
  {
    id: 'rone-demand',
    group: 'realestate',
    title: '매수 심리: 매매수급·전세수급 동향',
    about:
      '한국부동산원이 중개업소에 매수자와 매도자 중 어느 쪽이 많은지 물어 만든 지수입니다(0~200). 100보다 크면 사려는 사람이, 작으면 팔려는 사람이 많습니다. 매매수급은 가격보다 먼저 움직이는 경우가 많고, 전세수급이 높으면 전세 매물이 부족해 전세가가 오르기 쉽습니다. KB 매수우위지수와 같은 성격이지만 KB 지수는 공개 API가 없어 부동산원 지수를 씁니다.',
    source: '한국부동산원 R-ONE: 전국주택가격동향조사 (매매·전세 수급동향, 아파트)',
    defaultOn: true,
    usesRegion: 'sido',
    needs: (p) => {
      const r = regionOf(p.region);
      return [rone('A_2024_00076', r.rone), rone('A_2024_00077', r.rone)];
    },
    build: (get, p) => {
      const r = regionOf(p.region);
      const buy = get(`IND:RONE:A_2024_00076/${r.rone}/100001`), rent = get(`IND:RONE:A_2024_00077/${r.rone}/100001`);
      return {
        lines: [
          { key: 'buy', label: `${r.name} 매매수급`, color: C.a },
          { key: 'rent', label: `${r.name} 전세수급`, color: C.d },
        ],
        rows: joinSeries({ buy, rent }),
        unit: '',
        refs: [{ y: 100, label: '균형 100' }],
        latest: latestOf([
          { label: '매매수급', pts: buy, unit: '', digits: 1 },
          { label: '전세수급', pts: rent, unit: '', digits: 1 },
        ]),
      };
    },
  },
  {
    id: 'trade-cycle',
    group: 'realestate',
    title: '거래량과 벌집순환 국면',
    about:
      '거래량은 가격보다 먼저 움직입니다. 벌집순환모형은 가격과 거래량의 조합으로 시장을 여섯 국면으로 나눕니다: 1 회복기(가격↑ 거래↑) → 2 활황기(가격↑ 거래↓) → 3 침체 진입기(가격→ 거래↓) → 4 침체기(가격↓ 거래↓) → 5 불황기(가격↓ 거래↑) → 6 회복 진입기(가격→ 거래↑) → 다시 1. 가격은 아파트 매매가격지수의 6개월 변화, 거래량은 최근 6개월 거래를 그 전 6개월과 비교합니다. 국면 판정은 참고용입니다.',
    source: '한국부동산원 R-ONE: 아파트거래현황, 아파트 매매가격지수',
    defaultOn: true,
    usesRegion: 'sido',
    needs: (p) => {
      const r = regionOf(p.region);
      return [rone('A_2024_00045', r.rone), ...(r.roneTrade ? [rone('A_2024_00549', r.roneTrade)] : [])];
    },
    build: (get, p) => {
      const r = regionOf(p.region);
      const price = changeOver(get(`IND:RONE:A_2024_00045/${r.rone}/100001`), 6);
      const deals = r.roneTrade ? get(`IND:RONE:A_2024_00549/${r.roneTrade}/100001`) : [];
      const six = rollingSum(deals, 6);
      const volume = changeOver(six, 6);
      const lp = price.at(-1), lv = volume.find((v) => v.date === lp?.date) ?? volume.at(-1);
      const phase = lp && lv ? honeycombPhase(lp.value, lv.value) : null;
      const k = deals.map((d) => ({ ...d, value: d.value / 1000 }));
      return {
        lines: [
          { key: 'k', label: `${r.name} 아파트 거래`, color: C.muted, kind: 'bar', axis: 'right' },
          { key: 'price', label: '가격 6개월 변화', color: C.a },
          { key: 'volume', label: '거래량 6개월 변화 (÷10)', color: C.b },
        ],
        rows: joinSeries({ k, price, volume: volume.map((v) => ({ ...v, value: v.value / 10 })) }),
        unit: '%',
        rightUnit: '천 건',
        refs: [{ y: 0, label: '' }],
        latest: [
          ...(phase && lp ? [{ label: '국면', value: phase.name, date: lp.date.slice(0, 7) }] : []),
          ...latestOf([
            { label: '가격 6개월', pts: price, unit: '%', digits: 2 },
            { label: '거래량 6개월', pts: volume, unit: '%', digits: 0 },
            { label: '월 거래', pts: k, unit: '천 건', digits: 1 },
          ]),
        ],
        note: r.roneTrade ? '거래량 변화는 가격과 같은 축에 그리려고 10으로 나눴습니다.' : `${r.name}은 아파트거래현황 자료가 없어(전남광주 통합) 거래량 없이 가격만 보여 줍니다.`,
      };
    },
  },
  {
    id: 'starts-pipeline',
    group: 'realestate',
    title: '공급 파이프라인: 착공 → 입주',
    about:
      '아파트는 착공하고 보통 2년 반~3년 뒤 입주합니다. 주거용 건축 착공 면적(12개월 합)을 30개월 뒤로 옮긴 점선이 앞으로 입주가 몰리거나 줄어드는 시기를 대략 보여 줍니다. 입주가 몰리면 전세가와 매매가가 눌리고, 끊기면 몇 년 뒤 공급 부족이 옵니다. 미분양(오른쪽 축)과 함께 봅니다. 전국 자료입니다.',
    source: '한국은행 ECOS: 901Y103 (건축착공, 주거용 연면적), 901Y074 (미분양주택)',
    defaultOn: true,
    needs: () => [ecos('901Y103/M/1/I47ABA'), ecos('901Y074/M/I410A')],
    build: (get) => {
      const starts = rollingSum(get('IND:ECOS:901Y103/M/1/I47ABA'), 12).map((p) => ({ ...p, value: p.value / 10_000 }));
      const landing = shiftMonths(starts, 30);
      const unsold = get('IND:ECOS:901Y074/M/I410A').map((p) => ({ ...p, value: p.value / 1000 }));
      return {
        lines: [
          { key: 'starts', label: '주거용 착공 (12개월 합)', color: C.a, kind: 'area' },
          { key: 'landing', label: '입주 추정 (착공 30개월 뒤)', color: C.b, dash: true },
          { key: 'unsold', label: '미분양 (전국)', color: C.d, axis: 'right' },
        ],
        rows: joinSeries({ starts, landing, unsold }),
        unit: '만 ㎡',
        rightUnit: '천 호',
        latest: latestOf([
          { label: '착공 12개월', pts: starts, unit: '만 ㎡', digits: 0 },
          { label: '미분양', pts: unsold, unit: '천 호', digits: 1 },
        ]),
      };
    },
  },
  {
    id: 'affordability',
    group: 'realestate',
    title: '주택구입부담 (K-HAI 방식, 자체 계산)',
    about:
      '평균 주택을 집값의 47.9%만큼 대출(20년, 원리금균등, 그해 평균 주택담보대출 금리)받아 살 때, 매달 갚는 돈이 가구 월소득의 몇 %인지를 25%를 100으로 놓고 나타냅니다. 주택금융공사 주택구입부담지수(K-HAI)의 계산 방식을 따랐지만, 공사는 중위 주택·중위 소득을 쓰고 여기서는 평균값을 써서 숫자는 공사 발표와 다릅니다. PIR과 달리 금리 변화가 반영됩니다. 100을 넘으면 소득의 4분의 1 넘게 원리금으로 나간다는 뜻입니다.',
    source: '한국은행 ECOS: 291Y524, 901Y106, 903Y201·903Y001(또는 903Y206·903Y006), 121Y006',
    defaultOn: true,
    usesRegion: 'sido',
    usesIncome: true,
    needs: (p) => [...indicatorById('pir')!.needs(p), ecos('121Y006/M/BECBLA0302')],
    build: (get, p) => {
      const r = regionOf(p.region);
      const value = get(`IND:ECOS:291Y524/A/${r.value}`);
      const stock = get(`IND:ECOS:901Y106/A/${r.stock}`);
      const [older, newer] = p.incomeBase === 'region' ? [`903Y001/A/T01/A0100/${r.income}/C04`, `903Y201/A/T01/A0100/${r.income}/C04`] : [`903Y006/A/T01/A0100/${p.incomeBase}/C04`, `903Y206/A/T01/A0100/${p.incomeBase}/C04`];
      const income = shiftYears(splice(get(`IND:ECOS:${older}`), get(`IND:ECOS:${newer}`)), -1);
      const avgValue = combine(value, stock, (v, s) => (s > 0 ? (v * 1e9) / (s * 1e3) / 1e4 : null));
      const rate = yearlyMean(get('IND:ECOS:121Y006/M/BECBLA0302'));
      const hai = avgValue.flatMap((v) => {
        const i = income.find((x) => x.date === v.date), rt = rate.find((x) => x.date === v.date);
        return i && rt && i.value > 0 ? [{ date: v.date, value: affordability(v.value, i.value, rt.value) }] : [];
      });
      return {
        lines: [
          { key: 'hai', label: `${r.name} 주택구입부담`, color: C.a, kind: 'bar' },
          { key: 'rate', label: '주택담보대출 금리 (연평균)', color: C.ink, axis: 'right' },
        ],
        rows: joinSeries({ hai, rate: rate.filter((x) => hai.some((h) => h.date === x.date)) }),
        unit: '',
        rightUnit: '%',
        refs: [{ y: 100, label: '소득의 25%' }],
        latest: latestOf([
          { label: '부담지수', pts: hai, unit: '', freq: 'A', digits: 0 },
          { label: '대출금리', pts: rate, unit: '%', freq: 'A', digits: 2 },
        ]),
      };
    },
  },

  // ------------------------------------------------------------ liquidity and flows
  {
    id: 'us-net-liquidity',
    group: 'liquidity',
    title: '미국 순유동성: 연준 자산 − TGA − 역레포',
    about:
      '연준이 푼 돈(총자산) 가운데 재무부 계좌(TGA)에 묶여 있거나 역레포로 연준에 다시 맡겨진 돈을 뺀 "시장에 실제로 도는 돈"입니다. 월가에서 주식·코인 같은 위험자산과 함께 많이 봅니다. 재무부가 국채를 많이 찍어 TGA를 채우면 시장 돈이 빨려 들어가고, 역레포 잔액은 시장으로 풀려 나올 수 있는 여력입니다. 점선은 은행 지급준비금입니다.',
    source: 'FRED: WALCL, WTREGEN, RRPONTSYD, WRESBAL (월말)',
    defaultOn: true,
    needs: () => [fred('WALCL'), fred('WTREGEN'), fred('RRPONTSYD'), fred('WRESBAL')],
    build: (get) => {
      const assets = get('IND:FRED:WALCL').map((p) => ({ ...p, value: p.value / 1e6 }));
      const tga = get('IND:FRED:WTREGEN').map((p) => ({ ...p, value: p.value / 1e6 }));
      const rrp = get('IND:FRED:RRPONTSYD').map((p) => ({ ...p, value: p.value / 1e3 }));
      const reserves = get('IND:FRED:WRESBAL').map((p) => ({ ...p, value: p.value / 1e6 }));
      const net = combine(combine(assets, tga, (a, b) => a - b), rrp, (a, b) => a - b);
      return {
        lines: [
          { key: 'net', label: '순유동성', color: C.a, kind: 'area' },
          { key: 'assets', label: '연준 총자산', color: C.ink },
          { key: 'reserves', label: '지급준비금', color: C.c, dash: true },
          { key: 'tga', label: 'TGA (재무부 계좌)', color: C.b, axis: 'right' },
          { key: 'rrp', label: '역레포', color: C.d, axis: 'right' },
        ],
        rows: joinSeries({ net, assets, reserves, tga, rrp }),
        unit: '조 달러',
        rightUnit: '조 달러',
        latest: latestOf([
          { label: '순유동성', pts: net, unit: '조 달러', digits: 2 },
          { label: 'TGA', pts: tga, unit: '조 달러', digits: 2 },
          { label: '역레포', pts: rrp, unit: '조 달러', digits: 2 },
          { label: '지급준비금', pts: reserves, unit: '조 달러', digits: 2 },
        ]),
      };
    },
  },
  {
    id: 'us-cash',
    group: 'liquidity',
    title: '미국 대기자금: MMF',
    about:
      '머니마켓펀드(MMF)는 주식·채권에 들어가지 않고 기다리는 현금이 모이는 곳이라 "대기자금"으로 봅니다. 잔액이 사상 최대여도 금리가 높으면 이자를 받으며 머무르고, 금리가 내려가면 일부가 위험자산으로 옮겨 갈 여력으로 읽습니다. 분기 자료는 전체 MMF(연준 금융계정), 월 자료는 개인 MMF입니다.',
    source: 'FRED: MMMFFAQ027S (전체, 분기), WRMFNS (개인, 월)',
    defaultOn: true,
    needs: () => [fred('MMMFFAQ027S', 'Q'), fred('WRMFNS')],
    build: (get) => {
      const total = get('IND:FRED:MMMFFAQ027S').map((p) => ({ ...p, value: p.value / 1e6 }));
      const retail = get('IND:FRED:WRMFNS').map((p) => ({ ...p, value: p.value / 1e3 }));
      return {
        lines: [
          { key: 'total', label: 'MMF 전체 (분기)', color: C.a, kind: 'area' },
          { key: 'retail', label: '개인 MMF (월)', color: C.b },
        ],
        rows: joinSeries({ total, retail }),
        unit: '조 달러',
        latest: latestOf([
          { label: 'MMF 전체', pts: total, unit: '조 달러', freq: 'Q', digits: 2 },
          { label: '개인 MMF', pts: retail, unit: '조 달러', digits: 2 },
        ]),
      };
    },
  },
  {
    id: 'us-margin',
    group: 'liquidity',
    title: '미국 신용(빚투) 규모',
    about:
      '증권사가 고객에게 빌려준 돈(신용융자에 해당)과 그것이 주식 시가총액의 몇 %인지입니다. 빚을 내 투자하는 돈이 빠르게 늘면 상승장의 연료가 되지만, 하락할 때 반대매매로 낙폭을 키웁니다.',
    source: 'FRED: BOGZ1FL663067003Q (연준 금융계정, 증권사의 고객 신용), NCBEILQ027S',
    defaultOn: false,
    needs: () => [fred('BOGZ1FL663067003Q', 'Q'), fred('NCBEILQ027S', 'Q')],
    build: (get) => {
      const margin = get('IND:FRED:BOGZ1FL663067003Q');
      const share = combine(margin, get('IND:FRED:NCBEILQ027S'), (a, b) => (b > 0 ? (a / b) * 100 : null));
      // 백만 달러 → 억 달러
      const bn = margin.map((p) => ({ ...p, value: p.value / 100 }));
      return {
        lines: [
          { key: 'bn', label: '고객 신용', color: C.a, kind: 'area' },
          { key: 'share', label: '시가총액 대비', color: C.ink, axis: 'right' },
        ],
        rows: joinSeries({ bn, share }),
        unit: '억 달러',
        rightUnit: '%',
        latest: latestOf([
          { label: '고객 신용', pts: bn, unit: '억 달러', freq: 'Q', digits: 0 },
          { label: '시가총액 대비', pts: share, unit: '%', freq: 'Q', digits: 2 },
        ]),
      };
    },
  },
  {
    id: 'kr-idle-money',
    group: 'liquidity',
    title: '한국 대기자금: MMF · 예금 · 투자자예탁금',
    about:
      '언제든 투자로 옮겨 갈 수 있는 돈의 크기입니다. MMF와 요구불·수시입출식 예금은 바로 꺼낼 수 있는 단기 자금이고, 투자자예탁금은 증권 계좌에서 주식을 사려고 기다리는 돈입니다. 정기예금은 금리가 내려 만기 때 다시 맡기지 않으면 주식·부동산으로 옮겨 갈 수 있는 잠재 자금입니다. 이 돈이 늘어 있고 금리가 내려가는 시기에는 자산 가격을 밀어 올릴 여력이 큽니다.',
    source: '한국은행 ECOS: 161Y008 (M2 상품별, 말잔), 104Y015 (예금은행 정기예금), 901Y056 (증시주변자금)',
    defaultOn: true,
    needs: () => [ecos('161Y008/M/BBGA04'), ecos('161Y008/M/BBGA02'), ecos('161Y008/M/BBGA03'), ecos('104Y015/M/BDAA31'), ecos('901Y056/M/S23A')],
    build: (get) => {
      const jo = (pts: Point[], div: number) => pts.map((p) => ({ ...p, value: p.value / div }));
      const mmf = jo(get('IND:ECOS:161Y008/M/BBGA04'), 1000);
      const demand = jo(sumAll([get('IND:ECOS:161Y008/M/BBGA02'), get('IND:ECOS:161Y008/M/BBGA03')]), 1000);
      const time = jo(get('IND:ECOS:104Y015/M/BDAA31'), 1000);
      const deposit = jo(get('IND:ECOS:901Y056/M/S23A'), 1e12);
      return {
        lines: [
          { key: 'demand', label: '요구불 + 수시입출식 예금', color: C.c },
          { key: 'time', label: '정기예금 (예금은행)', color: C.muted, dash: true },
          { key: 'mmf', label: 'MMF', color: C.a, axis: 'right' },
          { key: 'deposit', label: '투자자예탁금', color: C.b, axis: 'right' },
        ],
        rows: joinSeries({ demand, time, mmf, deposit }),
        unit: '조원',
        rightUnit: '조원',
        latest: latestOf([
          { label: '요구불·수시입출식', pts: demand, unit: '조원', digits: 0 },
          { label: '정기예금', pts: time, unit: '조원', digits: 0 },
          { label: 'MMF', pts: mmf, unit: '조원', digits: 1 },
          { label: '투자자예탁금', pts: deposit, unit: '조원', digits: 1 },
        ]),
      };
    },
  },
  {
    id: 'kr-market-leverage',
    group: 'liquidity',
    title: '한국 증시 자금: 예탁금과 신용융자',
    about:
      '투자자예탁금은 주식을 살 수 있게 대기 중인 돈, 신용융자는 증권사에서 빌려 주식을 산 돈(빚투)입니다. 예탁금 대비 신용융자 비율이 높을수록 개인이 빚을 많이 지고 있다는 뜻으로, 시장이 꺾일 때 반대매매가 쏟아질 위험이 커집니다. 위탁매매 미수금도 단기 빚투의 크기입니다.',
    source: '한국은행 ECOS: 901Y056 (금융투자협회 증시주변자금)',
    defaultOn: true,
    needs: () => [ecos('901Y056/M/S23A'), ecos('901Y056/M/S23E'), ecos('901Y056/M/S23D')],
    build: (get) => {
      const deposit = get('IND:ECOS:901Y056/M/S23A').map((p) => ({ ...p, value: p.value / 1e12 }));
      const credit = get('IND:ECOS:901Y056/M/S23E').map((p) => ({ ...p, value: p.value / 1e12 }));
      const unpaid = get('IND:ECOS:901Y056/M/S23D').map((p) => ({ ...p, value: p.value / 1e12 }));
      const ratio = combine(credit, deposit, (c, d) => (d > 0 ? (c / d) * 100 : null));
      return {
        lines: [
          { key: 'deposit', label: '투자자예탁금', color: C.a, kind: 'area' },
          { key: 'credit', label: '신용융자 잔고', color: C.b },
          { key: 'unpaid', label: '위탁매매 미수금', color: C.d },
          { key: 'ratio', label: '신용융자 / 예탁금', color: C.ink, axis: 'right' },
        ],
        rows: joinSeries({ deposit, credit, unpaid, ratio }),
        unit: '조원',
        rightUnit: '%',
        latest: latestOf([
          { label: '예탁금', pts: deposit, unit: '조원', digits: 1 },
          { label: '신용융자', pts: credit, unit: '조원', digits: 1 },
          { label: '신용/예탁', pts: ratio, unit: '%', digits: 0 },
        ]),
      };
    },
  },
  {
    id: 'kr-investor-flows',
    group: 'liquidity',
    title: '한국 투자자별 순매수 (KOSPI)',
    about:
      '개인·외국인·기관이 주식을 산 금액에서 판 금액을 뺀 값입니다. 그래프는 최근 12개월을 더한 값이라 어느 쪽으로 꾸준히 사거나 팔았는지가 보이고, 최근 값에는 그달의 순매수가 나옵니다. 외국인 순매수는 코스피 방향과 가장 밀접하고, 개인은 하락장에서 사고 상승장에서 파는 경우가 많습니다.',
    source: '한국은행 ECOS: 901Y055 (투자자별 주식거래, 거래대금)',
    defaultOn: true,
    needs: () => [ecos('901Y055/M/S22CB/VA'), ecos('901Y055/M/S22CC/VA'), ecos('901Y055/M/S22CA/VA')],
    build: (get) => {
      const jo = (id: string) => get(id).map((p) => ({ ...p, value: p.value / 1e6 }));
      const retail = jo('IND:ECOS:901Y055/M/S22CB/VA'), foreign = jo('IND:ECOS:901Y055/M/S22CC/VA'), inst = jo('IND:ECOS:901Y055/M/S22CA/VA');
      // Twelve-month sums show which way each group has leaned; the month itself is in the latest values
      const y = (pts: Point[]) => rollingSum(pts, 12);
      return {
        lines: [
          { key: 'retail', label: '개인 (12개월 누적)', color: C.a },
          { key: 'foreign', label: '외국인 (12개월 누적)', color: C.b },
          { key: 'inst', label: '기관 (12개월 누적)', color: C.c },
        ],
        rows: joinSeries({ retail: y(retail), foreign: y(foreign), inst: y(inst) }),
        unit: '조원',
        refs: [{ y: 0, label: '' }],
        latest: latestOf([
          { label: '개인 (월)', pts: retail, unit: '조원', digits: 1 },
          { label: '외국인 (월)', pts: foreign, unit: '조원', digits: 1 },
          { label: '기관 (월)', pts: inst, unit: '조원', digits: 1 },
          { label: '외국인 12개월', pts: y(foreign), unit: '조원', digits: 1 },
        ]),
      };
    },
  },
];

export const indicatorById = (id: string) => INDICATORS.find((i) => i.id === id);

// ---------------------------------------------------------------- preferences

export interface AnalysisPrefs {
  /** Indicators the user turned off (or on, when off by default) */
  off: string[];
  on: string[];
  region: string;
  incomeBase: IncomeBase;
  /** Years shown; 0 = everything */
  years: number;
}

export const RANGE_YEARS = [5, 10, 20, 0] as const;

export function readPrefs(raw: unknown): AnalysisPrefs {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const ids = new Set(INDICATORS.map((i) => i.id));
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && ids.has(x)) : []);
  const region = typeof o.region === 'string' && (REGIONS.some((r) => r.code === o.region) || /^\d{5}$/.test(o.region)) ? o.region : '11';
  const incomeBase = INCOME_BASES.some((b) => b.key === o.incomeBase) ? (o.incomeBase as IncomeBase) : 'region';
  const years = RANGE_YEARS.includes(o.years as (typeof RANGE_YEARS)[number]) ? (o.years as number) : 10;
  return { off: list(o.off), on: list(o.on), region, incomeBase, years };
}

export const isOn = (ind: Indicator, prefs: AnalysisPrefs) => (ind.defaultOn ? !prefs.off.includes(ind.id) : prefs.on.includes(ind.id));

/** Prefs with one indicator switched */
export function toggled(prefs: AnalysisPrefs, id: string, on: boolean): AnalysisPrefs {
  const ind = indicatorById(id);
  if (!ind) return prefs;
  const off = prefs.off.filter((x) => x !== id);
  const onList = prefs.on.filter((x) => x !== id);
  if (ind.defaultOn && !on) off.push(id);
  if (!ind.defaultOn && on) onList.push(id);
  return { ...prefs, off, on: onList };
}

// ---------------------------------------------------------------- parsers

/** ECOS StatisticSearch of any cycle: "202501" → 2025-01-01, "2025Q2" → 2025-04-01, "2025" → 2025-01-01. */
export function parseEcosAny(body: unknown): { points: Point[]; error: string | null } {
  const b = body as { StatisticSearch?: { row?: { TIME?: string; DATA_VALUE?: string }[] }; RESULT?: { CODE?: string; MESSAGE?: string } } | null;
  if (!b?.StatisticSearch) return { points: [], error: b?.RESULT?.CODE === 'INFO-200' ? null : (b?.RESULT?.MESSAGE ?? null) };
  const points = (b.StatisticSearch.row ?? []).flatMap((r) => {
    const v = Number(r.DATA_VALUE);
    if (r.DATA_VALUE === '' || r.DATA_VALUE == null || !Number.isFinite(v)) return [];
    const t = r.TIME ?? '';
    const date = /^\d{6}$/.test(t) ? `${t.slice(0, 4)}-${t.slice(4)}-01` : /^\d{4}Q[1-4]$/.test(t) ? `${t.slice(0, 4)}-${String((Number(t[5]) - 1) * 3 + 1).padStart(2, '0')}-01` : /^\d{4}$/.test(t) ? `${t}-01-01` : null;
    return date ? [{ date, value: v }] : [];
  });
  return { points: points.sort((a, b) => a.date.localeCompare(b.date)), error: null };
}

/** KOSIS statisticsParameterData (json): rows with PRD_DE "202501", C1 region, C2 age, DT value. */
export function parseKosis(body: unknown): { rows: { region: string; age: string; date: string; value: number }[]; error: string | null; code: string | null } {
  if (!Array.isArray(body)) {
    const e = body as { err?: unknown; errMsg?: unknown } | null;
    const code = e?.err == null ? null : String(e.err);
    return { rows: [], code, error: typeof e?.errMsg === 'string' ? e.errMsg : code ? `KOSIS 오류 ${code}` : null };
  }
  const rows = body.flatMap((r: Record<string, unknown>) => {
    const prd = String(r.PRD_DE ?? '');
    const v = Number(String(r.DT ?? '').replace(/,/g, ''));
    if (!/^\d{6}$/.test(prd) || !Number.isFinite(v)) return [];
    return [{ region: String(r.C1 ?? ''), age: String(r.C2 ?? ''), date: `${prd.slice(0, 4)}-${prd.slice(4)}-01`, value: v }];
  });
  return { rows, error: null, code: null };
}

/** 한국부동산원 R-ONE SttsApiTblData (json): rows with WRTTIME_IDTFR_ID "202607" and DTA_VAL. */
export function parseRone(body: unknown): { points: Point[]; total: number; error: string | null; code: string | null } {
  const b = body as { SttsApiTblData?: [{ head?: [{ list_total_count?: number }, { RESULT?: { CODE?: string; MESSAGE?: string } }] }, { row?: Record<string, unknown>[] }?]; RESULT?: { CODE?: string; MESSAGE?: string } } | null;
  const result = b?.SttsApiTblData?.[0]?.head?.[1]?.RESULT ?? b?.RESULT;
  const code = result?.CODE ?? null;
  if (!b?.SttsApiTblData) return { points: [], total: 0, code, error: code === 'INFO-200' ? null : (result?.MESSAGE ?? 'R-ONE 응답을 읽지 못했습니다') };
  const total = Number(b.SttsApiTblData[0]?.head?.[0]?.list_total_count ?? 0);
  const points = (b.SttsApiTblData[1]?.row ?? []).flatMap((r) => {
    const t = String(r.WRTTIME_IDTFR_ID ?? '');
    const v = r.DTA_VAL;
    if (!/^\d{6}$/.test(t) || v === null || v === undefined || v === '' || !Number.isFinite(Number(v))) return [];
    return [{ date: `${t.slice(0, 4)}-${t.slice(4)}-01`, value: Number(v) }];
  });
  return { points: points.sort((a, b2) => a.date.localeCompare(b2.date)), total, error: null, code };
}

/**
 * The New York Fed's Laubach-Williams sheet "data": a header row with "Date" and, under
 * "One-Sided Estimates", "rstar" and "Output gap" (the first of each, the one-sided ones).
 */
export function parseLw(rows: unknown[][]): { rstar: Point[]; gap: Point[] } {
  const text = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : '');
  const h = rows.findIndex((r) => r?.some((c) => text(c) === 'date') && r.some((c) => text(c) === 'rstar'));
  if (h < 0) return { rstar: [], gap: [] };
  const head = rows[h];
  const di = head.findIndex((c) => text(c) === 'date');
  const ri = head.findIndex((c) => text(c) === 'rstar');
  const gi = head.findIndex((c) => text(c) === 'output gap');
  const dateOf = (v: unknown): string | null => {
    const d = v instanceof Date ? v.toISOString() : typeof v === 'string' ? v : null;
    return d && /^\d{4}-\d{2}-\d{2}/.test(d) ? `${d.slice(0, 7)}-01` : null;
  };
  const rstar: Point[] = [], gap: Point[] = [];
  for (const r of rows.slice(h + 1)) {
    const date = dateOf(r?.[di]);
    if (!date) continue;
    if (typeof r[ri] === 'number') rstar.push({ date, value: r[ri] as number });
    if (gi >= 0 && typeof r[gi] === 'number') gap.push({ date, value: r[gi] as number });
  }
  return { rstar, gap };
}

/** The ACM sheet ("DATE", "ACMY01", ...) → month-start points per column. Dates read "30-Sep-2026". */
export function parseAcm(rows: (number | string)[][], excelDate: (n: number) => string): Map<string, Point[]> {
  const head = (rows[0] ?? []).map((h) => String(h).trim().toUpperCase());
  const di = head.indexOf('DATE');
  const out = new Map<string, Point[]>();
  if (di < 0) return out;
  const months: Record<string, string> = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };
  const dateOf = (v: number | string | undefined): string | null => {
    if (typeof v === 'number') return `${excelDate(v).slice(0, 7)}-01`;
    const m = String(v ?? '').match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
    return m && months[m[2].toUpperCase()] ? `${m[3]}-${months[m[2].toUpperCase()]}-01` : null;
  };
  for (const r of rows.slice(1)) {
    const date = dateOf(r?.[di]);
    if (!date) continue;
    head.forEach((h, c) => {
      if (c === di || !h) return;
      const v = r[c];
      if (typeof v !== 'number' || !Number.isFinite(v)) return;
      const list = out.get(h) ?? [];
      list.push({ date, value: v });
      out.set(h, list);
    });
  }
  return out;
}

/** Points inside the last `years` years of `today` (0: all). */
export function clip(rows: Record<string, number | string | null>[], years: number, today: string) {
  if (!years) return rows;
  const from = `${Number(today.slice(0, 4)) - years}${today.slice(4, 7)}-01`;
  return rows.filter((r) => String(r.date) >= from);
}
