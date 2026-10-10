/**
 * Prices the phone fetches by itself, with no PPFP server:
 * - coins: Upbit's public ticker (no key)
 * - Korean and US stocks: 한국투자증권 with the user's own app key (the token is kept for a day,
 *   since each new token sends a KakaoTalk notice)
 * - USD/KRW: open.er-api.com, then frankfurter.app (no key; daily rates)
 * On the phone fetch goes through Capacitor's native HTTP, so these answer without CORS.
 */
import { Dec } from '@/domain/decimal';

export interface Quote {
  symbol: string;
  price: string;
  currency: 'KRW' | 'USD';
  prevClose: string | null;
  source: string;
}

export interface KisKeys {
  appKey: string;
  secret: string;
  paper?: boolean;
}

export interface KisToken {
  token: string;
  expiresAt: number;
  /** Which key it belongs to, so a changed key gets a new token */
  appKey: string;
}

export class MarketError extends Error {}

const timeout = (ms: number) => AbortSignal.timeout(ms);

async function getJson(url: string, init: RequestInit = {}, ms = 10_000): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, { ...init, signal: timeout(ms) });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

const o = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
const s = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());
const n = (v: unknown) => {
  const t = s(v).replace(/,/g, '');
  return /^-?\d+(\.\d+)?$/.test(t) ? t : '0';
};

export const isKrSymbol = (sym: string) => /^[0-9][0-9A-Z]{5}$/.test(sym);
export const isCoin = (sym: string) => /^KRW-[A-Z0-9]+$/.test(sym);

// ── Upbit ────────────────────────────────────────────

export function parseUpbitTicker(body: unknown): Quote[] {
  if (!Array.isArray(body)) return [];
  return body
    .map((r) => o(r))
    .filter((r) => typeof r.market === 'string')
    .map((r) => ({ symbol: s(r.market), price: n(r.trade_price), currency: 'KRW' as const, prevClose: n(r.prev_closing_price) === '0' ? null : n(r.prev_closing_price), source: '업비트' }))
    .filter((q) => q.price !== '0');
}

export async function upbitQuotes(symbols: string[]): Promise<Quote[]> {
  const markets = symbols.filter(isCoin);
  if (!markets.length) return [];
  const r = await getJson(`https://api.upbit.com/v1/ticker?markets=${markets.join(',')}`);
  if (r.status !== 200) throw new MarketError(`업비트 시세를 받지 못했습니다 (${r.status}).`);
  return parseUpbitTicker(r.body);
}

/** Coins Upbit lists in KRW, for the asset search: [market, Korean name] */
export async function upbitMarkets(): Promise<{ symbol: string; name: string }[]> {
  const r = await getJson('https://api.upbit.com/v1/market/all?isDetails=false');
  if (!Array.isArray(r.body)) return [];
  return r.body
    .map((x) => o(x))
    .filter((x) => s(x.market).startsWith('KRW-'))
    .map((x) => ({ symbol: s(x.market), name: s(x.korean_name) || s(x.market) }));
}

// ── 한국투자증권 ──────────────────────────────────────

const KIS_REAL = 'https://openapi.koreainvestment.com:9443';
const KIS_PAPER = 'https://openapivts.koreainvestment.com:29443';
const EXCD = ['NAS', 'NYS', 'AMS'];

export async function kisToken(keys: KisKeys, cached: KisToken | null, now = Date.now()): Promise<KisToken> {
  if (cached && cached.appKey === keys.appKey && cached.expiresAt - 10 * 60_000 > now) return cached;
  const r = await getJson(`${keys.paper ? KIS_PAPER : KIS_REAL}/oauth2/tokenP`, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ grant_type: 'client_credentials', appkey: keys.appKey, appsecret: keys.secret }),
  });
  const b = o(r.body);
  const token = s(b.access_token);
  if (r.status !== 200 || !token) throw new MarketError(`한국투자증권 토큰 발급 실패: ${s(b.error_description) || s(b.msg1) || r.status}`);
  const ttl = Number(b.expires_in) > 0 ? Number(b.expires_in) : 86_400;
  return { token, expiresAt: now + ttl * 1000, appKey: keys.appKey };
}

export function parseKisDomestic(symbol: string, body: unknown): Quote | null {
  const out = o(o(body).output);
  const price = n(out.stck_prpr);
  if (price === '0') return null;
  return { symbol, price, currency: 'KRW', prevClose: n(out.stck_sdpr) === '0' ? null : n(out.stck_sdpr), source: '한국투자증권' };
}

export function parseKisOverseas(symbol: string, body: unknown): Quote | null {
  const out = o(o(body).output);
  const price = n(out.last);
  if (price === '0') return null;
  return { symbol, price, currency: 'USD', prevClose: n(out.base) === '0' ? null : n(out.base), source: '한국투자증권' };
}

export async function kisQuotes(keys: KisKeys, token: KisToken, symbols: string[]): Promise<{ quotes: Quote[]; failed: string[] }> {
  const base = keys.paper ? KIS_PAPER : KIS_REAL;
  const headers = (trId: string) => ({ 'content-type': 'application/json; charset=utf-8', authorization: `Bearer ${token.token}`, appkey: keys.appKey, appsecret: keys.secret, tr_id: trId, custtype: 'P' });
  const quotes: Quote[] = [];
  const failed: string[] = [];
  for (const sym of symbols) {
    try {
      if (isKrSymbol(sym)) {
        const r = await getJson(`${base}/uapi/domestic-stock/v1/quotations/inquire-price?FID_COND_MRKT_DIV_CODE=J&FID_INPUT_ISCD=${sym}`, { headers: headers('FHKST01010100') });
        const q = parseKisDomestic(sym, r.body);
        if (q) quotes.push(q);
        else failed.push(sym);
      } else {
        let q: Quote | null = null;
        for (const ex of EXCD) {
          const r = await getJson(`${base}/uapi/overseas-price/v1/quotations/price?AUTH=&EXCD=${ex}&SYMB=${encodeURIComponent(sym)}`, { headers: headers('HHDFS00000300') });
          q = parseKisOverseas(sym, r.body);
          if (q) break;
        }
        if (q) quotes.push(q);
        else failed.push(sym);
      }
      // KIS allows about 20 calls a second on a real account; stay well under it
      await new Promise((res) => setTimeout(res, keys.paper ? 520 : 80));
    } catch {
      failed.push(sym);
    }
  }
  return { quotes, failed };
}

// ── USD/KRW ──────────────────────────────────────────

export function parseFx(body: unknown): number | null {
  const b = o(body);
  const v = Number(o(b.rates).KRW);
  return Number.isFinite(v) && v > 500 && v < 5000 ? v : null;
}

export async function usdKrw(): Promise<{ rate: string; source: string } | null> {
  for (const [url, source] of [
    ['https://open.er-api.com/v6/latest/USD', 'ExchangeRate-API'],
    ['https://api.frankfurter.app/latest?from=USD&to=KRW', 'Frankfurter (ECB)'],
  ] as const) {
    try {
      const r = await getJson(url, {}, 8000);
      const v = parseFx(r.body);
      if (v) return { rate: Dec.of(v.toFixed(2)).toString(), source };
    } catch {
      // try the next one
    }
  }
  return null;
}
