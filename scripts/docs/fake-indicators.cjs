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
  /** e-지방지표 regions (code, name) as KOSIS lists them, for the 입지 tables asked with objL1=ALL */
  const E_REGIONS = [["11","서울특별시"],["11010","종로구"],["11020","중구"],["11030","용산구"],["11040","성동구"],["11050","광진구"],["11060","동대문구"],["11070","중랑구"],["11080","성북구"],["11090","강북구"],["11100","도봉구"],["11110","노원구"],["11120","은평구"],["11130","서대문구"],["11140","마포구"],["11150","양천구"],["11160","강서구"],["11170","구로구"],["11180","금천구"],["11190","영등포구"],["11200","동작구"],["11210","관악구"],["11220","서초구"],["11230","강남구"],["11240","송파구"],["11250","강동구"],["12","전남광주통합특별시"],["21","부산광역시"],["21010","중구"],["21020","서구"],["21030","동구"],["21040","영도구"],["21050","부산진구"],["21060","동래구"],["21070","남구"],["21080","북구"],["21090","해운대구"],["21100","사하구"],["21110","금정구"],["21120","강서구"],["21130","연제구"],["21140","수영구"],["21150","사상구"],["21310","기장군"],["22","대구광역시"],["22010","중구"],["22020","동구"],["22030","서구"],["22040","남구"],["22050","북구"],["22060","수성구"],["22070","달서구"],["22310","달성군"],["23","인천광역시"],["23125","제물포구"],["23155","영종구"],["23275","서해구"],["23290","검단구"],["23010","중구"],["23020","동구"],["23030","남구"],["23040","연수구"],["23050","남동구"],["23060","부평구"],["23070","계양구"],["23080","서구"],["23090","미추홀구"],["23310","강화군"],["23320","옹진군"],["1224","광주광역시"],["1224010","동구"],["1224020","서구"],["1224030","남구"],["1224040","북구"],["1224050","광산구"],["25","대전광역시"],["25010","동구"],["25020","중구"],["25030","서구"],["25040","유성구"],["25050","대덕구"],["26","울산광역시"],["26010","중구"],["26020","남구"],["26030","동구"],["26040","북구"],["26310","울주군"],["29","세종특별자치시"],["31","경기도"],["31010","수원시"],["31020","성남시"],["31030","의정부시"],["31040","안양시"],["31050","부천시"],["31060","광명시"],["31070","평택시"],["31080","동두천시"],["31090","안산시"],["31100","고양시"],["31110","과천시"],["31120","구리시"],["31130","남양주시"],["31140","오산시"],["31150","시흥시"],["31160","군포시"],["31170","의왕시"],["31180","하남시"],["31190","용인시"],["31200","파주시"],["31210","이천시"],["31220","안성시"],["31230","김포시"],["31240","화성시"],["31250","광주시"],["31260","양주시"],["31270","포천시"],["31280","여주시"],["31350","연천군"],["31370","가평군"],["31380","양평군"],["32","강원특별자치도"],["32010","춘천시"],["32020","원주시"],["32030","강릉시"],["32040","동해시"],["32050","태백시"],["32060","속초시"],["32070","삼척시"],["32310","홍천군"],["32320","횡성군"],["32330","영월군"],["32340","평창군"],["32350","정선군"],["32360","철원군"],["32370","화천군"],["32380","양구군"],["32390","인제군"],["32400","고성군"],["32410","양양군"],["33","충청북도"],["33010","충북 청주시"],["33020","충주시"],["33030","제천시"],["33040","청주시"],["33310","충북 청원군"],["33320","보은군"],["33330","옥천군"],["33340","영동군"],["33350","진천군"],["33360","괴산군"],["33370","음성군"],["33380","단양군"],["33390","증평군"],["34","충청남도"],["34010","천안시"],["34020","공주시"],["34030","보령시"],["34040","아산시"],["34050","서산시"],["34060","논산시"],["34070","계룡시"],["34080","당진시"],["34310","금산군"],["34320","충남 연기군"],["34330","부여군"],["34340","서천군"],["34350","청양군"],["34360","홍성군"],["34370","예산군"],["34380","태안군"],["34390","충남 당진군"],["35","전북특별자치도"],["35010","전주시"],["35020","군산시"],["35030","익산시"],["35040","정읍시"],["35050","남원시"],["35060","김제시"],["35310","완주군"],["35320","진안군"],["35330","무주군"],["35340","장수군"],["35350","임실군"],["35360","순창군"],["35370","고창군"],["35380","부안군"],["1236","전라남도"],["1236010","목포시"],["1236020","여수시"],["1236030","순천시"],["1236040","나주시"],["1236060","광양시"],["1236310","담양군"],["1236320","곡성군"],["1236330","구례군"],["1236350","고흥군"],["1236360","보성군"],["1236370","화순군"],["1236380","장흥군"],["1236390","강진군"],["1236400","해남군"],["1236410","영암군"],["1236420","무안군"],["1236430","함평군"],["1236440","영광군"],["1236450","장성군"],["1236460","완도군"],["1236470","진도군"],["1236480","신안군"],["37","경상북도"],["37010","포항시"],["37020","경주시"],["37030","김천시"],["37040","안동시"],["37050","구미시"],["37060","영주시"],["37070","영천시"],["37080","상주시"],["37090","문경시"],["37100","경산시"],["37310","군위군"],["37320","의성군"],["37330","청송군"],["37340","영양군"],["37350","영덕군"],["37360","청도군"],["37370","고령군"],["37380","성주군"],["37390","칠곡군"],["37400","예천군"],["37410","봉화군"],["37420","울진군"],["37430","울릉군"],["38","경상남도"],["38010","경남 창원시"],["38020","경남 마산시"],["38030","진주시"],["38040","경남 진해시"],["38050","통영시"],["38060","사천시"],["38070","김해시"],["38080","밀양시"],["38090","거제시"],["38100","양산시"],["38110","창원시"],["38310","의령군"],["38320","함안군"],["38330","창녕군"],["38340","고성군"],["38350","남해군"],["38360","하동군"],["38370","산청군"],["38380","함양군"],["38390","거창군"],["38400","합천군"],["39","제주특별자치도"],["39010","제주시"],["39020","서귀포시"],["22520","군위군"]];
  const LOCATION = { DT_1YL21191: [1.4, 0.9], DT_1YL20981: [2.6, 1.8], DT_1YL20921: [28, 16], DT_1YL15014: [90000, 70000] };
  const locationRows = (url) => {
    const tbl = url.searchParams.get('tblId');
    const years = Number(url.searchParams.get('newEstPrdCnt') ?? 1);
    const last = NOW.getUTCFullYear() - 1;
    const rows = [];
    const big = (code) => (code.length === 2 ? 30 : 1) * (0.4 + 1.2 * hash(`big${code}`));
    if (tbl === 'DT_133001N_4215') {
      // 국세통계 numbers 시도 "A01" and their 시군구 "A0101" in its own order
      const sidoIx = new Map();
      for (const [code, name] of E_REGIONS) {
        if (code.length === 2) sidoIx.set(code, `A${String(sidoIx.size + 1).padStart(2, '0')}`);
        const sc = sidoIx.get(code.slice(0, 2));
        if (!sc) continue;
        const c = code.length === 2 ? sc : `${sc}${String(E_REGIONS.filter(([x]) => x.length === 5 && x.startsWith(code.slice(0, 2)) && x <= code).length).padStart(2, '0')}`;
        const people = Math.round(60000 * big(code));
        const pay = 3800 + 2600 * hash(`pay${code}`);
        rows.push({ C1: c, C1_NM: name, C2: 'B01', ITM_ID: 'T001', PRD_DE: String(last - 1), DT: String(people) });
        rows.push({ C1: c, C1_NM: name, C2: 'B01', ITM_ID: 'T002', PRD_DE: String(last - 1), DT: String(Math.round((people * pay) / 100)) });
      }
      return rows;
    }
    const itms = (url.searchParams.get('itmId') ?? 'T10').split(/[ +]/).filter(Boolean);
    for (let y = last - years + 1; y <= last; y++) {
      for (const [code, name] of E_REGIONS) {
        for (const itm of itms) {
          let v;
          if (itm === 'T002') v = Math.round(250000 * big(code) * (1 + (y - last) * 0.01 * (hash(`g${code}`) - 0.5) * 4));
          else {
            const [lvl, amp] = LOCATION[tbl] ?? [10, 5];
            v = lvl + amp * (hash(`${tbl}${code}`) - 0.5) * 2 * (tbl === 'DT_1YL15014' ? big(code) : 1);
            if (tbl === 'DT_1YL15014') v = Math.max(1000, Math.round(v * 2));
          }
          rows.push({ C1: code, C1_NM: name, ITM_ID: itm, PRD_DE: String(y), DT: String(typeof v === 'number' && !Number.isInteger(v) ? v.toFixed(2) : v) });
        }
      }
    }
    return rows;
  };
  const kosisRows = (url) => {
    if (url.searchParams.get('objL1') === 'ALL') return locationRows(url);
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
  /** 아파트매매거래 detail tables asked for every class of one region (no CLS_ID): shares per class, the 합계 their sum */
  const BUYER_SHARES = {
    A_2024_00609: [0.5, 0.22, 0.13, 0.15],
    A_2024_00610: [0.05, 0.3, 0.3, 0.18, 0.1, 0.05, 0.02],
    A_2024_00611: [0.93, 0.01, 0.005, 0.03, 0.002, 0.003, 0.02, 0.0, 0.0],
    // 토지거래허가 처리: 허가, 불허가
    A_2024_00655: [0.04, 0.0015],
    // 거래규모별: 20㎡ 이하 … 198㎡ 초과
    A_2024_00612: [0.005, 0.06, 0.28, 0.45, 0.09, 0.08, 0.025, 0.008, 0.002],
  };
  const buyerRows = (url, table) => {
    const grp = url.searchParams.get('GRP_ID') ?? '900001';
    const big = Number(grp) < 910000 ? 1 : 0.1;
    const shares = BUYER_SHARES[table];
    const row = [];
    for (const [y, m, t] of monthsFrom(table === 'A_2024_00610' ? 2019 : 2012, 1)) {
      const total = Math.max(50, wave(`deals${grp}`, t, 9000 * big, 4000 * big, 0));
      const parts = shares.map((sh, i) => Math.round(total * sh * (0.4 + 1.2 * hash(`${table}${grp}${i}w`)) * (1 + 0.35 * Math.sin(t / 19 + hash(`${table}${grp}${i}`) * 6.28))));
      const sum = parts.reduce((a, b) => a + b, 0);
      for (const [i, v] of [sum, ...parts].entries()) row.push({ STATBL_ID: table, WRTTIME_IDTFR_ID: `${y}${pad(m)}`, CLS_ID: 500001 + i, ITM_ID: 100001, DTA_VAL: v });
    }
    return { SttsApiTblData: [{ head: [{ list_total_count: row.length }, { RESULT: { CODE: 'INFO-000', MESSAGE: '정상 처리되었습니다.' } }] }, { row }] };
  };
  /** Region ids per table from src/domain/rone-regions.ts, for whole-table requests (the 지역 분석 map) */
  let regionIds = null;
  const idsOf = (table) => {
    if (!regionIds) {
      const text = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../src/domain/rone-regions.ts'), 'utf8');
      const rows = [...text.matchAll(/^  \['[^']+', ([0-9, ]+), '[0-9,]*'\],$/gm)].map((m) => m[1].split(',').map((x) => Number(x.trim())));
      const col = (i) => [...new Set(rows.map((r) => r[i]).filter(Boolean))];
      regionIds = { A_2024_00045: col(0), A_2024_00073: col(3), A_2024_00554: col(7), A_2024_00609: col(8) };
    }
    return regionIds[table] ?? [];
  };
  /** Rows from START_WRTTIME, one page of pSize */
  const paged = (url, row) => {
    const start = url.searchParams.get('START_WRTTIME') ?? '000000';
    const all = row.filter((r) => r.WRTTIME_IDTFR_ID >= start);
    const size = Number(url.searchParams.get('pSize') ?? 1000), page = Number(url.searchParams.get('pIndex') ?? 1);
    return { SttsApiTblData: [{ head: [{ list_total_count: all.length }, { RESULT: { CODE: 'INFO-000', MESSAGE: '정상 처리되었습니다.' } }] }, { row: all.slice((page - 1) * size, page * size) }] };
  };
  const wholeTable = (url, table) => {
    const rows = [];
    if (table === 'A_2024_00609') {
      for (const grp of idsOf(table)) {
        const u = new URL(url);
        u.searchParams.set('GRP_ID', String(grp));
        for (const r of buyerRows(u, table).SttsApiTblData[1].row) rows.push({ ...r, GRP_ID: grp });
      }
    } else {
      for (const cls of idsOf(table)) {
        const u = new URL(url);
        u.searchParams.set('CLS_ID', String(cls));
        rows.push(...roneRows(u).SttsApiTblData[1].row);
      }
    }
    return paged(url, rows);
  };
  const roneRows = (url) => {
    const table = url.searchParams.get('STATBL_ID') ?? '';
    if (!url.searchParams.get('CLS_ID') && !url.searchParams.get('GRP_ID') && idsOf(table).length) return wholeTable(url, table);
    if (BUYER_SHARES[table] && !url.searchParams.get('CLS_ID')) return buyerRows(url, table);
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
      A_2024_00178: cls === '500007' ? [82, 5, 0.2] : [90, 3, 0.09],
      A_2024_00180: [88 * k, 4 * k, 0.1 * k],
    }[table] ?? [100, 5, 0];
    const row = [];
    const quarterly = url.searchParams.get('DTACYCLE_CD') === 'QY';
    for (const [y, m, t] of monthsFrom(2012, 1)) {
      if (quarterly && (m - 1) % 3) continue;
      row.push({ STATBL_ID: table, WRTTIME_IDTFR_ID: quarterly ? `${y}0${(m - 1) / 3 + 1}` : `${y}${pad(m)}`, CLS_ID: Number(cls), ITM_ID: 100001, DTA_VAL: Number(Math.max(0, wave(`${table}${cls}`, t, level, amp, trend)).toFixed(2)) });
    }
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
