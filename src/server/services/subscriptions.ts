/**
 * 청약 view: a region's APT 분양 공고 of the last few years from 청약홈 (공공데이터포털 odcloud, the
 * user's data.go.kr key), each with its 주택형, 경쟁률 and 당첨가점. A 공고's details are kept in
 * AppSetting once its results are settled; the list is asked again every six hours.
 */
import {
  APPLY_BASE,
  APPLY_PATHS,
  APPLY_PORTAL,
  ApplyApiError,
  inRegion,
  monthlyApply,
  moveInChart,
  regulationOf,
  type Regulation,
  parseApply,
  readListing,
  readModels,
  summarizeListing,
  type Listing,
  type ListingSummary,
  type Model,
} from '@/domain/subscriptions';
import { roneRegion } from '@/domain/region-analysis';
import type { ChartData } from '@/domain/indicators';
import { kstDate, prisma } from '../db';
import { noteCall, outcomeOf } from './api-usage';
import { molitKey } from './real-estate';
import { UserError } from './portfolios';

const listCache = new Map<string, { at: number; rows: Listing[] }>();
const LIST_FRESH_MS = 6 * 3_600_000;

async function call(userId: string, key: string, path: string, cond: Record<string, string>, page = 1, perPage = 500) {
  const q = new URLSearchParams({ page: String(page), perPage: String(perPage), returnType: 'JSON', serviceKey: key, ...Object.fromEntries(Object.entries(cond).map(([k, v]) => [`cond[${k}]`, v])) });
  let res: Response;
  try {
    res = await fetch(`${APPLY_BASE}/${path}?${q}`, { cache: 'no-store', signal: AbortSignal.timeout(20_000) });
  } catch (e) {
    noteCall(userId, 'applyhome', 'error');
    throw e;
  }
  noteCall(userId, 'applyhome', outcomeOf(res.status));
  const body = await res.json().catch(() => null);
  if (res.status === 401 || (body && typeof body === 'object' && 'code' in body && Number((body as { code: number }).code) < 0)) {
    throw new UserError(`청약홈 API가 이 인증키를 받지 않았습니다 (${(body as { msg?: string } | null)?.msg ?? res.status}). 공공데이터포털에서 '청약홈 분양정보 조회 서비스'와 '청약홈 청약접수 경쟁률 및 특별공급 신청현황 조회 서비스' 두 가지를 활용신청하세요: ${APPLY_PORTAL.join(' , ')}`);
  }
  if (!res.ok) throw new Error(`청약홈 HTTP ${res.status}`);
  return parseApply(body);
}

async function all(userId: string, key: string, path: string, cond: Record<string, string>) {
  const first = await call(userId, key, path, cond);
  const rows = [...first.rows];
  for (let page = 2; rows.length < first.total && page <= 10; page++) rows.push(...(await call(userId, key, path, cond, page)).rows);
  return rows;
}

async function listings(userId: string, key: string, sido: string, since: string): Promise<Listing[]> {
  const ck = `${sido}|${since}`;
  const hit = listCache.get(ck);
  if (hit && Date.now() - hit.at < LIST_FRESH_MS) return hit.rows;
  const cond: Record<string, string> = { 'RCRIT_PBLANC_DE::GTE': since };
  if (sido !== '전국') cond['SUBSCRPT_AREA_CODE_NM::EQ'] = sido;
  const rows = (await all(userId, key, APPLY_PATHS.detail, cond)).map(readListing);
  listCache.set(ck, { at: Date.now(), rows });
  return rows;
}

interface Detail {
  at: string;
  models: Model[];
}

/** A 공고's 주택형, 경쟁률 and 가점; kept for good once the winners were announced a month ago */
async function detail(userId: string, key: string, l: Listing): Promise<Model[]> {
  // v2: 주택형 names as typeName writes them now
  const sk = `apply:v2:${l.id}:${l.pblancNo}`;
  const row = await prisma.appSetting.findUnique({ where: { key: sk } });
  const today = kstDate();
  const settledBy = (date: string | null) => !!date && new Date(Date.parse(`${date}T00:00:00Z`) + 30 * 86_400_000).toISOString().slice(0, 10) <= today;
  if (row) {
    const d = JSON.parse(row.value) as Detail;
    if (settledBy(l.winners) || Date.now() - Date.parse(d.at) < LIST_FRESH_MS) return d.models;
  }
  const cond = { 'HOUSE_MANAGE_NO::EQ': l.id, 'PBLANC_NO::EQ': l.pblancNo };
  const [m, c, s] = await Promise.all([all(userId, key, APPLY_PATHS.models, cond), all(userId, key, APPLY_PATHS.cmpet, cond), all(userId, key, APPLY_PATHS.score, cond)]);
  const models = readModels(m, c, s);
  const value = JSON.stringify({ at: new Date().toISOString(), models } satisfies Detail);
  await prisma.appSetting.upsert({ where: { key: sk }, create: { key: sk, value }, update: { value } });
  return models;
}

export interface ApplyRow {
  listing: Listing;
  models: Model[];
  summary: ListingSummary;
}

export interface ApplyView {
  region: { key: string; label: string };
  years: number;
  rows: ApplyRow[];
  charts: { rate: ChartData; price: ChartData; moveIn: ChartData };
  moveInYears: { year: string; households: number; when: 'past' | 'this' | 'future' }[];
  regulation: Regulation;
}

export async function applyView(userId: string, regionKey: string, years: number): Promise<ApplyView> {
  const r = roneRegion(regionKey);
  if (!r) throw new UserError('없는 지역입니다.');
  const key = await molitKey(userId);
  const y = [1, 3, 5].includes(years) ? years : 3;
  const today = kstDate();
  const since = `${Number(today.slice(0, 4)) - y}${today.slice(4)}`;
  // 수도권·지방권 are not 공급지역; ask for the whole country and keep their 시도
  const sido = ['수도권', '지방권', '5대광역시'].includes(r.key) ? '전국' : r.sido;
  const parts = r.depth > 0 ? r.key.split('>').slice(1) : [];
  const keep = (all: Listing[]) => {
    const inside = all.filter((l) => inRegion(l, sido, parts));
    return r.key === '수도권' ? inside.filter((l) => ['서울', '경기', '인천'].some((s) => l.area.startsWith(s))) : inside;
  };
  let list = keep(await listings(userId, key, sido, since));
  // 입주 예정 reads six years of 공고 whatever the period shown (a 공고 moves in two to four years later)
  const six = keep(await listings(userId, key, sido, `${Number(today.slice(0, 4)) - 6}${today.slice(4)}`));
  list.sort((a, b) => String(b.announced).localeCompare(String(a.announced)));
  const rows: ApplyRow[] = new Array(list.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, list.length) }, async () => {
      while (next < list.length) {
        const i = next++;
        const l = list[i];
        // Nothing to read before the receipt has started
        const models = l.receiptFrom && l.receiptFrom <= today ? await detail(userId, key, l).catch((e) => {
          if (e instanceof UserError) throw e;
          console.error('[apply] detail', l.id, e instanceof Error ? e.message : e);
          return [] as Model[];
        }) : [];
        rows[i] = { listing: l, models, summary: summarizeListing(models) };
      }
    }),
  );
  const charts = monthlyApply(rows.map((x) => ({ listing: x.listing, summary: x.summary, general: x.models.filter((m) => m.rate !== null).reduce((a, m) => a + m.general, 0), rank1: x.models.reduce((a, m) => a + m.rank1, 0) })));
  const moveIn = moveInChart(six, today);
  return { region: { key: r.key, label: r.label }, years: y, rows, charts: { ...charts, moveIn: moveIn.chart }, moveInYears: moveIn.years, regulation: regulationOf(six) };
}

export { ApplyApiError };
