/**
 * Real estate: reads 국토교통부 매매 실거래가 (apis.data.go.kr, XML) and 카카오 로컬 answers,
 * and turns a district's trades into what a real estate asset shows. Apartments, villas and
 * officetels are buildings whose own deals can be found (by name and 지번): their recent
 * deals, an estimated price, and how the neighborhood moved. Houses, land and shops are
 * reported with the 지번 masked, so they get the 동's deals and a price per ㎡ to compare
 * with. Pure; the service does the calls and the caching.
 */

/** The 매매 실거래가 service of each kind (공공데이터포털 국토교통부, one 활용신청 each). */
export const RTMS_SERVICES = {
  apartment: { path: 'RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev', title: '아파트 매매 실거래가 상세 자료', dataId: '15126468' },
  villa: { path: 'RTMSDataSvcRHTrade/getRTMSDataSvcRHTrade', title: '연립다세대 매매 실거래가 자료', dataId: '15126467' },
  officetel: { path: 'RTMSDataSvcOffiTrade/getRTMSDataSvcOffiTrade', title: '오피스텔 매매 실거래가 자료', dataId: '15126464' },
  house: { path: 'RTMSDataSvcSHTrade/getRTMSDataSvcSHTrade', title: '단독/다가구 매매 실거래가 자료', dataId: '15126465' },
  land: { path: 'RTMSDataSvcLandTrade/getRTMSDataSvcLandTrade', title: '토지 매매 실거래가 자료', dataId: '15126466' },
  commercial: { path: 'RTMSDataSvcNrgTrade/getRTMSDataSvcNrgTrade', title: '상업업무용 부동산 매매 실거래가 자료', dataId: '15126463' },
} as const;
export type TradeKind = keyof typeof RTMS_SERVICES;
export const TRADE_KINDS = Object.keys(RTMS_SERVICES) as TradeKind[];
export const rtmsPortalUrl = (kind: TradeKind) => `https://www.data.go.kr/data/${RTMS_SERVICES[kind].dataId}/openapi.do`;

/** Kinds whose own building can be picked from the deals: matched by name and 지번. */
export const BUILDING_KINDS = ['apartment', 'villa', 'officetel'] as const;
export type BuildingKind = (typeof BUILDING_KINDS)[number];
/** Kinds reported with the 지번 masked ("1**"): compared with the 동's deals per ㎡. */
export const LOT_KINDS = ['house', 'land', 'commercial'] as const;
export type LotKind = (typeof LOT_KINDS)[number];
export const isBuildingKind = (k: unknown): k is BuildingKind => (BUILDING_KINDS as readonly unknown[]).includes(k);
export const isLotKind = (k: unknown): k is LotKind => (LOT_KINDS as readonly unknown[]).includes(k);

/** One reported sale. Prices in 원 (the API reports 만원). */
export interface AptTrade {
  /** YYYY-MM-DD contract date */
  date: string;
  price: number;
  /**
   * ㎡ the price is compared on: 전용면적 for apartments, villas and officetels, 대지면적 for
   * houses, the traded area for land, 건물면적 for shops
   */
  area: number;
  floor: number | null;
  /** Building name (아파트, 연립다세대, 오피스텔); empty for houses, land and shops */
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
  /** YYYY-MM-DD the ownership transfer was registered (등기), once it is */
  rgstDate: string | null;
  /** 매수자 · 매도자: 개인, 법인, 공공기관, 기타 */
  buyer: string | null;
  seller: string | null;
  /** 대지권면적 (villa) or 대지면적 (house, shop), ㎡ */
  landArea?: number | null;
  /** 연면적 of a house, ㎡ */
  floorArea?: number | null;
  /** 단독/다가구 (house), 지목 (land), 건물주용도 (shop) */
  use?: string | null;
  /** 용도지역 (land, shop) */
  zoning?: string | null;
  /** 일반/집합 (shop) */
  buildingType?: string | null;
  /** A share of the lot or building was sold (지분거래) */
  share?: boolean;
}

/**
 * What a real estate asset remembers about the building it is (Asset.meta): an apartment,
 * a villa or an officetel. The 실거래가 fields name the building as the deals do.
 */
export interface ApartmentMeta {
  kind: BuildingKind;
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
/** "20260315", "26.03.15", "2026-03-15" → "2026-03-15" */
function dayOf(v: string | null): string | null {
  if (!v) return null;
  const d = v.replace(/\D/g, '');
  if (d.length === 8) return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`;
  if (d.length === 6) return `20${d.slice(0, 2)}-${d.slice(2, 4)}-${d.slice(4)}`;
  return null;
}
const pad = (v: string | null, len: number) => (v && /^\d+$/.test(v) ? v.padStart(len, '0') : null);

/** Error codes the data.go.kr gateway and the service send back, in words a user can act on. */
const MOLIT_ERRORS: Record<string, string> = {
  '03': '해당 기간에 거래가 없습니다.',
  '10': '요청값이 잘못되었습니다.',
  '12': '없어졌거나 바뀐 서비스입니다.',
  '20': '이 서비스에 활용신청이 되어 있지 않습니다.',
  '22': '오늘 호출 한도를 넘었습니다. 내일 다시 시도하세요.',
  '23': '잠깐 사이 너무 많이 호출했습니다. 잠시 후 다시 시도하세요.',
  '30': '등록되지 않은 서비스 키입니다. 공공데이터포털의 일반 인증키(Decoding)를 넣었는지 확인하세요.',
  '31': '기한이 지난 서비스 키입니다. 공공데이터포털에서 연장하세요.',
  '32': '등록되지 않은 IP에서 호출했습니다.',
};

/** Parses one page of a 실거래가 response of `kind`. Throws MolitApiError for an error answer. */
export function parseMolitTrades(xml: string, kind: TradeKind = 'apartment'): { trades: AptTrade[]; totalCount: number } {
  const fail = (code: string, fallback: string | null) => {
    const msg = code === '20' ? `이 서비스에 활용신청이 되어 있지 않습니다. 공공데이터포털에서 국토교통부 ${RTMS_SERVICES[kind].title}를 활용신청하세요.` : MOLIT_ERRORS[code] ?? fallback ?? '실거래가 서비스가 오류를 보냈습니다.';
    return new MolitApiError(msg, code);
  };
  const auth = tag(xml, 'returnReasonCode');
  if (auth && auth !== '00') throw fail(auth, tag(xml, 'returnAuthMsg'));
  const code = tag(xml, 'resultCode');
  if (code && !/^0+$/.test(code) && code !== '03') throw fail(code.replace(/^0(?=\d\d$)/, ''), tag(xml, 'resultMsg'));
  const trades: AptTrade[] = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const it = m[1];
    const y = num(pick(it, 'dealYear', '년'));
    const mo = num(pick(it, 'dealMonth', '월'));
    const d = num(pick(it, 'dealDay', '일'));
    const man = num(pick(it, 'dealAmount', '거래금액'));
    const landArea = num(pick(it, 'landAr', 'plottageAr', '대지권면적', '대지면적'));
    const floorArea = kind === 'house' ? num(pick(it, 'totalFloorAr', '연면적')) : null;
    const area =
      kind === 'house' ? landArea : kind === 'land' ? num(pick(it, 'dealArea', '거래면적')) : kind === 'commercial' ? num(pick(it, 'buildingAr', '건물면적')) : num(pick(it, 'excluUseAr', 'exclUseAr', '전용면적'));
    const name = isBuildingKind(kind) ? pick(it, 'aptNm', '아파트', 'mhouseNm', '연립다세대', 'offiNm', '단지') : '';
    if (!y || !mo || !d || !man || !area || name === null) continue;
    const cdeal = pick(it, 'cdealType', '해제여부');
    const share = pick(it, 'shareDealingType', '지분거래구분');
    const trade: AptTrade = {
      date: `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
      price: man * 10_000,
      area,
      floor: num(pick(it, 'floor', '층')),
      aptNm: name.replace(/\s+/g, ' '),
      umdCd: pad(pick(it, 'umdCd', '법정동읍면동코드'), 5),
      umdNm: (pick(it, 'umdNm', '법정동') ?? '').replace(/\s+/g, ' '),
      jibun: pick(it, 'jibun', '지번'),
      aptSeq: pick(it, 'aptSeq'),
      buildYear: num(pick(it, 'buildYear', '건축년도')),
      cancelled: !!cdeal && cdeal.toUpperCase() === 'O',
      dealing: pick(it, 'dealingGbn', '거래유형'),
      aptDong: pick(it, 'aptDong'),
      rgstDate: dayOf(pick(it, 'rgstDate', '등기일자')),
      buyer: pick(it, 'buyerGbn', '매수자'),
      seller: pick(it, 'slerGbn', '매도자'),
    };
    if (kind !== 'apartment') {
      Object.assign(trade, {
        landArea: kind === 'officetel' || kind === 'land' ? null : landArea,
        floorArea,
        use: kind === 'house' ? pick(it, 'houseType', '주택유형') : kind === 'land' ? pick(it, 'jimok', '지목') : kind === 'commercial' ? pick(it, 'buildingUse', '건물주용도') : null,
        zoning: pick(it, 'landUse', '용도지역'),
        buildingType: kind === 'commercial' ? pick(it, 'buildingType', '건물유형') : null,
        share: !!share && /지분|^Y$/i.test(share),
      });
    }
    trades.push(trade);
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

/** Map categories that name each kind, so its places come first among keyword hits. */
const KIND_CATEGORY: Partial<Record<TradeKind, RegExp>> = { apartment: /아파트/, officetel: /오피스텔/, villa: /빌라|연립|다세대|주택/ };

export function parseKakaoPlaces(body: unknown, kind: TradeKind = 'apartment'): PlaceHit[] {
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
  // Places of the kind first (an apartment complex before the stores inside it); the rest after.
  const re = KIND_CATEGORY[kind];
  if (!re) return hits;
  const last = new RegExp(`(${re.source})$`);
  const rank = (h: PlaceHit) => (last.test(h.category) ? 0 : re.test(h.category) ? 1 : 2);
  return hits.map((h, i) => ({ h, i })).sort((a, b) => rank(a.h) - rank(b.h) || a.i - b.i).map((x) => x.h);
}

/** 카카오 주소 검색 hits as places: named by the building when the road address has one, else by the address. */
export function parseKakaoAddresses(body: unknown): PlaceHit[] {
  const docs = (body as { documents?: unknown })?.documents;
  if (!Array.isArray(docs)) return [];
  return docs.flatMap((d: Record<string, unknown>) => {
    const jibun = (d.address as Record<string, unknown> | null)?.address_name;
    const road = d.road_address as Record<string, unknown> | null;
    const address = typeof jibun === 'string' && jibun.trim() ? jibun.trim() : typeof d.address_name === 'string' ? d.address_name.trim() : '';
    const lat = Number(d.y), lng = Number(d.x);
    if (!address || !Number.isFinite(lat) || !Number.isFinite(lng)) return [];
    const roadAddress = typeof road?.address_name === 'string' && road.address_name.trim() ? road.address_name.trim() : null;
    const building = typeof road?.building_name === 'string' ? road.building_name.trim() : '';
    return [{ name: building || address, address, roadAddress, lat, lng, category: '주소' }];
  });
}

/** 카카오 좌표→행정구역 answer: the 10-digit 법정동 code (region_type "B"). */
export function parseRegionCode(body: unknown): { lawdCd: string; umdCd: string; umdNm: string } | null {
  const docs = (body as { documents?: unknown })?.documents;
  if (!Array.isArray(docs)) return null;
  const b = docs.find((d: Record<string, unknown>) => d.region_type === 'B' && typeof d.code === 'string' && /^\d{10}$/.test(d.code)) as Record<string, string> | undefined;
  if (!b) return null;
  // 읍·면 areas name the 리 too ("와부읍 도곡리"), as the deals of houses and land do.
  const umdNm = [b.region_3depth_name, b.region_4depth_name].filter((x) => typeof x === 'string' && x.trim()).join(' ').trim();
  return { lawdCd: b.code.slice(0, 5), umdCd: b.code.slice(5), umdNm };
}

/**
 * Is a deal in the 동 of `place`? By code when the deal has one (apartments); else by name,
 * where a 리 matches with or without its 읍·면 ("도곡리", "와부읍 도곡리").
 */
export function inDong(t: Pick<AptTrade, 'umdCd' | 'umdNm'>, place: { umdCd: string; umdNm: string }): boolean {
  if (t.umdCd) return t.umdCd === place.umdCd;
  if (t.umdNm === place.umdNm) return true;
  const a = t.umdNm.split(' '), b = place.umdNm.split(' ');
  return a.at(-1) === b.at(-1) && (a.length === 1 || b.length === 1 || a[0] === b[0]);
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
  /** Latest contract date among its deals */
  lastDate: string;
  /** Areas traded in this complex, most traded first */
  areas: { area: number; deals: number; lastPrice: number; lastDate: string }[];
}

/** First contract month the 실거래가 API has (거래신고제, 2006). */
export const RTMS_FIRST_MONTH = '2006-01';

/** How far back the apartment picker reads; 0 is everything since RTMS_FIRST_MONTH. */
export const PICK_PERIODS = [
  { months: 12, label: '1년' },
  { months: 36, label: '3년' },
  { months: 60, label: '5년' },
  { months: 0, label: '전체 (2006~)' },
] as const;

/** Contract months from RTMS_FIRST_MONTH up to `today`'s, inclusive. */
export function monthsSinceFirst(today: string): number {
  const [y, m] = today.split('-').map(Number);
  const [y0, m0] = RTMS_FIRST_MONTH.split('-').map(Number);
  return (y - y0) * 12 + (m - m0) + 1;
}

/** The picker's period in months, clamped to what the API has; unknown values fall back to a year. */
export function pickMonths(months: number, today: string): number {
  const all = monthsSinceFirst(today);
  if (!PICK_PERIODS.some((p) => p.months === months)) return 12;
  return months === 0 ? all : Math.min(months, all);
}

/** "최근 3년", "2006년 이후" */
export const periodLabel = (months: number) => (months === 0 ? `${RTMS_FIRST_MONTH.slice(0, 4)}년 이후` : `최근 ${months / 12}년`);

export const complexKey = (t: Pick<AptTrade, 'aptSeq' | 'umdCd' | 'umdNm' | 'jibun' | 'aptNm'>) => t.aptSeq ?? `${t.umdCd ?? t.umdNm}|${t.jibun ?? ''}|${t.aptNm}`;

/** Two trades are the same unit type when their 전용면적 differ by under 0.5㎡. */
export const sameArea = (a: number, b: number) => Math.abs(a - b) < 0.5;

/** The complexes traded in one 법정동, with their areas. */
export function complexesIn(trades: AptTrade[], dong: { umdCd: string; umdNm: string }): ComplexOption[] {
  const groups = new Map<string, AptTrade[]>();
  for (const t of trades.filter((x) => inDong(x, dong))) {
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
      return { key, aptNm: sorted[0].aptNm, jibun: sorted[0].jibun, aptSeq: sorted[0].aptSeq, buildYear: sorted[0].buildYear, deals: ts.length, lastDate: sorted[0].date, areas };
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
  return inDong(t, meta) && t.aptNm === meta.aptNm && (!meta.jibun || !t.jibun || t.jibun === meta.jibun);
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
  const dongTrades = trades.filter((t) => inDong(t, meta));
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

  return {
    own,
    sameAreaDeals,
    estimate: area ? estimatePrice(own, area, today) : null,
    areas,
    nearby,
    dong: dongTrend(live, today),
  };
}

/** A 동's price per 3.3㎡: the last three months against a year earlier, and month by month. */
function dongTrend(live: AptTrade[], today: string): DongTrend {
  // One month of a 동 holds few deals of mixed buildings, so each month pools the two before it.
  const byMonth = new Map<string, number[]>();
  for (const t of live) byMonth.set(t.date.slice(0, 7), [...(byMonth.get(t.date.slice(0, 7)) ?? []), perPyeong(t)]);
  const months = [...byMonth.keys()].sort();
  const monthly = months.map((month) => {
    const from = monthsBefore(`${month}-01`, 2).slice(0, 7);
    const xs = months.filter((m) => m >= from && m <= month).flatMap((m) => byMonth.get(m)!);
    return { month, perPyeong: median(xs)!, deals: byMonth.get(month)!.length };
  });
  const window = (from: string, to: string) => live.filter((t) => t.date >= from && t.date < to).map(perPyeong);
  const recent = window(monthsBefore(today, 3), '9999');
  const yearAgo = window(monthsBefore(today, 15), monthsBefore(today, 12));
  return { recent: median(recent), yearAgo: median(yearAgo), recentDeals: recent.length, monthly };
}

/**
 * What a house, a piece of land or a shop remembers (Asset.meta): where it is, its area,
 * and which deals of its 동 to compare with. Their deals hide the 지번, so the asset is
 * not matched to its own deals.
 */
export interface LotMeta {
  kind: LotKind;
  /** 지번 주소 */
  address: string;
  roadAddress: string | null;
  placeName: string;
  lat: number;
  lng: number;
  lawdCd: string;
  umdCd: string;
  umdNm: string;
  jibun: string | null;
  /** ㎡ compared on: 대지면적 (house), 토지 면적 (land), 건물 면적 (shop) */
  area: number | null;
  /** Compare only deals of this 주택 유형 / 지목 / 건물 용도; null for all of the kind */
  use: string | null;
}

/** What each lot kind's area is, in words. */
export const LOT_AREA_LABEL: Record<LotKind, string> = { house: '대지면적', land: '토지 면적', commercial: '건물 면적' };
/** What each lot kind's `use` is, in words. */
export const LOT_USE_LABEL: Record<LotKind, string> = { house: '주택 유형', land: '지목', commercial: '건물 용도' };

/** A masked 지번 ("1**", "12*-3") could be `jibun` ("123"): same length, same digits where shown. */
export function maskedJibunFits(masked: string | null, jibun: string | null): boolean {
  if (!masked || !jibun || !masked.includes('*')) return false;
  const [m, j] = [masked.replace(/\s/g, ''), jibun.replace(/\s/g, '')];
  return m.length === j.length && [...m].every((c, i) => c === '*' || c === j[i]);
}

export interface LotDeal extends AptTrade {
  /** The masked 지번 fits the asset's own */
  maybeOwn: boolean;
}

export interface LotReport {
  /** The 동's deals of the kind (and use, when set) over the period read, newest first */
  deals: LotDeal[];
  /** Uses traded in the 동, most traded first */
  uses: { use: string; deals: number }[];
  /** Median price per ㎡ over the last year, leaving out cancelled and share deals */
  perArea: number | null;
  perAreaDeals: number;
  /** perArea × the asset's area: what the 동's deals put it at, for reference */
  reference: { price: number; basis: string } | null;
  dong: DongTrend;
}

/** The 동's uses of a lot kind, most traded first. */
export function lotUses(trades: AptTrade[], dong: { umdCd: string; umdNm: string }): { use: string; deals: number }[] {
  const counts = new Map<string, number>();
  for (const t of trades) if (t.use && inDong(t, dong)) counts.set(t.use, (counts.get(t.use) ?? 0) + 1);
  return [...counts.entries()].map(([use, deals]) => ({ use, deals })).sort((a, b) => b.deals - a.deals || a.use.localeCompare(b.use, 'ko'));
}

/** Everything the panel of a house, land or shop shows, from its 시군구's trades of that kind. */
export function lotReport(trades: AptTrade[], meta: LotMeta, today: string): LotReport {
  const dongTrades = trades.filter((t) => inDong(t, meta));
  const deals = dongTrades
    .filter((t) => !meta.use || t.use === meta.use)
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((t) => ({ ...t, maybeOwn: maskedJibunFits(t.jibun, meta.jibun) }));
  // A share deal prices part of the lot; its 면적 is not always the part sold.
  const live = deals.filter((t) => !t.cancelled && !t.share);
  const year = live.filter((t) => t.date >= monthsBefore(today, 12));
  const perArea = median(year.map((t) => t.price / t.area));
  const what = [meta.umdNm, meta.use ?? propertyKindLabel(meta.kind)].join(' ');
  const reference =
    perArea !== null && meta.area
      ? { price: Math.round((perArea * meta.area) / 10_000) * 10_000, basis: `${what} 최근 1년 거래 ${year.length}건의 ㎡당 중앙값 × ${LOT_AREA_LABEL[meta.kind]} ${meta.area}㎡` }
      : null;
  return { deals, uses: lotUses(dongTrades, meta), perArea, perAreaDeals: year.length, reference, dong: dongTrend(live, today) };
}

/** Kinds of real estate an asset can be; all but 기타 link to 실거래가 (ApartmentMeta or LotMeta). */
export const PROPERTY_KINDS = [
  ['apartment', '아파트'],
  ['villa', '빌라 · 연립 · 다세대'],
  ['officetel', '오피스텔'],
  ['house', '단독 · 다가구 주택'],
  ['land', '토지'],
  ['commercial', '상가 · 사무실'],
  ['other', '기타 부동산'],
] as const;
export type PropertyKind = (typeof PROPERTY_KINDS)[number][0];
export const propertyKindLabel = (kind: string) => PROPERTY_KINDS.find(([k]) => k === kind)?.[1] ?? '부동산';
/** "빌라 · 연립 · 다세대" → "빌라", for short phrases */
export const propertyKindShort = (kind: string) => propertyKindLabel(kind).split(' ')[0];

/** Real estate not linked to 실거래가: its kind, and the address and area written by hand. */
export interface PropertyMeta {
  kind: Exclude<PropertyKind, 'apartment'>;
  address: string | null;
  /** ㎡ */
  area: number | null;
}

const isLinked = (o: Record<string, unknown>) => typeof o.lawdCd === 'string';

/** Reads a PropertyMeta back from Asset.meta or a form; null for an apartment, a linked property or anything else. */
export function readPropertyMeta(v: unknown): PropertyMeta | null {
  const o = (typeof v === 'string' ? safeJson(v) : v) as Record<string, unknown> | null;
  if (!o || typeof o !== 'object' || o.kind === 'apartment' || isLinked(o) || !PROPERTY_KINDS.some(([k]) => k === o.kind)) return null;
  const address = typeof o.address === 'string' && o.address.trim() ? o.address.trim().slice(0, 120) : null;
  const area = o.area === null || o.area === undefined || o.area === '' ? null : Number(o.area);
  if (area !== null && !(Number.isFinite(area) && area > 0 && area < 1_000_000)) return null;
  return { kind: o.kind as PropertyMeta['kind'], address, area };
}

/** The place fields both linked metas share, checked; null when any is missing or malformed. */
function readPlace(o: Record<string, unknown>, maxArea: number) {
  const str = (k: string, max = 120) => (typeof o[k] === 'string' && (o[k] as string).trim() ? (o[k] as string).trim().slice(0, max) : null);
  const lat = Number(o.lat), lng = Number(o.lng), area = o.area === null || o.area === undefined || o.area === '' ? null : Number(o.area);
  const address = str('address'), placeName = str('placeName', 80), lawdCd = str('lawdCd', 5), umdCd = str('umdCd', 5);
  if (!address || !placeName || !lawdCd || !/^\d{5}$/.test(lawdCd) || !umdCd || !/^\d{5}$/.test(umdCd)) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (area !== null && !(Number.isFinite(area) && area > 0 && area < maxArea)) return null;
  return { str, place: { address, roadAddress: str('roadAddress'), placeName, lat, lng, lawdCd, umdCd, umdNm: str('umdNm', 40) ?? '', jibun: str('jibun', 20), area } };
}

/** Reads an ApartmentMeta (an apartment, villa or officetel) back from Asset.meta or a form field; null when it is not one. */
export function readApartmentMeta(v: unknown): ApartmentMeta | null {
  const o = (typeof v === 'string' ? safeJson(v) : v) as Record<string, unknown> | null;
  if (!o || typeof o !== 'object' || !isBuildingKind(o.kind)) return null;
  const r = readPlace(o, 1000);
  if (!r) return null;
  const { address, roadAddress, placeName, lat, lng, lawdCd, umdCd, umdNm, jibun, area } = r.place;
  return { kind: o.kind, address, roadAddress, placeName, lat, lng, lawdCd, umdCd, umdNm, aptNm: r.str('aptNm', 80), jibun, aptSeq: r.str('aptSeq', 40), area };
}

/** Reads a LotMeta (a house, land or shop linked to its 동's deals) back; null when it is not one. */
export function readLotMeta(v: unknown): LotMeta | null {
  const o = (typeof v === 'string' ? safeJson(v) : v) as Record<string, unknown> | null;
  if (!o || typeof o !== 'object' || !isLotKind(o.kind)) return null;
  const r = readPlace(o, 10_000_000);
  if (!r) return null;
  return { kind: o.kind, ...r.place, use: r.str('use', 40) };
}

/** The 실거래가 link of a real estate asset, whichever kind it is. */
export const readLinkedMeta = (v: unknown): ApartmentMeta | LotMeta | null => readApartmentMeta(v) ?? readLotMeta(v);

/** The kind of a real estate asset from its meta; an asset without one is an apartment not yet linked. */
export function propertyKindOf(v: unknown): PropertyKind {
  const o = (typeof v === 'string' ? safeJson(v) : v) as Record<string, unknown> | null;
  const k = o && typeof o === 'object' ? o.kind : null;
  return PROPERTY_KINDS.some(([x]) => x === k) ? (k as PropertyKind) : 'apartment';
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
