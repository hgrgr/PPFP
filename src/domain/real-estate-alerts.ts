/**
 * 부동산 알림: compares an apartment's reported sales with what the last check saw and says
 * what is new — a sale reported, a sale registered (등기), a sale cancelled — and reads the
 * 토지거래허가구역 status of the lot from 국토교통부 토지이용계획. Pure; the service fetches
 * and stores.
 */
import { eok, isOwnComplex, monthsBefore, sameArea, areaLabel, type ApartmentMeta, type AptTrade } from './real-estate';

export const RE_EVENTS = ['TRADE', 'REGISTERED', 'CANCELLED', 'ZONE'] as const;
export type ReEvent = (typeof RE_EVENTS)[number];
export const RE_EVENT_LABEL: Record<ReEvent, string> = { TRADE: '새 거래 신고', REGISTERED: '등기 완료', CANCELLED: '거래 해제', ZONE: '토지거래허가구역 지정·해제' };

export const RE_SCOPES = ['AREA', 'COMPLEX', 'DONG'] as const;
export type ReScope = (typeof RE_SCOPES)[number];
export const RE_SCOPE_LABEL: Record<ReScope, string> = { AREA: '이 단지 같은 면적', COMPLEX: '이 단지 전체', DONG: '같은 법정동 전체' };

export const RE_DEALINGS = { ANY: '모두', BROKER: '중개거래만', DIRECT: '직거래만' } as const;
export const RE_BUYERS = { ANY: '모두', PERSON: '개인만', CORP: '법인만' } as const;

export interface ReRule {
  events: ReEvent[];
  scope: ReScope;
  minPrice: number | null;
  maxPrice: number | null;
  newHighOnly: boolean;
  dealing: keyof typeof RE_DEALINGS;
  buyer: keyof typeof RE_BUYERS;
}

/** Sales are compared over the last four contract months: reports arrive within 30 days, registrations within about 60–90. */
export const WATCH_MONTHS = 4;

/** One sale, stable across checks (동 and 등기일 appear later, so they are left out). */
export const dealKey = (t: AptTrade) => [t.aptSeq ?? `${t.umdCd ?? t.umdNm}|${t.jibun ?? ''}|${t.aptNm}`, t.date, t.floor ?? '', t.area, t.price].join('|');
const flags = (t: AptTrade) => `${t.rgstDate ? 'R' : ''}${t.cancelled ? 'C' : ''}`;

export type Seen = Record<string, string>;

export function inScope(t: AptTrade, meta: ApartmentMeta, scope: ReScope): boolean {
  const dong = t.umdCd ? t.umdCd === meta.umdCd : t.umdNm === meta.umdNm;
  if (!dong) return false;
  if (scope === 'DONG') return true;
  if (!isOwnComplex(t, meta)) return false;
  return scope === 'COMPLEX' || (meta.area !== null && sameArea(t.area, meta.area));
}

/** Does a newly reported sale pass the rule's price, dealing and buyer conditions? */
export function passes(t: AptTrade, rule: ReRule, earlier: AptTrade[]): boolean {
  if (rule.minPrice !== null && t.price < rule.minPrice) return false;
  if (rule.maxPrice !== null && t.price > rule.maxPrice) return false;
  if (rule.dealing === 'DIRECT' && t.dealing !== '직거래') return false;
  if (rule.dealing === 'BROKER' && t.dealing === '직거래') return false;
  if (rule.buyer === 'PERSON' && t.buyer !== '개인') return false;
  if (rule.buyer === 'CORP' && t.buyer !== '법인') return false;
  if (rule.newHighOnly) {
    const same = earlier.filter((e) => !e.cancelled && e !== t && complexOf(e) === complexOf(t) && sameArea(e.area, t.area) && e.date <= t.date);
    if (same.some((e) => e.price >= t.price)) return false;
  }
  return true;
}
const complexOf = (t: AptTrade) => t.aptSeq ?? `${t.umdCd ?? t.umdNm}|${t.jibun ?? ''}|${t.aptNm}`;

export interface ReHit {
  event: Exclude<ReEvent, 'ZONE'>;
  trade: AptTrade;
}

/**
 * What changed since `seen`. With `seen` null (the first check) nothing is reported; the
 * returned `seen` becomes the baseline. `trades` are the district's sales (two years, for
 * the new-high comparison); only the last WATCH_MONTHS are watched.
 */
export function diffSales(trades: AptTrade[], meta: ApartmentMeta, rule: ReRule, seen: Seen | null, today: string): { hits: ReHit[]; seen: Seen } {
  const since = monthsBefore(today, WATCH_MONTHS);
  const watched = trades.filter((t) => t.date >= since && inScope(t, meta, rule.scope));
  const next: Seen = {};
  const hits: ReHit[] = [];
  for (const t of watched) {
    const k = dealKey(t);
    const f = flags(t);
    next[k] = f;
    if (!seen) continue;
    const before = seen[k];
    if (before === undefined) {
      // A sale first seen already cancelled was reported and withdrawn between checks.
      if (rule.events.includes('TRADE') && !t.cancelled && passes(t, rule, trades)) hits.push({ event: 'TRADE', trade: t });
      else if (rule.events.includes('CANCELLED') && t.cancelled) hits.push({ event: 'CANCELLED', trade: t });
      continue;
    }
    if (rule.events.includes('REGISTERED') && f.includes('R') && !before.includes('R')) hits.push({ event: 'REGISTERED', trade: t });
    if (rule.events.includes('CANCELLED') && f.includes('C') && !before.includes('C')) hits.push({ event: 'CANCELLED', trade: t });
  }
  hits.sort((a, b) => b.trade.date.localeCompare(a.trade.date));
  return { hits, seen: next };
}

const line = (t: AptTrade, scope: ReScope) =>
  `${scope === 'DONG' ? `${t.aptNm} ` : ''}${scope !== 'AREA' ? `${areaLabel(t.area)} ` : ''}${t.floor !== null ? `${t.floor}층 ` : ''}${eok(t.price)} (계약 ${t.date}${t.dealing === '직거래' ? ', 직거래' : ''}${t.buyer && t.buyer !== '개인' ? `, 매수 ${t.buyer}` : ''})`;

/** One notification for a check's hits: title and body. */
export function hitsMessage(name: string, hits: ReHit[], scope: ReScope): { title: string; body: string } {
  const by = (e: ReHit['event']) => hits.filter((h) => h.event === e);
  const parts: string[] = [];
  const titleBits: string[] = [];
  for (const [event, verb] of [['TRADE', '새 거래'], ['REGISTERED', '등기 완료'], ['CANCELLED', '거래 해제']] as const) {
    const xs = by(event);
    if (!xs.length) continue;
    titleBits.push(`${verb} ${xs.length}건`);
    parts.push(`${verb}: ${xs.slice(0, 3).map((h) => line(h.trade, scope) + (event === 'REGISTERED' && h.trade.rgstDate ? ` · 등기 ${h.trade.rgstDate}` : '')).join(' / ')}${xs.length > 3 ? ` 외 ${xs.length - 3}건` : ''}`);
  }
  return { title: `${name} · ${titleBits.join(', ')}`, body: parts.join('\n') };
}

/** 필지고유번호 (PNU, 19 digits) from the 법정동 code and 지번: 10 + 산(2)/대지(1) + 본번 4 + 부번 4. */
export function pnuOf(meta: Pick<ApartmentMeta, 'lawdCd' | 'umdCd' | 'jibun'>): string | null {
  const m = meta.jibun?.match(/^(산)?(\d{1,4})(?:-(\d{1,4}))?$/);
  if (!m) return null;
  return `${meta.lawdCd}${meta.umdCd}${m[1] ? '2' : '1'}${m[2].padStart(4, '0')}${(m[3] ?? '0').padStart(4, '0')}`;
}

/**
 * 토지거래허가구역 from a 토지이용계획 answer (브이월드 getLandUseAttr): true when any
 * district listed for the lot is a 토지거래계약에 관한 허가구역. Read loosely, by the name,
 * so it does not depend on the answer's field names. Null when the answer is an error.
 */
export function zoneFromLandUse(body: unknown): boolean | null {
  const root = (body as Record<string, unknown> | null)?.landUses as Record<string, unknown> | undefined;
  if (!root) return null;
  const code = root.resultCode;
  if (typeof code === 'string' && code && !/^(OK|0+|INFO-000)$/i.test(code)) return null;
  const names: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === 'string') names.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(root.field ?? root);
  return names.some((n) => /토지거래(계약에관한)?허가구역/.test(n.replace(/\s+/g, '')));
}

export const zoneMessage = (name: string, zone: boolean) => ({
  title: `${name} · 토지거래허가구역 ${zone ? '지정' : '해제'}`,
  body: zone ? '이 아파트의 땅이 토지거래허가구역에 들어갔습니다. 매매하려면 시·군·구청의 허가를 받아야 합니다(실거주 의무 등).' : '이 아파트의 땅이 토지거래허가구역에서 빠졌습니다.',
});
