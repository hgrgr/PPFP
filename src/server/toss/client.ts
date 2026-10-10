/**
 * Toss Securities OpenAPI client (spec 1.1.1, https://developers.tossinvest.com/docs).
 *
 * Server-only: the client secret must never reach a browser. One instance per
 * credential; tokens are reused until shortly before they expire (memory, then
 * the optional store). Requests are throttled per client and 429/5xx responses
 * are retried with backoff.
 */
import { memoryTokenStore, type TokenStore } from '../brokers/types';
import { TokenManager } from '../brokers/http';
import { noteCall, outcomeOf } from '../services/api-usage';

export interface TossCredentials {
  clientId: string;
  clientSecret: string;
}

export type Currency = 'KRW' | 'USD';

export interface TossPrice {
  symbol: string;
  timestamp: string | null;
  lastPrice: string;
  currency: Currency;
}

export interface TossCandle {
  timestamp: string;
  openPrice: string;
  highPrice: string;
  lowPrice: string;
  closePrice: string;
  volume: string;
  currency: Currency;
}

export interface TossStock {
  symbol: string;
  name: string;
  englishName: string;
  market: 'KOSPI' | 'KOSDAQ' | 'NYSE' | 'NASDAQ' | 'AMEX' | 'KR_ETC' | 'US_ETC';
  securityType: string;
  status: 'SCHEDULED' | 'ACTIVE' | 'DELISTED';
  currency: Currency;
}

export interface TossIndicatorPrice {
  symbol: string;
  timestamp: string | null;
  lastPrice: string;
}

export interface TossRankingItem {
  rank: number;
  symbol: string;
  currency: Currency;
  price: { lastPrice: string; basePrice: string; changeRate: string | null };
  tradingVolume: string;
  tradingAmount: string;
}

export interface TossOrderbook {
  timestamp: string | null;
  currency: Currency;
  asks: { price: string; volume: string }[];
  bids: { price: string; volume: string }[];
}

export interface TossExchangeRate {
  baseCurrency: Currency;
  quoteCurrency: Currency;
  rate: string;
  midRate: string;
  validFrom: string;
  validUntil: string;
}

export interface TossAccount {
  accountNo: string;
  accountSeq: number;
  accountType: string;
}

export interface TossHoldingItem {
  symbol: string;
  name: string;
  marketCountry: 'KR' | 'US';
  currency: Currency;
  quantity: string;
  lastPrice: string;
  averagePurchasePrice: string;
}

export interface TossHoldings {
  items: TossHoldingItem[];
}

export class TossApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'TossApiError';
  }
}

const BASE = (process.env.TOSS_API_BASE ?? 'https://openapi.tossinvest.com').replace(/\/$/, '');
const SYMBOL_RE = /^[A-Za-z0-9.-]{1,20}$/;
const MAX_RETRIES = 3;
const MIN_INTERVAL_MS = 120; // ~8 requests/second per client; conservative until limits are confirmed

const lastCallAt = new Map<string, number>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function assertSymbol(symbol: string): string {
  if (!SYMBOL_RE.test(symbol)) throw new TossApiError(`잘못된 종목 심볼: ${symbol}`, 400, 'invalid-symbol');
  return symbol.toUpperCase();
}

export class TossClient {
  private readonly tokens: TokenManager;

  constructor(
    private readonly creds: TossCredentials,
    store: TokenStore = memoryTokenStore(),
  ) {
    this.tokens = new TokenManager(`TOSS:${creds.clientId}`, store, () => this.issueToken());
  }

  private async throttle() {
    const key = this.creds.clientId;
    const wait = (lastCallAt.get(key) ?? 0) + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastCallAt.set(key, Date.now());
  }

  async token(force = false): Promise<string> {
    if (force) this.tokens.forget();
    return this.tokens.get(force);
  }

  private async issueToken() {
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.creds.clientId,
      client_secret: this.creds.clientSecret,
    });
    const res = await fetch(`${BASE}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body,
      cache: 'no-store',
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string; error_description?: string };
      throw new TossApiError(
        err.error === 'invalid_client' ? '토스증권 Client ID 또는 Secret이 올바르지 않습니다.' : `토큰 발급 실패 (${err.error ?? res.status})`,
        res.status,
        err.error ?? 'token-error',
      );
    }
    const json = (await res.json()) as { access_token: string; expires_in: number };
    return { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  }

  private async request<T>(
    path: string,
    query: Record<string, string | number | boolean | undefined> = {},
    headers: Record<string, string> = {},
  ): Promise<T> {
    const url = new URL(BASE + path);
    for (const [k, v] of Object.entries(query)) if (v !== undefined) url.searchParams.set(k, String(v));
    let refreshed = false;
    for (let attempt = 0; ; attempt++) {
      await this.throttle();
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${await this.token()}`, Accept: 'application/json', ...headers },
        cache: 'no-store',
      });
      noteCall(null, 'broker:TOSS', outcomeOf(res.status), res.headers);
      if (res.ok) return ((await res.json()) as { result: T }).result;

      if (res.status === 401 && !refreshed) {
        refreshed = true;
        await this.token(true);
        continue;
      }
      const retryable = res.status === 429 || res.status >= 500;
      if (retryable && attempt < MAX_RETRIES) {
        const ra = Number(res.headers.get('retry-after'));
        await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : 500 * 2 ** attempt + Math.random() * 250);
        continue;
      }
      const err = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string; requestId?: string } };
      throw new TossApiError(
        err.error?.message || (res.status === 429 ? '토스증권 API 호출 한도를 초과했습니다.' : `토스증권 API 오류 (${res.status})`),
        res.status,
        err.error?.code ?? `http-${res.status}`,
        err.error?.requestId ?? res.headers.get('x-request-id') ?? undefined,
      );
    }
  }

  /** Current prices; batches of up to 200 symbols per call. */
  async prices(symbols: string[]): Promise<TossPrice[]> {
    const clean = [...new Set(symbols.map(assertSymbol))];
    const out: TossPrice[] = [];
    for (let i = 0; i < clean.length; i += 200) {
      out.push(...(await this.request<TossPrice[]>('/api/v1/prices', { symbols: clean.slice(i, i + 200).join(',') })));
    }
    return out;
  }

  async stocks(symbols: string[]): Promise<TossStock[]> {
    const clean = [...new Set(symbols.map(assertSymbol))];
    if (!clean.length) return [];
    return this.request<TossStock[]>('/api/v1/stocks', { symbols: clean.join(',') });
  }

  /** Daily candles, newest first per page; walks pages until `since` (YYYY-MM-DD) or `maxPages`. */
  async dailyCandles(symbol: string, since: string, maxPages = 10): Promise<TossCandle[]> {
    const out: TossCandle[] = [];
    let before: string | undefined;
    for (let page = 0; page < maxPages; page++) {
      const r = await this.request<{ candles: TossCandle[]; nextBefore: string | null }>('/api/v1/candles', {
        symbol: assertSymbol(symbol),
        interval: '1d',
        count: 200,
        adjusted: true,
        before,
      });
      out.push(...r.candles);
      const oldest = r.candles.at(-1)?.timestamp.slice(0, 10);
      if (!r.nextBefore || !oldest || oldest <= since) break;
      before = r.nextBefore;
    }
    return out.filter((c) => c.timestamp.slice(0, 10) >= since);
  }

  /** One page of candles, newest first. */
  async candles(symbol: string, interval: '1m' | '1d', count = 200, before?: string) {
    return this.request<{ candles: TossCandle[]; nextBefore: string | null }>('/api/v1/candles', {
      symbol: assertSymbol(symbol),
      interval,
      count,
      adjusted: true,
      before,
    });
  }

  /** Domestic indices and KR bond yields (KOSPI, KOSDAQ, KR_BOND_*). */
  async indicatorPrices(symbols: string[]): Promise<TossIndicatorPrice[]> {
    return this.request<TossIndicatorPrice[]>('/api/v1/market-indicators/prices', { symbols: symbols.join(',') });
  }

  async indicatorCandles(symbol: string, interval: '1m' | '1d', count = 2) {
    return this.request<{ candles: TossCandle[]; nextBefore: string | null }>(`/api/v1/market-indicators/${encodeURIComponent(symbol)}/candles`, { interval, count });
  }

  async rankings(type: string, marketCountry: 'KR' | 'US', duration: string, count = 30) {
    return this.request<{ rankedAt: string | null; rankings: TossRankingItem[] }>('/api/v1/rankings', { type, marketCountry, duration, count });
  }

  async orderbook(symbol: string): Promise<TossOrderbook> {
    return this.request<TossOrderbook>('/api/v1/orderbook', { symbol: assertSymbol(symbol) });
  }

  async exchangeRate(base: Currency, quote: Currency, dateTime?: string): Promise<TossExchangeRate> {
    return this.request<TossExchangeRate>('/api/v1/exchange-rate', { baseCurrency: base, quoteCurrency: quote, dateTime });
  }

  async accounts(): Promise<TossAccount[]> {
    return this.request<TossAccount[]>('/api/v1/accounts');
  }

  async holdings(accountSeq: number | bigint): Promise<TossHoldings> {
    return this.request<TossHoldings>('/api/v1/holdings', {}, { 'X-Tossinvest-Account': String(accountSeq) });
  }
}
