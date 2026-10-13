import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chunk, financialTable, findSection, htmlToText } from '../sec';

describe('htmlToText', () => {
  it('keeps table rows apart, drops the hidden XBRL header and decodes entities', () => {
    const html = '<html><head><style>p{}</style></head><body><div style="display:none"><ix:header><ix:hidden>x</ix:hidden></ix:header></div><p>Revenue&#160;rose &amp; margins&nbsp;held</p><table><tr><td>Revenue</td><td>$</td><td>96,215</td></tr><tr><td>Cost</td><td>24,078</td></tr></table></body></html>';
    assert.equal(htmlToText(html), 'Revenue rose & margins held\nRevenue\t$\t96,215\nCost\t24,078');
  });
});

describe('findSection', () => {
  // A report names its items in the contents and again as headings; the heading has the text
  const report = ['FORM 10-Q', 'Item 1. Financial Statements\t3', 'Item 2. Management’s Discussion and Analysis\t20', 'Item 1A. Risk Factors\t40', '', 'Item 1. Financial Statements', 'Balance sheet rows', 'Item 2. Management’s Discussion and Analysis of Financial Condition', 'Revenue was up because of data center demand.', 'Gross margin improved.', 'Item 3. Quantitative and Qualitative Disclosures', 'Rates', 'Item 1A. Risk Factors', 'Export controls could hurt sales.', 'Item 5. Other'].join('\n');

  it('takes the heading, not the line in the table of contents', () => {
    const s = findSection(report, '10-Q', 'mda');
    assert.equal(s.found, true);
    assert.match(s.text, /^Item 2\. Management’s Discussion and Analysis of Financial Condition\nRevenue was up/);
    assert.doesNotMatch(s.text, /Rates/);
  });

  it('finds risk factors in a 10-Q and gives the whole text when a part is unknown', () => {
    assert.equal(findSection(report, '10-Q', 'risk').text, 'Item 1A. Risk Factors\nExport controls could hurt sales.');
    assert.deepEqual(findSection(report, '10-Q', 'business'), { text: report, found: false });
    assert.equal(findSection(report, '10-Q/A', 'risk').found, true);
  });

  it('finds a 20-F risk factors heading under item 3', () => {
    const f = 'ITEM 3. KEY INFORMATION\nsee “Item 3. Key Information – Risk Factors” below\nRisk Factors\nTaiwan risks.\nITEM 4. INFORMATION ON THE COMPANY\nHistory';
    assert.equal(findSection(f, '20-F', 'risk').text, 'Risk Factors\nTaiwan risks.');
  });
});

describe('chunk', () => {
  it('cuts at a line break and says where the next part starts', () => {
    const text = 'a'.repeat(60) + '\n' + 'b'.repeat(60);
    const first = chunk(text, 0, 80);
    assert.equal(first.text, 'a'.repeat(60));
    assert.equal(first.next, 60);
    assert.deepEqual(chunk(text, 60, 80), { text: '\n' + 'b'.repeat(60), next: null });
  });
});

describe('financialTable', () => {
  const q = (start: string, end: string, val: number, filed = '2026-01-01') => ({ start, end, val, filed, form: '10-Q' });
  // A fiscal year ending in late January: quarters end Apr, Jul, Oct; the fourth only in the year
  const facts = {
    'us-gaap': {
      Revenues: {
        units: {
          USD: [
            q('2024-01-29', '2024-04-28', 26), q('2024-04-29', '2024-07-28', 30), q('2024-07-29', '2024-10-27', 35), { ...q('2024-01-29', '2025-01-26', 130), form: '10-K' },
            q('2025-01-27', '2025-04-27', 44), q('2025-04-28', '2025-07-27', 46.7), q('2025-04-28', '2025-07-27', 46.74, '2026-08-01'),
          ],
        },
      },
      NetIncomeLoss: { units: { USD: [q('2024-04-29', '2024-07-28', 16), q('2025-04-28', '2025-07-27', 26.4)] } },
      // Cash flow reported only year to date
      NetCashProvidedByUsedInOperatingActivities: { units: { USD: [q('2025-01-27', '2025-04-27', 27), q('2025-01-27', '2025-07-27', 42)] } },
      CashAndCashEquivalentsAtCarryingValue: { units: { USD: [{ end: '2025-07-27', val: 11.6, filed: '2025-08-01' }] } },
      EarningsPerShareDiluted: { units: { 'USD/shares': [q('2025-01-27', '2025-04-27', 0.76), q('2025-01-27', '2025-07-27', 1.8)] } },
    },
  };

  it('lays quarters out by the calendar quarter they mostly fall in, deriving the fourth', () => {
    const t = financialTable(facts, 'quarterly');
    assert.deepEqual(t.periods.map((p) => p.label), ['2025 2분기', '2025 1분기', '2024 4분기', '2024 3분기', '2024 2분기', '2024 1분기']);
    const rev = t.rows.find((r) => r.key === 'revenue')!;
    // 130 − (26 + 30 + 35) for the quarter ending 2025-01-26
    assert.deepEqual(rev.values, [46.74, 44, 39, 35, 30, 26]);
    assert.equal(rev.yoy[0], 55.8);
    assert.equal(t.rows.find((r) => r.key === 'netIncome')!.yoy[0], 65);
  });

  it('derives quarterly cash flow from year-to-date figures, but not per-share numbers', () => {
    const t = financialTable(facts, 'quarterly');
    assert.deepEqual(t.rows.find((r) => r.key === 'operatingCashFlow')!.values.slice(0, 2), [15, 27]);
    assert.deepEqual(t.rows.find((r) => r.key === 'epsDiluted')!.values.slice(0, 2), [null, 0.76]);
    assert.equal(t.rows.find((r) => r.key === 'cash')!.values[0], 11.6);
    assert.equal(t.margins.net[0], Math.round((26.4 / 46.74) * 1000) / 10);
    assert.deepEqual(t.latestFiling, { form: '10-Q', filed: '2026-08-01' });
    assert.match(t.note, /앞 분기까지를 뺀 값/);
  });

  it('puts a fiscal year in the calendar year it mostly covers', () => {
    const t = financialTable(facts, 'annual');
    assert.deepEqual(t.periods.map((p) => [p.label, p.end]), [['2024', '2025-01-26']]);
    assert.equal(t.rows.find((r) => r.key === 'revenue')!.values[0], 130);
  });

  it('says where to look when a company has no quarterly numbers', () => {
    const t = financialTable({ 'ifrs-full': { Revenue: { units: { TWD: [{ start: '2024-01-01', end: '2024-12-31', val: 2894, filed: '2025-04-17', form: '20-F' }] } } } }, 'quarterly');
    assert.equal(t.periods.length, 0);
    assert.match(t.note, /6-K/);
  });
});
