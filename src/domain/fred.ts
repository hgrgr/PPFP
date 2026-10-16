/**
 * FRED (세인트루이스 연은) for 글로벌 매크로: upcoming US data releases with the headline number
 * each one moves, and the user's own sheet of FRED series. Pure.
 */

export interface MajorRelease {
  /** FRED release id */
  id: number;
  label: string;
  about: string;
  /** headline series and how to read it */
  series: string;
  show: 'level' | 'yoy' | 'mom' | 'diff';
  unit: string;
}

/** The releases markets watch most, with the series that headlines each */
export const MAJOR_RELEASES: MajorRelease[] = [
  { id: 50, label: '고용보고서 (비농업 고용)', about: '한 달 동안 늘어난 일자리 수와 실업률', series: 'PAYEMS', show: 'diff', unit: '천 명' },
  { id: 10, label: '소비자물가 (CPI)', about: '물가상승률, 금리 결정에 가장 큰 영향', series: 'CPIAUCSL', show: 'yoy', unit: '%' },
  { id: 46, label: '생산자물가 (PPI)', about: '기업이 받는 가격, 소비자물가의 선행', series: 'PPIFIS', show: 'yoy', unit: '%' },
  { id: 54, label: '개인소득·지출 (PCE 물가)', about: '연준이 목표로 삼는 근원 PCE 물가', series: 'PCEPILFE', show: 'yoy', unit: '%' },
  { id: 53, label: 'GDP', about: '실질 성장률(전기 대비 연율)', series: 'A191RL1Q225SBEA', show: 'level', unit: '%' },
  { id: 9, label: '소매판매', about: '소비 흐름', series: 'RSAFS', show: 'mom', unit: '%' },
  { id: 192, label: '구인·이직 (JOLTS)', about: '구인 건수, 노동 수요', series: 'JTSJOL', show: 'level', unit: '천 건' },
  { id: 13, label: '산업생산', about: '제조·광업·유틸리티 생산', series: 'INDPRO', show: 'mom', unit: '%' },
  { id: 27, label: '주택 착공', about: '주택 경기', series: 'HOUST', show: 'level', unit: '천 호(연율)' },
  { id: 95, label: '내구재 주문', about: '기업 설비투자 흐름', series: 'DGORDER', show: 'mom', unit: '%' },
  { id: 91, label: '미시간대 소비자심리', about: '소비자 체감 경기', series: 'UMCSENT', show: 'level', unit: '' },
  { id: 180, label: '신규 실업수당 청구', about: '주간 고용 신호', series: 'ICSA', show: 'level', unit: '건' },
  { id: 291, label: '기존주택 판매', about: '주택 거래', series: 'EXHOSLUSM495S', show: 'level', unit: '호(연율)' },
];

export const majorOf = (id: number) => MAJOR_RELEASES.find((m) => m.id === id) ?? null;

/** FOMC meeting decision days (the second day of each meeting), from the Federal Reserve's published calendar */
export const FOMC_DAYS = ['2026-01-28', '2026-03-18', '2026-04-29', '2026-06-17', '2026-07-29', '2026-09-16', '2026-10-28', '2026-12-09'];

export interface ReleaseDate {
  id: number;
  name: string;
  date: string;
}

/** fred/releases/dates JSON → releases by date */
export function parseReleaseDates(body: unknown): ReleaseDate[] {
  const list = (body as { release_dates?: { release_id?: number; release_name?: string; date?: string }[] } | null)?.release_dates ?? [];
  return list.flatMap((r) => (r.release_id && r.release_name && /^\d{4}-\d{2}-\d{2}$/.test(r.date ?? '') ? [{ id: r.release_id, name: r.release_name, date: r.date! }] : []));
}

export interface Point {
  date: string;
  value: number;
}

export type Transform = 'level' | 'yoy' | 'mom' | 'diff';
export const TRANSFORM_LABEL: Record<Transform, string> = { level: '값 그대로', yoy: '1년 전 대비 %', mom: '직전 대비 %', diff: '직전 대비 변화' };

/** Periods a year apart for this frequency */
const perYear = (points: Point[]) => {
  if (points.length < 3) return 12;
  const days = (Date.parse(points.at(-1)!.date) - Date.parse(points[0].date)) / 86_400_000 / (points.length - 1);
  return days > 300 ? 1 : days > 80 ? 4 : days > 20 ? 12 : days > 5 ? 52 : 252;
};

export function transform(points: Point[], t: Transform): Point[] {
  if (t === 'level') return points;
  const lag = t === 'yoy' ? perYear(points) : 1;
  return points.slice(lag).flatMap((p, i) => {
    const prev = points[i].value;
    if (t === 'diff') return [{ date: p.date, value: Number((p.value - prev).toFixed(4)) }];
    return prev ? [{ date: p.date, value: Number(((p.value / prev - 1) * 100).toFixed(3)) }] : [];
  });
}

/** The headline reading of a release: the latest transformed value and the one before */
export function headline(points: Point[], t: Transform): { date: string; value: number; prev: number | null } | null {
  const s = transform(points, t);
  const last = s.at(-1);
  return last ? { date: last.date, value: last.value, prev: s.at(-2)?.value ?? null } : null;
}

export interface SheetItem {
  id: string;
  title: string;
  units: string;
  frequency: string;
  transform: Transform;
}

/** fred/series/search JSON → the fields a sheet keeps */
export function parseSeriesSearch(body: unknown): (Omit<SheetItem, 'transform'> & { popularity: number })[] {
  const list = (body as { seriess?: { id?: string; title?: string; units_short?: string; frequency_short?: string; popularity?: number }[] } | null)?.seriess ?? [];
  return list.flatMap((s) => (s.id && s.title ? [{ id: s.id, title: s.title, units: s.units_short ?? '', frequency: s.frequency_short ?? '', popularity: s.popularity ?? 0 }] : []));
}

export const cleanSheet = (items: unknown): SheetItem[] => {
  if (!Array.isArray(items)) return [];
  const seen = new Set<string>();
  return items.flatMap((x) => {
    const i = x as Partial<SheetItem>;
    if (!i || typeof i.id !== 'string' || !/^[A-Z0-9_.]{1,40}$/i.test(i.id) || seen.has(i.id.toUpperCase())) return [];
    seen.add(i.id.toUpperCase());
    const t: Transform = i.transform && i.transform in TRANSFORM_LABEL ? i.transform : 'level';
    return [{ id: i.id.toUpperCase(), title: String(i.title ?? i.id).slice(0, 200), units: String(i.units ?? '').slice(0, 40), frequency: String(i.frequency ?? '').slice(0, 10), transform: t }];
  }).slice(0, 24);
};
