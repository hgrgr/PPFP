import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { byAsset, cashflow, forecast, frequency, months, type HeldAsset, type Payment } from '../dividends';

const pay = (assetId: string, date: string, amount: number, qty: number, fx = 1): Payment => ({ assetId, date, amount, qty, krw: amount * fx });
const held = (assetId: string, qty: number, currency = 'KRW', fx = 1, valueKrw = 1_000_000): HeldAsset => ({ assetId, name: assetId, symbol: assetId, currency, qty, fx, valueKrw });

describe('dividend frequency', () => {
  it('reads the usual gap between payments', () => {
    assert.equal(frequency(['2026-01-15', '2026-04-15', '2026-07-15']), 4);
    assert.equal(frequency(['2026-01-31', '2026-02-28', '2026-03-31']), 12);
    assert.equal(frequency(['2025-06-30', '2025-12-30']), 2);
    assert.equal(frequency(['2026-04-01']), 1);
  });
});

describe('dividend forecast', () => {
  it('repeats the latest per-share amount at the usual interval, for today\'s shares', () => {
    const p = forecast('2026-10-08', [held('S', 100)], [pay('S', '2026-05-20', 18050, 50), pay('S', '2026-08-18', 18050, 50)]);
    assert.deepEqual(
      p.map((x) => x.date.slice(0, 7)),
      ['2026-11', '2027-02', '2027-05', '2027-08'],
    );
    assert.equal(p[0].perShare, 361);
    assert.equal(p[0].amount, 36100);
    assert.equal(p[0].freq, 4);
  });

  it('converts foreign dividends at today\'s rate and skips stocks no longer held or long silent', () => {
    const p = forecast('2026-10-08', [held('A', 10, 'USD', 1400), held('OLD', 5), held('GONE', 0)], [pay('A', '2026-09-28', 2.5, 10, 1390), pay('OLD', '2025-01-10', 100, 5), pay('GONE', '2026-09-01', 50, 5)]);
    assert.ok(p.every((x) => x.assetId === 'A'));
    assert.equal(p[0].krw, 2.5 * 1400);
  });
});

describe('dividend cash flow', () => {
  it('lays out 24 months around today', () => {
    assert.deepEqual(months('2025-11', 3), ['2025-11', '2025-12', '2026-01']);
    const history = [pay('S', '2026-08-18', 18050, 50)];
    const projected = forecast('2026-10-08', [held('S', 50, 'KRW', 1, 4_000_000)], history);
    const c = cashflow('2026-10-08', history, projected);
    assert.equal(c.length, 24);
    assert.equal(c[0].month, '2025-11');
    assert.equal(c.find((x) => x.month === '2026-08')!.received, 18050);
    // One payment so far: treated as yearly
    assert.equal(c.find((x) => x.month === '2027-08')!.expected, 18050);
    assert.equal(c.find((x) => x.month === '2026-11')!.expected, 0);
    assert.ok(c.find((x) => x.month === '2026-10')!.current);

    const rows = byAsset('2026-10-08', [held('S', 50, 'KRW', 1, 4_000_000), held('X', 1)], history, projected);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].nextKrw, 18050);
    assert.equal(rows[0].yieldPct, 0.5);
  });
});
