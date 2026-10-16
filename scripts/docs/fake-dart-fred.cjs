/**
 * Fake OpenDART and FRED API for the 종목 분석 (한국 종목) and 경제 지표 일정 · 내 지표 시트
 * screenshots. Loaded by fake-market.cjs; answers only when PPFP_FAKE_INDICATORS=1.
 *
 * One made-up company (데모전자, 999990) with smooth made-up statements, filings and holdings,
 * a made-up release calendar and search results. None of it is real data.
 */
'use strict';

if (process.env.PPFP_FAKE_INDICATORS === '1') {
  const zlib = require('node:zlib');
  const CORP = '00999990';
  const STOCK = '999990';
  const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });

  function zip(name, content) {
    const data = zlib.deflateRawSync(Buffer.from(content));
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0);
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(8, 8);
    h.writeUInt32LE(data.length, 18);
    h.writeUInt32LE(Buffer.byteLength(content), 22);
    h.writeUInt16LE(name.length, 26);
    return Buffer.concat([h, Buffer.from(name), data]);
  }
  const corpXml = `<?xml version="1.0" encoding="UTF-8"?><result><list><corp_code>${CORP}</corp_code><corp_name>데모전자</corp_name><corp_eng_name>DEMO ELECTRONICS</corp_eng_name><stock_code>${STOCK}</stock_code><modify_date>20260101</modify_date></list></result>`;

  /** Quarterly revenue in won (trillions), growing with a cycle; q counts from 2022Q1 */
  const rev = (q) => Math.round((60 + q * 2.2 + 8 * Math.sin(q / 2)) * 1e12);
  const opm = (q) => 0.08 + 0.06 * Math.sin(q / 3 + 1);
  const qIndex = (y, n) => (y - 2022) * 4 + (n - 1);
  const n0 = (v) => String(Math.round(v));
  const NOW = new Date();
  const lastQ = (() => {
    // Reports are out about 45 days after a quarter
    const t = new Date(NOW.getTime() - 50 * 86_400_000);
    return { y: t.getUTCFullYear(), n: Math.floor(t.getUTCMonth() / 3) };
  })();
  const filed = (y, n) => y < lastQ.y || (y === lastQ.y && n <= lastQ.n);

  function statements(year, codeIn) {
    const code = String(codeIn);
    const n = { 11013: 1, 11012: 2, 11014: 3, 11011: 4 }[Number(code)];
    if (!filed(year, n)) return null;
    const q = qIndex(year, n);
    const inYear = Array.from({ length: n }, (_, k) => qIndex(year, k + 1));
    const sum = (f) => inYear.reduce((a, i) => a + f(i), 0);
    const r = (i) => rev(i), op = (i) => rev(i) * opm(i), ni = (i) => rev(i) * opm(i) * 0.82;
    const own = (f) => (code === '11011' ? sum(f) : f(q));
    const cum = (f) => sum(f);
    const bs = (k) => (900 + q * 18) * k * 1e12;
    const prevYear = (f) => Array.from({ length: 4 }, (_, k) => qIndex(year - 1, k + 1)).reduce((a, i) => a + f(i), 0);
    const prev2 = (f) => Array.from({ length: 4 }, (_, k) => qIndex(year - 2, k + 1)).reduce((a, i) => a + f(i), 0);
    const line = (sj, id, nm, th, add, fr, bf) => ({ rcept_no: `${year}${code}`, reprt_code: String(code), bsns_year: String(year), corp_code: CORP, sj_div: sj, account_id: id, account_nm: nm, thstrm_amount: n0(th), thstrm_add_amount: add === undefined ? undefined : n0(add), frmtrm_amount: fr === undefined ? undefined : n0(fr), bfefrmtrm_amount: bf === undefined ? undefined : n0(bf) });
    const fy = code === '11011';
    return [
      line('IS', 'ifrs-full_Revenue', '매출액', own(r), cum(r), fy ? prevYear(r) : undefined, fy ? prev2(r) : undefined),
      line('IS', 'ifrs-full_GrossProfit', '매출총이익', own((i) => r(i) * 0.38), cum((i) => r(i) * 0.38), fy ? prevYear((i) => r(i) * 0.38) : undefined, fy ? prev2((i) => r(i) * 0.38) : undefined),
      line('IS', 'dart_OperatingIncomeLoss', '영업이익', own(op), cum(op), fy ? prevYear(op) : undefined, fy ? prev2(op) : undefined),
      line('IS', 'ifrs-full_ProfitLossAttributableToOwnersOfParent', '지배기업의 소유주에게 귀속되는 당기순이익', own(ni), cum(ni), fy ? prevYear(ni) : undefined, fy ? prev2(ni) : undefined),
      line('IS', 'ifrs-full_BasicEarningsLossPerShare', '기본주당이익', own(ni) / 5.9e9, undefined, fy ? prevYear(ni) / 5.9e9 : undefined, fy ? prev2(ni) / 5.9e9 : undefined),
      line('CF', 'ifrs-full_CashFlowsFromUsedInOperatingActivities', '영업활동현금흐름', cum((i) => r(i) * 0.2), undefined, fy ? prevYear((i) => r(i) * 0.2) : undefined, fy ? prev2((i) => r(i) * 0.2) : undefined),
      line('CF', 'ifrs-full_PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities', '유형자산의 취득', cum((i) => r(i) * 0.12), undefined, fy ? prevYear((i) => r(i) * 0.12) : undefined, fy ? prev2((i) => r(i) * 0.12) : undefined),
      line('CF', 'ifrs-full_DividendsPaidClassifiedAsFinancingActivities', '배당금의 지급', cum((i) => r(i) * 0.012), undefined, fy ? prevYear((i) => r(i) * 0.012) : undefined, fy ? prev2((i) => r(i) * 0.012) : undefined),
      line('BS', 'ifrs-full_CashAndCashEquivalents', '현금및현금성자산', bs(0.1), undefined, bs(0.09), bs(0.085)),
      line('BS', 'ifrs-full_Assets', '자산총계', bs(1), undefined, bs(0.93), bs(0.87)),
      line('BS', 'ifrs-full_Liabilities', '부채총계', bs(0.25), undefined, bs(0.24), bs(0.23)),
      line('BS', 'ifrs-full_EquityAttributableToOwnersOfParent', '지배기업의 소유주에게 귀속되는 자본', bs(0.72), undefined, bs(0.67), bs(0.62)),
      line('BS', 'ifrs-full_LongtermBorrowings', '장기차입금', bs(0.012), undefined, bs(0.011), bs(0.01)),
    ];
  }

  const ymd = (t) => new Date(t).toISOString().slice(0, 10).replace(/-/g, '');
  const DAY = 86_400_000;
  const TITLES = ['분기보고서 (2026.06)', '주요사항보고서(자기주식취득결정)', '연결재무제표기준영업(잠정)실적(공정공시)', '임원ㆍ주요주주특정증권등소유상황보고서', '기업설명회(IR)개최(안내공시)', '현금ㆍ현물배당결정', '단일판매ㆍ공급계약체결', '최대주주등소유주식변동신고서', '반기보고서 (2026.06)', '임원ㆍ주요주주특정증권등소유상황보고서'];
  const disclosures = () => TITLES.map((t, i) => ({ corp_code: CORP, corp_name: '데모전자', stock_code: STOCK, report_nm: t, rcept_no: `2026${String(900000 + i)}`, flr_nm: /임원/.test(t) ? `데모임원${(i % 3) + 1}` : '데모전자', rcept_dt: ymd(Date.now() - (i * 9 + 2) * DAY) }));
  const elestock = () =>
    [
      ['데모임원1', '대표이사', '-', 120000, 20000, 0.02, 0.0],
      ['데모임원2', '부사장', '-', 35000, -5000, 0.01, -0.0],
      ['데모재단', '-', '10%이상주주', 590000000, 1500000, 10.02, 0.03],
      ['데모임원3', '전무', '-', 18000, 3000, 0.0, 0.0],
    ].map(([repror, ofcps, main, cnt, irds, rate, irate], i) => ({ rcept_no: `2026${String(910000 + i)}`, rcept_dt: ymd(Date.now() - (i * 15 + 5) * DAY), corp_code: CORP, corp_name: '데모전자', repror, isu_exctv_rgist_at: '등기임원', isu_exctv_ofcps: ofcps, isu_main_shrholdr: main, sp_stock_lmp_cnt: String(cnt), sp_stock_lmp_irds_cnt: String(irds), sp_stock_lmp_rate: String(rate), sp_stock_lmp_irds_rate: String(irate) }));

  // ------------------------------------------------------------ FRED API
  const RELEASES = [
    [10, 'Consumer Price Index', 12], [9, 'Advance Monthly Sales for Retail and Food Services', 15], [46, 'Producer Price Index', 13], [180, 'Unemployment Insurance Weekly Claims Report', 0],
    [13, 'G.17 Industrial Production and Capacity Utilization', 16], [27, 'New Residential Construction', 18], [91, 'Surveys of Consumers', 23], [95, "Manufacturer's Shipments, Inventories, and Orders (M3) Survey", 26],
    [53, 'Gross Domestic Product', 29], [54, 'Personal Income and Outlays', 30], [192, 'Job Openings and Labor Turnover Survey', 34], [50, 'Employment Situation', 37], [441, 'Coinbase Cryptocurrencies', 1],
  ];
  const releaseDates = () => {
    const start = Date.now() - 6 * DAY;
    const out = [];
    for (const [id, name, day] of RELEASES) {
      if (id === 180) for (let w = 0; w < 6; w++) out.push({ release_id: id, release_name: name, date: new Date(start + (w * 7 + 1) * DAY).toISOString().slice(0, 10) });
      else out.push({ release_id: id, release_name: name, date: new Date(start + day * DAY).toISOString().slice(0, 10) });
    }
    out.sort((a, b) => a.date.localeCompare(b.date));
    return { realtime_start: '', count: out.length, offset: 0, limit: 1000, release_dates: out };
  };
  const seriesSearch = (q) => ({
    seriess: [
      { id: 'XTEXVA01KRM667N', title: 'International Merchandise Trade Statistics: Exports: Commodities for Korea', units_short: 'US $', frequency_short: 'M', popularity: 14 },
      { id: 'DCOILWTICO', title: 'Crude Oil Prices: West Texas Intermediate (WTI)', units_short: '$ per Barrel', frequency_short: 'D', popularity: 80 },
      { id: 'MORTGAGE30US', title: '30-Year Fixed Rate Mortgage Average in the United States', units_short: '%', frequency_short: 'W', popularity: 90 },
    ].filter((s) => !q || s.title.toLowerCase().includes(q.split(' ')[0].toLowerCase()) || q.length > 0),
  });

  const prevFetch = globalThis.fetch;
  globalThis.fetch = async function dartFredDemoFetch(input, init) {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    let url;
    try {
      url = new URL(raw);
    } catch {
      return prevFetch(input, init);
    }
    if (url.hostname === 'opendart.fss.or.kr') {
      const p = url.pathname.replace('/api/', '');
      const q = (k) => url.searchParams.get(k);
      if (p === 'corpCode.xml') return new Response(zip('CORPCODE.xml', corpXml), { status: 200, headers: { 'content-type': 'application/zip' } });
      if (p === 'fnlttSinglAcntAll.json') {
        if (q('fs_div') !== 'CFS') return json({ status: '013', message: '조회된 데이타가 없습니다.' });
        const rows = statements(Number(q('bsns_year')), Number(q('reprt_code')));
        return json(rows ? { status: '000', message: '정상', list: rows } : { status: '013', message: '조회된 데이타가 없습니다.' });
      }
      if (p === 'list.json') return json({ status: '000', message: '정상', list: disclosures() });
      if (p === 'elestock.json') return json({ status: '000', message: '정상', list: elestock() });
      if (p === 'stockTotqySttus.json') return json({ status: '000', message: '정상', list: [{ se: '보통주', istc_totqy: '5,969,782,550', tesstk_co: '70,000,000', distb_stock_co: '5,899,782,550' }] });
      return json({ status: '013', message: '조회된 데이타가 없습니다.' });
    }
    if (url.hostname === 'api.stlouisfed.org') {
      if (url.pathname === '/fred/releases/dates') return json(releaseDates());
      if (url.pathname === '/fred/series/search') return json(seriesSearch(url.searchParams.get('search_text') ?? ''));
      if (url.pathname === '/fred/series') return json({ seriess: [{ id: 'GDP' }] });
    }
    return prevFetch(input, init);
  };
}
