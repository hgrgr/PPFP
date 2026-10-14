/**
 * Fake FRED, 한국은행 ECOS, 통계청 KOSIS and New York Fed ACM file for the 분석 지표 screenshots.
 * Loaded by fake-market.cjs; answers only when PPFP_FAKE_INDICATORS=1 (the capture script sets
 * it), so a local demo still reads the real FRED and ACM data.
 *
 * Every series follows a smooth deterministic path around a plausible level, so the charts
 * look like what they stand for. None of it is real data.
 */
'use strict';

if (process.env.PPFP_FAKE_INDICATORS === '1') {
  const hash = (s) => {
    let h = 2166136261;
    for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    return (h >>> 0) / 2 ** 32;
  };
  /** A wavy path: level + slow cycles, deterministic per key; t in months since 2000-01 */
  const wave = (key, t, level, amp, trend = 0) => {
    const a = hash(key) * 6.28, b = hash(`${key}b`) * 6.28;
    return level + trend * t + amp * (0.7 * Math.sin(t / 37 + a) + 0.3 * Math.sin(t / 11 + b));
  };
  const NOW = new Date();
  const lastMonth = NOW.getUTCFullYear() * 12 + NOW.getUTCMonth() - 1; // the previous month is the latest
  const monthsFrom = (y, m) => {
    const out = [];
    for (let k = y * 12 + (m - 1); k <= lastMonth; k++) out.push([Math.floor(k / 12), (k % 12) + 1, k - 2000 * 12]);
    return out;
  };
  const pad = (n) => String(n).padStart(2, '0');

  // ------------------------------------------------------------ FRED
  /** id → [level, amplitude, trend per month] */
  const FRED = {
    DGS10: [3.4, 1.1, 0.004], DFII10: [0.9, 0.9, 0.004], T10YIE: [2.2, 0.35, 0], T5YIFR: [2.25, 0.2, 0],
    DGS3MO: [2.4, 2.0, 0.003], T10Y3M: [1.0, 1.3, -0.002], T10Y2Y: [0.8, 1.0, -0.002], DFF: [2.2, 2.0, 0.003], MORTGAGE30US: [5.6, 1.2, 0.002],
    BAMLH0A0HYM2: [4.6, 1.6, -0.004], VIXCLS: [19, 6, -0.005], NFCI: [-0.35, 0.3, 0],
    DTWEXBGS: [112, 6, 0.02], DGS2: [3.0, 1.2, 0.004], DEXKOUS: [1250, 80, 0.4], PCEPILFE: [100, 1.5, 0.22], SAHMREALTIME: [0.15, 0.25, 0], IC4WSA: [230000, 30000, -40],
    DRTSCILM: [5, 15, 0], WALCL: [6500000, 1200000, 6000], WTREGEN: [600000, 250000, 1000], RRPONTSYD: [500, 700, -1], WRESBAL: [2800000, 600000, 4000],
    MMMFFAQ027S: [5000000, 600000, 18000], WRMFNS: [1600, 300, 7], BOGZ1FL663067003Q: [450000, 90000, 1200],
    QKRHAM770A: [75, 6, 0.08], QUSHAM770A: [84, 8, -0.07], QKRPAM770A: [180, 12, 0.12], NCBEILQ027S: [25000000, 4000000, 230000], GDP: [14000, 300, 70],
  };
  const fredCsv = (url) => {
    const id = url.searchParams.get('id') ?? 'X';
    const [level, amp, trend] = FRED[id] ?? [100, 10, 0.1];
    const quarterly = /^Q|^NCBEI|^GDP$|^MMMFFAQ|^BOGZ|^DRTSC/.test(id);
    const lines = [`observation_date,${id}`];
    for (const [y, m, t] of monthsFrom(1995, 1)) {
      if (quarterly && (m - 1) % 3) continue;
      lines.push(`${y}-${pad(m)}-01,${wave(id, t, level, amp, trend).toFixed(3)}`);
    }
    return lines.join('\n');
  };

  // ------------------------------------------------------------ ECOS
  const ECOS = {
    '722Y001/0101000': [2.2, 1.0, 0.0], '721Y001/5020000': [2.6, 1.0, 0], '721Y001/5050000': [3.0, 1.0, 0], '511Y003/FMB': [2.8, 0.6, 0],
    '121Y006/BECBLA0302': [3.9, 1.0, 0], '901Y009/0': [92, 1.2, 0.17], '161Y005/BBHS00': [1000000, 40000, 13000], '901Y062/P63AC': [60, 4, 0.22], '901Y062/P63ACA': [55, 5, 0.27],
    '901Y067/I16E': [100.5, 2.5, 0], '901Y067/I16D': [99.8, 2, 0], '901Y118/T002': [50000000, 6000000, 90000], '514Y001/AA': [0, 12, 0], '514Y001/AA04': [-2, 15, 0],
    '901Y063/P64AC': [60, 4, 0.2], '901Y063/P64ACA': [55, 5, 0.25], '721Y001/7020000': [3.4, 1.0, 0], '721Y001/7030000': [9.5, 1.2, 0], '721Y001/4020000': [2.9, 1.0, 0], '721Y001/2010000': [2.6, 1.0, 0],
    '901Y103/1': [4000000, 1200000, 0], '161Y008/BBGA04': [110000, 40000, 450], '161Y008/BBGA02': [250000, 30000, 1200], '161Y008/BBGA03': [600000, 60000, 2500], '104Y015/BDAA31': [700000, 80000, 2800],
    '901Y056/S23A': [55e12, 15e12, 2.5e11], '901Y056/S23E': [18e12, 5e12, 6e10], '901Y056/S23D': [3e11, 1.5e11, 0], '901Y055/S22CB': [500000, 3000000, 0], '901Y055/S22CC': [-300000, 2500000, 0], '901Y055/S22CA': [-200000, 1500000, 0],
    '511Y002/FMFB': [108, 14, 0], '901Y014/1110000': [13, 3, 0], '151Y001/1000000': [500000, 20000, 6500],
  };
  const ecosRows = (url) => {
    const parts = url.pathname.split('/'); // /api/StatisticSearch/KEY/json/kr/1/10000/STAT/CYCLE/FROM/TO/ITEMS...
    const [stat, cycle, from, to, ...items] = parts.slice(8);
    const key = `${stat}/${items.join('/')}`;
    let [level, amp, trend] = ECOS[`${stat}/${items[0]}`] ?? [100, 8, 0.05];
    // Regional tables: scale by the region so 서울 and 지방 differ
    const region = items.find((i) => /^(REG|H[A-Z]{3}|B05|I410|[A-Z]{3}$)/.test(i)) ?? '';
    const big = /REG11|HSEO|B0511|I410B|SEO/.test(region) ? 1 : /REG00|HALL|B0500|I410A|ALL/.test(region) ? 4 : 0.6;
    if (stat === '291Y524') [level, amp, trend] = [1500000 * big, 60000 * big, 0];
    if (stat === '901Y106') [level, amp, trend] = [3700 * big, 50 * big, 0];
    if (stat === '903Y201' || stat === '903Y001' || stat === '903Y206' || stat === '903Y006') [level, amp, trend] = [5600, 300, 0];
    if (stat === '901Y074') [level, amp, trend] = [2500 * big, 1800 * big, 0];
    if (stat === '901Y105') [level, amp, trend] = [6000 * big, 2500 * big, 0];
    const rows = [];
    const push = (time, t, years) => rows.push({ STAT_CODE: stat, TIME: time, DATA_VALUE: String(Number(wave(key, t, level, amp, trend * (years ? 12 : 1)).toFixed(3))) });
    if (cycle === 'A') {
      const last = stat === '291Y524' || stat === '903Y201' || stat === '903Y206' ? NOW.getUTCFullYear() - 1 : NOW.getUTCFullYear() - 2;
      const first = stat === '903Y001' || stat === '903Y006' ? 2012 : stat === '903Y201' || stat === '903Y206' ? 2017 : 2010;
      const lastYear = stat === '903Y001' || stat === '903Y006' ? 2017 : last;
      for (let y = first; y <= lastYear; y++) {
        const t = (y - 2000) * 12;
        // Values grow over the years: 시가총액 faster than income
        const g = stat === '291Y524' ? 1 + (y - 2010) * 0.055 : stat.startsWith('903') ? 1 + (y - 2010) * 0.035 : 1 + (y - 2010) * 0.012;
        rows.push({ STAT_CODE: stat, TIME: String(y), DATA_VALUE: String(Number((wave(key, t, level, amp * 0.3, 0) * g).toFixed(1))) });
      }
    } else if (cycle === 'Q') {
      for (const [y, m, t] of monthsFrom(2003, 1)) if ((m - 1) % 3 === 0) push(`${y}Q${(m - 1) / 3 + 1}`, t, false);
    } else {
      for (const [y, m, t] of monthsFrom(2005, 1)) push(`${y}${pad(m)}`, t, false);
    }
    void from;
    void to;
    return { StatisticSearch: { list_total_count: rows.length, row: rows } };
  };

  // ------------------------------------------------------------ KOSIS
  const kosisRows = (url) => {
    const region = url.searchParams.get('objL1') ?? '00';
    if (region === '42' || region === '45') return { err: '30', errMsg: '데이터가 존재하지 않습니다.' };
    if (url.searchParams.get('tblId') === 'DT_1B040B3') {
      // 세대수 keeps rising while people per household fall (more one-person households)
      const people = region === '00' ? 5_150_000 : region === '11' ? 940_000 : region.length === 5 ? 48_000 : 330_000;
      const rows = [];
      for (const [y, m, t] of monthsFrom(2011, 1)) rows.push({ C1: region, ITM_ID: 'T1', ITM_NM: '세대수', PRD_DE: `${y}${pad(m)}`, DT: String(Math.round(people * 4.3 * (1 + 0.0011 * (t - 132)))) });
      return rows;
    }
    const ages = (url.searchParams.get('objL2') ?? '0').split(/[ +]/).filter(Boolean);
    const scale = region === '00' ? 5_150_000 : region === '11' ? 940_000 : region.length === 5 ? 48_000 : 330_000;
    const rows = [];
    for (const [y, m, t] of monthsFrom(2011, 1)) {
      for (const age of ages) {
        const a = Number(age);
        // Fewer people in their 20s and 30s over time, more in their 50s
        const drift = a === 0 ? 0 : a <= 40 ? -0.0011 : a <= 50 ? -0.0004 : 0.0009;
        const share = a === 0 ? 10 : 0.68 + (a >= 45 && a <= 60 ? 0.12 : 0);
        // The total drifts slowly down, as most regions do; age groups shift as above
        const v = a === 0 ? scale * share * (1 - 0.00018 * (t - 132)) : scale * share * (1 + drift * (t - 132)) * (1 + 0.004 * Math.sin(t / 9 + a));
        rows.push({ ORG_ID: '101', TBL_ID: 'DT_1B04005N', C1: region, C2: age, ITM_ID: 'T2', PRD_SE: 'M', PRD_DE: `${y}${pad(m)}`, DT: String(Math.round(v)) });
      }
    }
    return rows;
  };

  // ------------------------------------------------------------ New York Fed ACM (.xls)
  const u16 = (...v) => Buffer.from(new Uint16Array(v).buffer);
  const u32 = (...v) => Buffer.from(new Uint32Array(v).buffer);
  const rec = (type, data) => Buffer.concat([u16(type, data.length), data]);
  const f64 = (v) => {
    const b = Buffer.alloc(8);
    b.writeDoubleLE(v);
    return b;
  };
  const label = (r, c, s) => rec(0x0204, Buffer.concat([u16(r, c, 0), u16(s.length), Buffer.from([0]), Buffer.from(s, 'latin1')]));
  const number = (r, c, v) => rec(0x0203, Buffer.concat([u16(r, c, 0), f64(v)]));
  function acmXls() {
    const head = ['DATE', 'ACMY10', 'ACMTP10', 'ACMRNY10'];
    const cells = head.map((h, c) => label(0, c, h));
    let r = 1;
    for (const [y, m, t] of monthsFrom(1990, 1)) {
      const last = new Date(Date.UTC(y, m, 0));
      const serial = Math.round((last.getTime() - Date.UTC(1899, 11, 30)) / 86_400_000);
      const tp = wave('acmtp', t, 0.6, 0.9, -0.004) + (t > 300 ? (t - 300) * 0.008 : 0);
      // The parts explain the fake market 10-year (DGS10 above) up to a few bp, as the real model does
      const [l10, a10, tr10] = FRED.DGS10;
      const rn = wave('DGS10', t, l10, a10, tr10) - tp - 0.02 - 0.015 * Math.sin(t / 5);
      cells.push(number(r, 0, serial), number(r, 1, tp + rn), number(r, 2, tp), number(r, 3, rn));
      r++;
    }
    const bof = rec(0x0809, u16(0x600, 0x10, 0, 0, 0, 0, 0, 0));
    const name = Buffer.concat([Buffer.from([11, 0]), Buffer.from('ACM Monthly', 'latin1')]);
    const globals = (pos) => Buffer.concat([bof, rec(0x0085, Buffer.concat([u32(pos), u16(0), name])), rec(0x000a, Buffer.alloc(0))]);
    const sheet = Buffer.concat([bof, ...cells, rec(0x000a, Buffer.alloc(0))]);
    const wb = Buffer.concat([globals(globals(0).length), sheet]);
    // Compound File: header, FAT sectors, one directory sector, then the stream
    const ss = 512;
    const data = Buffer.concat([wb, Buffer.alloc((ss - (wb.length % ss)) % ss)]);
    const n = data.length / ss;
    const fatCount = Math.ceil((n + 1 + 1) / 127);
    const total = fatCount + 1 + n;
    const fat = Buffer.alloc(fatCount * ss, 0xff);
    for (let i = 0; i < fatCount; i++) fat.writeUInt32LE(0xfffffffd, i * 4);
    fat.writeUInt32LE(0xfffffffe, fatCount * 4);
    for (let i = 0; i < n; i++) fat.writeUInt32LE(i === n - 1 ? 0xfffffffe : fatCount + 2 + i, (fatCount + 1 + i) * 4);
    void total;
    const header = Buffer.alloc(ss, 0);
    u32(0xe011cfd0, 0xe11ab1a1).copy(header, 0);
    header.writeUInt16LE(0x3e, 24);
    header.writeUInt16LE(3, 26);
    header.writeUInt16LE(0xfffe, 28);
    header.writeUInt16LE(9, 30);
    header.writeUInt16LE(6, 32);
    header.writeUInt32LE(fatCount, 44);
    header.writeUInt32LE(fatCount, 48);
    header.writeUInt32LE(4096, 56);
    header.writeUInt32LE(0xfffffffe, 60);
    header.writeUInt32LE(0xfffffffe, 68);
    for (let i = 0; i < 109; i++) header.writeUInt32LE(i < fatCount ? i : 0xffffffff, 76 + i * 4);
    const dir = Buffer.alloc(ss, 0);
    const entry = (i, nm, type, start, size) => {
      const o = i * 128;
      Buffer.from(`${nm}\0`, 'utf16le').copy(dir, o);
      dir.writeUInt16LE((nm.length + 1) * 2, o + 64);
      dir[o + 66] = type;
      dir.writeUInt32LE(0xffffffff, o + 68);
      dir.writeUInt32LE(0xffffffff, o + 72);
      dir.writeUInt32LE(i === 0 ? 1 : 0xffffffff, o + 76);
      dir.writeUInt32LE(start, o + 116);
      dir.writeUInt32LE(size, o + 120);
    };
    entry(0, 'Root Entry', 5, 0xfffffffe, 0);
    entry(1, 'Workbook', 2, fatCount + 1, Math.max(wb.length, 4096));
    return Buffer.concat([header, fat, dir, data]);
  }

  // ------------------------------------------------------------ 한국부동산원 R-ONE
  const roneRows = (url) => {
    const table = url.searchParams.get('STATBL_ID') ?? '';
    const cls = url.searchParams.get('CLS_ID') ?? '500001';
    const seoul = cls === '500008' || (table === 'A_2024_00549' && cls === '500002');
    // 지역 분석 asks for any region: below 시도 level, a region-specific size and pace
    const k = 0.6 + hash(`size${cls}`) * 0.8;
    const big = Number(cls) < 510000 ? 1 : 0.12;
    const [level, amp, trend] = {
      A_2024_00076: seoul ? [102, 22, 0] : [96, 18, 0],
      A_2024_00077: seoul ? [112, 14, 0] : [103, 12, 0],
      A_2024_00073: seoul ? [52, 4, -0.02] : [68 * Math.min(1.2, k), 3, -0.01],
      A_2024_00045: seoul ? [80, 4, 0.18] : [88 * k, 3 * k, 0.1 * k],
      A_2024_00050: seoul ? [84, 3, 0.12] : [90 * k, 3 * k, 0.07 * k],
      A_2024_00062: seoul ? [700000, 60000, 2200] : [260000 * k, 30000, 900 * k],
      A_2024_00156: [5.2, 0.4, -0.004],
      A_2024_00549: seoul ? [5500, 2500, 0] : [45000, 15000, 0],
      A_2024_00554: seoul ? [4200, 1900, 0] : [32000 * big * k, 11000 * big * k, 0],
    }[table] ?? [100, 5, 0];
    const row = [];
    for (const [y, m, t] of monthsFrom(2012, 1)) row.push({ STATBL_ID: table, WRTTIME_IDTFR_ID: `${y}${pad(m)}`, CLS_ID: Number(cls), ITM_ID: 100001, DTA_VAL: Number(Math.max(0, wave(`${table}${cls}`, t, level, amp, trend)).toFixed(2)) });
    return { SttsApiTblData: [{ head: [{ list_total_count: row.length }, { RESULT: { CODE: 'INFO-000', MESSAGE: '정상 처리되었습니다.' } }] }, { row }] };
  };

  // ------------------------------------------------------------ New York Fed Laubach-Williams (.xlsx)
  async function lwXlsx() {
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('data');
    ws.addRow([]);
    ws.addRow([null, null, 'One-Sided Estimates']);
    ws.addRow(['Date', null, 'rstar', 'g', 'z', 'Output gap']);
    for (const [y, m, t] of monthsFrom(1995, 1)) {
      if ((m - 1) % 3) continue;
      ws.addRow([new Date(Date.UTC(y, m - 1, 1)), null, Number(wave('rstar', t, 1.2, 0.5, -0.002).toFixed(3)), 2, 0, Number(wave('gap', t, 0, 2, 0).toFixed(3))]);
    }
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  const prevFetch = globalThis.fetch;
  globalThis.fetch = async function indicatorsDemoFetch(input, init) {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    let url;
    try {
      url = new URL(raw);
    } catch {
      return prevFetch(input, init);
    }
    if (url.hostname === 'fred.stlouisfed.org' && url.pathname === '/graph/fredgraph.csv') return new Response(fredCsv(url), { status: 200, headers: { 'content-type': 'text/csv' } });
    if (url.hostname === 'ecos.bok.or.kr' && url.pathname.startsWith('/api/StatisticSearch/')) return new Response(JSON.stringify(ecosRows(url)), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.hostname === 'kosis.kr' && url.pathname.includes('statisticsParameterData')) return new Response(JSON.stringify(kosisRows(url)), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.hostname === 'query1.finance.yahoo.com' && url.pathname.endsWith('/DX-Y.NYB') && url.searchParams.get('interval') === '1mo') {
      const timestamp = [], close = [];
      for (const [y, m, t] of monthsFrom(1990, 1)) {
        timestamp.push(Date.UTC(y, m - 1, 1) / 1000 + 4 * 3600);
        close.push(Number(wave('dxy', t, 96, 8, 0.01).toFixed(2)));
      }
      return new Response(JSON.stringify({ chart: { result: [{ meta: { gmtoffset: -14400 }, timestamp, indicators: { quote: [{ close }] } }] } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.hostname === 'www.reb.or.kr' && url.pathname.endsWith('SttsApiTblData.do')) return new Response(JSON.stringify(roneRows(url)), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.hostname === 'www.newyorkfed.org' && url.pathname.endsWith('Laubach_Williams_current_estimates.xlsx')) return new Response(await lwXlsx(), { status: 200, headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } });
    if (url.hostname === 'www.newyorkfed.org' && url.pathname.endsWith('ACMTermPremium.xls')) return new Response(acmXls(), { status: 200, headers: { 'content-type': 'application/vnd.ms-excel' } });
    return prevFetch(input, init);
  };
}
