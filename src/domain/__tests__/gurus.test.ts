import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fixUnits, changesOf, cloneReturns, cloneStats, commonHoldings, consensus, figiTicker, GURUS, holdingsOf, infoTableFile, overlap, parseInfoTable, reportsThousands, type Holding } from '../gurus';

const close = (a: number | null | undefined, b: number, eps = 1e-9) => assert.ok(a !== null && a !== undefined && Math.abs(a - b) < eps, `${a} ≈ ${b}`);

const row = (cusip: string, name: string, value: number, shares: number, putCall = '') =>
  `<ns1:infoTable><ns1:nameOfIssuer>${name}</ns1:nameOfIssuer><ns1:titleOfClass>COM</ns1:titleOfClass><ns1:cusip>${cusip}</ns1:cusip><ns1:value>${value}</ns1:value><ns1:shrsOrPrnAmt><ns1:sshPrnamt>${shares}</ns1:sshPrnamt><ns1:sshPrnamtType>SH</ns1:sshPrnamtType></ns1:shrsOrPrnAmt>${putCall ? `<ns1:putCall>${putCall}</ns1:putCall>` : ''}</ns1:infoTable>`;

const h = (cusip: string, value: number, shares: number, weight: number, ticker: string | null = null): Holding => ({ cusip, name: cusip, ticker, value, shares, weight });

describe('13F', () => {
  it('has unique managers', () => {
    assert.equal(new Set(GURUS.map((g) => g.key)).size, GURUS.length);
    assert.equal(new Set(GURUS.map((g) => g.cik)).size, GURUS.length);
  });

  it('parses and sums an information table, options apart', () => {
    const xml = `<informationTable>${row('037833100', 'APPLE INC', 600, 3)}${row('037833100', 'APPLE INC', 400, 2)}${row('037833100', 'APPLE INC', 50, 1, 'Put')}${row('02005n100', 'ALLY FINL &amp; CO', 100, 10)}${row('BAD', 'X', 1, 1)}</informationTable>`;
    const p = parseInfoTable(xml);
    assert.equal(p.length, 3);
    assert.deepEqual(p[0], { cusip: '037833100', name: 'APPLE INC', cls: 'COM', value: 1000, shares: 5, putCall: null });
    assert.equal(p.find((x) => x.putCall === 'PUT')?.value, 50);
    assert.equal(p.find((x) => x.cusip === '02005N100')?.name, 'ALLY FINL & CO');
    assert.equal(parseInfoTable(row('037833100', 'A', 7, 1), true)[0].value, 7000);
    assert.equal(reportsThousands('2022-11-14'), true);
    assert.equal(reportsThousands('2023-02-14'), false);
    const hs = holdingsOf(p, new Map([['037833100', 'AAPL']]));
    assert.equal(hs.length, 2);
    close(hs[0].weight, 1000 / 1100);
    assert.equal(hs[0].ticker, 'AAPL');
    assert.equal(hs[1].ticker, null);
  });

  it('takes values as thousands when shares look priced under a dollar', () => {
    const p = (value: number, shares: number) => ({ cusip: 'X', name: 'X', cls: '', value, shares, putCall: null });
    assert.deepEqual(fixUnits([p(150, 1000), p(30, 100), p(4, 10)]).map((x) => x.value), [150000, 30000, 4000]);
    assert.deepEqual(fixUnits([p(150000, 1000), p(30000, 100), p(4000, 10)]).map((x) => x.value), [150000, 30000, 4000]);
  });

  it('finds the information table file', () => {
    assert.equal(infoTableFile([{ name: 'primary_doc.xml', size: 5000 }, { name: 'a.xml', size: 10 }, { name: 'info.xml', size: '44724' }, { name: 'x.txt', size: 99999 }]), 'info.xml');
    assert.equal(infoTableFile([{ name: 'primary_doc.xml' }]), null);
  });

  it('classifies changes between reports', () => {
    const prev = [h('A', 100, 10, 0.5), h('B', 100, 10, 0.25), h('C', 100, 10, 0.25), h('D', 50, 5, 0.1)];
    const cur = [h('A', 220, 20, 0.4), h('B', 101, 10.1, 0.2), h('C', 60, 5, 0.1), h('E', 150, 3, 0.3)];
    const c = new Map(changesOf(prev, cur).map((x) => [x.cusip, x]));
    assert.equal(c.get('A')!.kind, 'add');
    close(c.get('A')!.flow, 110);
    assert.equal(c.get('B')!.kind, 'same');
    assert.equal(c.get('C')!.kind, 'reduce');
    close(c.get('C')!.flow, -60);
    assert.equal(c.get('D')!.kind, 'sold');
    assert.equal(c.get('D')!.flow, -50);
    assert.equal(c.get('E')!.kind, 'new');
  });

  it('ranks consensus buys, sells and common holdings', () => {
    const g1 = changesOf([h('A', 1, 1, 1)], [h('A', 2, 2, 0.5, 'AAA'), h('B', 2, 2, 0.5, 'BBB')]);
    const g2 = changesOf([h('C', 5, 5, 1)], [h('B', 9, 9, 1)]);
    const buys = consensus([{ key: 'x', changes: g1 }, { key: 'y', changes: g2 }], 'buy');
    assert.deepEqual(buys.map((b) => b.cusip), ['B', 'A']);
    assert.equal(buys[0].gurus.length, 2);
    close(buys[0].flow, 11);
    const sells = consensus([{ key: 'x', changes: g1 }, { key: 'y', changes: g2 }], 'sell');
    assert.deepEqual(sells.map((b) => b.cusip), ['C']);
    const common = commonHoldings([{ key: 'x', holdings: [h('A', 1, 1, 0.6), h('B', 1, 1, 0.4)] }, { key: 'y', holdings: [h('B', 1, 1, 1)] }]);
    assert.equal(common[0].cusip, 'B');
    close(common[0].avgWeight, 0.7);
  });

  it('scores overlap with my portfolio', () => {
    const o = overlap(new Map([['AAPL', 0.5], ['MSFT', 0.3], ['005930', 0.2]]), new Map([['AAPL', 0.2], ['MSFT', 0.6], ['KO', 0.2]]));
    close(o.score, 0.5);
    assert.deepEqual(o.shared.map((s) => s.ticker), ['MSFT', 'AAPL']);
  });

  it('prices the copy of each report', () => {
    const p = (pts: [string, number][]) => pts.map(([date, close]) => ({ date, close }));
    const prices = new Map([
      ['A', p([['2026-03-31', 10], ['2026-06-30', 12], ['2026-10-14', 12]])],
      ['B', p([['2026-03-31', 20], ['2026-06-30', 18], ['2026-10-14', 27]])],
    ]);
    const bench = p([['2026-03-31', 100], ['2026-06-30', 105], ['2026-10-14', 110.25]]);
    const q = cloneReturns(
      [
        { date: '2026-06-30', weights: new Map([['A', 0.5], ['B', 0.5]]) },
        { date: '2026-03-31', weights: new Map([['A', 0.5], ['B', 0.25], ['Z', 0.25]]) },
      ],
      prices,
      bench,
      '2026-10-15',
    );
    assert.equal(q[0].from, '2026-03-31');
    // Z unpriced: A and B re-weighted 2:1
    close(q[0].ret, (0.5 * 0.2 + 0.25 * -0.1) / 0.75);
    close(q[0].covered, 0.75);
    close(q[1].ret, 0.25);
    close(q[1].bench, 0.05);
    const s = cloneStats(q);
    close(s.total, (1 + 0.1) * 1.25 - 1);
    close(s.bench, 1.05 * 1.05 - 1);
    assert.equal(s.sharpe, null);
  });

  it('reads OpenFIGI answers', () => {
    assert.equal(figiTicker({ data: [{ ticker: 'AAPL', exchCode: 'US', securityType: 'Common Stock' }, { ticker: 'AAPL', exchCode: 'UN' }] }), 'AAPL');
    assert.equal(figiTicker({ data: [{ ticker: 'BRK/B', exchCode: 'US', securityType: 'Common Stock' }] }), 'BRK.B');
    assert.equal(figiTicker({ warning: 'No identifier found.' }), null);
  });
});
