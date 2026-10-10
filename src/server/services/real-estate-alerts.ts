/**
 * 부동산 알림: rules on apartment assets, checked every few hours by the alert loop. Sales
 * come from the 실거래가 the asset page already reads (and caches); 토지거래허가구역 from
 * 브이월드 토지이용계획 with the user's or the server's key.
 */
import { Prisma } from '@prisma/client';
import { readApartmentMeta, type ApartmentMeta } from '@/domain/real-estate';
import {
  diffSales,
  hitsMessage,
  pnuOf,
  RE_BUYERS,
  RE_DEALINGS,
  RE_EVENTS,
  RE_SCOPES,
  zoneFromLandUse,
  zoneMessage,
  type ReEvent,
  type ReRule,
  type ReScope,
  type Seen,
} from '@/domain/real-estate-alerts';
import { dec, kstDate, prisma } from '../db';
import { clearServiceKey, serviceKey, setServiceKey } from './api-keys';
import { noteCall, outcomeOf } from './api-usage';
import { notify } from './notify';
import { UserError } from './portfolios';
import { districtTrades } from './real-estate';

const MAX_RULES = 50;

export interface ReAlertView {
  id: string;
  assetId: string;
  assetName: string;
  holdingId: string | null;
  events: ReEvent[];
  scope: ReScope;
  minPrice: number | null;
  maxPrice: number | null;
  newHighOnly: boolean;
  dealing: keyof typeof RE_DEALINGS;
  buyer: keyof typeof RE_BUYERS;
  note: string | null;
  active: boolean;
  zone: boolean | null;
  checkedAt: string | null;
  firedAt: string | null;
  lastError: string | null;
}

const ruleOf = (r: { events: string[]; scope: string; minPrice: Prisma.Decimal | null; maxPrice: Prisma.Decimal | null; newHighOnly: boolean; dealing: string; buyer: string }): ReRule => ({
  events: r.events.filter((e): e is ReEvent => (RE_EVENTS as readonly string[]).includes(e)),
  scope: (RE_SCOPES as readonly string[]).includes(r.scope) ? (r.scope as ReScope) : 'AREA',
  minPrice: r.minPrice ? dec(r.minPrice).toNumber() : null,
  maxPrice: r.maxPrice ? dec(r.maxPrice).toNumber() : null,
  newHighOnly: r.newHighOnly,
  dealing: r.dealing in RE_DEALINGS ? (r.dealing as ReRule['dealing']) : 'ANY',
  buyer: r.buyer in RE_BUYERS ? (r.buyer as ReRule['buyer']) : 'ANY',
});

export async function listReAlerts(userId: string): Promise<ReAlertView[]> {
  const rows = await prisma.realEstateAlert.findMany({
    where: { userId },
    include: { asset: { select: { name: true, holdings: { select: { id: true }, take: 1 } } } },
    orderBy: [{ active: 'desc' }, { createdAt: 'desc' }],
  });
  return rows.map((r) => ({
    id: r.id,
    assetId: r.assetId,
    assetName: r.asset.name,
    holdingId: r.asset.holdings[0]?.id ?? null,
    ...ruleOf(r),
    note: r.note,
    active: r.active,
    zone: r.zone,
    checkedAt: r.checkedAt?.toISOString() ?? null,
    firedAt: r.firedAt?.toISOString() ?? null,
    lastError: r.lastError,
  }));
}

/** Apartment assets that can carry a rule (a linked apartment is needed). */
export async function apartmentAssets(userId: string): Promise<{ id: string; name: string }[]> {
  const rows = await prisma.asset.findMany({ where: { userId, type: 'REAL_ESTATE' }, select: { id: true, name: true, meta: true }, orderBy: { name: 'asc' } });
  return rows.filter((r) => readApartmentMeta(r.meta)).map((r) => ({ id: r.id, name: r.name }));
}

/** "31.5" (억) → 원 */
function eokToWon(v: string | undefined, label: string): number | null {
  const s = v?.trim().replace(/,/g, '');
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0 || n > 10_000) throw new UserError(`${label}은 억 단위 숫자로 입력하세요. 예: 31.5`);
  return Math.round(n * 1e8);
}

export async function createReAlert(
  userId: string,
  input: { assetId: string; events: string[]; scope?: string; minEok?: string; maxEok?: string; newHighOnly?: boolean; dealing?: string; buyer?: string; note?: string },
) {
  const asset = await prisma.asset.findFirst({ where: { id: input.assetId, userId } });
  if (!asset || !readApartmentMeta(asset.meta)) throw new UserError('아파트를 연결한 부동산 자산을 고르세요.');
  const events = [...new Set(input.events)].filter((e) => (RE_EVENTS as readonly string[]).includes(e));
  if (!events.length) throw new UserError('알릴 일을 하나 이상 고르세요.');
  const minPrice = eokToWon(input.minEok, '최저 가격');
  const maxPrice = eokToWon(input.maxEok, '최고 가격');
  if (minPrice !== null && maxPrice !== null && minPrice > maxPrice) throw new UserError('최저 가격이 최고 가격보다 큽니다.');
  if ((await prisma.realEstateAlert.count({ where: { userId } })) >= MAX_RULES) throw new UserError(`부동산 알림은 ${MAX_RULES}개까지입니다.`);
  const row = await prisma.realEstateAlert.create({
    data: {
      userId,
      assetId: asset.id,
      events,
      scope: (RE_SCOPES as readonly string[]).includes(input.scope ?? '') ? input.scope! : 'AREA',
      minPrice,
      maxPrice,
      newHighOnly: !!input.newHighOnly,
      dealing: (input.dealing ?? '') in RE_DEALINGS ? input.dealing! : 'ANY',
      buyer: (input.buyer ?? '') in RE_BUYERS ? input.buyer! : 'ANY',
      note: input.note?.trim().slice(0, 200) || null,
    },
  });
  // The first check records what is already there, so the next one reports only what is new.
  await checkOne(row.id).catch((e) => console.error('[re-alerts] first check failed', e));
  return row;
}

export async function setReAlertActive(userId: string, id: string, active: boolean) {
  // Turning a rule back on starts from a fresh baseline: what happened while it was off is not reported.
  const r = await prisma.realEstateAlert.updateMany({ where: { id, userId }, data: active ? { active, seen: Prisma.DbNull, zone: null, lastError: null } : { active } });
  if (!r.count) throw new UserError('알림을 찾을 수 없습니다.');
  if (active) await checkOne(id).catch(() => {});
}

export async function deleteReAlert(userId: string, id: string) {
  const r = await prisma.realEstateAlert.deleteMany({ where: { id, userId } });
  if (!r.count) throw new UserError('알림을 찾을 수 없습니다.');
}

/** 토지거래허가구역 of the apartment's lot, or null without a key or when it cannot be told. */
async function landZone(userId: string, meta: ApartmentMeta): Promise<boolean | null> {
  const pnu = pnuOf(meta);
  const key = await serviceKey(userId, 'vworld', 'VWORLD_API_KEY');
  if (!pnu || !key) return null;
  const params = new URLSearchParams({ pnu, format: 'json', numOfRows: '100', pageNo: '1', key: key.key });
  if (process.env.VWORLD_DOMAIN) params.set('domain', process.env.VWORLD_DOMAIN);
  let res: Response;
  try {
    res = await fetch(`https://api.vworld.kr/ned/data/getLandUseAttr?${params}`, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
  } catch (e) {
    noteCall(userId, 'vworld', 'error');
    throw e;
  }
  const body = await res.json().catch(() => null);
  const zone = zoneFromLandUse(body);
  noteCall(userId, 'vworld', zone === null ? 'error' : outcomeOf(res.status));
  if (zone === null) {
    const msg = (body as { landUses?: { resultMsg?: string } } | null)?.landUses?.resultMsg;
    throw new UserError(`토지이용계획을 읽지 못했습니다${msg ? `: ${msg}` : ''}`);
  }
  return zone;
}

/** Checks one rule; sends at most one notification for its sales and one for the zone. Returns how many were sent. */
async function checkOne(id: string): Promise<number> {
  const r = await prisma.realEstateAlert.findUnique({ where: { id }, include: { asset: { select: { name: true, meta: true, holdings: { select: { id: true }, take: 1 } } } } });
  if (!r || !r.active) return 0;
  const meta = readApartmentMeta(r.asset.meta);
  if (!meta) {
    await prisma.realEstateAlert.update({ where: { id }, data: { lastError: '자산에 연결된 아파트가 없습니다.', checkedAt: new Date() } });
    return 0;
  }
  const rule = ruleOf(r);
  const url = r.asset.holdings[0] ? `/holdings/${r.asset.holdings[0].id}#real-estate` : '/alerts#real-estate';
  let sent = 0;
  const data: Prisma.RealEstateAlertUpdateInput = { checkedAt: new Date(), lastError: null };
  const errors: string[] = [];

  if (rule.events.some((e) => e !== 'ZONE')) {
    try {
      const trades = await districtTrades(r.userId, meta.lawdCd, 24);
      const prev = (r.seen as Seen | null) ?? null;
      const { hits, seen } = diffSales(trades, meta, rule, prev, kstDate());
      data.seen = seen;
      if (hits.length) {
        await notify(r.userId, { kind: 'REALESTATE', ...hitsMessage(r.asset.name, hits, rule.scope), url });
        data.firedAt = new Date();
        sent++;
      }
    } catch (e) {
      errors.push(e instanceof UserError ? e.message : '실거래가를 확인하지 못했습니다.');
      if (!(e instanceof UserError)) console.error('[re-alerts] sales', e);
    }
  }
  if (rule.events.includes('ZONE')) {
    try {
      const zone = await landZone(r.userId, meta);
      if (zone === null) errors.push('토지거래허가구역을 보려면 연동 · 설정에 브이월드 인증키를 넣으세요.');
      else {
        if (r.zone !== null && r.zone !== zone) {
          await notify(r.userId, { kind: 'REALESTATE', ...zoneMessage(r.asset.name, zone), url });
          data.firedAt = new Date();
          sent++;
        }
        data.zone = zone;
      }
    } catch (e) {
      errors.push(e instanceof UserError ? e.message : '토지이용계획을 확인하지 못했습니다.');
      if (!(e instanceof UserError)) console.error('[re-alerts] zone', e);
    }
  }
  if (errors.length) data.lastError = errors.join(' ').slice(0, 300);
  await prisma.realEstateAlert.update({ where: { id }, data });
  return sent;
}

/** Every active rule (or one user's), one at a time. Returns how many notifications were sent. */
export async function checkRealEstateAlerts(onlyUserId?: string): Promise<number> {
  const rows = await prisma.realEstateAlert.findMany({ where: { active: true, ...(onlyUserId ? { userId: onlyUserId } : {}) }, select: { id: true }, orderBy: { createdAt: 'asc' } });
  let sent = 0;
  for (const { id } of rows) sent += await checkOne(id).catch((e) => (console.error('[re-alerts] check failed', e), 0));
  return sent;
}

export async function saveVworldKey(userId: string, input: { key?: string; clear?: boolean }) {
  const key = input.key?.trim();
  if (key) {
    if (!/^[0-9A-F-]{20,60}$/i.test(key)) throw new UserError('브이월드 인증키는 영문·숫자와 -로 된 키입니다. 그대로 붙여 넣으세요.');
    await setServiceKey(userId, 'vworld', key);
  } else if (input.clear) await clearServiceKey(userId, 'vworld');
}
