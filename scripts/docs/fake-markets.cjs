/**
 * Fake sources for the 시장 개요 screenshots: Yahoo Finance spark closes, the SPDR S&P 500
 * holdings sheet, Wikipedia's constituents table, and the government bond yields of FRED,
 * 한국은행 ECOS (817Y002, daily), 일본 재무성, 분데스방크 and 영란은행.
 * Loaded by fake-market.cjs; answers only when PPFP_FAKE_INDICATORS=1.
 *
 * The company list is a short sample of large S&P 500 members with made-up weights, and every
 * price and yield is a deterministic made-up path. None of it is real data.
 */
'use strict';

if (process.env.PPFP_FAKE_INDICATORS === '1') {
  const hash = (s) => {
    let h = 2166136261;
    for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    return (h >>> 0) / 2 ** 32;
  };
  const DAY = 86_400_000;
  const NOW = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
  const iso = (t) => new Date(t).toISOString().slice(0, 10);
  /** Weekdays from `days` ago to yesterday */
  const weekdays = (days) => {
    const out = [];
    for (let t = NOW - days * DAY; t < NOW; t += DAY) {
      const d = new Date(t).getUTCDay();
      if (d !== 0 && d !== 6) out.push(t);
    }
    return out;
  };
  /** A smooth made-up price path per symbol: drift + slow and fast waves */
  const price = (sym, k, n) => {
    const a = hash(sym), b = hash(`${sym}b`), c = hash(`${sym}c`);
    const drift = (a - 0.38) * 0.0012;
    const level = 20 + 400 * b;
    const x = k - n;
    // A little day-to-day noise of its own, so no symbol is an exact mix of the others
    const noise = 0.012 * (hash(`${sym}:${k}`) - 0.5);
    return level * Math.exp(drift * x + 0.12 * Math.sin(x / (40 + 60 * c) + a * 6.28) + 0.04 * Math.sin(x / 9 + b * 6.28) + 0.015 * Math.sin(x / 2.3 + c * 6.28) + noise);
  };

  // ------------------------------------------------------------ S&P 500 sample
  /** [ticker, name, GICS sector, sub-industry, weight %] */
  const SP = [
    ['NVDA', 'NVIDIA', 'Information Technology', 'Semiconductors', 7.6], ['AAPL', 'Apple Inc.', 'Information Technology', 'Technology Hardware, Storage & Peripherals', 6.9],
    ['MSFT', 'Microsoft', 'Information Technology', 'Systems Software', 6.4], ['AVGO', 'Broadcom', 'Information Technology', 'Semiconductors', 2.6],
    ['ORCL', 'Oracle Corporation', 'Information Technology', 'Application Software', 1.0], ['AMD', 'Advanced Micro Devices', 'Information Technology', 'Semiconductors', 0.8],
    ['CRM', 'Salesforce', 'Information Technology', 'Application Software', 0.6], ['CSCO', 'Cisco', 'Information Technology', 'Communications Equipment', 0.6],
    ['IBM', 'IBM', 'Information Technology', 'IT Consulting & Other Services', 0.5], ['MU', 'Micron Technology', 'Information Technology', 'Semiconductors', 0.5],
    ['QCOM', 'Qualcomm', 'Information Technology', 'Semiconductors', 0.4], ['TXN', 'Texas Instruments', 'Information Technology', 'Semiconductors', 0.4],
    ['ADBE', 'Adobe Inc.', 'Information Technology', 'Application Software', 0.4], ['INTC', 'Intel', 'Information Technology', 'Semiconductors', 0.4],
    ['NOW', 'ServiceNow', 'Information Technology', 'Systems Software', 0.4], ['AMAT', 'Applied Materials', 'Information Technology', 'Semiconductor Materials & Equipment', 0.35],
    ['LRCX', 'Lam Research', 'Information Technology', 'Semiconductor Materials & Equipment', 0.3], ['PLTR', 'Palantir Technologies', 'Information Technology', 'Application Software', 0.7],
    ['GOOGL', 'Alphabet Inc. (Class A)', 'Communication Services', 'Interactive Media & Services', 2.3], ['GOOG', 'Alphabet Inc. (Class C)', 'Communication Services', 'Interactive Media & Services', 1.9],
    ['META', 'Meta Platforms', 'Communication Services', 'Interactive Media & Services', 2.9], ['NFLX', 'Netflix', 'Communication Services', 'Movies & Entertainment', 0.8],
    ['T', 'AT&T', 'Communication Services', 'Integrated Telecommunication Services', 0.35], ['VZ', 'Verizon', 'Communication Services', 'Integrated Telecommunication Services', 0.3],
    ['DIS', 'Walt Disney Company (The)', 'Communication Services', 'Movies & Entertainment', 0.35], ['TMUS', 'T-Mobile US', 'Communication Services', 'Wireless Telecommunication Services', 0.3],
    ['AMZN', 'Amazon', 'Consumer Discretionary', 'Broadline Retail', 3.8], ['TSLA', 'Tesla, Inc.', 'Consumer Discretionary', 'Automobile Manufacturers', 2.0],
    ['HD', 'Home Depot (The)', 'Consumer Discretionary', 'Home Improvement Retail', 0.7], ['MCD', "McDonald's", 'Consumer Discretionary', 'Restaurants', 0.4],
    ['BKNG', 'Booking Holdings', 'Consumer Discretionary', 'Hotels, Resorts & Cruise Lines', 0.3], ['LOW', "Lowe's", 'Consumer Discretionary', 'Home Improvement Retail', 0.25],
    ['TJX', 'TJX Companies', 'Consumer Discretionary', 'Apparel Retail', 0.25], ['NKE', 'Nike, Inc.', 'Consumer Discretionary', 'Footwear', 0.15], ['SBUX', 'Starbucks', 'Consumer Discretionary', 'Restaurants', 0.15],
    ['BRK.B', 'Berkshire Hathaway', 'Financials', 'Multi-Sector Holdings', 1.6], ['JPM', 'JPMorgan Chase', 'Financials', 'Diversified Banks', 1.5],
    ['V', 'Visa Inc.', 'Financials', 'Transaction & Payment Processing Services', 1.0], ['MA', 'Mastercard', 'Financials', 'Transaction & Payment Processing Services', 0.8],
    ['BAC', 'Bank of America', 'Financials', 'Diversified Banks', 0.6], ['WFC', 'Wells Fargo', 'Financials', 'Diversified Banks', 0.45], ['GS', 'Goldman Sachs', 'Financials', 'Investment Banking & Brokerage', 0.45],
    ['MS', 'Morgan Stanley', 'Financials', 'Investment Banking & Brokerage', 0.35], ['AXP', 'American Express', 'Financials', 'Consumer Finance', 0.35], ['BLK', 'BlackRock', 'Financials', 'Asset Management & Custody Banks', 0.3],
    ['C', 'Citigroup', 'Financials', 'Diversified Banks', 0.3], ['SPGI', 'S&P Global', 'Financials', 'Financial Exchanges & Data', 0.25], ['PGR', 'Progressive Corporation', 'Financials', 'Property & Casualty Insurance', 0.25],
    ['LLY', 'Lilly (Eli)', 'Health Care', 'Pharmaceuticals', 1.4], ['JNJ', 'Johnson & Johnson', 'Health Care', 'Pharmaceuticals', 0.8], ['ABBV', 'AbbVie', 'Health Care', 'Biotechnology', 0.65],
    ['UNH', 'UnitedHealth Group', 'Health Care', 'Managed Health Care', 0.55], ['MRK', 'Merck & Co.', 'Health Care', 'Pharmaceuticals', 0.4], ['ABT', 'Abbott Laboratories', 'Health Care', 'Health Care Equipment', 0.4],
    ['TMO', 'Thermo Fisher Scientific', 'Health Care', 'Life Sciences Tools & Services', 0.35], ['ISRG', 'Intuitive Surgical', 'Health Care', 'Health Care Equipment', 0.3], ['AMGN', 'Amgen', 'Health Care', 'Biotechnology', 0.3],
    ['PFE', 'Pfizer', 'Health Care', 'Pharmaceuticals', 0.25], ['GILD', 'Gilead Sciences', 'Health Care', 'Biotechnology', 0.25], ['DHR', 'Danaher Corporation', 'Health Care', 'Life Sciences Tools & Services', 0.2],
    ['GE', 'GE Aerospace', 'Industrials', 'Aerospace & Defense', 0.5], ['CAT', 'Caterpillar Inc.', 'Industrials', 'Construction Machinery & Heavy Transportation Equipment', 0.5], ['RTX', 'RTX Corporation', 'Industrials', 'Aerospace & Defense', 0.4],
    ['UBER', 'Uber', 'Industrials', 'Passenger Ground Transportation', 0.3], ['BA', 'Boeing', 'Industrials', 'Aerospace & Defense', 0.3], ['HON', 'Honeywell', 'Industrials', 'Industrial Conglomerates', 0.25],
    ['UNP', 'Union Pacific Corporation', 'Industrials', 'Rail Transportation', 0.25], ['DE', 'Deere & Company', 'Industrials', 'Agricultural & Farm Machinery', 0.2], ['ETN', 'Eaton Corporation', 'Industrials', 'Electrical Components & Equipment', 0.25],
    ['LMT', 'Lockheed Martin', 'Industrials', 'Aerospace & Defense', 0.18], ['UPS', 'United Parcel Service', 'Industrials', 'Air Freight & Logistics', 0.12],
    ['WMT', 'Walmart', 'Consumer Staples', 'Consumer Staples Merchandise Retail', 1.0], ['COST', 'Costco', 'Consumer Staples', 'Consumer Staples Merchandise Retail', 0.75], ['PG', 'Procter & Gamble', 'Consumer Staples', 'Personal Care Products', 0.6],
    ['KO', 'Coca-Cola Company (The)', 'Consumer Staples', 'Soft Drinks & Non-alcoholic Beverages', 0.45], ['PEP', 'PepsiCo', 'Consumer Staples', 'Soft Drinks & Non-alcoholic Beverages', 0.3], ['PM', 'Philip Morris International', 'Consumer Staples', 'Tobacco', 0.4],
    ['MO', 'Altria', 'Consumer Staples', 'Tobacco', 0.15], ['MDLZ', 'Mondelez International', 'Consumer Staples', 'Packaged Foods & Meats', 0.12],
    ['XOM', 'ExxonMobil', 'Energy', 'Integrated Oil & Gas', 0.8], ['CVX', 'Chevron Corporation', 'Energy', 'Integrated Oil & Gas', 0.5], ['COP', 'ConocoPhillips', 'Energy', 'Oil & Gas Exploration & Production', 0.2],
    ['EOG', 'EOG Resources', 'Energy', 'Oil & Gas Exploration & Production', 0.1], ['SLB', 'Schlumberger', 'Energy', 'Oil & Gas Equipment & Services', 0.1], ['WMB', 'Williams Companies', 'Energy', 'Oil & Gas Storage & Transportation', 0.12],
    ['NEE', 'NextEra Energy', 'Utilities', 'Multi-Utilities', 0.3], ['SO', 'Southern Company', 'Utilities', 'Electric Utilities', 0.18], ['DUK', 'Duke Energy', 'Utilities', 'Electric Utilities', 0.17],
    ['CEG', 'Constellation Energy', 'Utilities', 'Independent Power Producers & Energy Traders', 0.18], ['VST', 'Vistra Corp.', 'Utilities', 'Independent Power Producers & Energy Traders', 0.12],
    ['PLD', 'Prologis', 'Real Estate', 'Industrial REITs', 0.18], ['AMT', 'American Tower', 'Real Estate', 'Telecom Tower REITs', 0.15], ['EQIX', 'Equinix', 'Real Estate', 'Data Center REITs', 0.13],
    ['WELL', 'Welltower', 'Real Estate', 'Health Care REITs', 0.15], ['SPG', 'Simon Property Group', 'Real Estate', 'Retail REITs', 0.1], ['O', 'Realty Income', 'Real Estate', 'Retail REITs', 0.09],
    ['LIN', 'Linde plc', 'Materials', 'Industrial Gases', 0.35], ['SHW', 'Sherwin-Williams', 'Materials', 'Specialty Chemicals', 0.15], ['APD', 'Air Products', 'Materials', 'Industrial Gases', 0.1],
    ['FCX', 'Freeport-McMoRan', 'Materials', 'Copper', 0.12], ['NEM', 'Newmont', 'Materials', 'Gold', 0.14], ['ECL', 'Ecolab', 'Materials', 'Specialty Chemicals', 0.1],
  ];

  async function holdingsXlsx() {
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('holdings');
    ws.addRow(['Fund Name:', 'SPDR S&P 500 ETF Trust (데모)']);
    ws.addRow(['Ticker Symbol:', 'SPY']);
    ws.addRow([]);
    ws.addRow(['Name', 'Ticker', 'Identifier', 'SEDOL', 'Weight', 'Sector', 'Shares Held', 'Local Currency']);
    for (const [t, n, , , w] of SP) ws.addRow([n.toUpperCase(), t, '-', '-', w, '-', 1000, 'USD']);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }
  const esc = (s) => s.replace(/&/g, '&amp;');
  const wikiHtml = () =>
    `<html><body><table class="wikitable" id="constituents"><tbody><tr><th>Symbol</th><th>Security</th><th>GICS Sector</th><th>GICS Sub-Industry</th><th>Headquarters Location</th><th>Date added</th><th>CIK</th><th>Founded</th></tr>\n${SP.map(([t, n, s, i]) => `<tr><td><a href="#">${t}</a></td><td><a href="#">${esc(n)}</a></td><td>${esc(s)}</td><td>${esc(i)}</td><td>-</td><td>2000-01-01</td><td>0000000000</td><td>1900</td></tr>`).join('\n')}</tbody></table></body></html>`;

  // ------------------------------------------------------------ spark
  const spark = (url) => {
    const syms = (url.searchParams.get('symbols') ?? '').split(',').filter(Boolean);
    const days = url.searchParams.get('range') === '5y' ? 1830 : 735;
    const ts = weekdays(days);
    const out = {};
    for (const s of syms) {
      // An unknown KOSDAQ twin of a KOSPI code: nothing, as Yahoo answers
      if (/\.KQ$/.test(s) && hash(s) < 0.8) {
        out[s] = { symbol: s, timestamp: null, close: null };
        continue;
      }
      out[s] = { symbol: s, timestamp: ts.map((t) => t / 1000 + 14.5 * 3600), close: ts.map((_, k) => Number(price(s, k, ts.length).toFixed(4))), dataGranularity: 300 };
    }
    return out;
  };

  // ------------------------------------------------------------ yields
  /** country → [level, slope per year of maturity (log), amplitude] */
  const YC = { US: [3.9, 0.35, 1.4], KR: [2.9, 0.3, 1.0], JP: [0.6, 0.55, 0.5], DE: [2.0, 0.4, 1.2], UK: [3.8, 0.35, 1.3] };
  const yieldAt = (c, years, t) => {
    const [level, slope, amp] = YC[c];
    const x = t / DAY;
    const cyc = Math.sin(x / 700 + hash(c) * 6.28);
    // The curve flattens and inverts when the cycle is high
    return Math.max(0.05, level + amp * cyc + slope * Math.log(years) * (1 - 1.2 * Math.max(0, cyc)) + 0.05 * Math.sin(x / 120 + years));
  };
  const dailyFrom = (from) => weekdays(Math.round((NOW - Date.parse(`${from}T00:00:00Z`)) / DAY));
  const YEARS = { DGS1: 1, DGS2: 2, DGS3: 3, DGS5: 5, DGS7: 7, DGS10: 10, DGS20: 20, DGS30: 30, '010190000': 1, '010195000': 2, '010200000': 3, '010200001': 5, '010210000': 10, '010220000': 20, '010230000': 30, R01XX: 1, R02XX: 2, R03XX: 3, R05XX: 5, R10XX: 10, R20XX: 20, R30XX: 30, IUDSNPY: 5, IUDMNPY: 10, IUDLNPY: 20 };
  const f3 = (v) => v.toFixed(3);

  const fredMulti = (ids, from) => [`observation_date,${ids.join(',')}`, ...dailyFrom(from).map((t) => `${iso(t)},${ids.map((id) => f3(yieldAt('US', YEARS[id] ?? 10, t))).join(',')}`)].join('\n');
  const ecosDaily = (item) => {
    const row = dailyFrom('2000-01-01').map((t) => ({ STAT_CODE: '817Y002', TIME: iso(t).replace(/-/g, ''), DATA_VALUE: f3(yieldAt('KR', YEARS[item] ?? 3, t)) }));
    return { StatisticSearch: { list_total_count: row.length, row } };
  };
  const mof = (current) => {
    const tenors = ['1Y', '2Y', '3Y', '4Y', '5Y', '6Y', '7Y', '8Y', '9Y', '10Y', '15Y', '20Y', '25Y', '30Y', '40Y'];
    const monthStart = Date.UTC(new Date(NOW).getUTCFullYear(), new Date(NOW).getUTCMonth(), 1);
    const days = dailyFrom('2000-01-01').filter((t) => (current ? t >= monthStart : t < monthStart));
    const d = (t) => { const x = new Date(t); return `${x.getUTCFullYear()}/${x.getUTCMonth() + 1}/${x.getUTCDate()}`; };
    return ['Interest Rate,,,,,,,,,,,,,,,(Unit : %)', `Date,${tenors.join(',')}`, ...days.map((t) => `${d(t)},${tenors.map((n) => f3(yieldAt('JP', Number(n.slice(0, -1)), t))).join(',')}`)].join('\n');
  };
  const bbk = (codes) => {
    const id = (c) => `BBSIS.D.I.ZST.ZI.EUR.S1311.B.A604.${c}.R.A.A._Z._Z.A`;
    return ['﻿""', ...codes.flatMap((c) => [id(c), `${id(c)}_FLAGS`])].join(',') + '\n' + ['unit,' + codes.map(() => 'Prozent,').join(','), ...dailyFrom('2000-01-01').map((t) => `${iso(t)},${codes.map((c) => `${(yieldAt('DE', YEARS[c], t)).toFixed(2)},`).join(',')}`)].join('\n');
  };
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const boe = (codes) => [`DATE,${codes.join(',')}`, ...dailyFrom('2000-01-01').map((t) => { const x = new Date(t); return `${String(x.getUTCDate()).padStart(2, '0')} ${MON[x.getUTCMonth()]} ${x.getUTCFullYear()},${codes.map((c) => (yieldAt('UK', YEARS[c], t)).toFixed(4)).join(',')}`; })].join('\n');


  // ------------------------------------------------------------ 글로벌 매크로
  const ISOS = ['USA', 'KOR', 'JPN', 'CHN', 'DEU', 'GBR', 'FRA', 'ITA', 'ESP', 'CAN', 'AUS', 'IND', 'BRA', 'MEX', 'IDN', 'TUR', 'ZAF'];
  const months = (from) => {
    const out = [];
    const d = new Date(`${from}-01T00:00:00Z`);
    const end = new Date(NOW);
    end.setUTCMonth(end.getUTCMonth() - 1);
    while (d <= end) {
      out.push(d.toISOString().slice(0, 7));
      d.setUTCMonth(d.getUTCMonth() + 1);
    }
    return out;
  };
  const oecdCsv = () => {
    const lines = ['STRUCTURE,STRUCTURE_ID,ACTION,REF_AREA,Reference area,FREQ,MEASURE,TIME_PERIOD,OBS_VALUE'];
    for (const iso of ISOS) months('2015-01').forEach((m, k) => {
      const v = 100 + 1.6 * Math.sin(k / 9 + hash(iso) * 6.28) + 0.4 * Math.sin(k / 3.1 + hash(`${iso}b`) * 6.28);
      lines.push(`DATAFLOW,X,I,${iso},${iso},M,LI,${m},${v.toFixed(4)}`);
    });
    return lines.join('\n');
  };
  const WB = { 'NY.GDP.MKTP.KD.ZG': [2.5, 2.5], 'FP.CPI.TOTL.ZG': [3, 3], 'SL.UEM.TOTL.ZS': [5.5, 4], 'GC.DOD.TOTL.GD.ZS': [70, 50], 'BN.CAB.XOKA.GD.ZS': [0, 4] };
  const worldBank = (url) => {
    const code = url.pathname.split('/indicator/')[1];
    const [level, amp] = WB[code] ?? [1, 1];
    const isos = (url.pathname.split('/country/')[1] ?? '').split('/')[0].split(';');
    const y = new Date(NOW).getUTCFullYear();
    const rows = isos.flatMap((iso) => [y - 1, y - 2, y - 3].map((yr) => ({ countryiso3code: iso, date: String(yr), value: yr === y - 1 && hash(`${iso}${code}`) < 0.3 ? null : Number((level + amp * (hash(`${iso}${code}${yr}`) * 2 - 1)).toFixed(2)) })));
    return [{ page: 1, pages: 1, total: rows.length }, rows];
  };
  const COT = ['13874A', '209742', '1170E1', '042601', '043602', '098662', '099741', '097741', '088691', '084691', '085692', '067651', '133741'];
  const cftc = () => {
    const rows = [];
    for (const code of COT) {
      const oi = 200000 + hash(code) * 800000;
      for (let w = 0; w < 320; w++) {
        const t = NOW - (w * 7 + ((new Date(NOW).getUTCDay() + 5) % 7)) * DAY;
        const net = oi * (0.25 * Math.sin(w / 20 + hash(code) * 6.28) + 0.08 * Math.sin(w / 5));
        rows.push({ cftc_contract_market_code: code, report_date_as_yyyy_mm_dd: `${iso(t)}T00:00:00.000`, open_interest_all: String(Math.round(oi)), noncomm_positions_long_all: String(Math.round(oi * 0.3 + Math.max(0, net))), noncomm_positions_short_all: String(Math.round(oi * 0.3 + Math.max(0, -net))) });
      }
    }
    return rows;
  };
  const quarters = (from) => months(from).filter((m) => ['01', '04', '07', '10'].includes(m.slice(5))).slice(0, -1);
  const GDP_US = { DPCERY2Q224SBEA: [1.6, 1.0], A007RY2Q224SBEA: [0.6, 0.9], A014RY2Q224SBEA: [0, 1.2], A822RY2Q224SBEA: [0.4, 0.3], A019RY2Q224SBEA: [-0.3, 0.9] };
  const gdpPart = (code, k) => {
    const [level, amp] = GDP_US[code] ?? [0, 1];
    return level + amp * Math.sin(k / 2.3 + hash(code) * 6.28);
  };
  const fredGdp = (id) => {
    const lines = [`observation_date,${id}`];
    quarters('2010-01').forEach((m, k) => {
      const v = id === 'A191RL1Q225SBEA' ? Object.keys(GDP_US).reduce((a, c) => a + gdpPart(c, k), 0) : gdpPart(id, k);
      lines.push(`${m}-01,${v.toFixed(2)}`);
    });
    return lines.join('\n');
  };
  const KR_PARTS = { 1010110: [0.3, 0.3], 1010120: [0.15, 0.1], 1020111: [-0.05, 0.4], 1020112: [0.1, 0.4], 1020113: [0.05, 0.05], 1020120: [0, 0.4], 1060150: [0.1, 0.6] };
  const ecosGdp = (item) => {
    const [level, amp] = KR_PARTS[item] ?? [0, 0.2];
    const row = quarters('2010-01').map((m, k) => ({ STAT_CODE: '200Y125', TIME: `${m.slice(0, 4)}Q${(Number(m.slice(5)) + 2) / 3}`, DATA_VALUE: (level + amp * Math.sin(k / 2.1 + hash(String(item)) * 6.28)).toFixed(1) }));
    return { StatisticSearch: { list_total_count: row.length, row } };
  };

  const text = (body, type = 'text/csv') => new Response(body, { status: 200, headers: { 'content-type': type } });
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async function marketsDemoFetch(input, init) {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    let url;
    try {
      url = new URL(raw);
    } catch {
      return prevFetch(input, init);
    }
    if (url.hostname === 'sdmx.oecd.org' && url.pathname.includes('DF_CLI')) return text(oecdCsv());
    if (url.hostname === 'api.worldbank.org') return text(JSON.stringify(worldBank(url)), 'application/json');
    if (url.hostname === 'publicreporting.cftc.gov') return text(JSON.stringify(cftc()), 'application/json');
    if (url.hostname === 'fred.stlouisfed.org' && (url.searchParams.get('id') === 'A191RL1Q225SBEA' || GDP_US[url.searchParams.get('id')])) return text(fredGdp(url.searchParams.get('id')));
    if (url.hostname === 'ecos.bok.or.kr' && url.pathname.includes('/200Y125/Q/')) return text(JSON.stringify(ecosGdp(url.pathname.split('/').at(-1))), 'application/json');
    if (url.hostname === 'query1.finance.yahoo.com' && url.pathname === '/v8/finance/spark') return text(JSON.stringify(spark(url)), 'application/json');
    if (url.hostname === 'www.ssga.com' && url.pathname.endsWith('holdings-daily-us-en-spy.xlsx')) return new Response(await holdingsXlsx(), { status: 200, headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } });
    if (url.hostname === 'en.wikipedia.org' && url.pathname === '/wiki/List_of_S%26P_500_companies') return text(wikiHtml(), 'text/html');
    if (url.hostname === 'fred.stlouisfed.org' && (url.searchParams.get('id') ?? '').includes(',')) return text(fredMulti(url.searchParams.get('id').split(','), url.searchParams.get('cosd') ?? '2000-01-01'));
    if (url.hostname === 'ecos.bok.or.kr' && url.pathname.includes('/817Y002/D/')) return text(JSON.stringify(ecosDaily(url.pathname.split('/').at(-1))), 'application/json');
    if (url.hostname === 'www.mof.go.jp' && url.pathname.endsWith('jgbcme_all.csv')) return text(mof(false));
    if (url.hostname === 'www.mof.go.jp' && url.pathname.endsWith('jgbcme.csv')) return text(mof(true));
    if (url.hostname === 'api.statistiken.bundesbank.de') return text(bbk(/A604\.([^.]+)\.R\./.exec(url.pathname)?.[1].split('+') ?? ['R10XX']));
    if (url.hostname === 'www.bankofengland.co.uk' && url.pathname.includes('_iadb-fromshowcolumns')) return text(boe((url.searchParams.get('SeriesCodes') ?? 'IUDMNPY').split(',')));
    return prevFetch(input, init);
  };
}
