/**
 * Fake SEC EDGAR for documentation screenshots (loaded by fake-market.cjs): one company (NVDA)
 * with a 10-Q, an earnings 8-K and a 10-K, their file lists, a short 10-Q and press release,
 * and XBRL company facts. The numbers are NVIDIA's published quarterly figures, rounded to
 * $10 million; the filing texts are short stand-ins, not the real documents.
 */
'use strict';

const CIK = 1045810;
const B = 1e9;
const QUARTERS = [
  // start, end, revenue, gross profit, operating income, net income, diluted EPS
  ['2024-04-29', '2024-07-28', 30.04, 22.57, 18.64, 16.6, 0.67],
  ['2024-07-29', '2024-10-27', 35.08, 26.16, 21.86, 19.31, 0.78],
  ['2024-10-28', '2025-01-26', 39.33, 28.72, 24.03, 22.09, 0.89],
  ['2025-01-27', '2025-04-27', 44.06, 26.67, 21.64, 18.78, 0.76],
  ['2025-04-28', '2025-07-27', 46.74, 33.85, 28.44, 26.42, 1.08],
  ['2025-07-28', '2025-10-26', 57.01, 41.85, 36.01, 31.91, 1.3],
  ['2025-10-27', '2026-01-25', 68.13, 51.09, 44.3, 42.96, 1.76],
  ['2026-01-26', '2026-04-26', 81.61, 61.16, 53.54, 58.32, 2.39],
  ['2026-04-27', '2026-07-26', 96.22, 72.14, 63.73, 59.69, 2.46],
];
const fact = (q, v, unitB = true) => ({ start: q[0], end: q[1], val: unitB ? Math.round(v * B) : v, form: '10-Q', filed: '2026-08-26' });
const facts = {
  cik: CIK,
  entityName: 'NVIDIA CORP',
  facts: {
    'us-gaap': {
      Revenues: { units: { USD: QUARTERS.map((q) => fact(q, q[2])) } },
      GrossProfit: { units: { USD: QUARTERS.map((q) => fact(q, q[3])) } },
      OperatingIncomeLoss: { units: { USD: QUARTERS.map((q) => fact(q, q[4])) } },
      NetIncomeLoss: { units: { USD: QUARTERS.map((q) => fact(q, q[5])) } },
      EarningsPerShareDiluted: { units: { 'USD/shares': QUARTERS.map((q) => fact(q, q[6], false)) } },
    },
  },
};

const FILINGS = [
  { form: '10-Q', filed: '2026-08-26', period: '2026-07-26', acc: '0001045810-26-000075', doc: 'nvda-20260726.htm', items: '' },
  { form: '8-K', filed: '2026-08-26', period: '2026-08-26', acc: '0001045810-26-000073', doc: 'nvda-20260826.htm', items: '2.02,9.01' },
  { form: '10-Q', filed: '2026-05-20', period: '2026-04-26', acc: '0001045810-26-000052', doc: 'nvda-20260426.htm', items: '' },
  { form: '8-K', filed: '2026-05-20', period: '2026-05-20', acc: '0001045810-26-000050', doc: 'nvda-20260520.htm', items: '2.02,9.01' },
  { form: '10-K', filed: '2026-02-25', period: '2026-01-25', acc: '0001045810-26-000021', doc: 'nvda-20260125.htm', items: '' },
];
const submissions = {
  cik: String(CIK),
  name: 'NVIDIA CORP',
  fiscalYearEnd: '0125',
  filings: {
    recent: {
      form: FILINGS.map((f) => f.form),
      filingDate: FILINGS.map((f) => f.filed),
      reportDate: FILINGS.map((f) => f.period),
      accessionNumber: FILINGS.map((f) => f.acc),
      primaryDocument: FILINGS.map((f) => f.doc),
      items: FILINGS.map((f) => f.items),
    },
  },
};

const TENQ = `<html><body>
<p>FORM 10-Q (documentation stand-in)</p>
<p>Item 1. Financial Statements</p><table><tr><td>Revenue</td><td>$</td><td>96,215</td></tr><tr><td>Cost of revenue</td><td>24,075</td></tr></table>
<p>Item 2. Management's Discussion and Analysis of Financial Condition and Results of Operations</p>
<p>Revenue for the second quarter of fiscal year 2027 was $96.2 billion, up 106% from a year ago and up 18% sequentially, led by Data Center.</p>
<p>Gross margin was 75.0%, compared with 72.4% a year ago, reflecting a favorable mix.</p>
<p>Operating expenses grew with compensation and compute costs for research and development.</p>
<p>Item 3. Quantitative and Qualitative Disclosures About Market Risk</p><p>Not material.</p>
<p>Item 1A. Risk Factors</p><p>Export controls and customer concentration remain the main risks.</p>
<p>Item 5. Other Information</p>
</body></html>`;
const PR = `<html><body><p>NVIDIA Announces Financial Results for Second Quarter Fiscal 2027 (documentation stand-in)</p><p>Revenue of $96.2 billion, up 106% from a year ago. Outlook for the third quarter: revenue of about $110 billion.</p></body></html>`;

function sec(url) {
  const p = url.pathname;
  if (p === '/files/company_tickers.json') return { body: { 0: { cik_str: CIK, ticker: 'NVDA', title: 'NVIDIA CORP' } } };
  if (p === `/submissions/CIK${String(CIK).padStart(10, '0')}.json`) return { body: submissions };
  if (p === `/api/xbrl/companyfacts/CIK${String(CIK).padStart(10, '0')}.json`) return { body: facts };
  const m = p.match(/^\/Archives\/edgar\/data\/\d+\/(\d{18})\/(.+)$/);
  if (m) {
    const f = FILINGS.find((x) => x.acc.replace(/-/g, '') === m[1]);
    if (!f) return { status: 404, body: 'not found' };
    if (m[2] === 'index.json') {
      const item = [{ name: f.doc, size: '120000' }, ...(f.form === '8-K' ? [{ name: 'q2fy27pr.htm', size: '40000' }] : []), { name: `${f.acc}.txt`, size: '900000' }];
      return { body: { directory: { item } } };
    }
    if (m[2] === 'q2fy27pr.htm') return { body: PR, html: true };
    if (m[2] === f.doc) return { body: f.form === '8-K' ? '<html><body><p>Item 2.02 Results of Operations and Financial Condition. See Exhibit 99.1.</p></body></html>' : TENQ, html: true };
  }
  return { status: 404, body: 'not found' };
}

const prevFetch = globalThis.fetch;
globalThis.fetch = async function secDemoFetch(input, init) {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return prevFetch(input, init);
  }
  if (url.hostname !== 'www.sec.gov' && url.hostname !== 'data.sec.gov') return prevFetch(input, init);
  const r = sec(url);
  return r.html || typeof r.body === 'string'
    ? new Response(r.body, { status: r.status ?? 200, headers: { 'content-type': 'text/html; charset=utf-8' } })
    : new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'content-type': 'application/json' } });
};
