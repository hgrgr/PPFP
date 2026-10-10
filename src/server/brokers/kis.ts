/**
 * 한국투자증권 KIS Developers REST API (https://apiportal.koreainvestment.com).
 * Endpoints, TR ids and fields follow the official samples in
 * github.com/koreainvestment/open-trading-api (examples_llm).
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
  withSign,
  ymd,
  zonedIso,
  type UsMarket,
} from '@/domain/broker-format';
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
  type RankingMarket,
  type RankingRow,
  type RankingType,
  type TokenStore,
} from './types';
import { noteLimited } from '../services/api-usage';

const REAL = 'https://openapi.koreainvestment.com:9443';
const PAPER = 'https://openapivts.koreainvestment.com:29443';
/** Quote/info endpoints take 3-letter exchange codes. */
const EXCD: Record<UsMarket, string> = { NASDAQ: 'NAS', NYSE: 'NYS', AMEX: 'AMS' };
const KR_INDEX: Partial<Record<IndexCode, string>> = { KOSPI: '0001', KOSDAQ: '1001' };
/** Overseas index master codes (inquire-daily-chartprice, FID_COND_MRKT_DIV_CODE "N") */
const US_INDEX: Partial<Record<IndexCode, string>> = { NASDAQ: 'COMP', SP500: 'SPX', DOW: '.DJI' };
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
  readonly kind = 'stock' as const;
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
      if (code === 'EGW00201') noteLimited(null, 'broker:KIS');
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
          const o = obj(r.body.output);
          const price = num(o.stck_prpr);
          // stck_sdpr (기준가) is the previous close
          if (price !== '0') out.push({ symbol: ref.symbol, price, currency: 'KRW', market: ref.market, asOf: null, prevClose: num(o.stck_sdpr) === '0' ? null : num(o.stck_sdpr), volume: num(o.acml_vol) });
          continue;
        }
        for (const m of usMarketCandidates(ref.market)) {
          const r = await this.get('/uapi/overseas-price/v1/quotations/price', 'HHDFS00000300', { AUTH: '', EXCD: EXCD[m], SYMB: ref.symbol });
          const o = obj(r.body.output);
          const price = num(o.last);
          if (price !== '0') {
            out.push({ symbol: ref.symbol, price, currency: 'USD', market: m, asOf: null, prevClose: num(o.base) === '0' ? null : num(o.base), volume: num(o.tvol) });
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

  async indices(codes: IndexCode[]): Promise<IndexQuote[]> {
    const out: IndexQuote[] = [];
    for (const code of codes) {
      try {
        if (KR_INDEX[code]) {
          const r = await this.get('/uapi/domestic-stock/v1/quotations/inquire-index-price', 'FHPUP02100000', { FID_COND_MRKT_DIV_CODE: 'U', FID_INPUT_ISCD: KR_INDEX[code]! });
          const o = obj(r.body.output);
          const price = num(o.bstp_nmix_prpr);
          if (price !== '0') out.push({ code, price, prevClose: prevFromChange(price, withSign(o.bstp_nmix_prdy_vrss, o.prdy_vrss_sign)), asOf: null });
        } else if (US_INDEX[code]) {
          const today = todayKst();
          const r = await this.get('/uapi/overseas-price/v1/quotations/inquire-daily-chartprice', 'FHKST03030100', {
            FID_COND_MRKT_DIV_CODE: 'N',
            FID_INPUT_ISCD: US_INDEX[code]!,
            FID_INPUT_DATE_1: ymd(addDays(today, -10)),
            FID_INPUT_DATE_2: ymd(today),
            FID_PERIOD_DIV_CODE: 'D',
          });
          const o = obj(r.body.output1);
          const price = num(o.ovrs_nmix_prpr);
          if (price !== '0') out.push({ code, price, prevClose: num(o.ovrs_nmix_prdy_clpr) === '0' ? null : num(o.ovrs_nmix_prdy_clpr), asOf: null });
        }
      } catch (e) {
        if (!(e instanceof BrokerApiError)) throw e;
      }
    }
    return out;
  }

  async rankings(market: RankingMarket, type: RankingType): Promise<RankingRow[] | null> {
    if (market === 'CRYPTO') return null;
    if (market === 'KR') {
      if (type === 'AMOUNT' || type === 'VOLUME') {
        const r = await this.get('/uapi/domestic-stock/v1/quotations/volume-rank', 'FHPST01710000', {
          FID_COND_MRKT_DIV_CODE: 'J',
          FID_COND_SCR_DIV_CODE: '20171',
          FID_INPUT_ISCD: '0000',
          FID_DIV_CLS_CODE: '0',
          // 3: 거래금액순, 0: 평균거래량
          FID_BLNG_CLS_CODE: type === 'AMOUNT' ? '3' : '0',
          FID_TRGT_CLS_CODE: '111111111',
          FID_TRGT_EXLS_CLS_CODE: '0000000000',
          FID_INPUT_PRICE_1: '',
          FID_INPUT_PRICE_2: '',
          FID_VOL_CNT: '',
          FID_INPUT_DATE_1: '',
        });
        return rows(r.body.output).map((x) => ({
          symbol: str(x.mksc_shrn_iscd),
          name: str(x.hts_kor_isnm) || null,
          price: num(x.stck_prpr),
          changeRate: pctToRate(x.prdy_ctrt),
          volume: num(x.acml_vol),
          amount: num(x.acml_tr_pbmn),
          currency: 'KRW' as const,
        }));
      }
      const r = await this.get('/uapi/domestic-stock/v1/ranking/fluctuation', 'FHPST01700000', {
        fid_rsfl_rate2: '',
        fid_cond_mrkt_div_code: 'J',
        fid_cond_scr_div_code: '20170',
        fid_input_iscd: '0000',
        fid_rank_sort_cls_code: type === 'GAINERS' ? '0000' : '0001',
        fid_input_cnt_1: '0',
        fid_prc_cls_code: '0',
        fid_input_price_1: '',
        fid_input_price_2: '',
        fid_vol_cnt: '',
        fid_trgt_cls_code: '0',
        fid_trgt_exls_cls_code: '0',
        fid_div_cls_code: '0',
        fid_rsfl_rate1: '',
      });
      const list = rows(r.body.output).map((x) => ({
        symbol: str(x.stck_shrn_iscd),
        name: str(x.hts_kor_isnm) || null,
        price: num(x.stck_prpr),
        changeRate: pctToRate(x.prdy_ctrt),
        volume: num(x.acml_vol),
        amount: null,
        currency: 'KRW' as const,
      }));
      // The sort codes are not spelled out in the samples: accept the list only if it leans the way we asked.
      const first = list[0]?.changeRate ? Dec.of(list[0].changeRate) : null;
      if (!first || (type === 'GAINERS' ? first.isNeg() : first.isPos())) return null;
      return list;
    }
    const path = { AMOUNT: 'trade-pbmn', VOLUME: 'trade-vol', GAINERS: 'updown-rate', LOSERS: 'updown-rate' }[type];
    const trId = { AMOUNT: 'HHDFS76320010', VOLUME: 'HHDFS76310010', GAINERS: 'HHDFS76290000', LOSERS: 'HHDFS76290000' }[type];
    const merged: RankingRow[] = [];
    for (const excd of ['NAS', 'NYS']) {
      const params: Record<string, string> = { EXCD: excd, NDAY: '0', VOL_RANG: '0', AUTH: '', KEYB: '' };
      if (type === 'GAINERS' || type === 'LOSERS') params.GUBN = type === 'GAINERS' ? '1' : '0';
      else Object.assign(params, { PRC1: '', PRC2: '' });
      const r = await this.get(`/uapi/overseas-stock/v1/ranking/${path}`, trId, params);
      for (const x of rows(r.body.output2)) {
        merged.push({
          symbol: str(x.symb).toUpperCase(),
          name: str(x.name) || str(x.ename) || null,
          price: num(x.last),
          changeRate: pctToRate(x.rate),
          volume: num(x.tvol),
          amount: num(x.tamt),
          currency: 'USD',
        });
      }
    }
    const key = (x: RankingRow) => Dec.of(type === 'AMOUNT' ? (x.amount ?? '0') : type === 'VOLUME' ? (x.volume ?? '0') : (x.changeRate ?? '0'));
    return merged.sort((a, b) => (type === 'LOSERS' ? key(a).cmp(key(b)) : key(b).cmp(key(a)))).slice(0, 30);
  }

  async intraday(ref: InstrumentRef): Promise<MinuteBar[]> {
    const bars = new Map<string, MinuteBar>();
    if (isKrSymbol(ref.symbol)) {
      // 30 one-minute bars per call, walking back from the latest.
      let hour = '153000';
      let session: string | null = null;
      for (let i = 0; i < 14; i++) {
        const r = await this.get('/uapi/domestic-stock/v1/quotations/inquire-time-itemchartprice', 'FHKST03010200', {
          FID_COND_MRKT_DIV_CODE: 'J',
          FID_INPUT_ISCD: ref.symbol,
          FID_INPUT_HOUR_1: hour,
          FID_PW_DATA_INCU_YN: 'N',
          FID_ETC_CLS_CODE: '',
        });
        const page = rows(r.body.output2).filter((x) => str(x.stck_cntg_hour) && num(x.stck_prpr) !== '0');
        if (!page.length) break;
        let oldest = hour;
        for (const x of page) {
          const date = str(x.stck_bsop_date);
          session ??= date;
          if (date !== session) continue;
          const t = zonedIso(date, str(x.stck_cntg_hour), 'Asia/Seoul');
          if (t) bars.set(t, { time: t, close: num(x.stck_prpr), volume: num(x.cntg_vol) });
          if (str(x.stck_cntg_hour) < oldest) oldest = str(x.stck_cntg_hour);
        }
        if (oldest <= '090000' || oldest === hour) break;
        const prev = new Date(Date.parse(`2000-01-01T${oldest.slice(0, 2)}:${oldest.slice(2, 4)}:00Z`) - 60_000);
        hour = prev.toISOString().slice(11, 19).replace(/:/g, '');
      }
    } else {
      const m = usMarketOf(ref.market) ?? 'NASDAQ';
      let keyb = '';
      let session: string | null = null;
      for (let i = 0; i < 4; i++) {
        const r = await this.get('/uapi/overseas-price/v1/quotations/inquire-time-itemchartprice', 'HHDFS76950200', {
          AUTH: '', EXCD: EXCD[m], SYMB: ref.symbol, NMIN: '1', PINC: keyb ? '1' : '0', NEXT: keyb ? '1' : '', NREC: '120', FILL: '', KEYB: keyb,
        });
        const page = rows(r.body.output2).filter((x) => str(x.xymd) && num(x.last) !== '0');
        if (!page.length) break;
        let oldest = '';
        for (const x of page) {
          const local = str(x.xymd);
          session ??= local;
          if (local !== session) continue;
          // Korean date/time columns are unambiguous instants.
          const t = zonedIso(str(x.kymd), str(x.khms), 'Asia/Seoul');
          if (t) bars.set(t, { time: t, close: num(x.last), volume: num(x.evol) });
          const stamp = local + str(x.xhms);
          if (!oldest || stamp < oldest) oldest = stamp;
        }
        if (!oldest || str(obj(r.body.output1).next) !== '1') break;
        const prev = zonedIso(oldest.slice(0, 8), oldest.slice(8), 'America/New_York');
        if (!prev) break;
        // Next page key: one minute before the oldest bar, exchange-local, YYYYMMDDHHMMSS
        const ny = new Date(Date.parse(prev) - 60_000);
        const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
        keyb = fmt.format(ny).replace(/\D/g, '');
      }
    }
    return [...bars.values()].sort((a, b) => a.time.localeCompare(b.time));
  }

  async orderbook(ref: InstrumentRef): Promise<Orderbook | null> {
    const levels = (o: Record<string, unknown>, price: (i: number) => string, vol: (i: number) => string) => {
      const out: OrderbookLevel[] = [];
      for (let i = 1; i <= 10; i++) {
        const p = absNum(o[price(i)]);
        if (p !== '0') out.push({ price: p, volume: absNum(o[vol(i)]) });
      }
      return out;
    };
    if (isKrSymbol(ref.symbol)) {
      const r = await this.get('/uapi/domestic-stock/v1/quotations/inquire-asking-price-exp-ccn', 'FHKST01010200', { FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: ref.symbol });
      const o = obj(r.body.output1);
      return { asks: levels(o, (i) => `askp${i}`, (i) => `askp_rsqn${i}`), bids: levels(o, (i) => `bidp${i}`, (i) => `bidp_rsqn${i}`), currency: 'KRW', asOf: null };
    }
    for (const m of usMarketCandidates(ref.market)) {
      const r = await this.get('/uapi/overseas-price/v1/quotations/inquire-asking-price', 'HHDFS76200100', { AUTH: '', EXCD: EXCD[m], SYMB: ref.symbol });
      const o = obj(r.body.output2);
      const book = { asks: levels(o, (i) => `pask${i}`, (i) => `vask${i}`), bids: levels(o, (i) => `pbid${i}`, (i) => `vbid${i}`), currency: 'USD' as const, asOf: null };
      if (book.asks.length || book.bids.length) return book;
    }
    return null;
  }

  /**
   * Domestic: 1-minute bars across past sessions (inquire-time-dailychartprice, 120 per call) and
   * daily/weekly bars; other minute intervals are rolled up. US: N-minute, daily and weekly bars directly.
   */
  async candles(ref: InstrumentRef, unit: CandleUnit, count: number): Promise<Candle[] | null> {
    const bars = new Map<string, Candle>();
    const put = (c: Candle | null) => c && bars.set(c.time, c);
    if (isKrSymbol(ref.symbol)) {
      if (unit === '1m') {
        let date = ymd(todayKst());
        let hour = '153000';
        for (let i = 0; i < 12 && bars.size < count; i++) {
          const r = await this.get('/uapi/domestic-stock/v1/quotations/inquire-time-dailychartprice', 'FHKST03010230', {
            FID_COND_MRKT_DIV_CODE: 'J',
            FID_INPUT_ISCD: ref.symbol,
            FID_INPUT_HOUR_1: hour,
            FID_INPUT_DATE_1: date,
            FID_PW_DATA_INCU_YN: 'Y',
            FID_FAKE_TICK_INCU_YN: '',
          });
          const page = rows(r.body.output2).filter((x) => str(x.stck_bsop_date) && num(x.stck_prpr) !== '0');
          if (!page.length) break;
          let oldest = '';
          for (const x of page) {
            const d = str(x.stck_bsop_date);
            const t = str(x.stck_cntg_hour);
            const time = zonedIso(d, t, 'Asia/Seoul');
            if (time) put({ time, open: num(x.stck_oprc), high: num(x.stck_hgpr), low: num(x.stck_lwpr), close: num(x.stck_prpr), volume: num(x.cntg_vol) });
            if (!oldest || d + t < oldest) oldest = d + t;
          }
          // Continue one minute before the oldest bar; before the open, the previous session's close
          const prev = new Date(Date.parse(zonedIso(oldest.slice(0, 8), oldest.slice(8), 'Asia/Seoul')!) - 60_000);
          const kst = new Date(prev.getTime() + 9 * 3_600_000).toISOString();
          date = ymd(kst.slice(0, 10));
          hour = kst.slice(11, 19).replace(/:/g, '');
          if (hour < '090000') hour = '153000';
          if (hour === '153000' && kst.slice(11, 19) < '09:00:00') date = ymd(addDays(kst.slice(0, 10), -1));
        }
        return [...bars.values()].sort((a, b) => a.time.localeCompare(b.time)).slice(-count);
      }
      if (unit !== '1d' && unit !== '1w') return null;
      let end = todayKst();
      const step = unit === '1d' ? 140 : 700;
      for (let i = 0; i < 6 && bars.size < count; i++) {
        const start = addDays(end, -step);
        const r = await this.get('/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice', 'FHKST03010100', {
          FID_COND_MRKT_DIV_CODE: 'J',
          FID_INPUT_ISCD: ref.symbol,
          FID_INPUT_DATE_1: ymd(start),
          FID_INPUT_DATE_2: ymd(end),
          FID_PERIOD_DIV_CODE: unit === '1d' ? 'D' : 'W',
          FID_ORG_ADJ_PRC: '0',
        });
        const page = rows(r.body.output2).filter((x) => str(x.stck_bsop_date) && num(x.stck_clpr) !== '0');
        for (const x of page) {
          const time = zonedIso(str(x.stck_bsop_date), '000000', 'Asia/Seoul');
          if (time) put({ time, open: num(x.stck_oprc), high: num(x.stck_hgpr), low: num(x.stck_lwpr), close: num(x.stck_clpr), volume: num(x.acml_vol) });
        }
        if (!page.length) break;
        end = addDays(start, -1);
      }
      return [...bars.values()].sort((a, b) => a.time.localeCompare(b.time)).slice(-count);
    }
    const m = usMarketOf(ref.market) ?? 'NASDAQ';
    if (unit === '1d' || unit === '1w') {
      let bymd = '';
      for (let i = 0; i < 4 && bars.size < count; i++) {
        const r = await this.get('/uapi/overseas-price/v1/quotations/dailyprice', 'HHDFS76240000', { AUTH: '', EXCD: EXCD[m], SYMB: ref.symbol, GUBN: unit === '1d' ? '0' : '1', BYMD: bymd, MODP: '1' });
        const page = rows(r.body.output2).filter((x) => fromYmd(x.xymd) && num(x.clos) !== '0');
        for (const x of page) {
          const time = zonedIso(str(x.xymd), '000000', 'America/New_York');
          if (time) put({ time, open: num(x.open), high: num(x.high), low: num(x.low), close: num(x.clos), volume: num(x.tvol) });
        }
        const oldest = page.map((x) => fromYmd(x.xymd)!).sort()[0];
        if (!oldest) break;
        bymd = ymd(addDays(oldest, -1));
      }
      return [...bars.values()].sort((a, b) => a.time.localeCompare(b.time)).slice(-count);
    }
    const n = { '1m': '1', '5m': '5', '15m': '15', '60m': '60' }[unit as string];
    if (!n) return null;
    let keyb = '';
    for (let i = 0; i < 4 && bars.size < count; i++) {
      const r = await this.get('/uapi/overseas-price/v1/quotations/inquire-time-itemchartprice', 'HHDFS76950200', {
        AUTH: '', EXCD: EXCD[m], SYMB: ref.symbol, NMIN: n, PINC: '1', NEXT: keyb ? '1' : '', NREC: '120', FILL: '', KEYB: keyb,
      });
      const page = rows(r.body.output2).filter((x) => str(x.kymd) && num(x.last) !== '0');
      if (!page.length) break;
      let oldest = '';
      for (const x of page) {
        const time = zonedIso(str(x.kymd), str(x.khms), 'Asia/Seoul');
        if (time) put({ time, open: num(x.open), high: num(x.high), low: num(x.low), close: num(x.last), volume: num(x.evol) });
        const stamp = str(x.xymd) + str(x.xhms);
        if (!oldest || stamp < oldest) oldest = stamp;
      }
      if (str(obj(r.body.output1).next) !== '1') break;
      const prev = zonedIso(oldest.slice(0, 8), oldest.slice(8), 'America/New_York');
      if (!prev) break;
      const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
      keyb = fmt.format(new Date(Date.parse(prev) - 60_000)).replace(/\D/g, '');
    }
    return [...bars.values()].sort((a, b) => a.time.localeCompare(b.time)).slice(-count);
  }
}
