/**
 * Apartments: reads 국토교통부 아파트 매매 실거래가 (apis.data.go.kr, XML) and 카카오 로컬
 * answers, and turns a district's trades into what an apartment asset shows — its own
 * recent deals, an estimated price, and how the neighborhood moved. Pure; the service
 * does the calls and the caching.
 */

/** One reported sale. Prices in 원 (the API reports 만원). */
export interface AptTrade {
  /** YYYY-MM-DD contract date */
  date: string;
  price: number;
  /** 전용면적 ㎡ */
  area: number;
  floor: number | null;
  aptNm: string;
  /** 법정동 code (5 digits after the 시군구 code), when the API sends it */
  umdCd: string | null;
  umdNm: string;
  jibun: string | null;
  /** Complex serial number, when the API sends it */
  aptSeq: string | null;
  buildYear: number | null;
  /** Cancelled after reporting (해제 신고) */
  cancelled: boolean;
  /** 중개거래 / 직거래 */
  dealing: string | null;
  aptDong: string | null;
}

/** What a real estate asset remembers about the apartment it is (Asset.meta). */
export interface ApartmentMeta {
  kind: 'apartment';
  /** 지번 주소, e.g. "서울 강남구 대치동 316" */
  address: string;
  roadAddress: string | null;
  /** Name the map knows it by (카카오), used for the 네이버 부동산 link */
  placeName: string;
  lat: number;
  lng: number;
  /** 시군구 code (LAWD_CD) */
  lawdCd: string;
  /** 법정동 code (last five of the 10-digit code) */
  umdCd: string;
  umdNm: string;
  /** Name in the 실거래가 records; null when no deal was found to match */
  aptNm: string | null;
  jibun: string | null;
  aptSeq: string | null;
  /** 전용면적 ㎡ */
  area: number | null;
}

export class MolitApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'MolitApiError';
  }
}

const tag = (xml: string, name: string): string | null => {
  const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  if (!m) return null;
  const v = m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
  return v === '' ? null : v;
};
/** First tag present among `names` (the API renamed its fields to English in 2024). */
const pick = (xml: string, ...names: string[]) => {
  for (const n of names) {
    const v = tag(xml, n);
    if (v !== null) return v;
  }
  return null;
};
const num = (v: string | null) => {
  if (v === null) return null;
  const x = Number(v.replace(/[,\s]/g, ''));
  return Number.isFinite(x) ? x : null;
};
const pad = (v: string | null, len: number) => (v && /^\d+$/.test(v) ? v.padStart(len, '0') : null);

/** Error codes the data.go.kr gateway and the service send back, in words a user can act on. */
const MOLIT_ERRORS: Record<string, string> = {
  '03': '해당 기간에 거래가 없습니다.',
  '10': '요청값이 잘못되었습니다.',
  '12': '없어졌거나 바뀐 서비스입니다.',
  '20': '이 서비스에 활용신청이 되어 있지 않습니다. 공공데이터포털에서 아파트 매매 실거래가 상세 자료를 활용신청하세요.',
  '22': '오늘 호출 한도를 넘었습니다. 내일 다시 시도하세요.',
  '23': '잠깐 사이 너무 많이 호출했습니다. 잠시 후 다시 시도하세요.',
  '30': '등록되지 않은 서비스 키입니다. 공공데이터포털의 일반 인증키(Decoding)를 넣었는지 확인하세요.',
  '31': '기한이 지난 서비스 키입니다. 공공데이터포털에서 연장하세요.',
  '32': '등록되지 않은 IP에서 호출했습니다.',
};

/** Parses one page of the 실거래가 response. Throws MolitApiError for an error answer. */
export function parseMolitTrades(xml: string): { trades: AptTrade[]; totalCount: number } {
  const auth = tag(xml, 'returnReasonCode');
  if (auth && auth !== '00') throw new MolitApiError(MOLIT_ERRORS[auth] ?? tag(xml, 'returnAuthMsg') ?? '실거래가 서비스가 오류를 보냈습니다.', auth);
  const code = tag(xml, 'resultCode');
  if (code && !/^0+$/.test(code) && code !== '03') {
    const short = code.replace(/^0(?=\d\d$)/, '');
    throw new MolitApiError(MOLIT_ERRORS[short] ?? tag(xml, 'resultMsg') ?? '실거래가 서비스가 오류를 보냈습니다.', short);
  }
  const trades: AptTrade[] = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const it = m[1];
    const y = num(pick(it, 'dealYear', '년'));
    const mo = num(pick(it, 'dealMonth', '월'));
    const d = num(pick(it, 'dealDay', '일'));
    const man = num(pick(it, 'dealAmount', '거래금액'));
    const area = num(pick(it, 'excluUseAr', 'exclUseAr', '전용면적'));
    const aptNm = pick(it, 'aptNm', '아파트');
    if (!y || !mo || !d || !man || !area || !aptNm) continue;
    const cdeal = pick(it, 'cdealType', '해제여부');
    trades.push({
      date: `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
      price: man * 10_000,
      area,
      floor: num(pick(it, 'floor', '층')),
      aptNm: aptNm.replace(/\s+/g, ' '),
      umdCd: pad(pick(it, 'umdCd', '법정동읍면동코드'), 5),
      umdNm: (pick(it, 'umdNm', '법정동') ?? '').replace(/\s+/g, ' '),
      jibun: pick(it, 'jibun', '지번'),
      aptSeq: pick(it, 'aptSeq'),
      buildYear: num(pick(it, 'buildYear', '건축년도')),
      cancelled: !!cdeal && cdeal.toUpperCase() === 'O',
      dealing: pick(it, 'dealingGbn', '거래유형'),
      aptDong: pick(it, 'aptDong'),
    });
  }
  return { trades, totalCount: num(tag(xml, 'totalCount')) ?? trades.length };
}

/** 카카오 키워드 검색 hit, cut down to what picking an apartment needs. */
export interface PlaceHit {
  name: string;
  address: string;
  roadAddress: string | null;
  lat: number;
  lng: number;
  /** "부동산 > 주거시설 > 아파트" */
  category: string;
}

export function parseKakaoPlaces(body: unknown): PlaceHit[] {
  const docs = (body as { documents?: unknown })?.documents;
  if (!Array.isArray(docs)) return [];
  const hits = docs.flatMap((d: Record<string, unknown>) => {
    const name = typeof d.place_name === 'string' ? d.place_name.trim() : '';
    const address = typeof d.address_name === 'string' ? d.address_name.trim() : '';
    const lat = Number(d.y), lng = Number(d.x);
    if (!name || !address || !Number.isFinite(lat) || !Number.isFinite(lng)) return [];
    const road = typeof d.road_address_name === 'string' && d.road_address_name.trim() ? d.road_address_name.trim() : null;
    return [{ name, address, roadAddress: road, lat, lng, category: typeof d.category_name === 'string' ? d.category_name : '' }];
  });
  // Apartment complexes first; stores and offices inside one come after.
  const apt = (h: PlaceHit) => (/아파트$/.test(h.category) ? 0 : /아파트/.test(h.category) ? 1 : 2);
  return hits.map((h, i) => ({ h, i })).sort((a, b) => apt(a.h) - apt(b.h) || a.i - b.i).map((x) => x.h);
}

/** 카카오 좌표→행정구역 answer: the 10-digit 법정동 code (region_type "B"). */
export function parseRegionCode(body: unknown): { lawdCd: string; umdCd: string; umdNm: string } | null {
  const docs = (body as { documents?: unknown })?.documents;
  if (!Array.isArray(docs)) return null;
  const b = docs.find((d: Record<string, unknown>) => d.region_type === 'B' && typeof d.code === 'string' && /^\d{10}$/.test(d.code)) as Record<string, string> | undefined;
  if (!b) return null;
  return { lawdCd: b.code.slice(0, 5), umdCd: b.code.slice(5), umdNm: (b.region_3depth_name || b.region_4depth_name || '').trim() };
}

/** "서울 강남구 대치동 316" → "316"; "… 산 12-3" → "산12-3" */
export function jibunOf(address: string): string | null {
  const m = address.trim().match(/(산\s*)?(\d+(?:-\d+)?)$/);
  return m ? (m[1] ? '산' : '') + m[2] : null;
}

const squash = (s: string) => s.replace(/[\s()·.,\-]/g, '').replace(/아파트$/, '').toLowerCase();

export interface ComplexOption {
  /** aptSeq, or 동코드|지번|이름 when the API sends no serial */
  key: string;
  aptNm: string;
  jibun: string | null;
  aptSeq: string | null;
  buildYear: number | null;
  deals: number;
  /** Areas traded in this complex, most traded first */
  areas: { area: number; deals: number; lastPrice: number; lastDate: string }[];
}

export const complexKey = (t: Pick<AptTrade, 'aptSeq' | 'umdCd' | 'umdNm' | 'jibun' | 'aptNm'>) => t.aptSeq ?? `${t.umdCd ?? t.umdNm}|${t.jibun ?? ''}|${t.aptNm}`;

/** Two trades are the same unit type when their 전용면적 differ by under 0.5㎡. */
export const sameArea = (a: number, b: number) => Math.abs(a - b) < 0.5;

/** The complexes traded in one 법정동, with their areas. */
export function complexesIn(trades: AptTrade[], dong: { umdCd: string; umdNm: string }): ComplexOption[] {
  const inDong = trades.filter((t) => (t.umdCd ? t.umdCd === dong.umdCd : t.umdNm === dong.umdNm));
  const groups = new Map<string, AptTrade[]>();
  for (const t of inDong) {
    const k = complexKey(t);
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  return [...groups.entries()]
    .map(([key, ts]) => {
      const sorted = [...ts].sort((a, b) => b.date.localeCompare(a.date));
      const areas: ComplexOption['areas'] = [];
      for (const t of sorted) {
        const a = areas.find((x) => sameArea(x.area, t.area));
        if (a) a.deals += 1;
        else areas.push({ area: t.area, deals: 1, lastPrice: t.price, lastDate: t.date });
      }
      areas.sort((a, b) => b.deals - a.deals || a.area - b.area);
      return { key, aptNm: sorted[0].aptNm, jibun: sorted[0].jibun, aptSeq: sorted[0].aptSeq, buildYear: sorted[0].buildYear, deals: ts.length, areas };
    })
    .sort((a, b) => b.deals - a.deals || a.aptNm.localeCompare(b.aptNm, 'ko'));
}

/** The complex a picked map place most likely is: same 지번 first, then the closest name. */
export function guessComplex(options: ComplexOption[], place: { name: string; address: string }): string | null {
  const jibun = jibunOf(place.address);
  const byJibun = jibun ? options.filter((o) => o.jibun === jibun) : [];
  if (byJibun.length === 1) return byJibun[0].key;
  const pool = byJibun.length ? byJibun : options;
  const want = squash(place.name);
  const score = (o: ComplexOption) => {
    const have = squash(o.aptNm);
    if (have === want) return 3;
    if (have.includes(want) || want.includes(have)) return 2;
    let common = 0;
    while (common < Math.min(have.length, want.length) && have[common] === want[common]) common++;
    return common >= 3 ? 1 : 0;
  };
  const best = pool.map((o) => ({ o, s: score(o) })).sort((a, b) => b.s - a.s || b.o.deals - a.o.deals)[0];
  return best && (best.s > 0 || byJibun.length) ? best.o.key : null;
}

/** Does a trade belong to the apartment in `meta`? */
export function isOwnComplex(t: AptTrade, meta: Pick<ApartmentMeta, 'aptSeq' | 'umdCd' | 'umdNm' | 'jibun' | 'aptNm'>): boolean {
  if (meta.aptSeq && t.aptSeq) return t.aptSeq === meta.aptSeq;
  if (!meta.aptNm) return false;
  const dong = t.umdCd ? t.umdCd === meta.umdCd : t.umdNm === meta.umdNm;
  return dong && t.aptNm === meta.aptNm && (!meta.jibun || !t.jibun || t.jibun === meta.jibun);
}

/** 3.3㎡ (1평) */
export const PYEONG = 3.305785;

/** 전용 84.97㎡ → 약 34평형 (공급면적은 보통 전용의 1.3배 남짓). */
export const supplyPyeong = (area: number) => Math.round((area * 1.33) / PYEONG);

export const areaLabel = (area: number) => `${area.toFixed(2).replace(/\.?0+$/, '')}㎡ (약 ${supplyPyeong(area)}평형)`;

/** 12억 3,000만 */
export function eok(won: number): string {
  const man = Math.round(won / 10_000);
  const e = Math.floor(man / 10_000);
  const rest = man % 10_000;
  if (!e) return `${rest.toLocaleString('ko-KR')}만`;
  return rest ? `${e}억 ${rest.toLocaleString('ko-KR')}만` : `${e}억`;
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/** YYYY-MM-DD, `months` before `today` */
export function monthsBefore(today: string, months: number): string {
  const [y, m, d] = today.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 - months, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

/** The `count` contract months up to and including `today`'s, newest first: ["202610", "202609", …] */
export function recentMonths(today: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => monthsBefore(today, i).slice(0, 7).replace('-', ''));
}

export interface Estimate {
  price: number;
  /** How it was worked out, in a sentence */
  basis: string;
  deals: number;
  method: 'same-area' | 'complex-per-area';
}

/**
 * A price for the apartment from its own deals: the median of the latest (up to five)
 * same-area sales in the last six months, else in the last year; with none, the complex's
 * median price per ㎡ over the last year times the area. Cancelled deals are left out.
 */
export function estimatePrice(own: AptTrade[], area: number, today: string): Estimate | null {
  const live = own.filter((t) => !t.cancelled).sort((a, b) => b.date.localeCompare(a.date));
  for (const months of [6, 12]) {
    const since = monthsBefore(today, months);
    const recent = live.filter((t) => sameArea(t.area, area) && t.date >= since).slice(0, 5);
    if (recent.length) {
      const price = median(recent.map((t) => t.price))!;
      return { price, deals: recent.length, method: 'same-area', basis: `같은 면적 최근 ${months}개월 거래 ${recent.length}건(${recent.at(-1)!.date} ~ ${recent[0].date})의 중앙값` };
    }
  }
  const since = monthsBefore(today, 12);
  const year = live.filter((t) => t.date >= since);
  const perArea = median(year.map((t) => t.price / t.area));
  if (perArea === null) return null;
  return { price: Math.round((perArea * area) / 10_000) * 10_000, deals: year.length, method: 'complex-per-area', basis: `같은 면적 거래가 없어 단지 최근 1년 거래 ${year.length}건의 ㎡당 중앙값 × 전용면적으로 계산` };
}

export interface NearbyComplex {
  aptNm: string;
  buildYear: number | null;
  deals: number;
  lastDate: string;
  lastPrice: number;
  lastArea: number;
  /** Median price per 3.3㎡ of 전용면적, last 12 months */
  perPyeong: number;
  own: boolean;
}

export interface DongTrend {
  /** Median price per 3.3㎡ over the last three months, and the three months a year earlier */
  recent: number | null;
  yearAgo: number | null;
  recentDeals: number;
  /** Per month with deals, oldest first: median price per 3.3㎡ over that month and the two before */
  monthly: { month: string; perPyeong: number; deals: number }[];
}

export interface ApartmentReport {
  own: AptTrade[];
  sameAreaDeals: AptTrade[];
  estimate: Estimate | null;
  areas: { area: number; deals: number; lastPrice: number; lastDate: string; high: number }[];
  nearby: NearbyComplex[];
  dong: DongTrend;
}

const perPyeong = (t: AptTrade) => (t.price / t.area) * PYEONG;

/** Everything the apartment panel shows, from its 시군구's trades over the last two years. */
export function apartmentReport(trades: AptTrade[], meta: ApartmentMeta, today: string): ApartmentReport {
  const dongTrades = trades.filter((t) => (t.umdCd ? t.umdCd === meta.umdCd : t.umdNm === meta.umdNm));
  const own = dongTrades.filter((t) => isOwnComplex(t, meta)).sort((a, b) => b.date.localeCompare(a.date));
  const area = meta.area;
  const sameAreaDeals = area ? own.filter((t) => sameArea(t.area, area)) : [];

  const areas: ApartmentReport['areas'] = [];
  for (const t of own) {
    if (t.cancelled) continue;
    const a = areas.find((x) => sameArea(x.area, t.area));
    if (a) {
      a.deals += 1;
      a.high = Math.max(a.high, t.price);
    } else areas.push({ area: t.area, deals: 1, lastPrice: t.price, lastDate: t.date, high: t.price });
  }
  areas.sort((a, b) => a.area - b.area);

  const live = dongTrades.filter((t) => !t.cancelled);
  const yearSince = monthsBefore(today, 12);
  const groups = new Map<string, AptTrade[]>();
  for (const t of live) {
    if (t.date < yearSince) continue;
    const k = complexKey(t);
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  const nearby = [...groups.values()]
    .map((ts) => {
      const s = [...ts].sort((a, b) => b.date.localeCompare(a.date));
      return { aptNm: s[0].aptNm, buildYear: s[0].buildYear, deals: s.length, lastDate: s[0].date, lastPrice: s[0].price, lastArea: s[0].area, perPyeong: median(s.map(perPyeong))!, own: isOwnComplex(s[0], meta) };
    })
    .sort((a, b) => Number(b.own) - Number(a.own) || b.deals - a.deals)
    .slice(0, 12);

  // One month of a 동 holds few deals of mixed complexes, so each month pools the two before it.
  const byMonth = new Map<string, number[]>();
  for (const t of live) byMonth.set(t.date.slice(0, 7), [...(byMonth.get(t.date.slice(0, 7)) ?? []), perPyeong(t)]);
  const months = [...byMonth.keys()].sort();
  const monthly = months.map((month) => {
    const from = monthsBefore(`${month}-01`, 2).slice(0, 7);
    const xs = months.filter((m) => m >= from && m <= month).flatMap((m) => byMonth.get(m)!);
    return { month, perPyeong: median(xs)!, deals: byMonth.get(month)!.length };
  });
  const window = (from: string, to: string) => live.filter((t) => t.date >= from && t.date < to).map(perPyeong);
  const recentFrom = monthsBefore(today, 3);
  const recent = window(recentFrom, '9999');
  const yearAgo = window(monthsBefore(today, 15), monthsBefore(today, 12));

  return {
    own,
    sameAreaDeals,
    estimate: area ? estimatePrice(own, area, today) : null,
    areas,
    nearby,
    dong: { recent: median(recent), yearAgo: median(yearAgo), recentDeals: recent.length, monthly },
  };
}

/** Reads an ApartmentMeta back from Asset.meta or a form field; null when it is not one. */
export function readApartmentMeta(v: unknown): ApartmentMeta | null {
  const o = (typeof v === 'string' ? safeJson(v) : v) as Record<string, unknown> | null;
  if (!o || typeof o !== 'object' || o.kind !== 'apartment') return null;
  const str = (k: string, max = 120) => (typeof o[k] === 'string' && (o[k] as string).trim() ? (o[k] as string).trim().slice(0, max) : null);
  const lat = Number(o.lat), lng = Number(o.lng), area = o.area === null || o.area === undefined || o.area === '' ? null : Number(o.area);
  const address = str('address'), placeName = str('placeName', 80), lawdCd = str('lawdCd', 5), umdCd = str('umdCd', 5);
  if (!address || !placeName || !lawdCd || !/^\d{5}$/.test(lawdCd) || !umdCd || !/^\d{5}$/.test(umdCd)) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (area !== null && !(Number.isFinite(area) && area > 0 && area < 1000)) return null;
  return { kind: 'apartment', address, roadAddress: str('roadAddress'), placeName, lat, lng, lawdCd, umdCd, umdNm: str('umdNm', 40) ?? '', aptNm: str('aptNm', 80), jibun: str('jibun', 20), aptSeq: str('aptSeq', 40), area };
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** 네이버 부동산 search for the complex; it opens the complex page when the name matches one. */
export const naverLandUrl = (meta: Pick<ApartmentMeta, 'placeName' | 'aptNm'>) => `https://m.land.naver.com/search/result/${encodeURIComponent(meta.placeName || meta.aptNm || '')}`;

/** 국토교통부 실거래가 공개시스템, for checking a deal by hand. */
export const RTMS_URL = 'https://rt.molit.go.kr/pt/gis/gis.do';
