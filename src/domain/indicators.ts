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

export type IndicatorSource = 'FRED' | 'ECOS' | 'KOSIS' | 'ACM';
export type Freq = 'M' | 'Q' | 'A';

export interface Point {
  date: string;
  value: number;
}

/** One series to load. `id` is also its storage key (PriceDaily.symbol). */
export interface SeriesReq {
  id: string;
  source: IndicatorSource;
  /** FRED: series id · ECOS: "STAT/CYCLE/ITEM1[/ITEM2...]" · KOSIS: "orgId/tblId/itmId/objL1/objL2" · ACM: column (ACMY10, ACMTP10, ACMRNY10) */
  code: string;
  freq: Freq;
}

const fred = (code: string, freq: Freq = 'M'): SeriesReq => ({ id: `IND:FRED:${code}`, source: 'FRED', code, freq });
const ecos = (code: string): SeriesReq => {
  const cycle = code.split('/')[1] as Freq;
  return { id: `IND:ECOS:${code}`, source: 'ECOS', code, freq: cycle };
};
const acm = (col: string): SeriesReq => ({ id: `IND:ACM:${col}`, source: 'ACM', code: col, freq: 'M' });
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
}

export const REGIONS: Region[] = [
  { code: '00', name: '전국', value: 'REG00', stock: 'HALL', income: 'B0500', unsold: 'I410A', permit: 'ALL', kosis: ['00'] },
  { code: '11', name: '서울', value: 'REG11', stock: 'HSEO', income: 'B0511', unsold: 'I410B', permit: 'SEO', kosis: ['11'] },
  { code: '41', name: '경기', value: 'REG41', stock: 'HGYE', income: 'B0531', unsold: 'I410I', permit: 'GYE', kosis: ['41'] },
  { code: '28', name: '인천', value: 'REG28', stock: 'HINC', income: 'B0523', unsold: 'I410E', permit: 'INC', kosis: ['28'] },
  { code: '26', name: '부산', value: 'REG26', stock: 'HBUS', income: 'B0521', unsold: 'I410C', permit: 'BUS', kosis: ['26'] },
  { code: '27', name: '대구', value: 'REG27', stock: 'HDEG', income: 'B0522', unsold: 'I410D', permit: 'DEG', kosis: ['27'] },
  { code: '29', name: '광주', value: 'REG29', stock: 'HGWA', income: 'B0524', unsold: 'I410F', permit: 'GWA', kosis: ['29'] },
  { code: '30', name: '대전', value: 'REG30', stock: 'HDEJ', income: 'B0525', unsold: 'I410G', permit: 'DEJ', kosis: ['30'] },
  { code: '31', name: '울산', value: 'REG31', stock: 'HULS', income: 'B0526', unsold: 'I410H', permit: 'ULS', kosis: ['31'] },
  { code: '36', name: '세종', value: 'REG36', stock: 'HGAN', income: 'B0529', unsold: 'I410L', permit: 'SEJ', kosis: ['36'] },
  { code: '42', name: '강원', value: 'REG42', stock: 'HSEJ', income: 'B0532', unsold: 'I410J', permit: 'GAN', kosis: ['51', '42'] },
  { code: '43', name: '충북', value: 'REG43', stock: 'HCHB', income: 'B0533', unsold: 'I410K', permit: 'CHB', kosis: ['43'] },
  { code: '44', name: '충남', value: 'REG44', stock: 'HCHN', income: 'B0534', unsold: 'I410S', permit: 'CHN', kosis: ['44'] },
  { code: '45', name: '전북', value: 'REG45', stock: 'HJNB', income: 'B0535', unsold: 'I410M', permit: 'JNB', kosis: ['52', '45'] },
  { code: '46', name: '전남', value: 'REG46', stock: 'HJNN', income: 'B0536', unsold: 'I410N', permit: 'JNN', kosis: ['46'] },
  { code: '47', name: '경북', value: 'REG47', stock: 'HKYB', income: 'B0537', unsold: 'I410O', permit: 'KYB', kosis: ['47'] },
  { code: '48', name: '경남', value: 'REG48', stock: 'HKYN', income: 'B0538', unsold: 'I410P', permit: 'KYN', kosis: ['48'] },
  { code: '50', name: '제주', value: 'REG51', stock: 'HJEJ', income: 'B0539', unsold: 'I410Q', permit: 'JEJ', kosis: ['50'] },
];
// ECOS 901Y106 names 강원 "HSEJ" and 세종 "HGAN" (as its item list reads); kept as published.

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

export type Group = 'rates' | 'realestate' | 'stocks';
export const GROUPS: { key: Group; label: string }[] = [
  { key: 'rates', label: '금리' },
  { key: 'realestate', label: '부동산' },
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

const C = { a: 'var(--series-1)', b: 'var(--series-2)', c: 'var(--series-3)', d: 'var(--series-4)', e: 'var(--series-5)', f: 'var(--series-6)', ink: 'var(--ink)', muted: 'var(--muted)' };

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
      '시장의 10년 국채금리(검은 선)를 앞으로 10년간 예상되는 단기금리의 평균(기준금리 경로에 대한 기대)과, 장기채를 들고 있는 대가로 더 받는 기간 프리미엄으로 나눕니다. 두 부분은 뉴욕연준 ACM 모형의 추정치입니다. 금리가 오를 때 어느 쪽이 올렸는지 보면, 연준의 긴축 기대 때문인지(기대 단기금리) 재정·수급 불안 때문인지(기간 프리미엄) 구분할 수 있습니다. 두 부분의 합과 시장 금리 사이에 남는 몇 bp는 모형 잔차입니다.',
    source: '뉴욕연준 ACM Term Premium (월말), FRED: DGS10, 연방기금금리 (월말)',
    defaultOn: true,
    needs: () => [acm('ACMTP10'), acm('ACMRNY10'), fred('DGS10'), fred('DFF')],
    build: (get) => {
      const n = get('IND:FRED:DGS10'), tp = get('IND:ACM:ACMTP10'), rn = get('IND:ACM:ACMRNY10'), ff = get('IND:FRED:DFF');
      // What the two parts leave of the market yield: the fit error of the model, and that ACM
      // models zero-coupon yields while DGS10 is the yield of coupon-paying bonds
      const fitted = combine(rn, tp, (a, b) => a + b);
      const residual = combine(n, fitted, (a, b) => a - b);
      return {
        lines: [
          { key: 'rn', label: '기대 단기금리 (10년 평균)', color: C.a, kind: 'area' },
          { key: 'tp', label: '기간 프리미엄', color: C.b, kind: 'bar' },
          { key: 'n', label: '10년 국채금리 (시장)', color: C.ink },
          { key: 'ff', label: '연방기금금리', color: C.muted, dash: true },
        ],
        rows: joinSeries({ rn, tp, n, ff }),
        unit: '%',
        refs: [{ y: 0, label: '' }],
        latest: latestOf([
          { label: '10년 금리 (시장)', pts: n, unit: '%' },
          { label: '기대 단기금리', pts: rn, unit: '%' },
          { label: '기간 프리미엄', pts: tp, unit: '%p' },
          { label: '모형 잔차', pts: residual, unit: '%p' },
        ]),
        note: '모든 값은 그달 마지막 거래일 기준입니다. 모형 잔차는 ACM이 쿠폰 없는 채권 금리를 모형으로 맞춘 값이라 생기는 작은 차이입니다.',
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
    title: '수요: 지역 인구와 20~50대',
    about:
      '집을 사는 주된 연령인 20~50대 인구와 지역 전체 인구입니다. 인구보다 가구 수가 주택 수요에 더 가깝지만, 주민등록 연령별 인구는 시군구까지 매달 나와 지역의 수요 흐름을 보기에 좋습니다. 30~40대가 줄어드는 지역은 매수 수요가 약해질 수 있습니다.',
    source: '통계청 KOSIS 주민등록인구 (DT_1B04005N, 행정안전부)',
    defaultOn: true,
    usesRegion: 'any',
    needs: popReqs,
    build: (get, p) => {
      const total = popSeries(get, p.region, '0');
      const bands = AGE_BANDS.map((b) => ({ ...b, pts: sumAll(b.codes.map((c) => popSeries(get, p.region, c))) }));
      const cols: Record<string, Point[]> = { total: total.map((x) => ({ ...x, value: x.value / 10_000 })) };
      for (const b of bands) cols[`a${b.key}`] = b.pts.map((x) => ({ ...x, value: x.value / 10_000 }));
      const colors = [C.a, C.b, C.c, C.d];
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
