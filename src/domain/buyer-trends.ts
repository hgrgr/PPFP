/**
 * 투자자 동향: who buys a region's apartments, from 한국부동산원's 아파트매매거래 detail tables —
 * where the buyers live (same 시군구, elsewhere in the 시도, 서울, other 시도), how old they are,
 * and whether companies buy or sell. Counts are 동(호)수 per month; shares are taken over three
 * months (or twelve, for the ranking) so a quiet month does not swing them.
 */
import { joinSeries, rollingSum, type ChartData, type Point, type SeriesReq } from './indicators';
import { RONE_REGIONS, roneId, SIDO_KEYS, type RoneRegion } from './region-analysis';
import { LAND_PERMIT_GRP } from './rone-regions';

export const BUYER_TABLES = {
  residence: 'A_2024_00609',
  age: 'A_2024_00610',
  owner: 'A_2024_00611',
  /** 거래규모별 (전용면적대) — numbered like 거래주체별 */
  size: 'A_2024_00612',
} as const;
export type BuyerTable = keyof typeof BUYER_TABLES;

/** 매입자거주지 classes */
export const RESIDENCE = [
  { cls: 500002, key: 'local', label: '같은 시군구' },
  { cls: 500003, key: 'sido', label: '같은 시도 다른 시군구' },
  { cls: 500004, key: 'seoul', label: '다른 시도: 서울' },
  { cls: 500005, key: 'other', label: '다른 시도: 그 밖' },
] as const;
export const AGES = [
  { cls: 500002, key: 'a20', label: '20대 이하' },
  { cls: 500003, key: 'a30', label: '30대' },
  { cls: 500004, key: 'a40', label: '40대' },
  { cls: 500005, key: 'a50', label: '50대' },
  { cls: 500006, key: 'a60', label: '60대' },
  { cls: 500007, key: 'a70', label: '70대 이상' },
  { cls: 500008, key: 'etc', label: '기타 (법인 등)' },
] as const;
/** 거래주체별: 매도자→매수자 */
const OWNER = { total: 500001, corpBuys: [500003, 500006, 500009], corpSells: [500005, 500006, 500007], personToPerson: 500002 };
const TOTAL = 500001;
/** Every class each table's charts read */
export const BUYER_CLASSES: Record<BuyerTable, number[]> = {
  residence: [TOTAL, ...RESIDENCE.map((x) => x.cls)],
  age: [TOTAL, ...AGES.map((x) => x.cls)],
  owner: [OWNER.total, ...new Set([...OWNER.corpBuys, ...OWNER.corpSells])],
  size: [500001, 500002, 500003, 500004, 500005, 500006, 500007, 500008, 500009, 500010],
};
/** 전용면적 bands of 거래규모별, folded into the 주택법 size classes */
export const SIZE_BANDS = [
  { key: 's', label: '60㎡ 이하', cls: [500002, 500003, 500004] },
  { key: 'ms', label: '60~85㎡', cls: [500005] },
  { key: 'ml', label: '85~135㎡', cls: [500006, 500007] },
  { key: 'l', label: '135㎡ 초과', cls: [500008, 500009, 500010] },
] as const;

const ITEM = '100001';
/** The request that loads every class of one table for the region (null when the table has no row for it) */
const groupOf = (r: RoneRegion, t: BuyerTable) => (t === 'size' ? r.groups.owner : r.groups[t]);
export function buyerReq(r: RoneRegion, t: BuyerTable): SeriesReq | null {
  const grp = groupOf(r, t);
  if (!grp) return null;
  return { id: `IND:RONE:${BUYER_TABLES[t]}/*/${ITEM}/${grp}`, source: 'RONE', code: `${BUYER_TABLES[t]}/*/${ITEM}/${grp}`, freq: 'M' };
}
/** The stored series of one class */
export const classId = (r: RoneRegion, t: BuyerTable, cls: number) => `${roneId(BUYER_TABLES[t], cls, ITEM)}/${groupOf(r, t)}`;

type Get = (id: string) => Point[];

/** a ÷ b × 100 over `months`-month sums, on the dates both have */
export function shareOver(parts: Point[][], total: Point[], months = 3): Point[] {
  const sum = new Map<string, number>();
  for (const p of parts.flatMap((x) => rollingSum(x, months))) sum.set(p.date, (sum.get(p.date) ?? 0) + p.value);
  return rollingSum(total, months).flatMap((t) => {
    const v = sum.get(t.date);
    return v === undefined || !t.value ? [] : [{ date: t.date, value: (v / t.value) * 100 }];
  });
}

const C = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)', 'var(--series-6)', 'var(--series-7)'];
const fmt = (v: number, d = 1) => v.toLocaleString('ko-KR', { maximumFractionDigits: d });
const latest = (label: string, pts: Point[], unit: string, d = 1) => {
  const p = pts.at(-1);
  return p ? [{ label, value: `${fmt(p.value, d)}${unit}`, date: p.date.slice(0, 7) }] : [];
};

/** Where the buyers live: monthly deals stacked by residence, and the outsiders' share */
export function residenceChart(r: RoneRegion, get: Get): ChartData {
  const total = get(classId(r, 'residence', TOTAL));
  const parts = Object.fromEntries(RESIDENCE.map((x) => [x.key, get(classId(r, 'residence', x.cls))]));
  const outside = shareOver([parts.sido, parts.seoul, parts.other], total);
  const otherSido = shareOver([parts.seoul, parts.other], total);
  const seoul = shareOver([parts.seoul], total);
  const isSido = r.depth === 0;
  return {
    lines: [
      ...RESIDENCE.map((x, i) => ({ key: x.key, label: x.label, color: C[i], kind: 'bar' as const, stack: 'r' })),
      ...(isSido ? [] : [{ key: 'outside', label: '외지인 비율 (시군구 밖)', color: 'var(--ink)', axis: 'right' as const }]),
      { key: 'otherSido', label: '다른 시도 거주자 비율', color: C[3], axis: 'right' as const, dash: true },
      ...(r.sido === '서울' ? [] : [{ key: 'seoulShare', label: '서울 거주자 비율', color: C[2], axis: 'right' as const, dash: true }]),
    ],
    rows: joinSeries({ ...parts, ...(isSido ? {} : { outside }), otherSido, ...(r.sido === '서울' ? {} : { seoulShare: seoul }) }),
    unit: '건',
    rightUnit: '%',
    latest: [...(isSido ? [] : latest('외지인 비율', outside, '%')), ...latest('다른 시도', otherSido, '%'), ...(r.sido === '서울' ? [] : latest('서울 거주자', seoul, '%'))],
    note: '비율은 최근 3개월 거래를 합해 계산했습니다. 외지인은 그 시군구 밖에 사는 매수자입니다.',
  };
}

/** Buyers by age, and the share of those in their 30s and younger */
export function ageChart(r: RoneRegion, get: Get): ChartData {
  const total = get(classId(r, 'age', TOTAL));
  const parts = Object.fromEntries(AGES.map((x) => [x.key, get(classId(r, 'age', x.cls))]));
  const young = shareOver([parts.a20, parts.a30], total);
  const thirties = shareOver([parts.a30], total);
  return {
    lines: [
      ...AGES.map((x, i) => ({ key: x.key, label: x.label, color: C[i % C.length], kind: 'bar' as const, stack: 'a' })),
      { key: 'young', label: '30대 이하 비율', color: 'var(--ink)', axis: 'right' as const },
      { key: 'thirties', label: '30대 비율', color: C[1], axis: 'right' as const, dash: true },
    ],
    rows: joinSeries({ ...parts, young, thirties }),
    unit: '건',
    rightUnit: '%',
    latest: [...latest('30대 이하', young, '%'), ...latest('30대', thirties, '%')],
    note: '2019년부터 나오는 자료입니다. 30대 이하 비중이 빠르게 오르면 대출을 끌어 사는 실수요가 몰리는 국면인 경우가 많습니다.',
  };
}

/** Companies buying and selling: their share of deals */
export function ownerChart(r: RoneRegion, get: Get): ChartData {
  const total = get(classId(r, 'owner', OWNER.total));
  const of = (list: number[]) => list.map((c) => get(classId(r, 'owner', c)));
  const buys = shareOver(of(OWNER.corpBuys), total);
  const sells = shareOver(of(OWNER.corpSells), total);
  return {
    lines: [
      { key: 'total', label: '월 매매거래', color: 'var(--muted)', kind: 'bar' },
      { key: 'buys', label: '법인이 산 비율', color: C[3], axis: 'right' },
      { key: 'sells', label: '법인이 판 비율', color: C[0], axis: 'right' },
    ],
    rows: joinSeries({ total, buys, sells }),
    unit: '건',
    rightUnit: '%',
    latest: [...latest('법인 매수', buys, '%'), ...latest('법인 매도', sells, '%')],
    note: '법인 매수는 2020년 규제 전 갭투자 수단으로 몰렸다가 세금이 무거워지며 줄었습니다. 법인 매수가 다시 늘면 투자 수요가 돌아오는 신호로 봅니다.',
  };
}

/** Deals by 전용면적 class, and the share of the larger homes */
export function sizeChart(r: RoneRegion, get: Get): ChartData {
  const total = get(classId(r, 'size', TOTAL));
  const bands = Object.fromEntries(SIZE_BANDS.map((b) => [b.key, sumByDate(b.cls.map((c) => get(classId(r, 'size', c))))]));
  const big = shareOver([bands.ml, bands.l], total);
  const small = shareOver([bands.s], total);
  return {
    lines: [
      ...SIZE_BANDS.map((b, i) => ({ key: b.key, label: b.label, color: C[i], kind: 'bar' as const, stack: 'z' })),
      { key: 'big', label: '85㎡ 초과 비율', color: 'var(--ink)', axis: 'right' as const },
      { key: 'small', label: '60㎡ 이하 비율', color: C[0], axis: 'right' as const, dash: true },
    ],
    rows: joinSeries({ ...bands, big, small }),
    unit: '건',
    rightUnit: '%',
    latest: [...latest('85㎡ 초과', big, '%'), ...latest('60㎡ 이하', small, '%')],
    note: '상승장 초입에는 실수요가 몰리는 소형·중소형 거래가 먼저 늘고, 과열 국면에는 중대형 비중이 커지는 경우가 많습니다. 비율은 3개월 합입니다.',
  };
}

/** Points of several series summed on the dates any of them has */
function sumByDate(list: Point[][]): Point[] {
  const m = new Map<string, number>();
  for (const pts of list) for (const p of pts) m.set(p.date, (m.get(p.date) ?? 0) + p.value);
  return [...m].sort((a, b) => a[0].localeCompare(b[0])).map(([date, value]) => ({ date, value }));
}

// ---------------------------------------------------------------- ranking

/** The regions shown beside one: a 시도's 시군구, a 시군구's neighbours (and a 구's fellow 구), or the 시도 for 전국 */
export function peersOf(r: RoneRegion): RoneRegion[] {
  const sidos = SIDO_KEYS.filter((k) => k !== '전국').map((k) => RONE_REGIONS.find((x) => x.key === k)!);
  if (r.key === '전국') return sidos;
  const kids = RONE_REGIONS.filter((x) => x.sido === r.sido && x.depth === 1 && x.groups.residence);
  // A 구 of a 시 also sits beside the other 구 of its 시
  const parent = r.key.split('>').slice(0, -1).join('>');
  const siblings = r.depth === 2 ? RONE_REGIONS.filter((x) => x.depth === 2 && x.key.startsWith(`${parent}>`) && x.groups.residence) : [];
  return kids.length ? [...siblings, ...kids] : sidos;
}

export interface RankRow {
  key: string;
  label: string;
  /** Deals of the last 12 months */
  deals: number;
  /** Shares over the last 12 months, % */
  outside: number | null;
  otherSido: number | null;
  seoul: number | null;
  /** outside now against a year earlier, %p */
  change: number | null;
  /** Each of the last 12 months' outsider share (oldest first), for the heat cells */
  months: { date: string; value: number | null }[];
  date: string | null;
}

export function rankRow(r: RoneRegion, get: Get): RankRow {
  const total = get(classId(r, 'residence', TOTAL));
  const part = (k: string) => get(classId(r, 'residence', RESIDENCE.find((x) => x.key === k)!.cls));
  const outside12 = shareOver([part('sido'), part('seoul'), part('other')], total, 12);
  const other12 = shareOver([part('seoul'), part('other')], total, 12);
  const seoul12 = shareOver([part('seoul')], total, 12);
  const monthly = shareOver([part('sido'), part('seoul'), part('other')], total, 1);
  const last = total.at(-1)?.date ?? null;
  const at = (pts: Point[], d: string | null) => (d ? (pts.find((p) => p.date === d)?.value ?? null) : null);
  const yearAgo = last ? `${Number(last.slice(0, 4)) - 1}${last.slice(4)}` : null;
  const now = at(outside12, last);
  const before = at(outside12, yearAgo);
  const months = total.slice(-12).map((t) => ({ date: t.date, value: at(monthly, t.date) }));
  return {
    key: r.key,
    label: r.label,
    deals: rollingSum(total, 12).at(-1)?.value ?? 0,
    outside: now,
    otherSido: at(other12, last),
    seoul: r.sido === '서울' ? null : at(seoul12, last),
    change: now !== null && before !== null ? now - before : null,
    months,
    date: last,
  };
}

// ---------------------------------------------------------------- 토지거래허가

const PERMIT_TABLE = 'A_2024_00655';
/** 토지거래허가 처리 (필지수): every class of the region at once; null where the table has no row */
export function permitReq(r: RoneRegion): SeriesReq | null {
  const grp = LAND_PERMIT_GRP[r.key];
  return grp ? { id: `IND:RONE:${PERMIT_TABLE}/*/${ITEM}/${grp}`, source: 'RONE', code: `${PERMIT_TABLE}/*/${ITEM}/${grp}`, freq: 'M' } : null;
}
/** Stored series of a 토지거래허가 class: 500001 합계, 500002 허가, 500003 불허가 */
export const permitIds = (r: RoneRegion): string[] => {
  const grp = LAND_PERMIT_GRP[r.key];
  return grp ? [500001, 500002, 500003].map((c) => `${roneId(PERMIT_TABLE, c, ITEM)}/${grp}`) : [];
};

/** 토지거래허가 처리 건수 (필지) by month: granted, refused, and the refused share */
export function permitChart(r: RoneRegion, get: Get): ChartData {
  const [, okId, noId] = permitIds(r);
  const ok = okId ? get(okId) : [], no = noId ? get(noId) : [];
  const total = ok.length ? ok.map((p) => ({ date: p.date, value: p.value + (no.find((q) => q.date === p.date)?.value ?? 0) })) : [];
  const refused = shareOver([no], total, 3);
  const any = total.some((p) => p.value > 0);
  return {
    lines: [
      { key: 'ok', label: '허가 (필지)', color: C[0], kind: 'bar', stack: 'p' },
      { key: 'no', label: '불허가 (필지)', color: C[3], kind: 'bar', stack: 'p' },
      { key: 'refused', label: '불허가 비율', color: 'var(--ink)', axis: 'right' },
    ],
    rows: any ? joinSeries({ ok, no, refused }) : [],
    unit: '필지',
    rightUnit: '%',
    latest: [...latest('허가', ok, '필지', 0), ...latest('불허가 비율', refused, '%')],
    note: any
      ? '토지거래허가구역 안에서 땅·집을 사려면 시군구의 허가를 받아야 합니다. 허가 신청이 늘면 규제 지역에서도 매수세가 붙는 것이고, 불허가 비율이 오르면 실거주 요건 등 심사가 깐깐해진 것입니다. 비율은 3개월 합으로 계산합니다.'
      : '이 지역은 토지거래허가 처리 건이 없습니다(허가구역이 없거나 신청이 없음).',
  };
}
