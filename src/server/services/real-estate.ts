/**
 * Apartments: finds one on the map (카카오 로컬, with the 카카오 REST key also used for book
 * search), lists the complexes and areas traded around it, and reads two years of its
 * 시군구's deals from 국토교통부 아파트 매매 실거래가 (공공데이터포털 key) for the asset page.
 * Listings (매물) are not fetched: the page links to 네이버 부동산 instead.
 */
import {
  apartmentReport,
  complexesIn,
  guessComplex,
  MolitApiError,
  parseKakaoPlaces,
  parseMolitTrades,
  parseRegionCode,
  pickMonths,
  PICK_PERIODS,
  readApartmentMeta,
  recentMonths,
  type ApartmentMeta,
  type ApartmentReport,
  type AptTrade,
  type ComplexOption,
  type PlaceHit,
} from '@/domain/real-estate';
import { kstDate, prisma } from '../db';
import { clearServiceKey, serviceKey, setServiceKey } from './api-keys';
import { noteCall, outcomeOf } from './api-usage';
import { audit, UserError } from './portfolios';

const MOLIT_URL = 'https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev';
/** Months of deals the asset page reads: two years, for the year-on-year comparison. */
const REPORT_MONTHS = 24;

async function kakaoKey(userId: string) {
  const k = await serviceKey(userId, 'kakao', 'KAKAO_REST_API_KEY');
  if (!k) throw new UserError('아파트를 찾으려면 연동 · 설정의 책 검색 칸에 카카오 REST API 키를 넣으세요. 같은 키로 지도 검색도 합니다.');
  return k.key;
}

async function molitKey(userId: string) {
  const k = await serviceKey(userId, 'molit', 'DATA_GO_KR_API_KEY');
  if (!k) throw new UserError('실거래가를 보려면 연동 · 설정의 부동산 실거래가 칸에 공공데이터포털 인증키를 넣으세요.');
  return k.key;
}

async function kakao(userId: string, path: string, params: Record<string, string>): Promise<unknown> {
  const key = await kakaoKey(userId);
  let res: Response;
  try {
    res = await fetch(`https://dapi.kakao.com${path}?${new URLSearchParams(params)}`, { headers: { authorization: `KakaoAK ${key}`, accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(8_000) });
  } catch (e) {
    noteCall(userId, 'kakao-local', 'error');
    throw e;
  }
  noteCall(userId, 'kakao-local', outcomeOf(res.status), res.headers);
  if (res.status === 401) throw new UserError('카카오 REST API 키가 올바르지 않습니다. 연동 · 설정에서 확인하세요.');
  if (res.status === 403) throw new UserError('카카오 앱에서 카카오맵(로컬 API)을 쓰도록 켜야 합니다. 카카오 developers의 앱 설정 › 카카오맵에서 사용 설정을 켜세요.');
  if (!res.ok) throw new Error(`kakao ${path} ${res.status}`);
  return res.json();
}

export async function searchApartments(userId: string, query: string): Promise<PlaceHit[]> {
  const q = query.trim().replace(/\s+/g, ' ').slice(0, 80);
  if (q.length < 2) throw new UserError('아파트 이름이나 주소를 두 글자 이상 입력하세요.');
  try {
    return parseKakaoPlaces(await kakao(userId, '/v2/local/search/keyword.json', { query: q, size: '10' }));
  } catch (e) {
    if (e instanceof UserError) throw e;
    console.error('[real-estate] place search failed', e instanceof Error ? e.message : e);
    throw new UserError('지도 검색에 실패했습니다. 잠시 후 다시 시도하세요.');
  }
}

// One district-month of deals rarely changes once it is a few months old; recent months
// still receive late reports (신고 기한 30일), registrations and cancellations. Recently used
// months move to the end, so reading a district's whole history pushes out the least used.
const cache = new Map<string, { at: number; trades: AptTrade[] }>();
const inflight = new Map<string, Promise<AptTrade[]>>();
const CACHE_MAX = 600;

function fresh(ym: string, at: number, today: string) {
  const months = recentMonths(today, 4);
  const yearAgo = recentMonths(today, 13).at(-1)!;
  const ttl = months.includes(ym) ? 6 * 3_600_000 : ym > yearAgo ? 7 * 86_400_000 : 30 * 86_400_000;
  return Date.now() - at < ttl;
}

async function monthTrades(userId: string, key: string, lawdCd: string, ym: string, today: string): Promise<AptTrade[]> {
  const ck = `${lawdCd}:${ym}`;
  const hit = cache.get(ck);
  if (hit && fresh(ym, hit.at, today)) {
    cache.delete(ck);
    cache.set(ck, hit);
    return hit.trades;
  }
  const running = inflight.get(ck);
  if (running) return running;
  const job = (async () => {
    const all: AptTrade[] = [];
    for (let pageNo = 1, retry = 0; pageNo <= 10; pageNo++) {
      const params = new URLSearchParams({ serviceKey: key, LAWD_CD: lawdCd, DEAL_YMD: ym, pageNo: String(pageNo), numOfRows: '1000' });
      let res: Response;
      try {
        res = await fetch(`${MOLIT_URL}?${params}`, { headers: { accept: 'application/xml' }, cache: 'no-store', signal: AbortSignal.timeout(15_000) });
      } catch (e) {
        noteCall(userId, 'molit', 'error');
        throw e;
      }
      const text = await res.text();
      let page: ReturnType<typeof parseMolitTrades>;
      try {
        page = parseMolitTrades(text);
      } catch (e) {
        noteCall(userId, 'molit', e instanceof MolitApiError && ['22', '23'].includes(e.code) ? 'limited' : 'error');
        // 23: too many calls per second, which reading years at once can hit; wait and ask again
        if (e instanceof MolitApiError && e.code === '23' && retry < 3) {
          await new Promise((r) => setTimeout(r, 1_000 * ++retry));
          pageNo--;
          continue;
        }
        throw e;
      }
      noteCall(userId, 'molit', outcomeOf(res.status));
      if (!res.ok) throw new Error(`molit ${res.status}`);
      all.push(...page.trades);
      if (pageNo * 1000 >= page.totalCount || !page.trades.length) break;
    }
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
    cache.set(ck, { at: Date.now(), trades: all });
    return all;
  })().finally(() => inflight.delete(ck));
  inflight.set(ck, job);
  return job;
}

/** A 시군구's deals over the last `months` months, a few months at a time. */
export async function districtTrades(userId: string, lawdCd: string, months: number): Promise<AptTrade[]> {
  const key = await molitKey(userId);
  const today = kstDate();
  const yms = recentMonths(today, months);
  const out: AptTrade[] = [];
  try {
    for (let i = 0; i < yms.length; i += 4) {
      const batch = await Promise.all(yms.slice(i, i + 4).map((ym) => monthTrades(userId, key, lawdCd, ym, today)));
      out.push(...batch.flat());
    }
  } catch (e) {
    if (e instanceof MolitApiError) throw new UserError(`실거래가를 가져오지 못했습니다: ${e.message}`);
    console.error('[real-estate] trades failed', e instanceof Error ? e.message : e);
    throw new UserError('실거래가를 가져오지 못했습니다. 잠시 후 다시 시도하세요.');
  }
  return out;
}

export interface ApartmentOptions {
  place: PlaceHit;
  lawdCd: string;
  umdCd: string;
  umdNm: string;
  /** Period read, as in PICK_PERIODS (0: since 2006) */
  months: number;
  complexes: ComplexOption[];
  /** The complex the place most likely is */
  suggested: string | null;
}

/**
 * For a picked map place: its 법정동, and the complexes and areas traded there over the last
 * `months` (12, 36, 60, or 0 for everything since 2006; see PICK_PERIODS).
 */
export async function apartmentOptions(userId: string, place: PlaceHit, months = 12): Promise<ApartmentOptions> {
  let region: ReturnType<typeof parseRegionCode>;
  try {
    region = parseRegionCode(await kakao(userId, '/v2/local/geo/coord2regioncode.json', { x: String(place.lng), y: String(place.lat) }));
  } catch (e) {
    if (e instanceof UserError) throw e;
    console.error('[real-estate] region failed', e instanceof Error ? e.message : e);
    throw new UserError('주소의 법정동을 찾지 못했습니다. 잠시 후 다시 시도하세요.');
  }
  if (!region) throw new UserError('이 위치의 법정동을 찾지 못했습니다. 다른 검색 결과를 고르세요.');
  const period = PICK_PERIODS.some((p) => p.months === months) ? months : 12;
  const trades = await districtTrades(userId, region.lawdCd, pickMonths(period, kstDate()));
  const complexes = complexesIn(trades, region);
  return { place, ...region, months: period, complexes, suggested: guessComplex(complexes, place) };
}

export async function setApartment(userId: string, assetId: string, raw: string) {
  const meta = readApartmentMeta(raw);
  if (!meta) throw new UserError('아파트를 다시 골라 주세요.');
  const asset = await prisma.asset.findFirst({ where: { id: assetId, userId } });
  if (!asset) throw new UserError('자산을 찾지 못했습니다.');
  if (asset.type !== 'REAL_ESTATE') throw new UserError('부동산 자산에만 아파트를 연결할 수 있습니다.');
  const updated = await prisma.asset.update({ where: { id: assetId }, data: { meta: { ...meta } } });
  await audit(prisma, userId, 'asset', assetId, 'update', asset, updated);
}

export interface ApartmentView {
  meta: ApartmentMeta;
  report: ApartmentReport;
  asOf: string;
}

export async function apartmentView(userId: string, assetId: string): Promise<ApartmentView> {
  const asset = await prisma.asset.findFirst({ where: { id: assetId, userId }, select: { meta: true } });
  const meta = readApartmentMeta(asset?.meta);
  if (!meta) throw new UserError('이 자산에 연결된 아파트가 없습니다.');
  const today = kstDate();
  const trades = await districtTrades(userId, meta.lawdCd, REPORT_MONTHS);
  return { meta, report: apartmentReport(trades, meta, today), asOf: today };
}

export async function saveRealEstateKey(userId: string, input: { key?: string; clear?: boolean }) {
  let key = input.key?.trim();
  if (key) {
    // The portal shows the key twice: as is (Decoding) and URL-encoded (Encoding). Either works.
    if (/%[0-9A-F]{2}/i.test(key)) {
      try {
        key = decodeURIComponent(key);
      } catch {
        throw new UserError('인증키 형식이 올바르지 않습니다.');
      }
    }
    if (key.length < 20 || key.length > 200 || /\s/.test(key)) throw new UserError('공공데이터포털 일반 인증키를 그대로 붙여 넣으세요.');
    await setServiceKey(userId, 'molit', key);
  } else if (input.clear) await clearServiceKey(userId, 'molit');
}

export interface ApartmentSummary {
  holdingId: string;
  name: string;
  qty: string;
  estimate: number | null;
  basis: string | null;
  latest: { date: string; price: number } | null;
  /** 동 price per 3.3㎡, last three months against a year earlier */
  dongChange: number | null;
  umdNm: string;
  error: string | null;
}

/** Every apartment the user holds, for the market board. Assets without a linked apartment are left out. */
export async function myApartments(userId: string): Promise<{ rows: ApartmentSummary[]; unlinked: number }> {
  const holdings = await prisma.holding.findMany({
    where: { portfolio: { userId }, asset: { type: 'REAL_ESTATE' }, lots: { some: { qtyRemaining: { gt: 0 } } } },
    select: { id: true, asset: { select: { id: true, name: true, meta: true } }, lots: { select: { qtyRemaining: true } } },
  });
  const linked = holdings.filter((h) => readApartmentMeta(h.asset.meta));
  const rows = await Promise.all(
    linked.map(async (h): Promise<ApartmentSummary> => {
      const meta = readApartmentMeta(h.asset.meta)!;
      const qty = h.lots.reduce((a, l) => a + Number(l.qtyRemaining), 0).toString();
      const base = { holdingId: h.id, name: h.asset.name, qty, umdNm: meta.umdNm };
      try {
        const { report } = await apartmentView(userId, h.asset.id);
        const latest = report.sameAreaDeals.find((t) => !t.cancelled) ?? null;
        const { recent, yearAgo } = report.dong;
        return { ...base, estimate: report.estimate?.price ?? null, basis: report.estimate?.basis ?? null, latest: latest && { date: latest.date, price: latest.price }, dongChange: recent && yearAgo ? recent / yearAgo - 1 : null, error: null };
      } catch (e) {
        return { ...base, estimate: null, basis: null, latest: null, dongChange: null, error: e instanceof UserError ? e.message : '실거래가를 가져오지 못했습니다.' };
      }
    }),
  );
  return { rows, unlinked: holdings.length - linked.length };
}
