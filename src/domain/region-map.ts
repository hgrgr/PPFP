/**
 * 지역 분석 지도: one number per region, read from whole R-ONE tables (every region at once), and
 * how each 시군구 shape of the map finds its region: its own row, else the 시 it belongs to.
 */
import { changeOver, honeycombPhase, rollingSum, type Point } from './indicators';
import { RONE_REGIONS, type RoneRegion } from './region-analysis';

export const MAP_METRICS = [
  { key: 'y1', label: '매매 1년 변화', unit: '%', kind: 'change', about: '매매가격지수의 1년 변화' },
  { key: 'm3', label: '매매 3개월 변화', unit: '%', kind: 'change', about: '매매가격지수의 3개월 변화' },
  { key: 'm1', label: '매매 1개월 변화', unit: '%', kind: 'change', about: '매매가격지수의 1개월 변화' },
  { key: 'ratio', label: '전세가율', unit: '%', kind: 'level', about: '중위 매매가격 대비 중위 전세가격' },
  { key: 'trade', label: '거래량 1년 증감', unit: '%', kind: 'change', about: '최근 12개월 아파트 매매거래를 그 전 12개월과 비교' },
  { key: 'outside', label: '외지인 매수 비율', unit: '%', kind: 'level', about: '최근 12개월 매수자 중 그 시군구 밖에 사는 사람의 비율' },
  { key: 'phase', label: '벌집순환 국면', unit: '', kind: 'phase', about: '명목 가격 6개월 변화와 거래량 6개월 변화로 본 국면' },
] as const;
export type MapMetric = (typeof MAP_METRICS)[number]['key'];

export interface MapTables {
  /** 매매지수, 전세가율, 매매거래: "/CLS" → points; 매입자거주지: "GRP/CLS" */
  price: Map<string, Point[]>;
  ratio: Map<string, Point[]>;
  trade: Map<string, Point[]>;
  residence: Map<string, Point[]>;
}

export type RegionValues = Record<string, Partial<Record<MapMetric, number>> & { date?: string }>;

const last = (pts: Point[] | undefined) => pts?.at(-1)?.value;

/** Every region's numbers from the whole tables */
export function mapValues(t: MapTables): RegionValues {
  const out: RegionValues = {};
  for (const r of RONE_REGIONS) {
    const v: Partial<Record<MapMetric, number>> & { date?: string } = {};
    const price = t.price.get(`/${r.ids.price}`) ?? [];
    const trade = t.trade.get(`/${r.ids.trade}`) ?? [];
    if (price.length) {
      v.date = price.at(-1)!.date;
      for (const [k, n] of [['m1', 1], ['m3', 3], ['y1', 12]] as const) {
        const c = last(changeOver(price, n));
        if (c !== undefined) v[k] = c;
      }
    }
    const ratio = last(t.ratio.get(`/${r.ids.ratio}`));
    if (ratio !== undefined) v.ratio = ratio;
    const t12 = last(changeOver(rollingSum(trade, 12), 12));
    if (t12 !== undefined) v.trade = t12;
    if (r.groups.residence && (r.depth > 0 || r.key === '세종')) {
      const g = (cls: number) => rollingSum(t.residence.get(`${r.groups.residence}/${cls}`) ?? [], 12).at(-1)?.value;
      const total = g(500001), out3 = [500003, 500004, 500005].map(g);
      if (total && out3.every((x) => x !== undefined)) v.outside = ((out3 as number[]).reduce((a, b) => a + b, 0) / total) * 100;
    }
    const p6 = last(changeOver(price, 6));
    const v6 = last(changeOver(rollingSum(trade, 6), 6));
    if (p6 !== undefined && v6 !== undefined) v.phase = honeycombPhase(p6, v6).n;
    if (Object.keys(v).length) out[r.key] = v;
  }
  return out;
}

/** The region a map shape (시군구 code) is drawn with: the one whose only code it is, else the 시 holding it */
export function regionOfShape(code: string): { own: RoneRegion | null; parent: RoneRegion | null } {
  const own = RONE_REGIONS.find((r) => r.lawd.length === 1 && r.lawd[0] === code && r.depth > 0) ?? (code === '36110' ? RONE_REGIONS.find((r) => r.key === '세종')! : null);
  const parent = RONE_REGIONS.find((r) => r.lawd.length > 1 && r.lawd.includes(code)) ?? null;
  return { own, parent };
}

/** The value a shape shows for a metric, and which region it came from */
export function shapeValue(code: string, metric: MapMetric, values: RegionValues): { value: number; region: RoneRegion } | null {
  const { own, parent } = regionOfShape(code);
  for (const r of [own, parent]) {
    const v = r ? values[r.key]?.[metric] : undefined;
    if (r && v !== undefined) return { value: v, region: r };
  }
  return null;
}

// ---------------------------------------------------------------- time-lapse

/** The map metrics that can be played month by month */
export const TIMELINE_METRICS = ['y1', 'm1', 'ratio', 'trade', 'phase'] as const;
export type TimelineMetric = (typeof TIMELINE_METRICS)[number];

export interface TimelineFrames {
  /** First day of each month, oldest first */
  dates: string[];
  /** Per region key, per metric, one value per date (null when not published) */
  values: Record<string, Partial<Record<TimelineMetric, (number | null)[]>>>;
}

const round = (v: number | undefined, d = 2) => (v === undefined || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);

/** Every region's map metrics for each of the last `months` months, from whole tables */
export function timelineFrames(t: Pick<MapTables, 'price' | 'ratio' | 'trade'>, months: number): TimelineFrames {
  const all = [...t.price.values()].flatMap((pts) => pts.map((p) => p.date));
  const lastDate = all.sort().at(-1);
  if (!lastDate) return { dates: [], values: {} };
  const dates: string[] = [];
  for (let k = months - 1; k >= 0; k--) {
    const [y, m] = lastDate.split('-').map(Number);
    const n = y * 12 + (m - 1) - k;
    dates.push(`${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, '0')}-01`);
  }
  const values: TimelineFrames['values'] = {};
  for (const r of RONE_REGIONS) {
    const price = t.price.get(`/${r.ids.price}`) ?? [];
    const trade = t.trade.get(`/${r.ids.trade}`) ?? [];
    const ratio = t.ratio.get(`/${r.ids.ratio}`) ?? [];
    if (!price.length && !ratio.length) continue;
    const at = (pts: Point[]) => {
      const m = new Map(pts.map((p) => [p.date, p.value]));
      return (d: string) => m.get(d);
    };
    const y1 = at(changeOver(price, 12)), m1 = at(changeOver(price, 1)), ra = at(ratio), tr = at(changeOver(rollingSum(trade, 12), 12));
    const p6 = at(changeOver(price, 6)), v6 = at(changeOver(rollingSum(trade, 6), 6));
    const v: Partial<Record<TimelineMetric, (number | null)[]>> = {
      y1: dates.map((d) => round(y1(d))),
      m1: dates.map((d) => round(m1(d))),
      ratio: dates.map((d) => round(ra(d), 1)),
      trade: dates.map((d) => round(tr(d), 1)),
      phase: dates.map((d) => {
        const a = p6(d), b = v6(d);
        return a === undefined || b === undefined ? null : honeycombPhase(a, b).n;
      }),
    };
    for (const k of TIMELINE_METRICS) if (v[k]!.every((x) => x === null)) delete v[k];
    if (Object.keys(v).length) values[r.key] = v;
  }
  return { dates, values };
}
