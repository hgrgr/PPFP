/**
 * Normalising the shapes brokerage APIs send back: zero-padded signed number
 * strings, prefixed KRX codes, and each broker's own exchange codes.
 * Pure functions, shared by the server adapters and the paste importer.
 */
import { Dec } from './decimal';

export type UsMarket = 'NASDAQ' | 'NYSE' | 'AMEX';
export const US_MARKETS: readonly UsMarket[] = ['NASDAQ', 'NYSE', 'AMEX'];

const SYMBOL_RE = /^[A-Za-z0-9.-]{1,20}$/;

/** Upper-cased symbol if it is a plausible KRX code or US ticker, else null. */
export function cleanSymbol(raw: string): string | null {
  const s = raw.trim().toUpperCase();
  return SYMBOL_RE.test(s) ? s : null;
}

/** KRX short codes are 6 characters and start with a digit (newer ones contain letters, e.g. 0126Z0). */
export function isKrSymbol(symbol: string): boolean {
  return /^[0-9][0-9A-Z]{5}$/.test(symbol.toUpperCase());
}

/** "A005930" / "J005930" / " 005930 " -> "005930"; null when it is not a KRX code. */
export function krSymbol(raw: string): string | null {
  const s = raw.trim().toUpperCase();
  const m = /^[AJQ]?([0-9][0-9A-Z]{5})$/.exec(s);
  return m ? m[1] : null;
}

/**
 * Broker number strings to a canonical decimal string.
 * Handles "+000000000070000", "-00012.50", "1,234", "" and plain numbers.
 */
export function num(v: unknown): string {
  if (v === null || v === undefined) return '0';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '0';
  let s = String(v).trim().replace(/,/g, '');
  if (!s) return '0';
  let sign = '';
  if (s[0] === '+' || s[0] === '-') {
    sign = s[0] === '-' ? '-' : '';
    s = s.slice(1);
  }
  if (!/^\d*\.?\d*$/.test(s) || s === '' || s === '.') return '0';
  s = s.replace(/^0+(?=\d)/, '');
  if (s.startsWith('.')) s = '0' + s;
  if (/^0*\.?0*$/.test(s)) return '0';
  return sign + s;
}

/** Like num() but drops the sign. Some brokers prefix prices with the day's direction ("-70000" = down, at 70,000). */
export function absNum(v: unknown): string {
  return num(v).replace(/^-/, '');
}

const US_MARKET_CODES: Record<string, UsMarket> = {
  // KIS (NASD = all US in production), Toss, Kiwoom, Meritz, DB, LS
  NASD: 'NASDAQ', NAS: 'NASDAQ', NASDAQ: 'NASDAQ', ND: 'NASDAQ', OQ: 'NASDAQ', O: 'NASDAQ', FN: 'NASDAQ', '82': 'NASDAQ', BAQ: 'NASDAQ',
  NYSE: 'NYSE', NYS: 'NYSE', NY: 'NYSE', N: 'NYSE', FY: 'NYSE', '81': 'NYSE', BAY: 'NYSE',
  AMEX: 'AMEX', AMS: 'AMEX', NA: 'AMEX', AX: 'AMEX', A: 'AMEX', FA: 'AMEX', BAA: 'AMEX', 'NYSE AMERICAN': 'AMEX',
};

/** Any broker's US exchange code or name -> our market name. */
export function usMarketOf(raw: string | null | undefined): UsMarket | null {
  if (!raw) return null;
  const s = raw.trim().toUpperCase();
  if (US_MARKET_CODES[s]) return US_MARKET_CODES[s];
  if (/나스닥/.test(s)) return 'NASDAQ';
  if (/아멕스|AMERICAN/.test(s)) return 'AMEX';
  if (/뉴욕/.test(s)) return 'NYSE';
  return null;
}

/** Markets to try for a US symbol: the known one first, then the rest. */
export function usMarketCandidates(known: string | null | undefined): UsMarket[] {
  const m = usMarketOf(known);
  return m ? [m, ...US_MARKETS.filter((x) => x !== m)] : [...US_MARKETS];
}

/** "2026-10-07" -> "20261007" */
export function ymd(date: string): string {
  return date.replace(/-/g, '');
}

/** "20261007" -> "2026-10-07" (null when malformed) */
export function fromYmd(v: unknown): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(String(v ?? '').trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** YYYY-MM-DD shifted by whole days. */
export function addDays(date: string, days: number): string {
  const t = Date.parse(date + 'T00:00:00Z') + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Percent figure ("+1.25", "-0.80%") -> fraction string ("0.0125"); null when absent. */
export function pctToRate(v: unknown): string | null {
  const s = String(v ?? '').replace('%', '').trim();
  if (!s) return null;
  const n = num(s);
  if (n === '0' && !/^[+-]?0*\.?0*$/.test(s)) return null;
  return Dec.of(n).div(100).toString();
}

/** Brokers' up/down codes: 1 상한, 2 상승, 3 보합, 4 하한, 5 하락. Applies the direction to an unsigned figure. */
export function withSign(v: unknown, sign: unknown): string {
  const n = absNum(v);
  return ['4', '5'].includes(String(sign ?? '').trim()) && n !== '0' ? '-' + n : n;
}

/** Previous close from a price and its change; null when either is missing. */
export function prevFromChange(price: string, change: string | null): string | null {
  if (change === null || price === '0') return null;
  return Dec.of(price).sub(change).toString();
}

export type MarketZone = 'Asia/Seoul' | 'America/New_York';

function zoneOffsetMs(utcMs: number, zone: MarketZone): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - utcMs;
}

/** Exchange-local "YYYYMMDD" + "HHMMSS"/"HHMM" -> ISO instant. */
export function zonedIso(ymdValue: string, hms: string, zone: MarketZone): string | null {
  const d = /^(\d{4})(\d{2})(\d{2})$/.exec(ymdValue.trim());
  const t = /^(\d{2})(\d{2})(\d{2})?$/.exec(hms.trim().replace(/:/g, ''));
  if (!d || !t) return null;
  const asUtc = Date.UTC(+d[1], +d[2] - 1, +d[3], +t[1], +t[2], +(t[3] ?? 0));
  // Two passes settle the offset across DST changes.
  let ms = asUtc - zoneOffsetMs(asUtc, zone);
  ms = asUtc - zoneOffsetMs(ms, zone);
  return new Date(ms).toISOString();
}

/** The calendar date of an instant in a market's time zone. */
export function zonedDate(iso: string, zone: MarketZone): string {
  const ms = Date.parse(iso);
  return new Date(ms + zoneOffsetMs(ms, zone)).toISOString().slice(0, 10);
}
