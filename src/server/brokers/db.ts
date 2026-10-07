/**
 * DB증권 Open API (https://openapi.dbsec.co.kr). Paths, request blocks and
 * fields follow the official samples in github.com/DBsecurities/dbsec-open-api.
 * Every call is a POST with an {"In": {...}} body; continuation uses the
 * cont_yn / cont_key headers.
 */
import { Dec } from '@/domain/decimal';
import { fromYmd, isKrSymbol, krSymbol, num, usMarketCandidates, usMarketOf, ymd, type UsMarket } from '@/domain/broker-format';
import { backoff, expiryFrom, fetchJson, obj, rows, sleep, str, throttle, todayKst, TokenManager } from './http';
import {
  BrokerApiError,
  type BrokerAdapter,
  type BrokerHolding,
  type ConnectionConfig,
  type DailyClose,
  type InstrumentRef,
  type PriceQuote,
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
          const price = num(obj(r.body.Out).Prpr);
          if (price !== '0') out.push({ symbol: ref.symbol, price, currency: 'KRW', market: ref.market, asOf: null });
          continue;
        }
        for (const m of usMarketCandidates(ref.market)) {
          const r = await this.call('/api/v1/quote/overseas-stock/inquiry/price', { InputCondMrktDivCode: MRKT[m], InputIscd1: ref.symbol });
          const price = num(obj(r.body.Out).Prpr);
          if (price !== '0') {
            out.push({ symbol: ref.symbol, price, currency: 'USD', market: m, asOf: null });
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
}
