/**
 * 키움 REST API (https://openapi.kiwoom.com). API ids and fields follow the
 * official spec in github.com/Kiwoom-Securities/Kiwoom-REST-API
 * (kiwoom/_data/kiwoom_api_spec.json). Business errors arrive as HTTP 200
 * with a non-zero `return_code`.
 */
import { Dec } from '@/domain/decimal';
import {
  absNum,
  addDays,
  fromYmd,
  isKrSymbol,
  krSymbol,
  num,
  pctToRate,
  prevFromChange,
  usMarketCandidates,
  usMarketOf,
  ymd,
  zonedIso,
  type UsMarket,
} from '@/domain/broker-format';
import { parseKiwoomGold, type CommodityDef, type CommodityQuote } from '@/domain/commodities';
import { backoff, fetchJson, rows, sleep, str, throttle, todayKst, TokenManager } from './http';
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
  type RankingMarket,
  type RankingRow,
  type RankingType,
  type TokenStore,
} from './types';

const REAL = 'https://api.kiwoom.com';
const MOCK = 'https://mockapi.kiwoom.com';
const STEX: Record<UsMarket, string> = { NASDAQ: 'ND', NYSE: 'NY', AMEX: 'NA' };
const KR_INDEX: Partial<Record<IndexCode, { mrkt_tp: string; inds_cd: string }>> = {
  KOSPI: { mrkt_tp: '0', inds_cd: '001' },
  KOSDAQ: { mrkt_tp: '1', inds_cd: '101' },
};
/** Ranking requests (fields from the spec; "0"/"000" means no filter). */
const KR_RANKING: Record<RankingType, { apiId: string; list: string; body: Record<string, string> }> = {
  AMOUNT: { apiId: 'ka10032', list: 'trde_prica_upper', body: { mrkt_tp: '000', mang_stk_incls: '0', stex_tp: '1' } },
  VOLUME: {
    apiId: 'ka10030',
    list: 'tdy_trde_qty_upper',
    body: { mrkt_tp: '000', sort_tp: '1', mang_stk_incls: '0', crd_tp: '0', trde_qty_tp: '0', pric_tp: '0', trde_prica_tp: '0', mrkt_open_tp: '0', stex_tp: '1' },
  },
  GAINERS: {
    apiId: 'ka10027',
    list: 'pred_pre_flu_rt_upper',
    body: { mrkt_tp: '000', sort_tp: '1', trde_qty_cnd: '0000', stk_cnd: '0', crd_cnd: '0', updown_incls: '1', pric_cnd: '0', trde_prica_cnd: '0', stex_tp: '1' },
  },
  LOSERS: {
    apiId: 'ka10027',
    list: 'pred_pre_flu_rt_upper',
    body: { mrkt_tp: '000', sort_tp: '3', trde_qty_cnd: '0000', stk_cnd: '0', crd_cnd: '0', updown_incls: '1', pric_cnd: '0', trde_prica_cnd: '0', stex_tp: '1' },
  },
};
const US_FILTERS = { stex_tp: '0', inds_cd: '000', stk_tp: '0', stk_cnd: '0', pric_cnd: '0', trde_prica_cnd: '0', trde_qty_tp: '0' };
const US_RANKING: Record<RankingType, { apiId: string; body: Record<string, string> }> = {
  AMOUNT: { apiId: 'usa20540', body: US_FILTERS },
  VOLUME: { apiId: 'usa20530', body: { ...US_FILTERS, qry_tp: '0' } },
  GAINERS: { apiId: 'usa20910', body: { ...US_FILTERS, inds_cls_tp: '0', sort_tp: '1' } },
  LOSERS: { apiId: 'usa20910', body: { ...US_FILTERS, inds_cls_tp: '0', sort_tp: '4' } },
};

/** "20261008123000" (KST) -> epoch ms */
export function kiwoomExpiry(v: unknown): number {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(str(v));
  if (!m) return Date.now() + 12 * 3_600_000;
  return Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+09:00`);
}

export function parseKiwoomDomestic(list: unknown): BrokerHolding[] {
  return rows(list)
    .filter((r) => absNum(r.rmnd_qty) !== '0')
    .map((r) => ({
      symbol: krSymbol(str(r.stk_cd)) ?? str(r.stk_cd),
      name: str(r.stk_nm) || str(r.stk_cd),
      currency: 'KRW' as const,
      market: 'KRX',
      quantity: absNum(r.rmnd_qty),
      averagePrice: absNum(r.pur_pric),
      lastPrice: absNum(r.cur_prc),
    }));
}

export function parseKiwoomUs(list: unknown): BrokerHolding[] {
  return rows(list)
    .filter((r) => absNum(r.poss_qty) !== '0' && (str(r.crnc_code) || 'USD') === 'USD')
    .map((r) => ({
      symbol: str(r.stk_cd).toUpperCase(),
      name: str(r.frgn_stk_nm) || str(r.stk_cd),
      currency: 'USD' as const,
      market: usMarketOf(str(r.stex_nm)),
      quantity: absNum(r.poss_qty),
      averagePrice: absNum(r.frgn_stk_book_uv),
      lastPrice: absNum(r.now_pric),
    }));
}

export class KiwoomAdapter implements BrokerAdapter {
  readonly broker = 'KIWOOM' as const;
  readonly kind = 'stock' as const;
  private readonly base: string;
  private readonly tokens: TokenManager;

  constructor(private readonly cfg: ConnectionConfig, store: TokenStore) {
    this.base = cfg.paper ? MOCK : REAL;
    this.tokens = new TokenManager(`KIWOOM:${cfg.id}`, store, () => this.issueToken());
  }

  private async issueToken() {
    const r = await fetchJson('KIWOOM', `${this.base}/oauth2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json;charset=UTF-8', 'api-id': 'au10001' },
      body: JSON.stringify({ grant_type: 'client_credentials', appkey: this.cfg.appKey, secretkey: this.cfg.secret }),
    });
    const token = str(r.body.token);
    if (r.status !== 200 || !token || Number(r.body.return_code ?? 0) !== 0) {
      const msg = str(r.body.return_msg);
      throw new BrokerApiError(msg ? `키움증권 토큰 발급 실패: ${msg}` : `키움증권 토큰 발급 실패 (${r.status})`, 'KIWOOM', r.status, str(r.body.return_code) || 'token');
    }
    return { token, expiresAt: kiwoomExpiry(r.body.expires_dt) };
  }

  private async post(path: string, apiId: string, body: Record<string, unknown>, next?: { contYn: string; nextKey: string }) {
    let refreshed = false;
    for (let attempt = 0; ; attempt++) {
      await throttle(`KIWOOM:${this.cfg.id}`, 220);
      const headers: Record<string, string> = {
        'content-type': 'application/json;charset=UTF-8',
        'api-id': apiId,
        authorization: `Bearer ${await this.tokens.get()}`,
      };
      if (next) {
        headers['cont-yn'] = next.contYn;
        headers['next-key'] = next.nextKey;
      }
      const r = await fetchJson('KIWOOM', this.base + path, { method: 'POST', headers, body: JSON.stringify(body) });
      const code = Number(r.body.return_code ?? (r.status === 200 ? 0 : -1));
      const msg = str(r.body.return_msg);
      if (r.status === 200 && code === 0) {
        return { body: r.body, contYn: str(r.headers.get('cont-yn')), nextKey: str(r.headers.get('next-key')) };
      }
      // 8005: invalid token (sometimes wrapped as return_code 3 with "[8005:...]")
      if (!refreshed && (r.status === 401 || code === 8005 || msg.includes('8005'))) {
        refreshed = true;
        this.tokens.forget();
        await this.tokens.get(true);
        continue;
      }
      // 1700-1702: request rate exceeded
      if ((code === 1700 || code === 1701 || code === 1702 || r.status === 429 || r.status >= 500) && attempt < 3) {
        await sleep(backoff(attempt));
        continue;
      }
      throw new BrokerApiError(msg || `키움증권 API 오류 (${r.status})`, 'KIWOOM', r.status, String(code));
    }
  }

  async verify() {
    await this.post('/api/dostk/acnt', 'kt00018', { qry_tp: '1', dmst_stex_tp: 'KRX' });
    return {};
  }

  async holdings(): Promise<BrokerHolding[]> {
    const out: BrokerHolding[] = [];
    let next: { contYn: string; nextKey: string } | undefined;
    for (let page = 0; page < 20; page++) {
      const r = await this.post('/api/dostk/acnt', 'kt00018', { qry_tp: '1', dmst_stex_tp: 'KRX' }, next);
      out.push(...parseKiwoomDomestic(r.body.acnt_evlt_remn_indv_tot));
      if (r.contYn !== 'Y' || !r.nextKey) break;
      next = { contYn: 'Y', nextKey: r.nextKey };
    }
    try {
      next = undefined;
      for (let page = 0; page < 20; page++) {
        const r = await this.post('/api/us/acnt', 'ust21070', { stex_tp: '', stk_cd: '' }, next);
        out.push(...parseKiwoomUs(r.body.result_list));
        if (r.contYn !== 'Y' || !r.nextKey) break;
        next = { contYn: 'Y', nextKey: r.nextKey };
      }
    } catch (e) {
      console.warn('[kiwoom] US balance skipped:', e instanceof Error ? e.message : e);
    }
    return out;
  }

  private async usInfo(symbol: string, market: string | null) {
    for (const m of usMarketCandidates(market)) {
      try {
        const r = await this.post('/api/us/mrkcond', 'usa20100', { stex_tp: STEX[m], stk_cd: symbol });
        const price = absNum(r.body.cur_prc);
        const name = str(r.body.stk_nm) || str(r.body.stk_enm);
        if (price !== '0' || name)
          return { market: m, price, name, englishName: str(r.body.stk_enm), fx: num(r.body.base_exrt), prevClose: absNum(r.body.base_close_pric), volume: absNum(r.body.acc_trde_qty) };
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
          const r = await this.post('/api/dostk/stkinfo', 'ka10001', { stk_cd: ref.symbol });
          const price = absNum(r.body.cur_prc);
          // base_pric (기준가) is the previous close
          const prev = absNum(r.body.base_pric);
          if (price !== '0') out.push({ symbol: ref.symbol, price, currency: 'KRW', market: ref.market, asOf: null, prevClose: prev === '0' ? null : prev, volume: absNum(r.body.trde_qty) });
        } else {
          const info = await this.usInfo(ref.symbol, ref.market);
          if (info && info.price !== '0')
            out.push({ symbol: ref.symbol, price: info.price, currency: 'USD', market: info.market, asOf: null, prevClose: info.prevClose === '0' ? null : info.prevClose, volume: info.volume });
        }
      } catch (e) {
        if (!(e instanceof BrokerApiError)) throw e;
      }
    }
    return out;
  }

  async instrument(symbol: string): Promise<Instrument | null> {
    if (isKrSymbol(symbol)) {
      const r = await this.post('/api/dostk/stkinfo', 'ka10001', { stk_cd: symbol });
      const name = str(r.body.stk_nm);
      return name ? { symbol, name, currency: 'KRW', market: 'KRX' } : null;
    }
    const info = await this.usInfo(symbol, null);
    return info?.name ? { symbol, name: info.name, currency: 'USD', market: info.market, englishName: info.englishName || undefined } : null;
  }

  async dailyCloses(ref: InstrumentRef, since: string): Promise<DailyClose[]> {
    const out = new Map<string, string>();
    const kr = isKrSymbol(ref.symbol);
    const m = usMarketOf(ref.market) ?? 'NASDAQ';
    let base = todayKst();
    for (let i = 0; i < 12; i++) {
      const r = kr
        ? await this.post('/api/dostk/chart', 'ka10081', { stk_cd: ref.symbol, base_dt: ymd(base), upd_stkpc_tp: '1' })
        : await this.post('/api/us/mrkcond', 'usa20590', { stex_tp: STEX[m], stk_cd: ref.symbol, base_dt: ymd(base) });
      const page = rows(kr ? r.body.stk_dt_pole_chart_qry : r.body.result_list)
        .map((row) => ({ d: fromYmd(row.dt), c: absNum(row.cur_prc) }))
        .filter((x): x is { d: string; c: string } => !!x.d && x.c !== '0');
      for (const x of page) out.set(x.d, x.c);
      const oldest = page.map((x) => x.d).sort()[0];
      if (!oldest || oldest <= since || oldest >= base) break;
      base = addDays(oldest, -1);
    }
    return [...out].filter(([d]) => d >= since).map(([date, close]) => ({ date, close }));
  }

  async usdKrw(): Promise<string | null> {
    const info = await this.usInfo('AAPL', 'NASDAQ');
    return info && info.fx !== '0' ? info.fx : null;
  }

  /** KRX 금현물 only (ka50100); 키움 also trades it, so the key needs no extra service. */
  async commodity(def: CommodityDef, contract: string): Promise<CommodityQuote | null> {
    if (def.source !== 'KRX_GOLD') return null;
    const r = await this.post('/api/dostk/mrkcond', 'ka50100', { stk_cd: contract });
    return parseKiwoomGold(r.body);
  }

  async indices(codes: IndexCode[]): Promise<IndexQuote[]> {
    const out: IndexQuote[] = [];
    for (const code of codes) {
      const req = KR_INDEX[code];
      if (!req) continue;
      try {
        const r = await this.post('/api/dostk/sect', 'ka20001', req);
        const price = absNum(r.body.cur_prc);
        // pred_pre carries the change with its sign
        if (price !== '0') out.push({ code, price, prevClose: prevFromChange(price, num(r.body.pred_pre)), asOf: null });
      } catch (e) {
        if (!(e instanceof BrokerApiError)) throw e;
      }
    }
    return out;
  }

  async rankings(market: RankingMarket, type: RankingType): Promise<RankingRow[] | null> {
    if (market === 'CRYPTO') return null;
    if (market === 'KR') {
      const spec = KR_RANKING[type];
      const r = await this.post('/api/dostk/rkinfo', spec.apiId, spec.body);
      return rows(r.body[spec.list]).slice(0, 30).map((x) => ({
        symbol: krSymbol(str(x.stk_cd)) ?? str(x.stk_cd),
        name: str(x.stk_nm) || null,
        price: absNum(x.cur_prc),
        changeRate: pctToRate(x.flu_rt),
        volume: absNum(x.now_trde_qty ?? x.trde_qty),
        // trde_prica is in millions of won
        amount: x.trde_prica === undefined ? null : Dec.of(absNum(x.trde_prica)).mul(1_000_000).toString(),
        currency: 'KRW' as const,
      }));
    }
    const spec = US_RANKING[type];
    const r = await this.post('/api/us/rkinfo', spec.apiId, spec.body);
    return rows(r.body.result_list).slice(0, 30).map((x) => ({
      symbol: str(x.stk_cd).toUpperCase(),
      name: str(x.stk_nm) || str(x.stk_enm) || null,
      price: absNum(x.cur_prc),
      changeRate: pctToRate(x.flu_rt),
      volume: absNum(x.acc_trde_qty ?? x.trde_qty),
      // trde_prica is in thousands of dollars
      amount: x.trde_prica === undefined ? null : Dec.of(absNum(x.trde_prica)).mul(1000).toString(),
      currency: 'USD' as const,
    }));
  }

  async intraday(ref: InstrumentRef): Promise<MinuteBar[]> {
    const kr = isKrSymbol(ref.symbol);
    const zone = kr ? 'Asia/Seoul' : 'America/New_York';
    const bars = new Map<string, MinuteBar>();
    let session: string | null = null;
    let next: { contYn: string; nextKey: string } | undefined;
    for (let page = 0; page < 4; page++) {
      const r = kr
        ? await this.post('/api/dostk/chart', 'ka10080', { stk_cd: ref.symbol, tic_scope: '1', upd_stkpc_tp: '1' }, next)
        : await this.post('/api/us/chart', 'usa06011', { stex_tp: STEX[usMarketOf(ref.market) ?? 'NASDAQ'], stk_cd: ref.symbol, tic_scope: '1', upd_stkpc_tp: '1', exrt_appl_tp: '0' }, next);
      let stop = false;
      for (const x of rows(kr ? r.body.stk_min_pole_chart_qry : r.body.result_list)) {
        const stamp = str(x.cntr_tm);
        if (stamp.length < 12) continue;
        session ??= stamp.slice(0, 8);
        if (stamp.slice(0, 8) !== session) {
          stop = true;
          continue;
        }
        // cntr_tm is exchange-local time
        const t = zonedIso(stamp.slice(0, 8), stamp.slice(8, 14), zone);
        if (t) bars.set(t, { time: t, close: absNum(x.cur_prc), volume: absNum(x.trde_qty) });
      }
      if (stop || r.contYn !== 'Y' || !r.nextKey) break;
      next = { contYn: 'Y', nextKey: r.nextKey };
    }
    return [...bars.values()].sort((a, b) => a.time.localeCompare(b.time));
  }

  async orderbook(ref: InstrumentRef): Promise<Orderbook | null> {
    const pick = (o: Record<string, unknown>, price: (i: number) => string, vol: (i: number) => string) => {
      const out: OrderbookLevel[] = [];
      for (let i = 1; i <= 10; i++) {
        const p = absNum(o[price(i)]);
        if (p !== '0') out.push({ price: p, volume: absNum(o[vol(i)]) });
      }
      return out;
    };
    if (isKrSymbol(ref.symbol)) {
      const r = await this.post('/api/dostk/mrkcond', 'ka10004', { stk_cd: ref.symbol });
      // Level 1 is "fpr" (최우선); levels 2-10 are "{n}th_pre"
      const key = (side: 'sel' | 'buy', i: number, kind: 'bid' | 'req') => (i === 1 ? `${side}_fpr_${kind}` : `${side}_${i}th_pre_${kind}`);
      return {
        asks: pick(r.body, (i) => key('sel', i, 'bid'), (i) => key('sel', i, 'req')),
        bids: pick(r.body, (i) => key('buy', i, 'bid'), (i) => key('buy', i, 'req')),
        currency: 'KRW',
        asOf: null,
      };
    }
    for (const m of usMarketCandidates(ref.market)) {
      try {
        const r = await this.post('/api/us/mrkcond', 'usa20101', { stex_tp: STEX[m], stk_cd: ref.symbol });
        const book = {
          asks: pick(r.body, (i) => `sel_${i}bid`, (i) => `sel_${i}bid_req`),
          bids: pick(r.body, (i) => `buy_${i}bid`, (i) => `buy_${i}bid_req`),
          currency: 'USD' as const,
          asOf: null,
        };
        if (book.asks.length || book.bids.length) return book;
      } catch (e) {
        if (!(e instanceof BrokerApiError)) throw e;
      }
    }
    return null;
  }

  /** Native 1/5/15/60-minute, daily and weekly bars for KRX and US stocks; 4-hour bars are rolled up. */
  async candles(ref: InstrumentRef, unit: CandleUnit, count: number): Promise<Candle[] | null> {
    const kr = isKrSymbol(ref.symbol);
    const tic = { '1m': '1', '5m': '5', '15m': '15', '60m': '60' }[unit as string];
    if (!tic && unit !== '1d' && unit !== '1w') return null;
    const stex = STEX[usMarketOf(ref.market) ?? 'NASDAQ'];
    const zone = kr ? 'Asia/Seoul' : 'America/New_York';
    const call = (next?: { contYn: string; nextKey: string }) =>
      tic
        ? kr
          ? this.post('/api/dostk/chart', 'ka10080', { stk_cd: ref.symbol, tic_scope: tic, upd_stkpc_tp: '1' }, next)
          : this.post('/api/us/chart', 'usa06011', { stex_tp: stex, stk_cd: ref.symbol, tic_scope: tic, upd_stkpc_tp: '1', exrt_appl_tp: '0' }, next)
        : kr
          ? this.post('/api/dostk/chart', unit === '1d' ? 'ka10081' : 'ka10082', { stk_cd: ref.symbol, base_dt: ymd(todayKst()), upd_stkpc_tp: '1' }, next)
          : this.post('/api/us/chart', unit === '1d' ? 'usa06012' : 'usa06013', { stex_tp: stex, stk_cd: ref.symbol, upd_stkpc_tp: '1', exrt_appl_tp: '0' }, next);
    const list = (b: Record<string, unknown>) => rows(b.stk_min_pole_chart_qry ?? b.stk_dt_pole_chart_qry ?? b.stk_stk_pole_chart_qry ?? b.result_list);
    const bars = new Map<string, Candle>();
    let next: { contYn: string; nextKey: string } | undefined;
    for (let page = 0; page < 5 && bars.size < count; page++) {
      const r = await call(next);
      for (const x of list(r.body)) {
        const stamp = str(x.cntr_tm);
        const time = tic ? (stamp.length >= 12 ? zonedIso(stamp.slice(0, 8), stamp.slice(8, 14), zone) : null) : zonedIso(str(x.dt), '000000', zone);
        if (!time || absNum(x.cur_prc) === '0') continue;
        bars.set(time, {
          time,
          open: absNum(x.open_pric),
          high: absNum(x.high_pric),
          low: absNum(x.low_pric),
          close: absNum(x.cur_prc),
          volume: absNum(x.trde_qty ?? x.acc_trde_qty),
        });
      }
      if (r.contYn !== 'Y' || !r.nextKey) break;
      next = { contYn: 'Y', nextKey: r.nextKey };
    }
    return [...bars.values()].sort((a, b) => a.time.localeCompare(b.time)).slice(-count);
  }
}
