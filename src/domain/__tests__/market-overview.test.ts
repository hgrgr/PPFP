import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  curveFrames,
  groupMap,
  parseBoeCsv,
  parseBundesbankCsv,
  parseMofCsv,
  parseSp500Members,
  parseSpark,
  parseSpdrHoldings,
  periodReturn,
  periodStart,
  returnFrames,
  squarify,
  yahooSymbols,
  yieldId,
  yieldRow,
  YIELD_COUNTRIES,
  type Close,
} from '../market-overview';

const close = (a: number | null | undefined, b: number, eps = 1e-9) => assert.ok(a !== null && a !== undefined && Math.abs(a - b) < eps, `${a} ≈ ${b}`);

/** Weekday closes from `from` to `to`, rising one per day from 100 */
function days(from: string, to: string): Close[] {
  const out: Close[] = [];
  let v = 100;
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
    const d = new Date(t);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    out.push({ date: d.toISOString().slice(0, 10), close: v++ });
  }
  return out;
}

describe('period returns', () => {
  it('measures from the close on or before the period start', () => {
    assert.equal(periodStart('2026-10-15', '1W'), '2026-10-08');
    assert.equal(periodStart('2026-10-15', 'YTD'), '2025-12-31');
    assert.equal(periodStart('2026-03-31', '1M'), '2026-02-28');
    assert.equal(periodStart('2026-10-15', '3Y'), '2023-10-15');
    const c: Close[] = [
      { date: '2025-12-30', close: 90 },
      { date: '2025-12-31', close: 100 },
      { date: '2026-01-02', close: 104 },
      { date: '2026-10-14', close: 120 },
      { date: '2026-10-15', close: 126 },
    ];
    close(periodReturn(c, '1D'), 126 / 120 - 1);
    close(periodReturn(c, 'YTD'), 0.26);
    // Base older than ten days before the start: unknown, not a stale 1W
    assert.equal(periodReturn(c, '1W'), null);
    assert.equal(periodReturn(c, '3Y'), null);
    close(periodReturn(c, 'YTD', '2026-01-02'), 0.04);
  });

  it('replays month-end returns', () => {
    const s = new Map([['A', days('2025-01-01', '2026-10-15')]]);
    const f = returnFrames(s, ['A'], '1M', 6);
    assert.equal(f.dates.at(-1), '2026-10-15');
    assert.equal(f.dates[0], '2026-04-30');
    assert.equal(f.dates.length, 7);
    assert.ok(f.values.A.every((v) => v !== null && v > 0));
  });

  it('reads spark answers and maps symbols to Yahoo', () => {
    const s = parseSpark({ XLK: { timestamp: [1760535000, 1760621400, 1760707800], close: [10, null, 12] }, BAD: { error: 1 } });
    assert.deepEqual(s.get('XLK'), [{ date: '2025-10-15', close: 10 }, { date: '2025-10-17', close: 12 }]);
    assert.equal(s.has('BAD'), false);
    assert.deepEqual(yahooSymbols('005930', 'KOSPI'), ['005930.KS']);
    assert.deepEqual(yahooSymbols('247540', '코스닥'), ['247540.KQ']);
    assert.deepEqual(yahooSymbols('000660', null), ['000660.KS', '000660.KQ']);
    assert.deepEqual(yahooSymbols('KRW-BTC', null), ['BTC-KRW']);
    assert.deepEqual(yahooSymbols('BRK.B', 'NYSE'), ['BRK-B']);
  });
});

describe('S&P 500 map', () => {
  const rows = [
    [null, 'Fund Name:', 'SPDR'],
    [],
    [null, 'Name', 'Ticker', 'Identifier', 'SEDOL', 'Weight', 'Sector'],
    [null, 'NVIDIA CORP', 'NVDA', 'x', 'y', 8.2, '-'],
    [null, 'APPLE INC', 'AAPL', 'x', 'y', 7.4, '-'],
    [null, 'ALPHABET INC CL A', 'GOOGL', 'x', 'y', 2, '-'],
    [null, 'ALPHABET INC CL C', 'GOOG', 'x', 'y', 1.6, '-'],
    [null, 'JPMORGAN', 'JPM', 'x', 'y', 1.5, '-'],
    [null, 'TPG INC', '2602335D', 'x', 'y', 0.000003, '-'],
    [null, 'US DOLLAR', 'CASH_USD', 'x', 'y', 0.1, '-'],
  ];
  const html = `<table id="constituents"><tbody><tr><th>Symbol</th></tr>
<tr><td><a href="x">NVDA</a></td><td><a>Nvidia</a></td><td>Information Technology</td><td>Semiconductors</td><td>x</td><td>2001</td><td>0001045810</td></tr>
<tr><td><a>AAPL</a></td><td><a>Apple Inc.</a></td><td>Information Technology</td><td>Technology Hardware, Storage &amp; Peripherals</td><td>x</td><td>1982</td><td>0000320193</td></tr>
<tr><td><a>GOOGL</a></td><td>Alphabet Inc. (Class A)</td><td>Communication Services</td><td>Interactive Media &amp; Services</td></tr>
<tr><td><a>GOOG</a></td><td>Alphabet Inc. (Class C)</td><td>Communication Services</td><td>Interactive Media &amp; Services</td></tr>
<tr><td><a>JPM</a></td><td>JPMorgan Chase</td><td>Financials</td><td>Diversified Banks</td></tr>
</tbody></table><table><tr><td>ZZZ</td><td>a</td><td>b</td><td>c</td></tr></table>`;

  it('reads the holdings sheet and the constituents table', () => {
    const h = parseSpdrHoldings(rows);
    assert.deepEqual(h.map((x) => x.ticker), ['NVDA', 'AAPL', 'GOOGL', 'GOOG', 'JPM']);
    const m = parseSp500Members(html);
    assert.equal(m.length, 5);
    assert.deepEqual(m[1], { symbol: 'AAPL', name: 'Apple Inc.', sector: 'Information Technology', industry: 'Technology Hardware, Storage & Peripherals', cik: '0000320193' });
  });

  it('groups by sector and industry with weight-averaged returns', () => {
    const ret = new Map<string, Record<string, number | null>>([
      ['NVDA', { '1D': 0.02 }],
      ['AAPL', { '1D': -0.01 }],
      ['GOOGL', { '1D': 0.01 }],
      ['GOOG', { '1D': null }],
    ]);
    const g = groupMap(parseSpdrHoldings(rows), parseSp500Members(html), ret, ['1D']);
    assert.deepEqual(g.map((s) => s.label), ['정보기술', '커뮤니케이션', '금융']);
    close(g[0].weight, 15.6);
    close(g[0].returns['1D'], (8.2 * 0.02 - 7.4 * 0.01) / 15.6);
    // GOOG unknown: GOOGL alone is more than half the weight
    close(g[1].returns['1D'], 0.01);
    assert.equal(g[2].returns['1D'], null);
    assert.equal(g[1].industries[0].stocks.length, 2);
  });

  it('squarifies into the box with areas in proportion', () => {
    const vals = [6, 6, 4, 3, 2, 2, 1];
    const box = { x: 0, y: 0, w: 600, h: 400 };
    const r = squarify(vals, box);
    const total = vals.reduce((a, v) => a + v, 0);
    r.forEach((q, i) => {
      close(q.w * q.h, (vals[i] / total) * 240000, 1e-6);
      assert.ok(q.x >= -1e-9 && q.y >= -1e-9 && q.x + q.w <= 600 + 1e-6 && q.y + q.h <= 400 + 1e-6);
    });
    // Squarified: no sliver worse than 1:4 for these values
    assert.ok(r.every((q) => Math.max(q.w / q.h, q.h / q.w) < 4));
    assert.deepEqual(squarify([0, 0], box), [{ x: 0, y: 0, w: 0, h: 0 }, { x: 0, y: 0, w: 0, h: 0 }]);
  });
});

describe('government bond yields', () => {
  it('reads the 재무성, 분데스방크 and 영란은행 files', () => {
    const mof = parseMofCsv('Interest Rate,,,(Unit : %)\nDate,1Y,2Y,10Y,40Y\n1974/9/24,10.327,9.362,-,-\n2026/10/2,1.65,1.919,3.097,4.1\n');
    assert.deepEqual(mof.get('10Y'), [{ date: '2026-10-02', close: 3.097 }]);
    assert.equal(mof.get('1Y')?.length, 2);
    const bbk = parseBundesbankCsv('﻿"",BBSIS.D.I.ZST.ZI.EUR.S1311.B.A604.R01XX.R.A.A._Z._Z.A,BBSIS.D.I.ZST.ZI.EUR.S1311.B.A604.R01XX.R.A.A._Z._Z.A_FLAGS,BBSIS.D.I.ZST.ZI.EUR.S1311.B.A604.R10XX.R.A.A._Z._Z.A,x_FLAGS\nunit,Prozent,,Prozent,\n2000-01-01,.,No value available,.,\n2026-10-14,2.96,,3.51,\n');
    assert.deepEqual(bbk.get('R10XX'), [{ date: '2026-10-14', close: 3.51 }]);
    assert.deepEqual(bbk.get('R01XX'), [{ date: '2026-10-14', close: 2.96 }]);
    const boe = parseBoeCsv('DATE,IUDSNPY,IUDMNPY\n04 Jan 2000,6.3171,5.723\n12 Oct 2026,4.9722,\n');
    assert.deepEqual(boe.get('IUDSNPY'), [{ date: '2000-01-04', close: 6.3171 }, { date: '2026-10-12', close: 4.9722 }]);
    assert.equal(boe.get('IUDMNPY')?.length, 1);
  });

  it('builds a row with changes and month-end curves', () => {
    const us = YIELD_COUNTRIES[0];
    const s = new Map<string, Close[]>([
      [yieldId('US', '10Y'), [{ date: '2025-10-15', close: 4.0 }, { date: '2026-09-15', close: 4.3 }, { date: '2026-09-30', close: 4.2 }, { date: '2026-10-08', close: 4.1 }, { date: '2026-10-15', close: 4.25 }]],
      [yieldId('US', '2Y'), [{ date: '2026-09-30', close: 3.6 }, { date: '2026-10-15', close: 3.5 }]],
    ]);
    const r = yieldRow(us, s);
    assert.equal(r.date, '2026-10-15');
    assert.equal(r.level['10Y'], 4.25);
    close(r.change['1W']['10Y'], 0.15, 1e-9);
    close(r.change['1M']['10Y'], -0.05, 1e-9);
    close(r.change['1Y']['10Y'], 0.25, 1e-9);
    assert.equal(r.change['1M']['2Y'], null);
    const f = curveFrames(s, '2026-09-01');
    assert.deepEqual(f.dates, ['2026-09-30', '2026-10-15']);
    assert.equal(f.curves.US?.[0]['10Y'], 4.2);
    assert.equal(f.curves.US?.[1]['2Y'], 3.5);
    assert.equal(f.curves.KR, undefined);
  });
});
