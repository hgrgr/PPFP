/**
 * Fake 13F reports for the 거장 포트폴리오 screenshots: SEC submissions, filing indexes and
 * information tables for the managers in src/domain/gurus.ts, and OpenFIGI CUSIP → ticker.
 * Loaded by fake-market.cjs after fake-sec.cjs; answers only when PPFP_FAKE_INDICATORS=1.
 *
 * Every holding, share count and value is made up from a hash of the manager and quarter.
 * None of it is any manager's real portfolio.
 */
'use strict';

if (process.env.PPFP_FAKE_INDICATORS === '1') {
  const hash = (s) => {
    let h = 2166136261;
    for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    return (h >>> 0) / 2 ** 32;
  };
  // Same CIKs as GURUS in src/domain/gurus.ts
  const CIKS = [1067983, 1336528, 1350694, 1656456, 1061768, 921669, 1040273, 1536411, 1029160, 1167483, 1061165, 1103804, 1135730, 1709323, 1549575, 1112520, 1569205, 1096343, 860643, 949509, 1791786, 1418814, 1345471, 1517137, 934639, 1138995, 1035674, 883965, 813917, 200217, 1647251, 915191, 732905, 807985, 1036325, 1325447, 1034524, 1088875, 1697748, 1541617, 1747057];
  /** [ticker, issuer name as 13F writes it, price] */
  const POOL = [
    ['AAPL', 'APPLE INC', 230], ['MSFT', 'MICROSOFT CORP', 480], ['NVDA', 'NVIDIA CORPORATION', 180], ['AMZN', 'AMAZON COM INC', 220], ['GOOGL', 'ALPHABET INC', 240],
    ['META', 'META PLATFORMS INC', 700], ['TSLA', 'TESLA INC', 400], ['BRK.B', 'BERKSHIRE HATHAWAY INC DEL', 480], ['JPM', 'JPMORGAN CHASE & CO', 290], ['V', 'VISA INC', 340],
    ['MA', 'MASTERCARD INCORPORATED', 560], ['UNH', 'UNITEDHEALTH GROUP INC', 320], ['LLY', 'ELI LILLY & CO', 800], ['AVGO', 'BROADCOM INC', 340], ['TSM', 'TAIWAN SEMICONDUCTOR MANUFAC', 280],
    ['KO', 'COCA COLA CO', 70], ['AXP', 'AMERICAN EXPRESS CO', 310], ['BAC', 'BANK AMER CORP', 48], ['OXY', 'OCCIDENTAL PETE CORP', 45], ['CVX', 'CHEVRON CORP NEW', 155],
    ['UBER', 'UBER TECHNOLOGIES INC', 90], ['BN', 'BROOKFIELD CORP', 62], ['QSR', 'RESTAURANT BRANDS INTL INC', 68], ['HLT', 'HILTON WORLDWIDE HLDGS INC', 270], ['CMG', 'CHIPOTLE MEXICAN GRILL INC', 50],
    ['MU', 'MICRON TECHNOLOGY INC', 140], ['ORCL', 'ORACLE CORP', 250], ['CRM', 'SALESFORCE INC', 260], ['NFLX', 'NETFLIX INC', 1200], ['SPGI', 'S&P GLOBAL INC', 520],
    ['MCO', 'MOODYS CORP', 500], ['COST', 'COSTCO WHSL CORP NEW', 950], ['WMT', 'WALMART INC', 100], ['PG', 'PROCTER AND GAMBLE CO', 160], ['JNJ', 'JOHNSON & JOHNSON', 175],
    ['XOM', 'EXXON MOBIL CORP', 115], ['GE', 'GE AEROSPACE', 270], ['CAT', 'CATERPILLAR INC', 430], ['PLTR', 'PALANTIR TECHNOLOGIES INC', 170], ['SHOP', 'SHOPIFY INC', 150],
  ];
  const cusipOf = (i) => `DEMO${String(i).padStart(4, '0')}0`;
  const QUARTERS = [];
  {
    const now = new Date();
    // The latest quarter whose 45-day filing window has passed
    let y = now.getUTCFullYear(), q = Math.floor(now.getUTCMonth() / 3);
    if (Date.UTC(y, q * 3, 15) > now.getTime()) q--;
    if (q === 0) { y--; q = 4; }
    for (let k = 0; k < 9; k++) {
      const end = new Date(Date.UTC(y, q * 3, 0));
      const filed = new Date(Date.UTC(y, q * 3, 44));
      QUARTERS.push({ period: end.toISOString().slice(0, 10), filed: filed.toISOString().slice(0, 10) });
      q--;
      if (q === 0) { y--; q = 4; }
    }
  }
  const acc = (cik, k) => `0009${String(cik).slice(-6).padStart(6, '0')}-${QUARTERS[k].period.slice(2, 4)}-${String(100 + k).padStart(6, '0')}`;
  /** Holdings of a manager in quarter k (0 = latest): a stable core plus a few that come and go */
  function book(cik, k) {
    const n = 8 + Math.floor(hash(`n${cik}`) * 14);
    const rows = [];
    POOL.forEach(([, name, price], i) => {
      const core = hash(`${cik}:${i}`);
      const churn = hash(`${cik}:${i}:${Math.floor((k + core * 3) / 2)}`);
      if (core > n / POOL.length && churn > 0.25) return;
      const shares = Math.round(1e5 + hash(`${cik}s${i}`) * 4e7 * (1 + 0.3 * Math.sin(k + i)));
      const px = price * (1 - 0.04 * k + 0.05 * Math.sin(i + k));
      rows.push({ i, name, shares, value: Math.round(shares * px) });
    });
    return rows;
  }
  const infoTable = (cik, k) =>
    `<?xml version="1.0" encoding="UTF-8"?><informationTable xmlns="http://www.sec.gov/edgar/document/thirteenf/informationtable">${book(cik, k)
      .map((r) => `<infoTable><nameOfIssuer>${r.name.replace(/&/g, '&amp;')}</nameOfIssuer><titleOfClass>COM</titleOfClass><cusip>${cusipOf(r.i)}</cusip><value>${r.value}</value><shrsOrPrnAmt><sshPrnamt>${r.shares}</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt><investmentDiscretion>SOLE</investmentDiscretion><votingAuthority><Sole>${r.shares}</Sole><Shared>0</Shared><None>0</None></votingAuthority></infoTable>`)
      .join('')}</informationTable>`;
  const submissions = (cik) => {
    const form = [], accessionNumber = [], reportDate = [], filingDate = [];
    QUARTERS.forEach((q, k) => {
      form.push('13F-HR');
      accessionNumber.push(acc(cik, k));
      reportDate.push(q.period);
      filingDate.push(q.filed);
    });
    return { cik: String(cik), name: `DEMO MANAGER ${cik}`, filings: { recent: { form, accessionNumber, reportDate, filingDate, primaryDocument: form.map(() => 'primary_doc.xml'), items: form.map(() => '') } } };
  };
  const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });

  const prevFetch = globalThis.fetch;
  globalThis.fetch = async function gurusDemoFetch(input, init) {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    let url;
    try {
      url = new URL(raw);
    } catch {
      return prevFetch(input, init);
    }
    if (url.hostname === 'data.sec.gov') {
      const m = /^\/submissions\/CIK0*(\d+)\.json$/.exec(url.pathname);
      if (m && CIKS.includes(Number(m[1]))) return json(submissions(Number(m[1])));
    }
    if (url.hostname === 'www.sec.gov') {
      const m = /^\/Archives\/edgar\/data\/(\d+)\/(\d{18})\/(.+)$/.exec(url.pathname);
      if (m && CIKS.includes(Number(m[1]))) {
        const cik = Number(m[1]);
        const k = QUARTERS.findIndex((_, j) => acc(cik, j).replace(/-/g, '') === m[2]);
        if (k >= 0 && m[3] === 'index.json') return json({ directory: { item: [{ name: 'primary_doc.xml', size: '5000' }, { name: 'infotable.xml', size: '40000' }] } });
        if (k >= 0 && m[3] === 'infotable.xml') return new Response(infoTable(cik, k), { status: 200, headers: { 'content-type': 'application/xml' } });
      }
    }
    if (url.hostname === 'api.openfigi.com' && url.pathname === '/v3/mapping') {
      const jobs = JSON.parse(String(init?.body ?? '[]'));
      return json(jobs.map((j) => {
        const i = /^DEMO(\d{4})0$/.exec(j.idValue)?.[1];
        const t = i !== undefined ? POOL[Number(i)]?.[0] : null;
        return t ? { data: [{ ticker: t.replace('.', '/'), exchCode: 'US', securityType: 'Common Stock' }] } : { warning: 'No identifier found.' };
      }));
    }
    return prevFetch(input, init);
  };
}
