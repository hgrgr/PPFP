/**
 * 한국투자증권 KIS Developers REST API (https://apiportal.koreainvestment.com).
 * Endpoints, TR ids and fields follow the official samples in
 * github.com/koreainvestment/open-trading-api (examples_llm).
 */
import { addDays, fromYmd, krSymbol, isKrSymbol, num, usMarketCandidates, usMarketOf, ymd, type UsMarket } from '@/domain/broker-format';
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

const REAL = 'https://openapi.koreainvestment.com:9443';
const PAPER = 'https://openapivts.koreainvestment.com:29443';
/** Quote/info endpoints take 3-letter exchange codes. */
const EXCD: Record<UsMarket, string> = { NASDAQ: 'NAS', NYSE: 'NYS', AMEX: 'AMS' };
/** search-info product type per exchange */
const PRDT_TYPE: Record<UsMarket, string> = { NASDAQ: '512', NYSE: '513', AMEX: '529' };

/** "12345678-01" / "1234567801" -> CANO + ACNT_PRDT_CD */
export function parseKisAccount(no: string | null): { cano: string; prdt: string } {
  const digits = (no ?? '').replace(/\D/g, '');
  if (digits.length !== 10) throw new BrokerApiError('한국투자증권 계좌번호는 8자리-2자리(예: 12345678-01)로 입력하세요.', 'KIS', 400, 'account');
  return { cano: digits.slice(0, 8), prdt: digits.slice(8) };
}

export function parseKisDomestic(output1: unknown): BrokerHolding[] {
  return rows(output1)
    .filter((r) => num(r.hldg_qty) !== '0')
    .map((r) => ({
      symbol: krSymbol(str(r.pdno)) ?? str(r.pdno),
      name: str(r.prdt_name) || str(r.pdno),
      currency: 'KRW' as const,
      market: 'KRX',
      quantity: num(r.hldg_qty),
      averagePrice: num(r.pchs_avg_pric),
      lastPrice: num(r.prpr),
    }));
}

export function parseKisOverseas(output1: unknown): BrokerHolding[] {
  return rows(output1)
    .filter((r) => num(r.ovrs_cblc_qty) !== '0' && (str(r.tr_crcy_cd) || 'USD') === 'USD')
    .map((r) => ({
      symbol: str(r.ovrs_pdno).toUpperCase(),
      name: str(r.ovrs_item_name) || str(r.ovrs_pdno),
      currency: 'USD' as const,
      market: usMarketOf(str(r.ovrs_excg_cd)),
      quantity: num(r.ovrs_cblc_qty),
      averagePrice: num(r.pchs_avg_pric),
      lastPrice: num(r.now_pric2),
    }));
}

export class KisAdapter implements BrokerAdapter {
  readonly broker = 'KIS' as const;
  private readonly base: string;
  private readonly tokens: TokenManager;

  constructor(private readonly cfg: ConnectionConfig, store: TokenStore) {
    this.base = cfg.paper ? PAPER : REAL;
    this.tokens = new TokenManager(`KIS:${cfg.id}`, store, () => this.issueToken());
  }

  private async issueToken() {
    const r = await fetchJson('KIS', `${this.base}/oauth2/tokenP`, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ grant_type: 'client_credentials', appkey: this.cfg.appKey, appsecret: this.cfg.secret }),
    });
    const token = str(r.body.access_token);
    if (r.status !== 200 || !token) {
      const msg = str(r.body.error_description) || str(r.body.msg1);
      throw new BrokerApiError(msg ? `한국투자증권 토큰 발급 실패: ${msg}` : `한국투자증권 토큰 발급 실패 (${r.status})`, 'KIS', r.status, str(r.body.error_code) || 'token');
    }
    return { token, expiresAt: expiryFrom(r.body, 86_400) };
  }

  /** The official wrapper swaps T/J/C-prefixed account TR ids for their V-prefixed mock versions. */
  private trId(id: string) {
    return this.cfg.paper && /^[TJC]/.test(id) ? 'V' + id.slice(1) : id;
  }

  private async get(path: string, trId: string, params: Record<string, string>, trCont = '') {
    const url = new URL(this.base + path);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    let refreshed = false;
    for (let attempt = 0; ; attempt++) {
      await throttle(`KIS:${this.cfg.id}`, this.cfg.paper ? 520 : 60);
      const r = await fetchJson('KIS', url.toString(), {
        headers: {
          'content-type': 'application/json; charset=utf-8',
          authorization: `Bearer ${await this.tokens.get()}`,
          appkey: this.cfg.appKey,
          appsecret: this.cfg.secret,
          tr_id: this.trId(trId),
          custtype: 'P',
          tr_cont: trCont,
        },
      });
      const code = str(r.body.msg_cd);
      if (r.status === 200 && str(r.body.rt_cd) === '0') return { body: r.body, trCont: str(r.headers.get('tr_cont')) };
      // EGW00123: token expired, EGW00121: invalid token
      if (!refreshed && (r.status === 401 || code === 'EGW00123' || code === 'EGW00121')) {
        refreshed = true;
        this.tokens.forget();
        await this.tokens.get(true);
        continue;
      }
      // EGW00201: calls per second exceeded
      if ((code === 'EGW00201' || r.status >= 500) && attempt < 3) {
        await sleep(backoff(attempt));
        continue;
      }
      throw new BrokerApiError(str(r.body.msg1) || `한국투자증권 API 오류 (${r.status})`, 'KIS', r.status, code);
    }
  }

  async verify() {
    const { cano, prdt } = parseKisAccount(this.cfg.accountNo);
    await this.domesticPage(cano, prdt, '', '', '');
    return { accountNo: `${cano}-${prdt}` };
  }

  private domesticPage(cano: string, prdt: string, fk: string, nk: string, trCont: string) {
    return this.get(
      '/uapi/domestic-stock/v1/trading/inquire-balance',
      'TTTC8434R',
      {
        CANO: cano,
        ACNT_PRDT_CD: prdt,
        AFHR_FLPR_YN: 'N',
        OFL_YN: '',
        INQR_DVSN: '02',
        UNPR_DVSN: '01',
        FUND_STTL_ICLD_YN: 'N',
        FNCG_AMT_AUTO_RDPT_YN: 'N',
        PRCS_DVSN: '00',
        CTX_AREA_FK100: fk,
        CTX_AREA_NK100: nk,
      },
      trCont,
    );
  }

  async holdings(): Promise<BrokerHolding[]> {
    const { cano, prdt } = parseKisAccount(this.cfg.accountNo);
    const out: BrokerHolding[] = [];
    let fk = '';
    let nk = '';
    let cont = '';
    for (let page = 0; page < 20; page++) {
      const r = await this.domesticPage(cano, prdt, fk, nk, cont);
      out.push(...parseKisDomestic(r.body.output1));
      if (!['M', 'F'].includes(r.trCont)) break;
      fk = str(r.body.ctx_area_fk100);
      nk = str(r.body.ctx_area_nk100);
      cont = 'N';
    }
    // Production NASD covers every US exchange; the mock server wants each one.
    for (const excg of this.cfg.paper ? ['NASD', 'NYSE', 'AMEX'] : ['NASD']) {
      try {
        fk = '';
        nk = '';
        cont = '';
        for (let page = 0; page < 20; page++) {
          const r = await this.get(
            '/uapi/overseas-stock/v1/trading/inquire-balance',
            'TTTS3012R',
            { CANO: cano, ACNT_PRDT_CD: prdt, OVRS_EXCG_CD: excg, TR_CRCY_CD: 'USD', CTX_AREA_FK200: fk, CTX_AREA_NK200: nk },
            cont,
          );
          out.push(...parseKisOverseas(r.body.output1));
          if (!['M', 'F'].includes(r.trCont)) break;
          fk = str(r.body.ctx_area_fk200);
          nk = str(r.body.ctx_area_nk200);
          cont = 'N';
        }
      } catch (e) {
        // Accounts without overseas trading return an error here; the domestic list still stands.
        console.warn('[kis] overseas balance skipped:', e instanceof Error ? e.message : e);
      }
    }
    return out;
  }

  async quotes(refs: InstrumentRef[]): Promise<PriceQuote[]> {
    const out: PriceQuote[] = [];
    for (const ref of refs) {
      try {
        if (isKrSymbol(ref.symbol)) {
          const r = await this.get('/uapi/domestic-stock/v1/quotations/inquire-price', 'FHKST01010100', { FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: ref.symbol });
          const price = num(obj(r.body.output).stck_prpr);
          if (price !== '0') out.push({ symbol: ref.symbol, price, currency: 'KRW', market: ref.market, asOf: null });
          continue;
        }
        for (const m of usMarketCandidates(ref.market)) {
          const r = await this.get('/uapi/overseas-price/v1/quotations/price', 'HHDFS00000300', { AUTH: '', EXCD: EXCD[m], SYMB: ref.symbol });
          const price = num(obj(r.body.output).last);
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

  async instrument(symbol: string): Promise<Instrument | null> {
    if (isKrSymbol(symbol)) {
      const r = await this.get('/uapi/domestic-stock/v1/quotations/search-stock-info', 'CTPF1002R', { PRDT_TYPE_CD: '300', PDNO: symbol });
      const o = obj(r.body.output);
      const name = str(o.prdt_abrv_name) || str(o.prdt_name);
      if (!name) return null;
      const mk = str(o.mket_id_cd);
      return {
        symbol,
        name,
        currency: 'KRW',
        market: mk === 'STK' ? 'KOSPI' : mk === 'KSQ' ? 'KOSDAQ' : 'KRX',
        englishName: str(o.prdt_eng_name) || undefined,
        delisted: !!str(o.lstg_abol_dt) && str(o.lstg_abol_dt) <= ymd(todayKst()),
      };
    }
    for (const m of usMarketCandidates(null)) {
      try {
        const r = await this.get('/uapi/overseas-price/v1/quotations/search-info', 'CTPF1702R', { PRDT_TYPE_CD: PRDT_TYPE[m], PDNO: symbol });
        const o = obj(r.body.output);
        const name = str(o.prdt_name) || str(o.ovrs_item_name) || str(o.prdt_eng_name);
        if (name) return { symbol, name, currency: 'USD', market: m, englishName: str(o.prdt_eng_name) || undefined };
      } catch (e) {
        if (!(e instanceof BrokerApiError)) throw e;
      }
    }
    return null;
  }

  async dailyCloses(ref: InstrumentRef, since: string): Promise<DailyClose[]> {
    const out = new Map<string, string>();
    const today = todayKst();
    if (isKrSymbol(ref.symbol)) {
      // At most 100 rows per call: walk back in ~140-day windows.
      let end = today;
      for (let i = 0; i < 30 && end >= since; i++) {
        const start = [addDays(end, -140), since].sort().at(-1)!;
        const r = await this.get('/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice', 'FHKST03010100', {
          FID_COND_MRKT_DIV_CODE: 'J',
          FID_INPUT_ISCD: ref.symbol,
          FID_INPUT_DATE_1: ymd(start),
          FID_INPUT_DATE_2: ymd(end),
          FID_PERIOD_DIV_CODE: 'D',
          FID_ORG_ADJ_PRC: '0',
        });
        for (const row of rows(r.body.output2)) {
          const d = fromYmd(row.stck_bsop_date);
          if (d && num(row.stck_clpr) !== '0') out.set(d, num(row.stck_clpr));
        }
        end = addDays(start, -1);
      }
    } else {
      const m = usMarketOf(ref.market) ?? 'NASDAQ';
      let bymd = '';
      for (let i = 0; i < 15; i++) {
        const r = await this.get('/uapi/overseas-price/v1/quotations/dailyprice', 'HHDFS76240000', { AUTH: '', EXCD: EXCD[m], SYMB: ref.symbol, GUBN: '0', BYMD: bymd, MODP: '1' });
        const page = rows(r.body.output2)
          .map((row) => ({ d: fromYmd(row.xymd), c: num(row.clos) }))
          .filter((x): x is { d: string; c: string } => !!x.d && x.c !== '0');
        for (const x of page) out.set(x.d, x.c);
        const oldest = page.map((x) => x.d).sort()[0];
        if (!oldest || oldest <= since) break;
        bymd = ymd(addDays(oldest, -1));
      }
    }
    return [...out].filter(([d]) => d >= since).map(([date, close]) => ({ date, close }));
  }

  async usdKrw(): Promise<string | null> {
    const r = await this.get('/uapi/overseas-price/v1/quotations/price-detail', 'HHDFS76200200', { AUTH: '', EXCD: 'NAS', SYMB: 'AAPL' });
    const rate = num(obj(r.body.output).t_rate);
    return rate === '0' ? null : rate;
  }
}
