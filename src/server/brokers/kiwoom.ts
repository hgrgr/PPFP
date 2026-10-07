/**
 * 키움 REST API (https://openapi.kiwoom.com). API ids and fields follow the
 * official spec in github.com/Kiwoom-Securities/Kiwoom-REST-API
 * (kiwoom/_data/kiwoom_api_spec.json). Business errors arrive as HTTP 200
 * with a non-zero `return_code`.
 */
import { absNum, addDays, fromYmd, isKrSymbol, krSymbol, num, usMarketCandidates, usMarketOf, ymd, type UsMarket } from '@/domain/broker-format';
import { backoff, fetchJson, rows, sleep, str, throttle, todayKst, TokenManager } from './http';
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

const REAL = 'https://api.kiwoom.com';
const MOCK = 'https://mockapi.kiwoom.com';
const STEX: Record<UsMarket, string> = { NASDAQ: 'ND', NYSE: 'NY', AMEX: 'NA' };

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
        if (price !== '0' || name) return { market: m, price, name, englishName: str(r.body.stk_enm), fx: num(r.body.base_exrt) };
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
          if (price !== '0') out.push({ symbol: ref.symbol, price, currency: 'KRW', market: ref.market, asOf: null });
        } else {
          const info = await this.usInfo(ref.symbol, ref.market);
          if (info && info.price !== '0') out.push({ symbol: ref.symbol, price: info.price, currency: 'USD', market: info.market, asOf: null });
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
}
