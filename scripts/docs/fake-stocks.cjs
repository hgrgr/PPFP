/**
 * Fake SEC data for the 종목 분석 screenshots, on top of fake-sec.cjs (NVDA): balance sheet,
 * cash flow and dividend facts for NVDA, six made-up semiconductor peers (their facts are NVDA's
 * scaled), and a handful of Form 4 insider reports. Loaded by fake-market.cjs after fake-sec.cjs;
 * answers only when PPFP_FAKE_INDICATORS=1. The peers' numbers and every insider trade are made up.
 */
'use strict';

if (process.env.PPFP_FAKE_INDICATORS === '1') {
  const NVDA = 1045810;
  /** ticker → [fake CIK, scale of NVDA's numbers, name] */
  const PEERS = { AVGO: [900001, 0.42, 'BROADCOM INC'], AMD: [900002, 0.2, 'ADVANCED MICRO DEVICES INC'], MU: [900003, 0.24, 'MICRON TECHNOLOGY INC'], QCOM: [900004, 0.26, 'QUALCOMM INC'], TXN: [900005, 0.11, 'TEXAS INSTRUMENTS INC'], INTC: [900006, 0.3, 'INTEL CORP'] };
  const pad = (n) => String(n).padStart(10, '0');
  const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
  const INSIDERS = [
    ['2026-09-18', 'DEMO CEO', 'President and CEO · 이사', 'S', 75000, 178.4],
    ['2026-09-11', 'DEMO CEO', 'President and CEO · 이사', 'S', 75000, 181.2],
    ['2026-09-05', 'DEMO CFO', 'EVP and CFO', 'S', 40000, 176.9],
    ['2026-08-28', 'DEMO DIRECTOR A', '이사', 'P', 6000, 166.3],
    ['2026-08-20', 'DEMO CFO', 'EVP and CFO', 'F', 12000, 171.0],
    ['2026-07-30', 'DEMO DIRECTOR B', '이사', 'S', 20000, 158.7],
    ['2026-07-15', 'DEMO OFFICER C', 'EVP Operations', 'A', 30000, 0],
    ['2026-06-24', 'DEMO DIRECTOR A', '이사', 'P', 4000, 149.2],
  ];
  const acc4 = (i) => `0009999999-26-${String(500 + i).padStart(6, '0')}`;
  const form4 = (i) => {
    const [date, owner, role, code, shares, price] = INSIDERS[i];
    const title = role.split(' · ')[0];
    const director = role.includes('이사');
    return `<?xml version="1.0"?><ownershipDocument><reportingOwner><reportingOwnerId><rptOwnerName>${owner}</rptOwnerName></reportingOwnerId><reportingOwnerRelationship><isDirector>${director ? 1 : 0}</isDirector>${title !== '이사' ? `<isOfficer>1</isOfficer><officerTitle>${title}</officerTitle>` : ''}</reportingOwnerRelationship></reportingOwner><nonDerivativeTable><nonDerivativeTransaction><transactionDate><value>${date}</value></transactionDate><transactionCoding><transactionCode>${code}</transactionCode></transactionCoding><transactionAmounts><transactionShares><value>${shares}</value></transactionShares><transactionPricePerShare><value>${price}</value></transactionPricePerShare><transactionAcquiredDisposedCode><value>${code === 'P' || code === 'A' ? 'A' : 'D'}</value></transactionAcquiredDisposedCode></transactionAmounts><postTransactionAmounts><sharesOwnedFollowingTransaction><value>${800000000 - i * 150000}</value></sharesOwnedFollowingTransaction></postTransactionAmounts></nonDerivativeTransaction></nonDerivativeTable></ownershipDocument>`;
  };

  /** NVDA's facts plus cash flow, balance sheet and dividends; scaled for a peer */
  function enrich(base, scale, name, cik) {
    const g = JSON.parse(JSON.stringify(base));
    g.cik = cik;
    g.entityName = name;
    const us = g.facts['us-gaap'];
    const rev = us.Revenues.units.USD;
    const flow = (ratio) => rev.map((f) => ({ ...f, val: Math.round(f.val * ratio) }));
    us.NetCashProvidedByUsedInOperatingActivities = { units: { USD: flow(0.55) } };
    us.PaymentsToAcquirePropertyPlantAndEquipment = { units: { USD: flow(0.04) } };
    us.PaymentsOfDividends = { units: { USD: flow(0.012) } };
    const at = (ratio) => rev.map((f, k) => ({ end: f.end, val: Math.round(f.val * ratio * (1 + k * 0.08)), form: f.form, filed: f.filed }));
    us.Assets = { units: { USD: at(3.2) } };
    us.Liabilities = { units: { USD: at(1.0) } };
    us.StockholdersEquity = { units: { USD: at(2.2) } };
    us.LongTermDebt = { units: { USD: at(0.18) } };
    us.CashAndCashEquivalentsAtCarryingValue ??= { units: { USD: at(0.25) } };
    if (scale !== 1) {
      for (const tag of Object.values(us)) for (const list of Object.values(tag.units)) for (const f of list) f.val = Math.round(f.val * scale * (0.85 + 0.3 * ((cik * 7919) % 100) / 100));
      // Per-share and share counts are not scaled with the business
      if (us.EarningsPerShareDiluted) for (const f of Object.values(us.EarningsPerShareDiluted.units)[0]) f.val = Number((f.val / scale).toFixed(2));
    }
    return g;
  }

  const prevFetch = globalThis.fetch;
  globalThis.fetch = async function stocksDemoFetch(input, init) {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    let url;
    try {
      url = new URL(raw);
    } catch {
      return prevFetch(input, init);
    }
    const p = url.pathname;
    if (url.hostname === 'www.sec.gov' && p === '/files/company_tickers.json') {
      const base = await (await prevFetch(input, init)).json();
      Object.entries(PEERS).forEach(([t, [cik, , name]], i) => (base[100 + i] = { cik_str: cik, ticker: t, title: name }));
      return json(base);
    }
    if (url.hostname === 'data.sec.gov') {
      const m = /^\/api\/xbrl\/companyfacts\/CIK0*(\d+)\.json$/.exec(p);
      if (m) {
        const cik = Number(m[1]);
        const peer = Object.values(PEERS).find((x) => x[0] === cik);
        if (cik === NVDA || peer) {
          const base = await (await prevFetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${pad(NVDA)}.json`, init)).json();
          return json(enrich(base, peer ? peer[1] : 1, peer ? peer[2] : base.entityName, cik));
        }
      }
      if (p === `/submissions/CIK${pad(NVDA)}.json`) {
        const sub = await (await prevFetch(input, init)).json();
        const r = sub.filings.recent;
        INSIDERS.forEach((x, i) => {
          r.form.unshift('4');
          r.filingDate.unshift(x[0]);
          r.reportDate.unshift(x[0]);
          r.accessionNumber.unshift(acc4(i));
          r.primaryDocument.unshift('xslF345X06/form4.xml');
          r.items.unshift('');
        });
        return json(sub);
      }
    }
    if (url.hostname === 'www.sec.gov') {
      const m = /^\/Archives\/edgar\/data\/\d+\/(\d{18})\/form4\.xml$/.exec(p);
      const i = m ? INSIDERS.findIndex((_, k) => acc4(k).replace(/-/g, '') === m[1]) : -1;
      if (i >= 0) return new Response(form4(i), { status: 200, headers: { 'content-type': 'application/xml' } });
    }
    return prevFetch(input, init);
  };
}
