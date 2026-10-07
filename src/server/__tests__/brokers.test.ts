/**
 * Adapter wiring against a fake fetch: request shape (paths, TR ids, headers,
 * continuation) and response parsing, using field names from each broker's
 * published spec. No network access.
 */
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TokenManager } from '../brokers/http';
import { DbAdapter } from '../brokers/db';
import { KisAdapter, parseKisAccount } from '../brokers/kis';
import { KiwoomAdapter, kiwoomExpiry } from '../brokers/kiwoom';
import { LsAdapter } from '../brokers/ls';
import { MeritzAdapter } from '../brokers/meritz';
import { memoryTokenStore, type ConnectionConfig } from '../brokers/types';

interface Call {
  url: URL;
  method: string;
  headers: Record<string, string>;
  body: string;
}
type Reply = { status?: number; headers?: Record<string, string>; body: unknown };

const realFetch = globalThis.fetch;
let calls: Call[] = [];

function fake(handler: (c: Call) => Reply) {
  calls = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries((init?.headers as Record<string, string>) ?? {})) headers[k.toLowerCase()] = v;
    const call: Call = { url: new URL(String(input)), method: init?.method ?? 'GET', headers, body: init?.body ? String(init.body) : '' };
    calls.push(call);
    const r = handler(call);
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: r.headers });
  }) as typeof fetch;
}

let seq = 0;
const cfg = (over: Partial<ConnectionConfig> = {}): ConnectionConfig => ({ id: `t${++seq}`, appKey: 'APPKEY', secret: 'SECRET', accountNo: null, paper: false, ...over });
const apiCalls = () => calls.filter((c) => !c.url.pathname.startsWith('/oauth2'));

beforeEach(() => {
  calls = [];
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('TokenManager', () => {
  it('issues one token for concurrent callers and reuses the stored one', async () => {
    let issued = 0;
    const store = memoryTokenStore();
    const issue = async () => {
      issued++;
      await new Promise((r) => setTimeout(r, 20));
      return { token: `tok${issued}`, expiresAt: Date.now() + 3_600_000 };
    };
    const a = new TokenManager('tm-a', store, issue);
    const got = await Promise.all([a.get(), a.get(), a.get()]);
    assert.deepEqual(got, ['tok1', 'tok1', 'tok1']);
    assert.equal(issued, 1);
    // A fresh process (different memory key) finds it in the store.
    const b = new TokenManager('tm-b', store, issue);
    assert.equal(await b.get(), 'tok1');
    assert.equal(issued, 1);
  });

  it('issues again when the stored token is about to expire', async () => {
    let issued = 0;
    const store = memoryTokenStore();
    await store.save({ token: 'old', expiresAt: Date.now() + 60_000 });
    const m = new TokenManager('tm-c', store, async () => ({ token: `new${++issued}`, expiresAt: Date.now() + 3_600_000 }));
    assert.equal(await m.get(), 'new1');
    assert.equal(store.current?.token, 'new1');
  });
});

describe('한국투자증권', () => {
  it('validates the 8-2 account number', () => {
    assert.deepEqual(parseKisAccount('12345678-01'), { cano: '12345678', prdt: '01' });
    assert.deepEqual(parseKisAccount('1234567801'), { cano: '12345678', prdt: '01' });
    assert.throws(() => parseKisAccount('1234-5678'), /8자리-2자리/);
  });

  it('reads domestic pages and US holdings with the documented TRs and headers', async () => {
    fake((c) => {
      if (c.url.pathname === '/oauth2/tokenP') return { body: { access_token: 'KIS-TOKEN', expires_in: 86400, access_token_token_expired: '2026-10-08 12:00:00' } };
      if (c.url.pathname.endsWith('/domestic-stock/v1/trading/inquire-balance')) {
        const first = !c.url.searchParams.get('CTX_AREA_NK100');
        return {
          headers: { tr_cont: first ? 'M' : 'D' },
          body: {
            rt_cd: '0',
            ctx_area_fk100: 'FK',
            ctx_area_nk100: first ? 'NK1' : '',
            output1: first
              ? [{ pdno: '005930', prdt_name: '삼성전자', hldg_qty: '10', pchs_avg_pric: '68500.0000', prpr: '71200' }, { pdno: '000660', prdt_name: 'SK하이닉스', hldg_qty: '0', pchs_avg_pric: '0', prpr: '0' }]
              : [{ pdno: '035420', prdt_name: 'NAVER', hldg_qty: '2', pchs_avg_pric: '190000', prpr: '201000' }],
          },
        };
      }
      if (c.url.pathname.endsWith('/overseas-stock/v1/trading/inquire-balance')) {
        return { body: { rt_cd: '0', output1: [{ ovrs_pdno: 'AAPL', ovrs_item_name: '애플', ovrs_cblc_qty: '3', pchs_avg_pric: '187.2500', now_pric2: '230.10', ovrs_excg_cd: 'NASD', tr_crcy_cd: 'USD' }] } };
      }
      throw new Error('unexpected ' + c.url);
    });
    const store = memoryTokenStore();
    const h = await new KisAdapter(cfg({ accountNo: '12345678-01' }), store).holdings();
    assert.deepEqual(
      h.map((x) => [x.symbol, x.name, x.quantity, x.averagePrice, x.currency, x.market]),
      [
        ['005930', '삼성전자', '10', '68500.0000', 'KRW', 'KRX'],
        ['035420', 'NAVER', '2', '190000', 'KRW', 'KRX'],
        ['AAPL', '애플', '3', '187.2500', 'USD', 'NASDAQ'],
      ],
    );
    const token = calls.find((c) => c.url.pathname === '/oauth2/tokenP')!;
    assert.equal(token.url.origin, 'https://openapi.koreainvestment.com:9443');
    assert.deepEqual(JSON.parse(token.body), { grant_type: 'client_credentials', appkey: 'APPKEY', appsecret: 'SECRET' });
    const [p1, p2, us] = apiCalls();
    assert.equal(p1.headers.tr_id, 'TTTC8434R');
    assert.equal(p1.headers.authorization, 'Bearer KIS-TOKEN');
    assert.equal(p1.headers.appkey, 'APPKEY');
    assert.equal(p1.headers.custtype, 'P');
    assert.equal(p1.url.searchParams.get('CANO'), '12345678');
    assert.equal(p1.url.searchParams.get('ACNT_PRDT_CD'), '01');
    assert.equal(p2.headers.tr_cont, 'N');
    assert.equal(p2.url.searchParams.get('CTX_AREA_NK100'), 'NK1');
    assert.equal(us.headers.tr_id, 'TTTS3012R');
    assert.equal(us.url.searchParams.get('OVRS_EXCG_CD'), 'NASD');
    assert.equal(store.current?.token, 'KIS-TOKEN');
    assert.equal(calls.filter((c) => c.url.pathname === '/oauth2/tokenP').length, 1);
  });

  it('uses the mock host, V-prefixed TR ids and each US exchange in paper mode', async () => {
    fake((c) => (c.url.pathname === '/oauth2/tokenP' ? { body: { access_token: 'T', expires_in: 86400 } } : { body: { rt_cd: '0', output1: [] } }));
    await new KisAdapter(cfg({ accountNo: '12345678-01', paper: true }), memoryTokenStore()).holdings();
    const api = apiCalls();
    assert.equal(api[0].url.origin, 'https://openapivts.koreainvestment.com:29443');
    assert.equal(api[0].headers.tr_id, 'VTTC8434R');
    assert.deepEqual(
      api.slice(1).map((c) => [c.headers.tr_id, c.url.searchParams.get('OVRS_EXCG_CD')]),
      [
        ['VTTS3012R', 'NASD'],
        ['VTTS3012R', 'NYSE'],
        ['VTTS3012R', 'AMEX'],
      ],
    );
  });

  it('refreshes an expired token once and retries', async () => {
    let n = 0;
    fake((c) => {
      if (c.url.pathname === '/oauth2/tokenP') return { body: { access_token: `T${++n}`, expires_in: 86400 } };
      if (c.headers.authorization === 'Bearer T1') return { status: 500, body: { rt_cd: '1', msg_cd: 'EGW00123', msg1: '기간이 만료된 token 입니다.' } };
      return { body: { rt_cd: '0', output: { stck_prpr: '71200' } } };
    });
    const q = await new KisAdapter(cfg({ accountNo: '12345678-01' }), memoryTokenStore()).quotes([{ symbol: '005930', market: null }]);
    assert.deepEqual(q.map((x) => [x.symbol, x.price]), [['005930', '71200']]);
    assert.equal(n, 2);
  });

  it('finds the US exchange for a quote and reports it', async () => {
    fake((c) => {
      if (c.url.pathname === '/oauth2/tokenP') return { body: { access_token: 'T', expires_in: 86400 } };
      const excd = c.url.searchParams.get('EXCD');
      return { body: { rt_cd: '0', output: { last: excd === 'NYS' ? '70.25' : '' } } };
    });
    const [q] = await new KisAdapter(cfg({ accountNo: '12345678-01' }), memoryTokenStore()).quotes([{ symbol: 'KO', market: null }]);
    assert.deepEqual([q.price, q.market, q.currency], ['70.25', 'NYSE', 'USD']);
  });
});

describe('키움증권', () => {
  it('parses the KST expiry timestamp', () => {
    assert.equal(kiwoomExpiry('20261008123000'), Date.parse('2026-10-08T12:30:00+09:00'));
  });

  it('reads padded domestic balances across pages, then US holdings', async () => {
    fake((c) => {
      if (c.url.pathname === '/oauth2/token') return { body: { return_code: 0, token: 'KW', token_type: 'bearer', expires_dt: '20991231235959' } };
      if (c.headers['api-id'] === 'kt00018') {
        const first = !c.headers['next-key'];
        return {
          headers: first ? { 'cont-yn': 'Y', 'next-key': 'K2' } : ({} as Record<string, string>),
          body: {
            return_code: 0,
            acnt_evlt_remn_indv_tot: [
              first
                ? { stk_cd: 'A005930', stk_nm: '삼성전자', rmnd_qty: '000000000000010', pur_pric: '000000000068500', cur_prc: '-000000071200' }
                : { stk_cd: 'A000660', stk_nm: 'SK하이닉스', rmnd_qty: '000000000000003', pur_pric: '000000000150000', cur_prc: '+000000180000' },
            ],
          },
        };
      }
      if (c.headers['api-id'] === 'ust21070') {
        return { body: { return_code: 0, result_list: [{ stk_cd: 'TSLA', frgn_stk_nm: '테슬라', poss_qty: '2', frgn_stk_book_uv: '250.5000', now_pric: '260.0000', crnc_code: 'USD', stex_nm: 'NASDAQ' }] } };
      }
      throw new Error('unexpected ' + c.headers['api-id']);
    });
    const h = await new KiwoomAdapter(cfg(), memoryTokenStore()).holdings();
    assert.deepEqual(
      h.map((x) => [x.symbol, x.quantity, x.averagePrice, x.lastPrice, x.currency, x.market]),
      [
        ['005930', '10', '68500', '71200', 'KRW', 'KRX'],
        ['000660', '3', '150000', '180000', 'KRW', 'KRX'],
        ['TSLA', '2', '250.5000', '260.0000', 'USD', 'NASDAQ'],
      ],
    );
    const token = calls[0];
    assert.equal(token.url.origin, 'https://api.kiwoom.com');
    assert.deepEqual(JSON.parse(token.body), { grant_type: 'client_credentials', appkey: 'APPKEY', secretkey: 'SECRET' });
    const [p1, p2] = apiCalls();
    assert.equal(p1.url.pathname, '/api/dostk/acnt');
    assert.deepEqual(JSON.parse(p1.body), { qry_tp: '1', dmst_stex_tp: 'KRX' });
    assert.equal(p1.headers.authorization, 'Bearer KW');
    assert.equal(p2.headers['cont-yn'], 'Y');
    assert.equal(p2.headers['next-key'], 'K2');
  });

  it('surfaces business errors sent with HTTP 200', async () => {
    fake((c) =>
      c.url.pathname === '/oauth2/token'
        ? { body: { return_code: 0, token: 'KW', expires_dt: '20991231235959' } }
        : { body: { return_code: 2, return_msg: '입력값 오류입니다' } },
    );
    await assert.rejects(new KiwoomAdapter(cfg(), memoryTokenStore()).verify(), /입력값 오류/);
  });
});

describe('LS증권', () => {
  it('pages t0424 by cts_expcode and reads COSOQ00201 overseas rows', async () => {
    fake((c) => {
      if (c.url.pathname === '/oauth2/token') return { body: { access_token: 'LS', expires_in: 86400, scope: 'oob', token_type: 'Bearer' } };
      if (c.headers.tr_cd === 't0424') {
        const cursor = JSON.parse(c.body).t0424InBlock.cts_expcode;
        return {
          body: {
            rsp_cd: '00000',
            t0424OutBlock: { cts_expcode: cursor ? '' : '000660' },
            t0424OutBlock1: cursor
              ? [{ expcode: '000660', hname: 'SK하이닉스', janqty: 3, pamt: 150000, price: 180000 }]
              : [{ expcode: '005930', hname: '삼성전자', janqty: 10, pamt: 68500, price: 71200 }],
          },
        };
      }
      if (c.headers.tr_cd === 'COSOQ00201') {
        return { body: { rsp_cd: '00000', COSOQ00201OutBlock4: [{ ShtnIsuNo: 'MSFT', CrcyCode: 'USD', AstkBalQty: 1, FcstckUprc: 410.5, OvrsScrtsCurpri: 420, FcurrMktCode: '82' }] } };
      }
      throw new Error('unexpected ' + c.headers.tr_cd);
    });
    const h = await new LsAdapter(cfg(), memoryTokenStore()).holdings();
    assert.deepEqual(
      h.map((x) => [x.symbol, x.quantity, x.averagePrice, x.currency, x.market]),
      [
        ['005930', '10', '68500', 'KRW', 'KRX'],
        ['000660', '3', '150000', 'KRW', 'KRX'],
        ['MSFT', '1', '410.5', 'USD', 'NASDAQ'],
      ],
    );
    assert.equal(calls[0].url.origin, 'https://openapi.ls-sec.co.kr:8080');
    assert.equal(new URLSearchParams(calls[0].body).get('appsecretkey'), 'SECRET');
    const [p1, p2] = apiCalls();
    assert.equal(p1.headers.tr_cont, 'N');
    assert.deepEqual(JSON.parse(p1.body).t0424InBlock, { prcgb: '1', chegb: '2', dangb: '0', charge: '1', cts_expcode: '' });
    assert.equal(p2.headers.tr_cont, 'Y');
  });

  it('treats a non-00000 rsp_cd as an error', async () => {
    fake((c) => (c.url.pathname === '/oauth2/token' ? { body: { access_token: 'LS', expires_in: 86400 } } : { body: { rsp_cd: '01234', rsp_msg: '계좌 없음' } }));
    await assert.rejects(new LsAdapter(cfg(), memoryTokenStore()).verify(), /계좌 없음/);
  });
});

describe('DB증권', () => {
  it('computes the domestic average from purchase amount and reads overseas rows', async () => {
    fake((c) => {
      if (c.url.pathname === '/oauth2/token') return { body: { access_token: 'DB', expires_in: 86400 } };
      if (c.url.pathname === '/api/v1/trading/kr-stock/inquiry/balance') {
        return { body: { rsp_cd: '00000', Out1: [{ IsuNo: 'A005930', IsuNm: '삼성전자', BalQty: 10, BalQty0: 12, PchsAmt: 840000, NowPrc: 71200 }] } };
      }
      if (c.url.pathname === '/api/v1/trading/overseas-stock/inquiry/balance-margin') {
        return { body: { Out2: [{ AstkIsuNo: 'NVDA', AstkHanglIsuNm: '엔비디아', CrcyCode: 'USD', AstkMktNm: '나스닥', AstkExecBaseQty: 4, AstkAvrPchsPrc: 120.25, AstkNowPrc: 130 }] } };
      }
      throw new Error('unexpected ' + c.url);
    });
    const h = await new DbAdapter(cfg(), memoryTokenStore()).holdings();
    assert.deepEqual(
      h.map((x) => [x.symbol, x.name, x.quantity, x.averagePrice, x.currency, x.market]),
      [
        ['005930', '삼성전자', '12', '70000', 'KRW', 'KRX'],
        ['NVDA', '엔비디아', '4', '120.25', 'USD', 'NASDAQ'],
      ],
    );
    const [kr, us] = apiCalls();
    assert.deepEqual(JSON.parse(kr.body), { In: { QryTpCode0: '0' } });
    assert.equal(kr.headers.cont_yn, 'N');
    assert.equal(JSON.parse(us.body).In.TrxTpCode, '2');
  });
});

describe('메리츠증권', () => {
  it('sends the MAC header, splits domestic and overseas holdings', async () => {
    fake((c) => {
      if (c.url.pathname === '/oauth2/token') return { body: { access_token: 'MZ', expires_in: 43200, scope: 'login' } };
      if (c.url.pathname === '/accounts/v1/me/holdings') {
        return {
          body: {
            rsp_cd: '5766',
            data: [
              { iscd: 'A005930', isnm: '삼성전자', pros_trgt_cls_code: '1', rmnd_qty: '10', rmnd_dqty: '0.5000000000', byng_unpr: '68500', psnt_prc: '71200' },
              { iscd: 'AAPL.OQ', isnm: '애플', pros_trgt_cls_code: 'J', rmnd_qty: '3', byng_unpr: '187.25', psnt_prc: '230' },
            ],
          },
        };
      }
      if (c.url.pathname === '/accounts/v1/me/overseas/holdings') {
        return { body: { data: [{ iscd: 'AAPL.OQ', ovrs_stck_symb_iscd: 'AAPL', isnm: '애플', crcd: 'USD', rmnd_dqty: '3.25', avrg_unpr: '187.25', psnt_prc: '230' }] } };
      }
      throw new Error('unexpected ' + c.url);
    });
    const h = await new MeritzAdapter(cfg(), memoryTokenStore()).holdings();
    assert.deepEqual(
      h.map((x) => [x.symbol, x.quantity, x.averagePrice, x.currency, x.market]),
      [
        ['005930', '10.5', '68500', 'KRW', 'KRX'],
        ['AAPL', '3.25', '187.25', 'USD', 'NASDAQ'],
      ],
    );
    const token = new URLSearchParams(calls[0].body);
    assert.equal(calls[0].url.origin, 'https://openapi.imeritz.com:9443');
    assert.equal(token.get('client_id'), 'APPKEY');
    assert.equal(token.get('scope'), 'login');
    for (const c of apiCalls()) assert.match(c.headers.mac_address, /^[0-9A-F]{12}$/);
  });

  it('reports gateway errors sent as HTTP 500', async () => {
    fake((c) =>
      c.url.pathname === '/oauth2/token' ? { body: { access_token: 'MZ', expires_in: 43200 } } : { status: 500, body: { rsp_cd: '0760', rsp_msg: '권한이 없습니다' } },
    );
    await assert.rejects(new MeritzAdapter(cfg(), memoryTokenStore()).verify(), /권한이 없습니다/);
  });
});
