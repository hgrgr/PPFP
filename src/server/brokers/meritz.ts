/**
 * 메리츠증권 Open API, beta (https://openapi.imeritz.com). Paths and fields
 * follow the official OpenAPI document and samples in
 * github.com/meritz-securities/open-api. The gateway requires a 12-digit MAC
 * address header on every call; errors come back as HTTP 500 with `rsp_cd`.
 */
import { networkInterfaces } from 'node:os';
import { Dec } from '@/domain/decimal';
import { absNum, addDays, fromYmd, isKrSymbol, krSymbol, num, usMarketCandidates, usMarketOf, ymd, zonedIso, type UsMarket } from '@/domain/broker-format';
import { backoff, expiryFrom, fetchJson, obj, rows, sleep, str, throttle, todayKst, TokenManager } from './http';
import {
  BrokerApiError,
  type BrokerAdapter,
  type BrokerHolding,
  type ConnectionConfig,
  type DailyClose,
  type IndexCode,
  type IndexQuote,
  type Instrument,
  type InstrumentRef,
  type Candle,
  type CandleUnit,
  type MinuteBar,
  type Orderbook,
  type OrderbookLevel,
  type PriceQuote,
  type TokenStore,
} from './types';

const BASE = 'https://openapi.imeritz.com:9443';
const MRKT_CLS: Record<UsMarket, string> = { NASDAQ: 'OQ', NYSE: 'NY', AMEX: 'AX' };
/** Index codes: domestic per the spec examples; overseas share LS-style symbols (NAS@IXIC is the documented example). */
const KR_INDEX: Partial<Record<IndexCode, string>> = { KOSPI: 'KGG01P', KOSDAQ: 'QGG01P' };
const US_INDEX: Partial<Record<IndexCode, string>> = { NASDAQ: 'NAS@IXIC', SP500: 'SPI@SPX', DOW: 'DJI@DJI' };

/** The KRX session a bare HHMMSS minute bar belongs to: today from 09:00 on weekdays, else the previous weekday. */
function krSessionDate(now = new Date()): string {
  const kst = new Date(now.getTime() + 9 * 3_600_000);
  let day = kst.toISOString().slice(0, 10);
  const weekday = (d: string) => new Date(d + 'T00:00:00Z').getUTCDay();
  if (kst.getUTCHours() < 9) day = addDays(day, -1);
  while (weekday(day) === 0 || weekday(day) === 6) day = addDays(day, -1);
  return day;
}

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
  readonly kind = 'stock' as const;
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
        if (price !== '0')
          return { market: m, price, name: str(d.kor_isnm) || str(d.eng_isnm), englishName: str(d.eng_isnm), prevClose: num(d.prdy_clpr) === '0' ? null : num(d.prdy_clpr), volume: num(d.acml_vol) };
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
          // sdpr (기준가) is the previous close
          if (price !== '0') out.push({ symbol: ref.symbol, price, currency: 'KRW', market: ref.market, asOf: null, prevClose: num(d.sdpr) === '0' ? null : num(d.sdpr), volume: num(d.acml_vol) });
        } else {
          const q = await this.usPrice(ref.symbol, ref.market);
          if (q) out.push({ symbol: ref.symbol, price: q.price, currency: 'USD', market: q.market, asOf: null, prevClose: q.prevClose, volume: q.volume });
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

  async indices(codes: IndexCode[]): Promise<IndexQuote[]> {
    const out: IndexQuote[] = [];
    for (const code of codes) {
      const path = KR_INDEX[code] ? '/market/v1/index/prices' : US_INDEX[code] ? '/market/v1/overseas/index/prices' : null;
      if (!path) continue;
      try {
        const d = obj((await this.get(path, { iscd: (KR_INDEX[code] ?? US_INDEX[code])! })).data);
        const price = num(d.stck_prpr);
        if (price !== '0') out.push({ code, price, prevClose: num(d.prdy_clpr) === '0' ? null : num(d.prdy_clpr), asOf: null });
      } catch (e) {
        if (!(e instanceof BrokerApiError)) throw e;
      }
    }
    return out;
  }

  async intraday(ref: InstrumentRef): Promise<MinuteBar[]> {
    const bars: MinuteBar[] = [];
    if (isKrSymbol(ref.symbol)) {
      const day = ymd(krSessionDate());
      const list = rows((await this.get('/market/v1/candles/minutes', { mrkt_div_code: 'J', iscd: ref.symbol, hour_cls_code: '60' })).data);
      for (const x of list) {
        const t = zonedIso(day, str(x.cntg_hour), 'Asia/Seoul');
        if (t && num(x.stck_prpr) !== '0') bars.push({ time: t, close: num(x.stck_prpr), volume: num(x.cntg_vol) });
      }
    } else {
      const list = rows(
        (
          await this.get('/market/v1/overseas/candles/minutes', {
            mrkt_div_code: 'OV',
            mrkt_cls_code: MRKT_CLS[usMarketOf(ref.market) ?? 'NASDAQ'],
            iscd: ref.symbol,
            dely_rltm_cls_code: '1',
            hour_cls_code: '60',
          })
        ).data,
      );
      // korea_date/korea_hour are KST; keep the latest US session only
      const stamped = list
        .map((x) => ({ t: zonedIso(str(x.korea_date), str(x.korea_hour), 'Asia/Seoul'), x }))
        .filter((e): e is { t: string; x: Record<string, unknown> } => !!e.t && num(e.x.prpr) !== '0');
      const latest = stamped.map((e) => e.t).sort().at(-1);
      const cutoff = latest ? Date.parse(latest) - 16 * 3_600_000 : 0;
      for (const { t, x } of stamped) if (Date.parse(t) > cutoff) bars.push({ time: t, close: num(x.prpr), volume: num(x.cntg_vol) });
    }
    return bars.sort((a, b) => a.time.localeCompare(b.time));
  }

  async orderbook(ref: InstrumentRef): Promise<Orderbook | null> {
    const pick = (d: Record<string, unknown>, side: 'askp' | 'bidp', plainFirst: boolean) => {
      const out: OrderbookLevel[] = [];
      for (let i = 1; i <= 10; i++) {
        // The domestic orderbook names its first level "askp"/"bidp" without a number
        const p = absNum(d[i === 1 && plainFirst ? side : `${side}${i}`]);
        if (p !== '0') out.push({ price: p, volume: absNum(d[`${side}_rsqn${i}`]) });
      }
      return out;
    };
    if (isKrSymbol(ref.symbol)) {
      const d = obj((await this.get('/market/v1/orderbook', { mrkt_div_code: 'J', iscd: ref.symbol })).data);
      return { asks: pick(d, 'askp', true), bids: pick(d, 'bidp', true), currency: 'KRW', asOf: null };
    }
    for (const m of usMarketCandidates(ref.market)) {
      try {
        const d = obj((await this.get('/market/v1/overseas/orderbook', { mrkt_div_code: 'OV', mrkt_cls_code: MRKT_CLS[m], iscd: ref.symbol, dely_rltm_cls_code: '1' })).data);
        const book = { asks: pick(d, 'askp', false), bids: pick(d, 'bidp', false), currency: 'USD' as const, asOf: null };
        if (book.asks.length || book.bids.length) return book;
      } catch (e) {
        if (!(e instanceof BrokerApiError)) throw e;
      }
    }
    return null;
  }

  /** Minute bars (today's session for KRX, KST-stamped for US) and daily bars; 4-hour and weekly are rolled up. */
  async candles(ref: InstrumentRef, unit: CandleUnit, count: number): Promise<Candle[] | null> {
    const kr = isKrSymbol(ref.symbol);
    const seconds = { '1m': 60, '5m': 300, '15m': 900, '60m': 3600 }[unit as string];
    if (!seconds && unit !== '1d') return null;
    const bars: Candle[] = [];
    if (unit === '1d') {
      const range = { from: ymd(addDays(todayKst(), -Math.ceil(count * 1.5) - 7)), to: ymd(todayKst()) };
      const body = kr
        ? await this.get('/market/v1/candles/days', { mrkt_div_code: 'J', iscd: ref.symbol, mod_stpr_cls_code: '1', ...range })
        : await this.get('/market/v1/overseas/candles/days', {
            mrkt_div_code: 'OV', mrkt_cls_code: MRKT_CLS[usMarketOf(ref.market) ?? 'NASDAQ'], iscd: ref.symbol, dely_rltm_cls_code: '1', mod_stpr_cls_code: '1', ...range,
          });
      for (const x of rows(body.data)) {
        const time = zonedIso(str(x.date), '000000', kr ? 'Asia/Seoul' : 'America/New_York');
        const close = num(kr ? x.stck_clpr : x.prpr);
        if (time && close !== '0') bars.push({ time, open: num(x.oprc), high: num(x.hprc), low: num(x.lprc), close, volume: num(x.acml_vol) });
      }
    } else if (kr) {
      const day = ymd(krSessionDate());
      for (const x of rows((await this.get('/market/v1/candles/minutes', { mrkt_div_code: 'J', iscd: ref.symbol, hour_cls_code: String(seconds) })).data)) {
        const time = zonedIso(day, str(x.cntg_hour), 'Asia/Seoul');
        if (time && num(x.stck_prpr) !== '0') bars.push({ time, open: num(x.oprc), high: num(x.hprc), low: num(x.lprc), close: num(x.stck_prpr), volume: num(x.cntg_vol) });
      }
    } else {
      const list = rows(
        (
          await this.get('/market/v1/overseas/candles/minutes', {
            mrkt_div_code: 'OV', mrkt_cls_code: MRKT_CLS[usMarketOf(ref.market) ?? 'NASDAQ'], iscd: ref.symbol, dely_rltm_cls_code: '1', hour_cls_code: String(seconds),
          })
        ).data,
      );
      for (const x of list) {
        const time = zonedIso(str(x.korea_date), str(x.korea_hour), 'Asia/Seoul');
        if (time && num(x.prpr) !== '0') bars.push({ time, open: num(x.oprc), high: num(x.hprc), low: num(x.lprc), close: num(x.prpr), volume: num(x.cntg_vol) });
      }
    }
    return bars.sort((a, b) => a.time.localeCompare(b.time)).slice(-count);
  }
}
