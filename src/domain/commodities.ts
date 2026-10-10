/**
 * Gold, oil and other commodities, and index futures, for the market board: which contract
 * is the active one today, and how to read the two brokers that publish them — 키움's KRX
 * 금현물 (ka50100) and 한국투자증권's 해외선물 (HHDFC55010000). Pure.
 */

export type CommoditySource = 'KRX_GOLD' | 'FUTURE';

export interface CommodityDef {
  id: string;
  name: string;
  /** Price unit as shown, e.g. "USD/oz" */
  unit: string;
  currency: 'KRW' | 'USD';
  source: CommoditySource;
  /** KRX code (KRX_GOLD) or the futures root (FUTURE) */
  code: string;
  /** Exchange, for display */
  exchange: string;
  /** Contract month letters that trade (FUTURE) */
  months?: string;
  /** The active contract is at least this many months ahead… */
  ahead?: number;
  /** …one more once the day of month passes this */
  rollDay?: number;
  /** Troy ounces per unit, to show gold in 원/g */
  perGram?: boolean;
}

/** Month codes of futures contracts, January first. */
export const MONTH_CODES = 'FGHJKMNQUVXZ';

export const COMMODITIES: CommodityDef[] = [
  { id: 'krx-gold', name: '금 현물 (KRX)', unit: '원/g', currency: 'KRW', source: 'KRX_GOLD', code: 'M04020000', exchange: 'KRX 금시장' },
  { id: 'gold', name: '금', unit: 'USD/oz', currency: 'USD', source: 'FUTURE', code: 'GC', exchange: 'COMEX', months: 'GJMQVZ', ahead: 1, rollDay: 25, perGram: true },
  { id: 'silver', name: '은', unit: 'USD/oz', currency: 'USD', source: 'FUTURE', code: 'SI', exchange: 'COMEX', months: 'HKNUZ', ahead: 1, rollDay: 25 },
  { id: 'copper', name: '구리', unit: 'USD/lb', currency: 'USD', source: 'FUTURE', code: 'HG', exchange: 'COMEX', months: 'HKNUZ', ahead: 1, rollDay: 25 },
  { id: 'wti', name: 'WTI 원유', unit: 'USD/bbl', currency: 'USD', source: 'FUTURE', code: 'CL', exchange: 'NYMEX', months: MONTH_CODES, ahead: 1, rollDay: 15 },
  { id: 'natgas', name: '천연가스', unit: 'USD/MMBtu', currency: 'USD', source: 'FUTURE', code: 'NG', exchange: 'NYMEX', months: MONTH_CODES, ahead: 1, rollDay: 22 },
  { id: 'corn', name: '옥수수', unit: '¢/bu', currency: 'USD', source: 'FUTURE', code: 'ZC', exchange: 'CBOT', months: 'HKNUZ', ahead: 1, rollDay: 25 },
  { id: 'soybean', name: '대두', unit: '¢/bu', currency: 'USD', source: 'FUTURE', code: 'ZS', exchange: 'CBOT', months: 'FHKNQUX', ahead: 1, rollDay: 25 },
  { id: 'es', name: 'S&P 500 미니 선물', unit: 'pt', currency: 'USD', source: 'FUTURE', code: 'ES', exchange: 'CME', months: 'HMUZ', ahead: 0, rollDay: 9 },
  { id: 'nq', name: '나스닥 100 미니 선물', unit: 'pt', currency: 'USD', source: 'FUTURE', code: 'NQ', exchange: 'CME', months: 'HMUZ', ahead: 0, rollDay: 9 },
  { id: 'zn', name: '미국채 10년 선물', unit: 'pt', currency: 'USD', source: 'FUTURE', code: 'ZN', exchange: 'CBOT', months: 'HMUZ', ahead: 1, rollDay: 25 },
];

/** Grams per troy ounce */
export const OZ_GRAMS = 31.1034768;

/**
 * The contract most traders hold on `today` (YYYY-MM-DD, KST): the first listed month at
 * least `ahead` months out (one more after `rollDay`). Rough by design: it ignores holidays
 * and each exchange's exact last trading day, which the quote's expiry date shows anyway.
 */
export function activeContract(def: Pick<CommodityDef, 'code' | 'months' | 'ahead' | 'rollDay'>, today: string): string {
  const [y, m, d] = today.split('-').map(Number);
  const months = def.months ?? MONTH_CODES;
  const minAhead = (def.ahead ?? 1) + (def.rollDay && d > def.rollDay ? 1 : 0);
  for (let k = minAhead; k < minAhead + 13; k++) {
    const idx = (m - 1 + k) % 12;
    const year = y + Math.floor((m - 1 + k) / 12);
    if (months.includes(MONTH_CODES[idx])) return `${def.code}${MONTH_CODES[idx]}${String(year % 100).padStart(2, '0')}`;
  }
  throw new Error(`no contract month for ${def.code}`);
}

export interface CommodityQuote {
  price: string;
  prevClose: string | null;
  open: string | null;
  high: string | null;
  low: string | null;
  volume: string | null;
  /** YYYY-MM-DD, futures only */
  expiry: string | null;
  asOf: string | null;
}

const clean = (v: unknown): string | null => {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const s = String(v).replace(/[,\s+]/g, '');
  if (!s || !Number.isFinite(Number(s))) return null;
  return String(Number(s));
};
const date8 = (v: unknown) => (typeof v === 'string' && /^\d{8}$/.test(v) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6)}` : null);

/**
 * 키움 ka50100 금현물 시세정보. It has no current-price field: the price is the previous
 * close plus the signed change. Prices carry a sign marking the direction, not negativity.
 */
export function parseKiwoomGold(body: unknown): CommodityQuote | null {
  const b = body as Record<string, unknown> | null;
  if (!b) return null;
  const prev = clean(b.pred_close_pric);
  const change = clean(b.pred_pre);
  if (!prev || change === null) return null;
  const abs = (v: unknown) => {
    const c = clean(v);
    return c === null ? null : String(Math.abs(Number(c)));
  };
  return { price: String(Number(prev) + Number(change)), prevClose: prev, open: abs(b.open_pric), high: abs(b.high_pric), low: abs(b.low_pric), volume: clean(b.trde_qty), expiry: null, asOf: null };
}

/** 한국투자증권 해외선물 현재가 (inquire-price, output1). */
export function parseKisFuture(output1: unknown): CommodityQuote | null {
  const o = (Array.isArray(output1) ? output1[0] : output1) as Record<string, unknown> | null;
  if (!o) return null;
  const price = clean(o.last_price);
  if (!price || Number(price) <= 0) return null;
  const prev = clean(o.prev_price);
  const d = date8(o.proc_date);
  const t = typeof o.proc_time === 'string' && /^\d{6}$/.test(o.proc_time) ? `${o.proc_time.slice(0, 2)}:${o.proc_time.slice(2, 4)}:${o.proc_time.slice(4)}` : null;
  return {
    price,
    prevClose: prev && Number(prev) > 0 ? prev : null,
    open: clean(o.open_price),
    high: clean(o.high_price),
    low: clean(o.low_price),
    volume: clean(o.vol),
    expiry: date8(o.expr_date) ?? date8(o.trd_to_date),
    // The exchange's local time; shown as is
    asOf: d ? `${d}${t ? ` ${t}` : ''}` : null,
  };
}

/** USD/oz → 원/g */
export const krwPerGram = (usdPerOz: number, usdKrw: number) => (usdPerOz * usdKrw) / OZ_GRAMS;
