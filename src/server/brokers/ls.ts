/**
 * LS증권 OPEN API (https://openapi.ls-sec.co.kr). TR codes and block fields
 * follow the portal's published TR guide (snapshot kept in
 * github.com/smallfish06/krsec pkg/ls/specs) and LS's own samples
 * (github.com/teranum/ls-openapi-samples). Mock trading uses the same host
 * with a mock app key.
 */
import { fromYmd, isKrSymbol, krSymbol, num, usMarketCandidates, usMarketOf, ymd, type UsMarket } from '@/domain/broker-format';
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

const BASE = 'https://openapi.ls-sec.co.kr:8080';
/** Overseas exchange codes: 82 NASDAQ, 81 NYSE/AMEX */
const EXCH: Record<UsMarket, string> = { NASDAQ: '82', NYSE: '81', AMEX: '81' };
/** Documented calls per second per TR */
const TPS: Record<string, number> = { t0424: 2, t1102: 3, t8410: 1, COSOQ00201: 1, g3101: 10, g3204: 1 };

export function parseLsDomestic(out1: unknown): BrokerHolding[] {
  return rows(out1)
    .filter((r) => num(r.janqty) !== '0')
    .map((r) => ({
      symbol: krSymbol(str(r.expcode)) ?? str(r.expcode),
      name: str(r.hname) || str(r.expcode),
      currency: 'KRW' as const,
      market: 'KRX',
      quantity: num(r.janqty),
      averagePrice: num(r.pamt),
      lastPrice: num(r.price),
    }));
}

export function parseLsOverseas(out4: unknown): BrokerHolding[] {
  return rows(out4)
    .filter((r) => num(r.AstkBalQty) !== '0' && (str(r.CrcyCode) || 'USD') === 'USD')
    .map((r) => {
      const symbol = (str(r.ShtnIsuNo) || str(r.IsuNo)).toUpperCase();
      return {
        symbol,
        name: symbol,
        currency: 'USD' as const,
        market: usMarketOf(str(r.FcurrMktCode)) ?? usMarketOf(str(r.MktTpNm)),
        quantity: num(r.AstkBalQty),
        averagePrice: num(r.FcstckUprc),
        lastPrice: num(r.OvrsScrtsCurpri),
      };
    });
}

export class LsAdapter implements BrokerAdapter {
  readonly broker = 'LS' as const;
  private readonly tokens: TokenManager;

  constructor(private readonly cfg: ConnectionConfig, store: TokenStore) {
    this.tokens = new TokenManager(`LS:${cfg.id}`, store, () => this.issueToken());
  }

  private async issueToken() {
    const r = await fetchJson('LS', `${BASE}/oauth2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', appkey: this.cfg.appKey, appsecretkey: this.cfg.secret, scope: 'oob' }),
    });
    const token = str(r.body.access_token);
    if (r.status !== 200 || !token) {
      const msg = str(r.body.rsp_msg) || str(r.body.error_description) || str(r.body.message);
      throw new BrokerApiError(msg ? `LS증권 토큰 발급 실패: ${msg}` : `LS증권 토큰 발급 실패 (${r.status})`, 'LS', r.status, str(r.body.rsp_cd) || 'token');
    }
    return { token, expiresAt: expiryFrom(r.body, 86_400) };
  }

  private async call(path: string, trCd: string, body: Record<string, unknown>, cont?: { key: string }) {
    let refreshed = false;
    for (let attempt = 0; ; attempt++) {
      await throttle(`LS:${this.cfg.id}:${trCd}`, Math.ceil(1000 / (TPS[trCd] ?? 2)) + 50);
      const r = await fetchJson('LS', BASE + path, {
        method: 'POST',
        headers: {
          'content-type': 'application/json; charset=utf-8',
          authorization: `Bearer ${await this.tokens.get()}`,
          tr_cd: trCd,
          tr_cont: cont ? 'Y' : 'N',
          tr_cont_key: cont?.key ?? '',
        },
        body: JSON.stringify(body),
      });
      const code = str(r.body.rsp_cd);
      const msg = str(r.body.rsp_msg);
      if (r.status === 200 && (code === '' || code === '00000')) return { body: r.body, contKey: str(r.headers.get('tr_cont_key')), cont: str(r.headers.get('tr_cont')) };
      const tokenProblem = r.status === 401 || code.startsWith('IGW') || /token|토큰/i.test(msg);
      if (!refreshed && tokenProblem) {
        refreshed = true;
        this.tokens.forget();
        await this.tokens.get(true);
        continue;
      }
      if ((r.status === 429 || r.status >= 500 || /초과/.test(msg)) && attempt < 3) {
        await sleep(backoff(attempt));
        continue;
      }
      throw new BrokerApiError(msg || `LS증권 API 오류 (${r.status})`, 'LS', r.status, code);
    }
  }

  private balancePage(cursor: string) {
    return this.call(
      '/stock/accno',
      't0424',
      { t0424InBlock: { prcgb: '1', chegb: '2', dangb: '0', charge: '1', cts_expcode: cursor } },
      cursor ? { key: '' } : undefined,
    );
  }

  async verify() {
    await this.balancePage('');
    return {};
  }

  async holdings(): Promise<BrokerHolding[]> {
    const out: BrokerHolding[] = [];
    let cursor = '';
    for (let page = 0; page < 20; page++) {
      const r = await this.balancePage(cursor);
      out.push(...parseLsDomestic(r.body.t0424OutBlock1));
      const next = str(obj(r.body.t0424OutBlock).cts_expcode);
      if (!next || next === cursor) break;
      cursor = next;
    }
    try {
      const r = await this.call('/overseas-stock/accno', 'COSOQ00201', {
        COSOQ00201InBlock1: { RecCnt: 1, BaseDt: '', CrcyCode: 'USD', AstkBalTpCode: '00' },
      });
      out.push(...parseLsOverseas(r.body.COSOQ00201OutBlock4));
    } catch (e) {
      console.warn('[ls] overseas balance skipped:', e instanceof Error ? e.message : e);
    }
    return out;
  }

  private async usQuote(symbol: string, market: string | null) {
    const tried = new Set<string>();
    for (const m of usMarketCandidates(market)) {
      const exch = EXCH[m];
      if (tried.has(exch)) continue;
      tried.add(exch);
      try {
        const r = await this.call('/overseas-stock/market-data', 'g3101', { g3101InBlock: { delaygb: 'R', keysymbol: exch + symbol, exchcd: exch, symbol } });
        const o = obj(r.body.g3101OutBlock);
        const price = num(o.price);
        if (price !== '0' || str(o.korname)) return { market: m, price, name: str(o.korname), currency: str(o.currency) || 'USD' };
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
          const r = await this.call('/stock/market-data', 't1102', { t1102InBlock: { shcode: ref.symbol } });
          const price = num(obj(r.body.t1102OutBlock).price);
          if (price !== '0') out.push({ symbol: ref.symbol, price, currency: 'KRW', market: ref.market, asOf: null });
        } else {
          const q = await this.usQuote(ref.symbol, ref.market);
          if (q && q.price !== '0') out.push({ symbol: ref.symbol, price: q.price, currency: 'USD', market: q.market, asOf: null });
        }
      } catch (e) {
        if (!(e instanceof BrokerApiError)) throw e;
      }
    }
    return out;
  }

  async instrument(symbol: string): Promise<Instrument | null> {
    if (isKrSymbol(symbol)) {
      const r = await this.call('/stock/market-data', 't1102', { t1102InBlock: { shcode: symbol } });
      const name = str(obj(r.body.t1102OutBlock).hname);
      return name ? { symbol, name, currency: 'KRW', market: 'KRX' } : null;
    }
    const q = await this.usQuote(symbol, null);
    return q?.name ? { symbol, name: q.name, currency: 'USD', market: q.market } : null;
  }

  async dailyCloses(ref: InstrumentRef, since: string): Promise<DailyClose[]> {
    const out = new Map<string, string>();
    const kr = isKrSymbol(ref.symbol);
    const exch = EXCH[usMarketOf(ref.market) ?? 'NASDAQ'];
    let ctsDate = '';
    let ctsInfo = '';
    for (let i = 0; i < 10; i++) {
      const cont = ctsDate ? { key: '' } : undefined;
      const r = kr
        ? await this.call(
            '/stock/chart',
            't8410',
            { t8410InBlock: { shcode: ref.symbol, gubun: '2', qrycnt: 500, sdate: ymd(since), edate: ymd(todayKst()), cts_date: ctsDate, comp_yn: 'N', sujung: 'Y' } },
            cont,
          )
        : await this.call(
            '/overseas-stock/chart',
            'g3204',
            {
              g3204InBlock: {
                delaygb: 'R', keysymbol: exch + ref.symbol, exchcd: exch, symbol: ref.symbol, gubun: '2', qrycnt: 500,
                comp_yn: 'N', sdate: ymd(since), edate: ymd(todayKst()), cts_date: ctsDate, cts_info: ctsInfo, sujung: 'Y',
              },
            },
            cont,
          );
      for (const row of rows(kr ? r.body.t8410OutBlock1 : r.body.g3204OutBlock1)) {
        const d = fromYmd(row.date);
        if (d && num(row.close) !== '0') out.set(d, num(row.close));
      }
      const head = obj(kr ? r.body.t8410OutBlock : r.body.g3204OutBlock);
      const next = str(head.cts_date);
      if (!next || next === ctsDate || fromYmd(next) === null || fromYmd(next)! < since) break;
      ctsDate = next;
      ctsInfo = str(head.cts_info);
    }
    return [...out].filter(([d]) => d >= since).map(([date, close]) => ({ date, close }));
  }

  async usdKrw(): Promise<string | null> {
    const r = await this.call('/overseas-stock/accno', 'COSOQ00201', { COSOQ00201InBlock1: { RecCnt: 1, BaseDt: '', CrcyCode: 'USD', AstkBalTpCode: '00' } });
    const usd = rows(r.body.COSOQ00201OutBlock3).find((x) => str(x.CrcyCode) === 'USD');
    const rate = num(usd?.BaseXchrat);
    return rate === '0' ? null : rate;
  }
}
