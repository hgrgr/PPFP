/**
 * 청약: a region's apartment 분양 공고 from 청약홈 (한국부동산원, via 공공데이터포털 odcloud), each
 * with its 주택형, 분양가, 1순위 경쟁률 and 당첨가점, and the region's 청약 temperature by month.
 *
 * Services (each needs its own 활용신청 on data.go.kr with the same 인증키):
 *   ApplyhomeInfoDetailSvc (15098547): getAPTLttotPblancDetail, getAPTLttotPblancMdl
 *   ApplyhomeInfoCmpetRtSvc (15098905): getAPTLttotPblancCmpet, getAptLttotPblancScore
 * Field names are from their published swagger (infuser.odcloud.kr stages 37000, 36148).
 */
import { addMonths, type ChartData } from './indicators';
import { PYEONG } from './real-estate';

export const APPLY_BASE = 'https://api.odcloud.kr/api';
export const APPLY_PATHS = {
  detail: 'ApplyhomeInfoDetailSvc/v1/getAPTLttotPblancDetail',
  models: 'ApplyhomeInfoDetailSvc/v1/getAPTLttotPblancMdl',
  cmpet: 'ApplyhomeInfoCmpetRtSvc/v1/getAPTLttotPblancCmpet',
  score: 'ApplyhomeInfoCmpetRtSvc/v1/getAptLttotPblancScore',
} as const;
export const APPLY_PORTAL = ['https://www.data.go.kr/data/15098547/openapi.do', 'https://www.data.go.kr/data/15098905/openapi.do'];

type Row = Record<string, unknown>;
export class ApplyApiError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

/** An odcloud answer: its rows and how many there are in all */
export function parseApply(body: unknown): { rows: Row[]; total: number } {
  const b = body as { data?: Row[]; totalCount?: number; matchCount?: number; code?: number; msg?: string } | null;
  if (!b || !Array.isArray(b.data)) throw new ApplyApiError(String(b?.code ?? ''), b?.msg ?? '청약홈 응답을 읽지 못했습니다');
  return { rows: b.data, total: Number(b.matchCount ?? b.totalCount ?? b.data.length) };
}

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());
const num = (v: unknown): number | null => {
  const s = str(v).replace(/[,\s]/g, '');
  if (!s) return null;
  const n = Number(s.replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const day = (v: unknown) => (/^\d{4}-\d{2}-\d{2}/.test(str(v)) ? str(v).slice(0, 10) : /^\d{8}$/.test(str(v)) ? `${str(v).slice(0, 4)}-${str(v).slice(4, 6)}-${str(v).slice(6)}` : null);

export interface Listing {
  id: string;
  pblancNo: string;
  name: string;
  /** 공급지역명: 서울, 경기 … */
  area: string;
  address: string;
  households: number | null;
  announced: string | null;
  receiptFrom: string | null;
  receiptTo: string | null;
  winners: string | null;
  moveIn: string | null;
  builder: string;
  url: string;
  flags: string[];
}

export function readListing(r: Row): Listing {
  const flags = [
    str(r.SPECLT_RDN_EARTH_AT) === 'Y' && '투기과열지구',
    str(r.MDAT_TRGET_AREA_SECD) === 'Y' && '조정대상지역',
    str(r.PARCPRC_ULS_AT) === 'Y' && '분양가상한제',
    str(r.IMPRMN_BSNS_AT) === 'Y' && '정비사업',
    str(r.PUBLIC_HOUSE_EARTH_AT) === 'Y' && '공공주택지구',
  ].filter((x): x is string => !!x);
  const mv = str(r.MVN_PREARNGE_YM);
  return {
    id: str(r.HOUSE_MANAGE_NO),
    pblancNo: str(r.PBLANC_NO),
    name: str(r.HOUSE_NM),
    area: str(r.SUBSCRPT_AREA_CODE_NM),
    address: str(r.HSSPLY_ADRES),
    households: num(r.TOT_SUPLY_HSHLDCO),
    announced: day(r.RCRIT_PBLANC_DE),
    receiptFrom: day(r.RCEPT_BGNDE),
    receiptTo: day(r.RCEPT_ENDDE),
    winners: day(r.PRZWNER_PRESNATN_DE),
    moveIn: /^\d{6}$/.test(mv) ? `${mv.slice(0, 4)}.${mv.slice(4)}` : mv || null,
    builder: str(r.CNSTRCT_ENTRPS_NM),
    url: str(r.PBLANC_URL) || str(r.HMPG_ADRES),
    flags,
  };
}

export interface Model {
  model: string;
  /** 주택형, e.g. "084.9800A" → "84.98A" */
  type: string;
  /** 공급면적 ㎡ */
  supplyArea: number | null;
  general: number;
  special: number;
  /** 분양 최고가 (원) */
  topPrice: number | null;
  /** 1순위 접수 (해당지역 + 기타) and 경쟁률 on the general supply */
  rank1: number;
  rate: number | null;
  /** 1순위 해당지역 경쟁률 as published */
  localRate: string | null;
  score: { min: number | null; max: number | null; avg: number | null } | null;
}

/** "084.9800A" → "84.98A", "059.9442B" → "59.94B" (two decimals at most, as 청약홈 shows them) */
export const typeName = (v: string) => {
  const m = v.trim().match(/^0*(\d+(?:\.\d+)?)(.*)$/);
  if (!m) return v.trim();
  return `${Number(Number(m[1]).toFixed(2))}${m[2]}`;
};

export function readModels(models: Row[], cmpet: Row[], scores: Row[]): Model[] {
  return models
    .map((m) => {
      const no = str(m.MODEL_NO);
      const mine = cmpet.filter((c) => str(c.MODEL_NO) === no);
      const rank1 = mine.filter((c) => str(c.SUBSCRPT_RANK_CODE) === '1').reduce((a, c) => a + (num(c.REQ_CNT) ?? 0), 0);
      const general = num(m.SUPLY_HSHLDCO) ?? num(mine[0]?.SUPLY_HSHLDCO) ?? 0;
      const local = mine.find((c) => str(c.SUBSCRPT_RANK_CODE) === '1' && str(c.RESIDE_SECD) === '01');
      const sc = scores.filter((s) => str(s.MODEL_NO) === no || str(s.HOUSE_TY) === str(m.HOUSE_TY));
      const scoreOf = (k: string) => {
        const xs = sc.map((s) => num(s[k])).filter((x): x is number => x !== null && x > 0);
        return xs.length ? xs : null;
      };
      const mins = scoreOf('LWET_SCORE'), maxs = scoreOf('TOP_SCORE'), avgs = scoreOf('AVRG_SCORE');
      const top = num(m.LTTOT_TOP_AMOUNT);
      return {
        model: no,
        type: typeName(str(m.HOUSE_TY)),
        supplyArea: num(m.SUPLY_AR),
        general,
        special: num(m.SPSPLY_HSHLDCO) ?? 0,
        topPrice: top === null ? null : top * 10_000,
        rank1,
        rate: general > 0 && mine.length ? rank1 / general : null,
        localRate: local ? str(local.CMPET_RATE) || null : null,
        score: mins || maxs || avgs ? { min: mins ? Math.min(...mins) : null, max: maxs ? Math.max(...maxs) : null, avg: avgs ? avgs.reduce((a, b) => a + b, 0) / avgs.length : null } : null,
      };
    })
    .sort((a, b) => (a.supplyArea ?? 0) - (b.supplyArea ?? 0));
}

export interface ListingSummary {
  /** 1순위 접수 ÷ 일반공급 세대 over every 주택형 */
  rate: number | null;
  /** The busiest 주택형 */
  maxRate: { type: string; rate: number } | null;
  /** 분양 최고가 per 3.3㎡ of 공급면적, averaged over 주택형 weighted by households (원) */
  perPyeong: number | null;
  score: { min: number | null; avg: number | null } | null;
}

export function summarizeListing(models: Model[]): ListingSummary {
  const withRate = models.filter((m) => m.rate !== null && m.general > 0);
  const gen = withRate.reduce((a, m) => a + m.general, 0);
  const rate = gen ? withRate.reduce((a, m) => a + m.rank1, 0) / gen : null;
  const best = withRate.reduce<Model | null>((b, m) => (!b || (m.rate ?? 0) > (b.rate ?? 0) ? m : b), null);
  const priced = models.filter((m) => m.topPrice && m.supplyArea);
  const units = priced.reduce((a, m) => a + (m.general + m.special || 1), 0);
  const perPyeong = units ? priced.reduce((a, m) => a + ((m.topPrice! / m.supplyArea!) * PYEONG) * (m.general + m.special || 1), 0) / units : null;
  const scored = models.flatMap((m) => (m.score ? [m.score] : []));
  const mins = scored.map((s) => s.min).filter((x): x is number => x !== null);
  const avgs = scored.map((s) => s.avg).filter((x): x is number => x !== null);
  return {
    rate,
    maxRate: best && best.rate !== null ? { type: best.type, rate: best.rate } : null,
    perPyeong,
    score: mins.length || avgs.length ? { min: mins.length ? Math.min(...mins) : null, avg: avgs.length ? avgs.reduce((a, b) => a + b, 0) / avgs.length : null } : null,
  };
}

/** Does a listing lie in the region: its 공급지역 is the 시도, and the address names the 시군구 (and 구) */
export function inRegion(l: Pick<Listing, 'area' | 'address'>, sido: string, parts: string[]): boolean {
  if (sido !== '전국' && !l.area.startsWith(sido) && !l.address.includes(sido)) return false;
  return parts.every((p) => l.address.includes(p));
}

/**
 * Month by month: how many listings and the 1순위 rate over all of them (one chart), and the
 * average price per 평 (another; 만원 do not share an axis with a rate).
 */
export function monthlyApply(list: { listing: Listing; summary: ListingSummary; general: number; rank1: number }[]): { rate: ChartData; price: ChartData } {
  const by = new Map<string, { n: number; gen: number; req: number; ppSum: number; ppN: number }>();
  for (const x of list) {
    if (!x.listing.announced) continue;
    const k = `${x.listing.announced.slice(0, 7)}-01`;
    const m = by.get(k) ?? { n: 0, gen: 0, req: 0, ppSum: 0, ppN: 0 };
    m.n++;
    m.gen += x.general;
    m.req += x.rank1;
    if (x.summary.perPyeong) {
      m.ppSum += x.summary.perPyeong;
      m.ppN++;
    }
    by.set(k, m);
  }
  const months = [...by.keys()].sort();
  const rows: Record<string, number | string | null>[] = [];
  if (months.length) {
    for (let d = months[0]; d <= months.at(-1)!; d = addMonths(d, 1)) {
      const m = by.get(d);
      rows.push({ date: d, n: m?.n ?? 0, rate: m && m.gen ? m.req / m.gen : null, pp: m && m.ppN ? m.ppSum / m.ppN / 10_000 : null });
    }
  }
  const lastWith = (k: string) => [...rows].reverse().find((r) => r[k] !== null && r[k] !== 0);
  const lr = lastWith('rate'), lp = lastWith('pp');
  return {
    rate: {
      lines: [
        { key: 'n', label: '분양 공고 수', color: 'var(--muted)', kind: 'bar', axis: 'right' },
        { key: 'rate', label: '1순위 평균 경쟁률', color: 'var(--series-4)' },
      ],
      rows: rows.map((r) => ({ date: r.date, n: r.n, rate: r.rate })),
      unit: ':1',
      rightUnit: '건',
      latest: lr ? [{ label: '최근 1순위 경쟁률', value: `${Number(lr.rate).toFixed(1)}:1`, date: String(lr.date).slice(0, 7) }] : [],
      note: '그달 공고들의 1순위 접수 건수를 일반공급 세대수로 나눈 값입니다. 결과가 나온 공고만 셉니다.',
    },
    price: {
      lines: [{ key: 'pp', label: '평균 분양가 (3.3㎡당)', color: 'var(--series-1)' }],
      rows: rows.map((r) => ({ date: r.date, pp: r.pp })),
      unit: '만원',
      latest: lp ? [{ label: '최근 평균 분양가', value: `${Math.round(Number(lp.pp)).toLocaleString('ko-KR')}만원/3.3㎡`, date: String(lp.date).slice(0, 7) }] : [],
      note: '주택형별 최고 분양가를 공급면적 3.3㎡당으로 바꿔 세대수로 가중 평균했습니다.',
    },
  };
}
