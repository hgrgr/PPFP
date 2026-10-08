/**
 * DB증권 Open API (https://openapi.dbsec.co.kr). Paths, request blocks and
 * fields follow the official samples in github.com/DBsecurities/dbsec-open-api.
 * Every call is a POST with an {"In": {...}} body; continuation uses the
 * cont_yn / cont_key headers.
 */
import { Dec } from '@/domain/decimal';
import { absNum, addDays, fromYmd, isKrSymbol, krSymbol, num, pctToRate, usMarketCandidates, usMarketOf, withSign, ymd, zonedIso, type UsMarket } from '@/domain/broker-format';
import { backoff, expiryFrom, fetchJson, obj, rows, sleep, str, throttle, todayKst, TokenManager } from './http';
import {
  BrokerApiError,
  type BrokerAdapter,
  type BrokerHolding,
  type ConnectionConfig,
  type DailyClose,
  type InstrumentRef,
  type MinuteBar,
  type Orderbook,
  type OrderbookLevel,
  type PriceQuote,
  type RankingMarket,
  type RankingRow,
  type RankingType,
  type TokenStore,
} from './types';

const BASE = 'https://openapi.dbsec.co.kr:8443';
/** InputCondMrktDivCode for US quotes and charts */
const MRKT: Record<UsMarket, string> = { NASDAQ: 'FN', NYSE: 'FY', AMEX: 'FA' };
/** Documented TPS per endpoint (balances 2-3, quotes 2-5); charts are not documented, so stay slow. */
const INTERVAL_MS: Record<string, number> = {
  '/api/v1/trading/kr-stock/inquiry/balance': 550,
  '/api/v1/trading/overseas-stock/inquiry/balance-margin': 400,
  '/api/v1/quote/kr-stock/inquiry/price': 220,
  '/api/v1/quote/overseas-stock/inquiry/price': 550,
  '/api/v1/quote/kr-stock/inquiry/rank-list': 400,
  '/api/v1/quote/overseas-stock/inquiry/rank-list': 550,
  '/api/v1/quote/kr-chart/min': 300,
  '/api/v1/quote/overseas-stock/chart/min': 300,
  '/api/v1/quote/kr-stock/inquiry/orderbook': 400,
  '/api/v1/quote/overseas-stock/inquiry/orderbook': 550,
};

export function parseDbDomestic(out1: unknown): BrokerHolding[] {
  return rows(out1)
    .map((r) => {
      // BalQty0 is the execution-basis balance (includes today's unsettled trades)
      const qty = num(r.BalQty0) !== '0' ? num(r.BalQty0) : num(r.BalQty);
      const amount = Dec.of(num(r.PchsAmt));
      const avg = qty === '0' ? Dec.ZERO : amount.div(qty).round(4);
      return {
        symbol: krSymbol(str(r.IsuNo)) ?? str(r.IsuNo),
        name: str(r.IsuNm) || str(r.IsuNo),
        currency: 'KRW' as const,
        market: 'KRX',
        quantity: qty,
        averagePrice: avg.toString(),
        lastPrice: num(r.NowPrc),
      };
    })
    .filter((h) => h.quantity !== '0');
}

export function parseDbOverseas(out2: unknown): BrokerHolding[] {
  return rows(out2)
    .map((r) => {
      const qty = num(r.AstkExecBaseQty) !== '0' ? num(r.AstkExecBaseQty) : num(r.AstkSettBaseQty);
      const symbol = (str(r.AstkIsuNo) || str(r.ShtnCntrySymCode) || str(r.SymCode)).toUpperCase();
      return {
        symbol,
        name: str(r.AstkHanglIsuNm) || symbol,
        currency: (str(r.CrcyCode) || 'USD') as 'USD',
        market: usMarketOf(str(r.AstkMktNm)) ?? usMarketOf(str(r.AstkSeNm)) ?? usMarketOf(str(r.AstkMktCode)),
        quantity: qty,
        averagePrice: num(r.AstkAvrPchsPrc),
        lastPrice: num(r.AstkNowPrc),
      };
    })
    .filter((h) => h.quantity !== '0' && h.currency === 'USD');
}

export class DbAdapter implements BrokerAdapter {
  readonly broker = 'DB' as const;
  private readonly tokens: TokenManager;

  constructor(private readonly cfg: ConnectionConfig, store: TokenStore) {
    this.tokens = new TokenManager(`DB:${cfg.id}`, store, () => this.issueToken());
  }

  private async issueToken() {
    const r = await fetchJson('DB', `${BASE}/oauth2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', appkey: this.cfg.appKey, appsecretkey: this.cfg.secret, scope: 'oob' }),
    });
    const token = str(r.body.access_token);
    if (r.status !== 200 || !token) {
      const msg = str(r.body.rsp_msg) || str(r.body.message) || str(r.body.error_description);
      throw new BrokerApiError(msg ? `DB증권 토큰 발급 실패: ${msg}` : `DB증권 토큰 발급 실패 (${r.status})`, 'DB', r.status, str(r.body.rsp_cd) || str(r.body.code) || 'token');
    }
    return { token, expiresAt: expiryFrom(r.body, 86_400) };
  }

  private async call(path: string, input: Record<string, string>, contKey?: string) {
    let refreshed = false;
    for (let attempt = 0; ; attempt++) {
      await throttle(`DB:${this.cfg.id}:${path}`, INTERVAL_MS[path] ?? 550);
      const r = await fetchJson('DB', BASE + path, {
        method: 'POST',
        headers: {
          'content-type': 'application/json; charset=utf-8',
          authorization: `Bearer ${await this.tokens.get()}`,
          cont_yn: contKey ? 'Y' : 'N',
          cont_key: contKey ?? '',
        },
        body: JSON.stringify({ In: input }),
      });
      const code = str(r.body.rsp_cd);
      const msg = str(r.body.rsp_msg);
      const gatewayError = /^(IGW|EGW)/.test(code);
      if (r.status === 200 && !gatewayError) return { body: r.body, contYn: str(r.headers.get('cont_yn')), contKey: str(r.headers.get('cont_key')) };
      if (!refreshed && (r.status === 401 || /token|토큰/i.test(msg))) {
        refreshed = true;
        this.tokens.forget();
        await this.tokens.get(true);
        continue;
      }
      if ((r.status === 429 || r.status >= 500 || /초과/.test(msg)) && attempt < 3) {
        await sleep(backoff(attempt));
        continue;
      }
      throw new BrokerApiError(msg || `DB증권 API 오류 (${r.status})`, 'DB', r.status, code);
    }
  }

  private async paged(path: string, input: Record<string, string>, pick: (body: Record<string, unknown>) => unknown) {
    const all: Record<string, unknown>[] = [];
    let key: string | undefined;
    for (let page = 0; page < 20; page++) {
      const r = await this.call(path, input, key);
      all.push(...rows(pick(r.body)));
      if (r.contYn !== 'Y' || !r.contKey || r.contKey === key) break;
      key = r.contKey;
    }
    return all;
  }

  async verify() {
    await this.call('/api/v1/trading/kr-stock/inquiry/balance', { QryTpCode0: '0' });
    return {};
  }

  async holdings(): Promise<BrokerHolding[]> {
    const out = parseDbDomestic(await this.paged('/api/v1/trading/kr-stock/inquiry/balance', { QryTpCode0: '0' }, (b) => b.Out1));
    try {
      const us = await this.paged(
        '/api/v1/trading/overseas-stock/inquiry/balance-margin',
        // 외화 기준, 주식잔고상세, 매수제비용 포함, 소수점 포함 전체
        { WonFcurrTpCode: '2', TrxTpCode: '2', CmsnTpCode: '1', DpntBalTpCode: '0' },
        (b) => b.Out2,
      );
      out.push(...parseDbOverseas(us));
    } catch (e) {
      console.warn('[db] overseas balance skipped:', e instanceof Error ? e.message : e);
    }
    return out;
  }

  async quotes(refs: InstrumentRef[]): Promise<PriceQuote[]> {
    const out: PriceQuote[] = [];
    for (const ref of refs) {
      try {
        if (isKrSymbol(ref.symbol)) {
          const r = await this.call('/api/v1/quote/kr-stock/inquiry/price', { InputCondMrktDivCode: 'J', InputIscd1: ref.symbol });
          const o = obj(r.body.Out);
          const price = num(o.Prpr);
          // Sdpr (기준가) is the previous close
          if (price !== '0') out.push({ symbol: ref.symbol, price, currency: 'KRW', market: ref.market, asOf: null, prevClose: num(o.Sdpr) === '0' ? null : num(o.Sdpr), volume: num(o.AcmlVol) });
          continue;
        }
        for (const m of usMarketCandidates(ref.market)) {
          const r = await this.call('/api/v1/quote/overseas-stock/inquiry/price', { InputCondMrktDivCode: MRKT[m], InputIscd1: ref.symbol });
          const o = obj(r.body.Out);
          const price = num(o.Prpr);
          if (price !== '0') {
            out.push({ symbol: ref.symbol, price, currency: 'USD', market: m, asOf: null, prevClose: num(o.Sdpr) === '0' ? null : num(o.Sdpr) });
            break;
          }
        }
      } catch (e) {
        if (!(e instanceof BrokerApiError)) throw e;
      }
    }
    return out;
  }

  async dailyCloses(ref: InstrumentRef, since: string): Promise<DailyClose[]> {
    const kr = isKrSymbol(ref.symbol);
    const list = await this.paged(
      kr ? '/api/v1/quote/kr-chart/day' : '/api/v1/quote/overseas-stock/chart/day',
      {
        InputOrgAdjPrc: '1',
        InputCondMrktDivCode: kr ? 'J' : MRKT[usMarketOf(ref.market) ?? 'NASDAQ'],
        InputIscd1: ref.symbol,
        InputDate1: ymd(since),
        InputDate2: ymd(todayKst()),
      },
      (b) => b.Out,
    );
    const out = new Map<string, string>();
    for (const row of list) {
      const d = fromYmd(row.Date);
      if (d && d >= since && num(row.Prpr) !== '0') out.set(d, num(row.Prpr));
    }
    return [...out].map(([date, close]) => ({ date, close }));
  }

  async usdKrw(): Promise<string | null> {
    const r = await this.call('/api/v1/trading/overseas-stock/inquiry/balance-margin', { WonFcurrTpCode: '2', TrxTpCode: '1', CmsnTpCode: '0', DpntBalTpCode: '0' });
    const usd = rows(r.body.Out1).find((x) => str(x.CrcyCode) === 'USD');
    const rate = num(usd?.Xchrat);
    return rate === '0' ? null : rate;
  }

  /** DB publishes gainer/loser rankings only. */
  async rankings(market: RankingMarket, type: RankingType): Promise<RankingRow[] | null> {
    if (type !== 'GAINERS' && type !== 'LOSERS') return null;
    const up = type === 'GAINERS';
    const list =
      market === 'KR'
        ? await this.paged('/api/v1/quote/kr-stock/inquiry/rank-list', { InputDateClsCode: '0', InputRankSortClsCode1: up ? '12' : '11', InputMrktClsCode: 'A', InputBstpIscd: '' }, (b) => b.Out)
        : await this.paged(
            '/api/v1/quote/overseas-stock/inquiry/rank-list',
            { InputRealDelayClsCode: '1', InputDataCode: 'US', InputDateClsCode: '0', InputRankSortClsCode1: up ? '249' : '250', InputVolClsCode: '7', InputTrPbmn1: '', InputDprice1: '', InputDprice2: '' },
            (b) => b.Out,
          );
    return list.slice(0, 30).map((x) => ({
      symbol: market === 'KR' ? (krSymbol(str(x.Iscd)) ?? str(x.Iscd)) : str(x.Iscd).toUpperCase(),
      name: str(x.KorIsnm) || null,
      price: absNum(x.Prpr),
      changeRate: pctToRate(withSign(x.PrdyCtrt, x.PrdyVrssSign)),
      volume: x.AcmlVol === undefined ? null : num(x.AcmlVol),
      amount: x.AcmlTrPbmn === undefined ? null : num(x.AcmlTrPbmn),
      currency: market === 'KR' ? ('KRW' as const) : ('USD' as const),
    }));
  }

  async intraday(ref: InstrumentRef): Promise<MinuteBar[]> {
    const kr = isKrSymbol(ref.symbol);
    const today = todayKst();
    const list = kr
      ? await this.paged(
          '/api/v1/quote/kr-chart/min',
          { dataCnt: '400', InputCondMrktDivCode: 'J', InputIscd1: ref.symbol, InputDate1: ymd(today), InputDivXtick: '60', InputOrgAdjPrc: '1' },
          (b) => b.Out,
        )
      : await this.paged(
          '/api/v1/quote/overseas-stock/chart/min',
          {
            InputCondMrktDivCode: MRKT[usMarketOf(ref.market) ?? 'NASDAQ'],
            InputIscd1: ref.symbol,
            InputDate1: ymd(addDays(today, -4)),
            InputDate2: ymd(today),
            InputHourClsCode: '0',
            InputDivXtick: '60',
            InputPwDataIncuYn: 'Y',
            InputOrgAdjPrc: '1',
            dataCnt: '400',
          },
          (b) => b.Out,
        );
    const session = list.map((x) => str(x.Date)).filter(Boolean).sort().at(-1);
    const bars: MinuteBar[] = [];
    for (const x of list) {
      if (str(x.Date) !== session) continue;
      // Assumed exchange-local, like the daily chart's dates
      const t = zonedIso(str(x.Date), str(x.Hour).slice(0, 6), kr ? 'Asia/Seoul' : 'America/New_York');
      if (t && num(x.Prpr) !== '0') bars.push({ time: t, close: absNum(x.Prpr), volume: num(x.CntgVol) });
    }
    return bars.sort((a, b) => a.time.localeCompare(b.time));
  }

  async orderbook(ref: InstrumentRef): Promise<Orderbook | null> {
    const pick = (o: Record<string, unknown>, side: 'Askp' | 'Bidp') => {
      const out: OrderbookLevel[] = [];
      for (let i = 1; i <= 10; i++) {
        const p = absNum(o[`${side}${i}`]);
        if (p !== '0') out.push({ price: p, volume: absNum(o[`${side}Rsqn${i}`]) });
      }
      return out;
    };
    if (isKrSymbol(ref.symbol)) {
      const o = obj((await this.call('/api/v1/quote/kr-stock/inquiry/orderbook', { InputIscd1: ref.symbol, InputCondMrktDivCode: 'J' })).body.Out);
      return { asks: pick(o, 'Askp'), bids: pick(o, 'Bidp'), currency: 'KRW', asOf: null };
    }
    for (const m of usMarketCandidates(ref.market)) {
      const o = obj((await this.call('/api/v1/quote/overseas-stock/inquiry/orderbook', { InputIscd1: ref.symbol, InputCondMrktDivCode: MRKT[m] })).body.Out);
      const book = { asks: pick(o, 'Askp'), bids: pick(o, 'Bidp'), currency: 'USD' as const, asOf: null };
      if (book.asks.length || book.bids.length) return book;
    }
    return null;
  }
}
