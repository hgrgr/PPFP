/**
 * Fake 한국투자증권 and 업비트 servers for documentation screenshots.
 *
 * Loaded with `node --require` into the demo server (and imported by the demo
 * seed), it answers requests to the two brokers' hosts with made-up but
 * self-consistent data: prices follow a deterministic smooth path per symbol,
 * so quotes, candles of every interval, rankings and the demo accounts agree
 * with each other. Every other request goes to the real fetch.
 *
 * Nothing here is market data. Names are real tickers so the screens read
 * naturally; prices, volumes and balances are fictional.
 */
'use strict';

const MIN = 60_000;
const H = 60 * MIN;
const D = 24 * H;

// ---------------------------------------------------------------- universe
/** sym -> [name, price now, typical daily volume, KIS exchange] */
const KR = {
  '005930': ['삼성전자', 84500, 14_000_000],
  '000660': ['SK하이닉스', 268000, 3_200_000],
  '035420': ['NAVER', 212000, 900_000],
  '035720': ['카카오', 52300, 2_100_000],
  '069500': ['KODEX 200', 43250, 4_500_000],
  '005380': ['현대차', 228000, 700_000],
  '373220': ['LG에너지솔루션', 365000, 260_000],
  '068270': ['셀트리온', 186000, 800_000],
  '000270': ['기아', 99800, 1_300_000],
  '005490': ['POSCO홀딩스', 312000, 300_000],
  '207940': ['삼성바이오로직스', 1020000, 60_000],
  '105560': ['KB금융', 98700, 1_100_000],
};
const US = {
  AAPL: ['애플', 252.3, 48_000_000, 'NAS'],
  NVDA: ['엔비디아', 186.4, 190_000_000, 'NAS'],
  MSFT: ['마이크로소프트', 512.6, 21_000_000, 'NAS'],
  TSLA: ['테슬라', 438.7, 95_000_000, 'NAS'],
  AMZN: ['아마존', 228.1, 40_000_000, 'NAS'],
  GOOGL: ['알파벳 A', 245.8, 30_000_000, 'NAS'],
  META: ['메타 플랫폼스', 712.3, 12_000_000, 'NAS'],
  QQQ: ['인베스코 QQQ', 601.2, 45_000_000, 'NAS'],
  PLTR: ['팔란티어', 182.5, 70_000_000, 'NAS'],
  JPM: ['JP모건 체이스', 305.4, 9_000_000, 'NYS'],
  V: ['비자', 342.8, 6_000_000, 'NYS'],
  XOM: ['엑슨모빌', 113.9, 15_000_000, 'NYS'],
  VOO: ['뱅가드 S&P 500 ETF', 612.4, 7_000_000, 'AMS'],
};
const COINS = {
  BTC: ['비트코인', 142_000_000, 2_600],
  ETH: ['이더리움', 5_200_000, 42_000],
  XRP: ['엑스알피(리플)', 3_900, 260_000_000],
  SOL: ['솔라나', 280_000, 900_000],
  DOGE: ['도지코인', 330, 900_000_000],
  ADA: ['에이다', 1_100, 120_000_000],
  AVAX: ['아발란체', 42_000, 1_500_000],
  LINK: ['체인링크', 31_000, 2_400_000],
  TRX: ['트론', 480, 300_000_000],
  SUI: ['수이', 5_600, 40_000_000],
};
const INDEX = { '0001': ['KOSPI', 3450.12], '1001': ['KOSDAQ', 862.41], COMP: ['NASDAQ', 22780.5], SPX: ['SP500', 6715.3], '.DJI': ['DOW', 46580.2] };
const USDKRW = 1395.2;

// ---------------------------------------------------------------- price paths
function hash(s, i) {
  let h = 2166136261 ^ (i | 0);
  for (let k = 0; k < s.length; k++) h = Math.imul(h ^ s.charCodeAt(k), 16777619);
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  h ^= h >>> 16;
  return ((h >>> 0) / 4294967295) * 2 - 1;
}
function smooth(s, x) {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return hash(s, i) * (1 - u) + hash(s, i + 1) * u;
}
const LAYERS = [
  [90 * D, 0.2], [20 * D, 0.08], [5 * D, 0.035], [D, 0.015], [4 * H, 0.008], [H, 0.004], [15 * MIN, 0.0022], [4 * MIN, 0.0012], [MIN, 0.0005],
];
// Prices equal the listed "now" at the start of today (KST), so separate processes agree.
const ANCHOR = Math.floor((Date.now() + 9 * H) / D) * D - 9 * H;
function logPath(sym, t, scale) {
  let v = 0;
  for (const [period, amp] of LAYERS) v += amp * scale * smooth(sym + ':' + period, t / period);
  return v + (0.22 * scale * t) / (365 * D);
}
function priceAt(sym, base, t, scale = 1) {
  return base * Math.exp(logPath(sym, t, scale) - logPath(sym, ANCHOR, scale));
}

// ---------------------------------------------------------------- time zones and sessions
const fmtCache = {};
function parts(ms, zone) {
  fmtCache[zone] ??= new Intl.DateTimeFormat('en-CA', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short' });
  const p = Object.fromEntries(fmtCache[zone].formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { ymd: `${p.year}${p.month}${p.day}`, hms: `${p.hour}${p.minute}${p.second}`, dow: p.weekday };
}
function zoned(ymd, hms, zone) {
  const guess = Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8), +hms.slice(0, 2), +hms.slice(2, 4), +hms.slice(4, 6) || 0);
  let t = guess;
  for (let i = 0; i < 2; i++) {
    const p = parts(t, zone);
    const asUtc = Date.UTC(+p.ymd.slice(0, 4), +p.ymd.slice(4, 6) - 1, +p.ymd.slice(6, 8), +p.hms.slice(0, 2), +p.hms.slice(2, 4), +p.hms.slice(4, 6));
    t = guess - (asUtc - t);
  }
  return t;
}
const addDay = (ymd, n) => new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8)) + n * D).toISOString().slice(0, 10).replace(/-/g, '');
const SESSION = {
  KR: { zone: 'Asia/Seoul', open: '090000', close: '153000' },
  US: { zone: 'America/New_York', open: '093000', close: '160000' },
};
const isWeekend = (ymd) => [0, 6].includes(new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8))).getUTCDay());
function session(mkt, ymd) {
  const s = SESSION[mkt];
  return { ymd, open: zoned(ymd, s.open, s.zone), close: zoned(ymd, s.close, s.zone) };
}
/** Latest session day (YYYYMMDD) on or before `ymd` that had opened by `at`. */
function sessionOnOrBefore(mkt, ymd, at = Date.now()) {
  let d = ymd;
  for (let i = 0; i < 10; i++, d = addDay(d, -1)) if (!isWeekend(d) && session(mkt, d).open <= at) return d;
  return d;
}
const lastSession = (mkt, at = Date.now()) => sessionOnOrBefore(mkt, parts(at, SESSION[mkt].zone).ymd, at);
const prevSession = (mkt, ymd) => sessionOnOrBefore(mkt, addDay(ymd, -1), Infinity);

// ---------------------------------------------------------------- bars
const roundTo = (v, step) => Math.round(v / step) * step;
const krTick = (p) => (p < 2000 ? 1 : p < 5000 ? 5 : p < 20000 ? 10 : p < 50000 ? 50 : p < 200000 ? 100 : p < 500000 ? 500 : 1000);
const usRound = (p) => Math.round(p * 100) / 100;
function bar(key, base, t0, t1, scale, round, dailyVol, spanMin) {
  const end = Math.min(t1, Date.now());
  const pts = [];
  for (let k = 0; k <= 4; k++) pts.push(priceAt(key, base, t0 + ((end - t0) * k) / 4, scale));
  const wobble = 1 + 0.0015 * scale * Math.abs(hash(key + 'w', Math.floor(t0 / MIN)));
  const o = round(pts[0]);
  const c = round(pts[4]);
  const h = round(Math.max(...pts) * wobble);
  const l = round(Math.min(...pts) / wobble);
  const vol = Math.max(1, Math.round(dailyVol * ((end - t0) / MIN / spanMin) * (0.55 + 0.9 * Math.abs(hash(key + 'v', Math.floor(t0 / MIN))))));
  return { t0, o, h: Math.max(h, o, c), l: Math.min(l, o, c), c, v: vol };
}

function stockMeta(sym) {
  if (KR[sym]) return { mkt: 'KR', key: sym, name: KR[sym][0], base: KR[sym][1], vol: KR[sym][2], round: (p) => roundTo(p, krTick(p)), scale: 1 };
  if (US[sym]) return { mkt: 'US', key: sym, name: US[sym][0], base: US[sym][1], vol: US[sym][2], excd: US[sym][3], round: usRound, scale: 1.1 };
  if (INDEX[sym]) {
    const mkt = /^\d/.test(sym) ? 'KR' : 'US';
    return { mkt, key: 'IDX' + sym, name: INDEX[sym][0], base: INDEX[sym][1], vol: 400_000_000, round: (p) => Math.round(p * 100) / 100, scale: 0.6 };
  }
  return null;
}
const SESSION_MIN = { KR: 390, US: 390 };
function dayBar(m, ymd) {
  const s = session(m.mkt, ymd);
  return { ymd, ...bar(m.key, m.base, s.open, s.close, m.scale, m.round, m.vol, SESSION_MIN[m.mkt]) };
}
/** Daily bars from newest to oldest, starting at the latest session on or before `ymd`. */
function dailyDesc(m, ymd, n) {
  const out = [];
  let d = sessionOnOrBefore(m.mkt, ymd);
  for (let i = 0; i < n; i++, d = prevSession(m.mkt, d)) out.push(dayBar(m, d));
  return out;
}
function weeklyDesc(m, ymd, n) {
  const days = dailyDesc(m, ymd, n * 5 + 5);
  const weeks = new Map();
  for (const b of days) {
    const dow = (new Date(Date.UTC(+b.ymd.slice(0, 4), +b.ymd.slice(4, 6) - 1, +b.ymd.slice(6, 8))).getUTCDay() + 6) % 7;
    const monday = addDay(b.ymd, -dow);
    const w = weeks.get(monday);
    if (!w) weeks.set(monday, { ...b, ymd: monday });
    else Object.assign(w, { o: b.o, h: Math.max(w.h, b.h), l: Math.min(w.l, b.l), v: w.v + b.v });
  }
  return [...weeks.values()].slice(0, n);
}
/** n-minute bars of one session, oldest first, cut at now. */
function sessionMinutes(m, ymd, n) {
  const s = session(m.mkt, ymd);
  const out = [];
  for (let t = s.open; t < s.close && t < Date.now(); t += n * MIN) out.push(bar(m.key, m.base, t, Math.min(t + n * MIN, s.close), m.scale, m.round, m.vol, SESSION_MIN[m.mkt]));
  return out;
}
function quoteOf(m) {
  const today = lastSession(m.mkt);
  const s = session(m.mkt, today);
  const price = m.round(priceAt(m.key, m.base, Math.min(Date.now(), s.close), m.scale));
  const prev = dayBar(m, prevSession(m.mkt, today)).c;
  const vol = sessionMinutes(m, today, 30).reduce((a, b) => a + b.v, 0);
  return { price, prev, vol, today };
}

// ---------------------------------------------------------------- 한국투자증권
const kisOk = (body, headers = {}) => ({ body: { rt_cd: '0', msg_cd: 'MCA00000', msg1: '정상처리 되었습니다.', ...body }, headers: { tr_cont: '', ...headers } });
const pct = (a, b) => (b ? (((a - b) / b) * 100).toFixed(2) : '0.00');
const sign = (a, b) => (a > b ? '2' : a < b ? '5' : '3');

/** The demo 한국투자 account: what was imported a year ago plus one stock bought since. */
const KIS_ACCOUNT = [
  ['005930', 50, 72300],
  ['000660', 12, 198500],
  ['069500', 120, 36800],
  ['035720', 30, 48900],
];

function kis(url) {
  const p = url.pathname;
  const q = (k) => url.searchParams.get(k) ?? '';
  if (p === '/oauth2/tokenP') return { body: { access_token: 'demo-access-token', token_type: 'Bearer', expires_in: 86400, access_token_token_expired: '' } };
  if (p === '/uapi/domestic-stock/v1/trading/inquire-balance') {
    return kisOk({
      output1: KIS_ACCOUNT.map(([sym, qty, avg]) => ({ pdno: sym, prdt_name: KR[sym][0], hldg_qty: String(qty), pchs_avg_pric: String(avg), prpr: String(quoteOf(stockMeta(sym)).price) })),
      output2: [{}],
    });
  }
  if (p === '/uapi/overseas-stock/v1/trading/inquire-balance') return kisOk({ output1: [], output2: {} });
  if (p === '/uapi/domestic-stock/v1/quotations/inquire-price') {
    const m = stockMeta(q('FID_INPUT_ISCD'));
    if (!m) return kisOk({ output: { stck_prpr: '0' } });
    const x = quoteOf(m);
    return kisOk({ output: { stck_prpr: String(x.price), stck_sdpr: String(x.prev), acml_vol: String(x.vol) } });
  }
  if (p === '/uapi/overseas-price/v1/quotations/price') {
    const m = stockMeta(q('SYMB'));
    if (!m || m.mkt !== 'US' || m.excd !== q('EXCD')) return kisOk({ output: { last: '' } });
    const x = quoteOf(m);
    return kisOk({ output: { last: x.price.toFixed(2), base: x.prev.toFixed(2), tvol: String(x.vol) } });
  }
  if (p === '/uapi/domestic-stock/v1/quotations/search-stock-info') {
    const m = stockMeta(q('PDNO'));
    return kisOk({ output: m ? { prdt_abrv_name: m.name, prdt_name: m.name, mket_id_cd: 'STK', lstg_abol_dt: '' } : {} });
  }
  if (p === '/uapi/overseas-price/v1/quotations/search-info') {
    const m = stockMeta(q('PDNO'));
    const ok = m && m.mkt === 'US' && { 512: 'NAS', 513: 'NYS', 529: 'AMS' }[q('PRDT_TYPE_CD')] === m.excd;
    return kisOk({ output: ok ? { prdt_name: m.name, prdt_eng_name: q('PDNO') } : {} });
  }
  if (p === '/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice') {
    const m = stockMeta(q('FID_INPUT_ISCD'));
    if (!m) return kisOk({ output2: [] });
    const from = q('FID_INPUT_DATE_1');
    const weekly = q('FID_PERIOD_DIV_CODE') === 'W';
    const list = (weekly ? weeklyDesc(m, q('FID_INPUT_DATE_2'), 100) : dailyDesc(m, q('FID_INPUT_DATE_2'), 100)).filter((b) => b.ymd >= from);
    return kisOk({ output2: list.map((b) => ({ stck_bsop_date: b.ymd, stck_oprc: String(b.o), stck_hgpr: String(b.h), stck_lwpr: String(b.l), stck_clpr: String(b.c), acml_vol: String(b.v) })) });
  }
  if (p === '/uapi/overseas-price/v1/quotations/dailyprice') {
    const m = stockMeta(q('SYMB'));
    if (!m) return kisOk({ output2: [] });
    const start = q('BYMD') || parts(Date.now(), 'America/New_York').ymd;
    const list = q('GUBN') === '1' ? weeklyDesc(m, start, 100) : dailyDesc(m, start, 100);
    return kisOk({ output2: list.map((b) => ({ xymd: b.ymd, open: b.o.toFixed(2), high: b.h.toFixed(2), low: b.l.toFixed(2), clos: b.c.toFixed(2), tvol: String(b.v) })) });
  }
  if (p === '/uapi/overseas-price/v1/quotations/price-detail') {
    return kisOk({ output: { t_rate: (USDKRW * Math.exp(0.004 * smooth('fx', Date.now() / D))).toFixed(2) } });
  }
  if (p === '/uapi/domestic-stock/v1/quotations/inquire-index-price') {
    const x = quoteOf(stockMeta(q('FID_INPUT_ISCD')));
    return kisOk({ output: { bstp_nmix_prpr: x.price.toFixed(2), bstp_nmix_prdy_vrss: Math.abs(x.price - x.prev).toFixed(2), prdy_vrss_sign: sign(x.price, x.prev) } });
  }
  if (p === '/uapi/overseas-price/v1/quotations/inquire-daily-chartprice') {
    const x = quoteOf(stockMeta(q('FID_INPUT_ISCD')));
    return kisOk({ output1: { ovrs_nmix_prpr: x.price.toFixed(2), ovrs_nmix_prdy_clpr: x.prev.toFixed(2) } });
  }
  if (p === '/uapi/domestic-stock/v1/quotations/volume-rank') {
    const rows = Object.keys(KR).map((sym) => {
      const x = quoteOf(stockMeta(sym));
      return { mksc_shrn_iscd: sym, hts_kor_isnm: KR[sym][0], stck_prpr: String(x.price), prdy_ctrt: pct(x.price, x.prev), acml_vol: String(x.vol), acml_tr_pbmn: String(Math.round(x.vol * x.price)) };
    });
    const key = q('FID_BLNG_CLS_CODE') === '3' ? 'acml_tr_pbmn' : 'acml_vol';
    return kisOk({ output: rows.sort((a, b) => Number(b[key]) - Number(a[key])) });
  }
  if (p === '/uapi/domestic-stock/v1/ranking/fluctuation') {
    const rows = Object.keys(KR).map((sym) => {
      const x = quoteOf(stockMeta(sym));
      return { stck_shrn_iscd: sym, hts_kor_isnm: KR[sym][0], stck_prpr: String(x.price), prdy_ctrt: pct(x.price, x.prev), acml_vol: String(x.vol) };
    });
    const up = q('fid_rank_sort_cls_code') === '0000';
    return kisOk({ output: rows.sort((a, b) => (up ? 1 : -1) * (Number(b.prdy_ctrt) - Number(a.prdy_ctrt))) });
  }
  const rank = p.match(/^\/uapi\/overseas-stock\/v1\/ranking\/(trade-pbmn|trade-vol|updown-rate)$/);
  if (rank) {
    const rows = Object.keys(US)
      .filter((sym) => US[sym][3] === q('EXCD'))
      .map((sym) => {
        const x = quoteOf(stockMeta(sym));
        return { symb: sym, name: US[sym][0], last: x.price.toFixed(2), rate: pct(x.price, x.prev), tvol: String(x.vol), tamt: String(Math.round(x.vol * x.price)) };
      });
    return kisOk({ output1: {}, output2: rows });
  }
  if (p === '/uapi/domestic-stock/v1/quotations/inquire-time-itemchartprice') {
    const m = stockMeta(q('FID_INPUT_ISCD'));
    if (!m) return kisOk({ output2: [] });
    const day = lastSession('KR');
    const upto = zoned(day, q('FID_INPUT_HOUR_1') || '153000', 'Asia/Seoul');
    const list = sessionMinutes(m, day, 1).filter((b) => b.t0 <= upto).reverse().slice(0, 30);
    return kisOk({ output2: list.map((b) => ({ stck_bsop_date: day, stck_cntg_hour: parts(b.t0, 'Asia/Seoul').hms, stck_prpr: String(b.c), cntg_vol: String(b.v) })) });
  }
  if (p === '/uapi/domestic-stock/v1/quotations/inquire-time-dailychartprice') {
    const m = stockMeta(q('FID_INPUT_ISCD'));
    if (!m) return kisOk({ output2: [] });
    let day = sessionOnOrBefore('KR', q('FID_INPUT_DATE_1'));
    let upto = day === q('FID_INPUT_DATE_1') ? zoned(day, q('FID_INPUT_HOUR_1') || '153000', 'Asia/Seoul') : Infinity;
    const out = [];
    for (let guard = 0; out.length < 120 && guard < 5; guard++, day = prevSession('KR', day), upto = Infinity) {
      out.push(...sessionMinutes(m, day, 1).filter((b) => b.t0 <= upto).reverse().map((b) => ({ day, b })));
    }
    return kisOk({
      output2: out.slice(0, 120).map(({ day, b }) => ({ stck_bsop_date: day, stck_cntg_hour: parts(b.t0, 'Asia/Seoul').hms, stck_oprc: String(b.o), stck_hgpr: String(b.h), stck_lwpr: String(b.l), stck_prpr: String(b.c), cntg_vol: String(b.v) })),
    });
  }
  if (p === '/uapi/overseas-price/v1/quotations/inquire-time-itemchartprice') {
    const m = stockMeta(q('SYMB'));
    if (!m) return kisOk({ output1: { next: '0' }, output2: [] });
    const n = Number(q('NMIN')) || 1;
    const keyb = q('KEYB');
    const before = keyb ? zoned(keyb.slice(0, 8), keyb.slice(8), 'America/New_York') : Infinity;
    const all = [];
    for (let d = lastSession('US'), i = 0; i < 5; i++, d = prevSession('US', d)) all.push(...sessionMinutes(m, d, n).reverse());
    const page = all.filter((b) => b.t0 <= before).slice(0, 120);
    const more = all.filter((b) => b.t0 <= before).length > 120;
    return kisOk({
      output1: { next: more ? '1' : '0' },
      output2: page.map((b) => {
        const ny = parts(b.t0, 'America/New_York');
        const kr = parts(b.t0, 'Asia/Seoul');
        return { xymd: ny.ymd, xhms: ny.hms, kymd: kr.ymd, khms: kr.hms, open: b.o.toFixed(2), high: b.h.toFixed(2), low: b.l.toFixed(2), last: b.c.toFixed(2), evol: String(b.v) };
      }),
    });
  }
  if (p === '/uapi/domestic-stock/v1/quotations/inquire-asking-price-exp-ccn') {
    const m = stockMeta(q('FID_INPUT_ISCD'));
    const out = {};
    if (m) {
      const px = quoteOf(m).price;
      const tick = krTick(px);
      for (let i = 1; i <= 10; i++) {
        out[`askp${i}`] = String(px + tick * i);
        out[`askp_rsqn${i}`] = String(Math.round(800 + 9000 * Math.abs(hash(m.key + 'a', i))));
        out[`bidp${i}`] = String(px - tick * (i - 1));
        out[`bidp_rsqn${i}`] = String(Math.round(800 + 9000 * Math.abs(hash(m.key + 'b', i))));
      }
    }
    return kisOk({ output1: out });
  }
  if (p === '/uapi/overseas-price/v1/quotations/inquire-asking-price') {
    const m = stockMeta(q('SYMB'));
    const out = {};
    if (m && m.excd === q('EXCD')) {
      const px = quoteOf(m).price;
      for (let i = 1; i <= 10; i++) {
        out[`pask${i}`] = (px + 0.01 * i).toFixed(2);
        out[`vask${i}`] = String(Math.round(100 + 2000 * Math.abs(hash(m.key + 'a', i))));
        out[`pbid${i}`] = (px - 0.01 * (i - 1)).toFixed(2);
        out[`vbid${i}`] = String(Math.round(100 + 2000 * Math.abs(hash(m.key + 'b', i))));
      }
    }
    return kisOk({ output2: out });
  }
  return { status: 404, body: { rt_cd: '1', msg_cd: 'DEMO404', msg1: `데모 서버에 없는 요청: ${p}` } };
}

// ---------------------------------------------------------------- 업비트
const coinMeta = (coin) => (COINS[coin] ? { key: 'C' + coin, name: COINS[coin][0], base: COINS[coin][1], vol: COINS[coin][2] } : null);
const upbitTick = (p) => (p >= 2_000_000 ? 1000 : p >= 1_000_000 ? 500 : p >= 500_000 ? 100 : p >= 100_000 ? 50 : p >= 10_000 ? 10 : p >= 1_000 ? 1 : p >= 100 ? 0.1 : 0.01);
const coinRound = (p) => {
  const t = upbitTick(p);
  return Number((Math.round(p / t) * t).toFixed(2));
};
const coinPrice = (c, t) => coinRound(priceAt(c.key, c.base, t, 2));
function coinBar(c, t0, t1) {
  return bar(c.key, c.base, t0, t1, 2, coinRound, c.vol, 1440);
}
const isoNoZ = (ms) => new Date(ms).toISOString().slice(0, 19);
function candleRow(market, c, b, t1) {
  return {
    market,
    candle_date_time_utc: isoNoZ(b.t0),
    candle_date_time_kst: isoNoZ(b.t0 + 9 * H),
    opening_price: b.o,
    high_price: b.h,
    low_price: b.l,
    trade_price: b.c,
    timestamp: Math.min(t1, Date.now()),
    candle_acc_trade_price: Math.round(b.v * b.c),
    candle_acc_trade_volume: b.v,
  };
}
function ticker(coin) {
  const c = coinMeta(coin);
  const now = Date.now();
  const dayStart = Math.floor(now / D) * D;
  const price = coinPrice(c, now);
  const prev = coinPrice(c, dayStart);
  const today = coinBar(c, dayStart, dayStart + D);
  const vol24 = Math.round(c.vol * (0.8 + 0.4 * Math.abs(hash(c.key, Math.floor(now / H)))));
  return {
    market: 'KRW-' + coin,
    trade_price: price,
    opening_price: today.o,
    high_price: today.h,
    low_price: today.l,
    prev_closing_price: prev,
    change: price > prev ? 'RISE' : price < prev ? 'FALL' : 'EVEN',
    signed_change_price: Number((price - prev).toFixed(2)),
    signed_change_rate: Number(((price - prev) / prev).toFixed(6)),
    acc_trade_volume: today.v,
    acc_trade_price: Math.round(today.v * price),
    acc_trade_volume_24h: vol24,
    acc_trade_price_24h: Math.round(vol24 * price),
    timestamp: now,
  };
}

/** The demo 업비트 account history, relative to today. Times are spread over the last ~14 months. */
function upbitLedger() {
  const day = (n, hour = 10) => ANCHOR - n * D + hour * H;
  const ev = [
    ['DEP', 'KRW', 4_000_000, day(420)],
    ['BUY', 'BTC', 0.012, day(415, 21)],
    ['DEP', 'KRW', 6_000_000, day(300)],
    ['BUY', 'ETH', 0.4, day(290, 14)],
    ['BUY', 'XRP', 600, day(200, 22)],
    ['BUY', 'BTC', 0.005, day(150, 9)],
    ['SELL', 'ETH', 0.15, day(90, 16)],
    ['DEP', 'SOL', 3, day(60, 11)],
    ['BUY', 'BTC', 0.003, day(30, 20)],
    ['WD', 'KRW', 500_000, day(10, 13)],
    ['BUY', 'XRP', 200, day(2, 8)],
  ];
  const orders = [];
  const deposits = [];
  const withdraws = [];
  const bal = { KRW: 0 };
  const cost = {};
  const kst = (ms) => isoNoZ(ms + 9 * H) + '+09:00';
  ev.forEach(([kind, cur, qty, at], i) => {
    const id = `demo-${i + 1}`;
    if (kind === 'DEP') {
      deposits.push({ type: 'deposit', uuid: id, currency: cur, txid: null, state: 'ACCEPTED', created_at: kst(at - 5 * MIN), done_at: kst(at), amount: String(qty), fee: '0', transaction_type: 'default' });
      bal[cur] = (bal[cur] ?? 0) + qty;
      if (cur !== 'KRW') cost[cur] = (cost[cur] ?? 0) + qty * coinPrice(coinMeta(cur), at);
    } else if (kind === 'WD') {
      const fee = cur === 'KRW' ? 1000 : 0;
      withdraws.push({ type: 'withdraw', uuid: id, currency: cur, txid: null, state: 'DONE', created_at: kst(at - 5 * MIN), done_at: kst(at), amount: String(qty), fee: String(fee), transaction_type: 'default' });
      bal[cur] -= qty + fee;
    } else {
      const c = coinMeta(cur);
      const price = coinPrice(c, at);
      const funds = Math.round(price * qty);
      const fee = Math.round(funds * 0.0005 * 100) / 100;
      orders.push({
        uuid: id, side: kind === 'BUY' ? 'bid' : 'ask', ord_type: 'limit', price: String(price), state: 'done', market: 'KRW-' + cur,
        created_at: kst(at), volume: String(qty), remaining_volume: '0', executed_volume: String(qty), paid_fee: String(fee), trades_count: 1,
        trades: [{ market: 'KRW-' + cur, uuid: id + '-t', price: String(price), volume: String(qty), funds: String(funds), side: kind === 'BUY' ? 'bid' : 'ask', created_at: kst(at + 1000) }],
      });
      if (kind === 'BUY') {
        bal.KRW -= funds + fee;
        bal[cur] = (bal[cur] ?? 0) + qty;
        cost[cur] = (cost[cur] ?? 0) + funds + fee;
      } else {
        const avg = cost[cur] / bal[cur];
        bal.KRW += funds - fee;
        bal[cur] -= qty;
        cost[cur] -= avg * qty;
      }
    }
    if (bal.KRW < 0) throw new Error(`demo ledger goes below zero KRW at event ${i + 1}`);
  });
  const accounts = Object.entries(bal).map(([cur, qty]) => ({
    currency: cur,
    balance: cur === 'KRW' ? String(Math.round(qty)) : String(Number(qty.toFixed(8))),
    locked: '0',
    avg_buy_price: cur === 'KRW' ? '0' : String(Math.round(cost[cur] / qty)),
    avg_buy_price_modified: false,
    unit_currency: 'KRW',
  }));
  return { orders, deposits, withdraws, accounts };
}
let ledgerCache = null;
const ledger = () => (ledgerCache ??= upbitLedger());

function upbit(url) {
  const p = url.pathname;
  const q = (k) => url.searchParams.get(k) ?? '';
  const markets = (s) => s.split(',').map((m) => m.trim().toUpperCase()).filter((m) => m.startsWith('KRW-') && COINS[m.slice(4)]);
  if (p === '/v1/market/all') return { body: Object.keys(COINS).map((c) => ({ market: 'KRW-' + c, korean_name: COINS[c][0], english_name: c })) };
  if (p === '/v1/ticker') return { body: markets(q('markets')).map((m) => ticker(m.slice(4))) };
  if (p === '/v1/ticker/all') return { body: Object.keys(COINS).map(ticker) };
  const cm = p.match(/^\/v1\/candles\/(minutes\/(\d+)|days|weeks)$/);
  if (cm) {
    const market = q('market').toUpperCase();
    const c = coinMeta(market.slice(4));
    if (!c) return { body: [] };
    const span = cm[2] ? Number(cm[2]) * MIN : cm[1] === 'days' ? D : 7 * D;
    const to = q('to') ? Date.parse(q('to').includes('T') ? q('to') : q('to').replace(' ', 'T') + 'Z') : Date.now() + 1;
    // Weeks start on Monday (1970-01-01 was a Thursday)
    const align = (t) => (span === 7 * D ? Math.floor((t - 4 * D) / span) * span + 4 * D : Math.floor(t / span) * span);
    const count = Math.min(200, Number(q('count')) || 1);
    const out = [];
    for (let t0 = align(to - 1); out.length < count; t0 -= span) {
      if (t0 >= to) continue;
      out.push(candleRow(market, c, coinBar(c, t0, t0 + span), t0 + span));
    }
    return { body: out };
  }
  if (p === '/v1/orderbook') {
    return {
      body: markets(q('markets')).map((m) => {
        const c = coinMeta(m.slice(4));
        const px = coinPrice(c, Date.now());
        const tick = upbitTick(px);
        const size = (s, i) => Number((c.vol / 3000 * (0.2 + Math.abs(hash(c.key + s, i)))).toFixed(4));
        return {
          market: m,
          timestamp: Date.now(),
          orderbook_units: Array.from({ length: 15 }, (_, i) => ({ ask_price: Number((px + tick * (i + 1)).toFixed(2)), bid_price: Number((px - tick * i).toFixed(2)), ask_size: size('a', i), bid_size: size('b', i) })),
        };
      }),
    };
  }
  const L = ledger();
  if (p === '/v1/accounts') return { body: L.accounts };
  if (p === '/v1/orders/closed') {
    const s = Number(q('start_time')) || 0;
    const e = Number(q('end_time')) || Date.now();
    return { body: L.orders.filter((o) => Date.parse(o.created_at) >= s && Date.parse(o.created_at) <= e).map(({ trades, ...o }) => o) };
  }
  if (p === '/v1/order') return { body: L.orders.find((o) => o.uuid === q('uuid')) ?? {} };
  if (p === '/v1/deposits') return { body: q('page') === '1' || !q('page') ? [...L.deposits].reverse() : [] };
  if (p === '/v1/withdraws') return { body: q('page') === '1' || !q('page') ? [...L.withdraws].reverse() : [] };
  return { status: 404, body: { error: { name: 'demo_not_found', message: `데모 서버에 없는 요청: ${p}` } } };
}

// ---------------------------------------------------------------- fetch hook
// 빗썸 API 2.0 follows 업비트's shape; the demo 빗썸 link only checks the balance.
const HOSTS = { 'openapi.koreainvestment.com': kis, 'openapivts.koreainvestment.com': kis, 'api.upbit.com': upbit, 'api.bithumb.com': upbit };
const realFetch = globalThis.fetch;
globalThis.fetch = async function demoFetch(input, init) {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return realFetch(input, init);
  }
  const handler = HOSTS[url.hostname];
  if (!handler) return realFetch(input, init);
  const r = handler(url);
  return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'content-type': 'application/json; charset=utf-8', ...(r.headers ?? {}) } });
};

module.exports = { KR, US, COINS, KIS_ACCOUNT, USDKRW, ANCHOR, priceAt, stockMeta, dayBar, quoteOf, ledger, smooth, sessionOnOrBefore, parts };
