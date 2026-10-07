/**
 * 메리츠증권 Open API, beta (https://openapi.imeritz.com). Paths and fields
 * follow the official OpenAPI document and samples in
 * github.com/meritz-securities/open-api. The gateway requires a 12-digit MAC
 * address header on every call; errors come back as HTTP 500 with `rsp_cd`.
 */
import { networkInterfaces } from 'node:os';
import { Dec } from '@/domain/decimal';
import { addDays, fromYmd, isKrSymbol, krSymbol, num, usMarketCandidates, usMarketOf, ymd, type UsMarket } from '@/domain/broker-format';
import { backoff, expiryFrom, fetchJson, obj, rows, sleep, str, throttle, todayKst, TokenManager } from './http';
import {
  BrokerApiError,
  type BrokerAdapter,
  type BrokerHolding,
  type ConnectionConfig,
  type DailyClose,
  type Instrument,
  type InstrumentRef,
  type PriceQuote,
  type TokenStore,
} from './types';

const BASE = 'https://openapi.imeritz.com:9443';
const MRKT_CLS: Record<UsMarket, string> = { NASDAQ: 'OQ', NYSE: 'NY', AMEX: 'AX' };

/** This server's first real MAC address as 12 hex digits, which the gateway insists on. */
function macAddress(): string {
  for (const list of Object.values(networkInterfaces())) {
    for (const i of list ?? []) {
      if (!i.internal && i.mac && i.mac !== '00:00:00:00:00:00') return i.mac.replace(/:/g, '').toUpperCase();
    }
  }
  return '0242AC110002';
}

export function parseMeritzDomestic(data: unknown): BrokerHolding[] {
  return rows(data)
    .filter((r) => str(r.pros_trgt_cls_code) === '1')
    .map((r) => ({
      symbol: krSymbol(str(r.iscd)) ?? str(r.iscd),
      name: str(r.isnm) || str(r.iscd),
      currency: 'KRW' as const,
      market: 'KRX',
      // Whole shares in rmnd_qty, fractional-share purchases in rmnd_dqty.
      quantity: Dec.of(num(r.rmnd_qty)).add(num(r.rmnd_dqty)).toString(),
      averagePrice: num(r.byng_unpr),
      lastPrice: num(r.psnt_prc),
    }))
    .filter((h) => h.quantity !== '0');
}

export function parseMeritzOverseas(data: unknown): BrokerHolding[] {
  return rows(data)
    .filter((r) => num(r.rmnd_dqty) !== '0' && (str(r.crcd) || 'USD') === 'USD')
    .map((r) => {
      const iscd = str(r.iscd);
      const symbol = (str(r.ovrs_stck_symb_iscd) || iscd.split('.')[0]).toUpperCase();
      return {
        symbol,
        name: str(r.isnm) || symbol,
        currency: 'USD' as const,
        market: usMarketOf(iscd.includes('.') ? iscd.split('.').pop()! : ''),
        quantity: num(r.rmnd_dqty),
        averagePrice: num(r.avrg_unpr),
        lastPrice: num(r.psnt_prc),
      };
    });
}

export class MeritzAdapter implements BrokerAdapter {
  readonly broker = 'MERITZ' as const;
  private readonly tokens: TokenManager;
  private readonly mac = macAddress();

  constructor(private readonly cfg: ConnectionConfig, store: TokenStore) {
    this.tokens = new TokenManager(`MERITZ:${cfg.id}`, store, () => this.issueToken());
  }

  private async issueToken() {
    const r = await fetchJson('MERITZ', `${BASE}/oauth2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: this.cfg.appKey, client_secret: this.cfg.secret, scope: 'login' }),
    });
    const token = str(r.body.access_token);
    if (r.status !== 200 || !token) {
      const msg = str(r.body.rsp_msg) || str(r.body.error_description);
      throw new BrokerApiError(msg ? `메리츠증권 토큰 발급 실패: ${msg}` : `메리츠증권 토큰 발급 실패 (${r.status})`, 'MERITZ', r.status, str(r.body.rsp_cd) || 'token');
    }
    return { token, expiresAt: expiryFrom(r.body, 43_200) };
  }

  private async get(path: string, query: Record<string, string> = {}) {
    const url = new URL(BASE + path);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    let refreshed = false;
    for (let attempt = 0; ; attempt++) {
      // 10 calls per second per API
      await throttle(`MERITZ:${this.cfg.id}:${path}`, 110);
      const r = await fetchJson('MERITZ', url.toString(), {
        headers: { authorization: `Bearer ${await this.tokens.get()}`, mac_address: this.mac },
      });
      const code = str(r.body.rsp_cd);
      const msg = str(r.body.rsp_msg);
      if (r.status === 200 && !/^(IGW|EGW)/.test(code)) return r.body;
      if (!refreshed && (r.status === 401 || code === 'EGW00123' || code === 'EGW00121' || /토큰|token/i.test(msg))) {
        refreshed = true;
        this.tokens.forget();
        await this.tokens.get(true);
        continue;
      }
      // EGW00200: calls per second exceeded
      if ((code === 'EGW00200' || r.status === 429) && attempt < 3) {
        await sleep(backoff(attempt));
        continue;
      }
      const sub = str(r.body.rsp_sub_msg);
      throw new BrokerApiError(msg ? `${msg}${sub ? ` (${sub})` : ''}` : `메리츠증권 API 오류 (${r.status})`, 'MERITZ', r.status, code);
    }
  }

  async verify() {
    await this.get('/accounts/v1/me/holdings');
    return {};
  }

  async holdings(): Promise<BrokerHolding[]> {
    const out = parseMeritzDomestic((await this.get('/accounts/v1/me/holdings')).data);
    try {
      out.push(...parseMeritzOverseas((await this.get('/accounts/v1/me/overseas/holdings')).data));
    } catch (e) {
      console.warn('[meritz] overseas balance skipped:', e instanceof Error ? e.message : e);
    }
    return out;
  }

  private async usPrice(symbol: string, market: string | null) {
    for (const m of usMarketCandidates(market)) {
      try {
        const d = obj(
          (await this.get('/market/v1/overseas/prices', { mrkt_div_code: 'OV', mrkt_cls_code: MRKT_CLS[m], iscd: symbol, dely_rltm_cls_code: '1' })).data,
        );
        const price = num(d.prpr);
        if (price !== '0') return { market: m, price, name: str(d.kor_isnm) || str(d.eng_isnm), englishName: str(d.eng_isnm) };
      } catch (e) {
        if (!(e instanceof BrokerApiError)) throw e;
      }
    }
    return null;
  }

  async quotes(refs: InstrumentRef[]): Promise<PriceQuote[]> {
    const out: PriceQuote[] = [];
    for (const ref of refs) {
      try {
        if (isKrSymbol(ref.symbol)) {
          const d = obj((await this.get('/market/v1/prices', { mrkt_div_code: 'J', iscd: ref.symbol })).data);
          const price = num(d.stck_prpr);
          if (price !== '0') out.push({ symbol: ref.symbol, price, currency: 'KRW', market: ref.market, asOf: null });
        } else {
          const q = await this.usPrice(ref.symbol, ref.market);
          if (q) out.push({ symbol: ref.symbol, price: q.price, currency: 'USD', market: q.market, asOf: null });
        }
      } catch (e) {
        if (!(e instanceof BrokerApiError)) throw e;
      }
    }
    return out;
  }

  async instrument(symbol: string): Promise<Instrument | null> {
    if (isKrSymbol(symbol)) {
      const d = obj((await this.get('/market/v1/prices', { mrkt_div_code: 'J', iscd: symbol })).data);
      const name = str(d.kor_isnm);
      return name ? { symbol, name, currency: 'KRW', market: str(d.rprs_mrkt_kor_name).startsWith('KOSDAQ') ? 'KOSDAQ' : 'KRX' } : null;
    }
    const q = await this.usPrice(symbol, null);
    return q?.name ? { symbol, name: q.name, currency: 'USD', market: q.market, englishName: q.englishName || undefined } : null;
  }

  async dailyCloses(ref: InstrumentRef, since: string): Promise<DailyClose[]> {
    const kr = isKrSymbol(ref.symbol);
    const range = { from: ymd(since), to: ymd(todayKst()) };
    const body = kr
      ? await this.get('/market/v1/candles/days', { mrkt_div_code: 'J', iscd: ref.symbol, mod_stpr_cls_code: '1', ...range })
      : await this.get('/market/v1/overseas/candles/days', {
          mrkt_div_code: 'OV',
          mrkt_cls_code: MRKT_CLS[usMarketOf(ref.market) ?? 'NASDAQ'],
          iscd: ref.symbol,
          dely_rltm_cls_code: '1',
          mod_stpr_cls_code: '1',
          ...range,
        });
    const out = new Map<string, string>();
    for (const row of rows(body.data)) {
      const d = fromYmd(row.date);
      const close = num(kr ? row.stck_clpr : row.prpr);
      if (d && d >= since && close !== '0') out.set(d, close);
    }
    return [...out].map(([date, close]) => ({ date, close }));
  }

  async usdKrw(): Promise<string | null> {
    // Rates are published per business day; step back over weekends and holidays.
    let day = todayKst();
    for (let i = 0; i < 6; i++) {
      const list = rows((await this.get('/forex/v1/rates', { stnd_date: ymd(day), crcd: 'USD' })).data);
      const rate = num(list.find((x) => str(x.crcd) === 'USD')?.deal_stnd_exrt);
      if (rate !== '0') return rate;
      day = addDays(day, -1);
    }
    return null;
  }
}
