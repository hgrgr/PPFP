import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { D, Dec } from '../decimal';
import { applyPicks, applySplit, averageCost, lotUnitCost, planSale, realize, type Lot } from '../lots';

// The AAPL example from the sample dashboard.
const lots: Lot[] = [
  { id: 'L1', acquiredAt: '2024-03-12T10:00:00Z', qtyRemaining: D(15), unitCost: D('171.2'), fxRate: D(1330) },
  { id: 'L2', acquiredAt: '2025-01-08T10:00:00Z', qtyRemaining: D(20), unitCost: D('229.4'), fxRate: D(1460) },
  { id: 'L3', acquiredAt: '2025-08-21T10:00:00Z', qtyRemaining: D(10), unitCost: D('226.1'), fxRate: D(1390) },
];
const sale = { price: '247.8', at: '2026-10-07T05:00:00Z' };

function picks(method: Parameters<typeof planSale>[2], qty: string | number, specific?: { lotId: string; qty: number }[]) {
  const p = planSale(lots, qty, method, specific);
  assert.equal(p.ok, true, !p.ok ? p.message : '');
  return p.ok ? p.picks : [];
}

const show = (ps: { lotId: string; qty: Dec }[]) => ps.map((p) => `${p.lotId}:${p.qty}`).join(' ');

describe('planSale', () => {
  it('FIFO takes the oldest lots first', () => {
    const p = picks('FIFO', 25);
    assert.equal(show(p), 'L1:15 L2:10');
    assert.equal(realize(lots, p, sale).pnl.toString(), '1333');
  });

  it('LIFO takes the newest lots first', () => {
    assert.equal(show(picks('LIFO', 25)), 'L3:10 L2:15');
  });

  it('HIFO takes the most expensive lots first (smallest gain)', () => {
    const p = picks('HIFO', 25);
    assert.equal(show(p), 'L2:20 L3:5');
    assert.equal(realize(lots, p, sale).pnl.toString(), '476.5');
  });

  it('LOFO takes the cheapest lots first', () => {
    assert.equal(show(picks('LOFO', 25)), 'L1:15 L3:10');
  });

  it('SPECIFIC uses exactly what the user picked', () => {
    const p = picks('SPECIFIC', 25, [
      { lotId: 'L3', qty: 10 },
      { lotId: 'L1', qty: 5 },
      { lotId: 'L2', qty: 10 },
    ]);
    assert.equal(show(p), 'L1:5 L2:10 L3:10');
  });

  it('SPECIFIC rejects mismatched or oversized picks', () => {
    const a = planSale(lots, 25, 'SPECIFIC', [{ lotId: 'L1', qty: 5 }]);
    assert.equal(!a.ok && a.reason, 'SPECIFIC_MISMATCH');
    const b = planSale(lots, 16, 'SPECIFIC', [{ lotId: 'L1', qty: 16 }]);
    assert.equal(!b.ok && b.reason, 'OVER_LOT');
    const c = planSale(lots, 1, 'SPECIFIC', [{ lotId: 'nope', qty: 1 }]);
    assert.equal(!c.ok && c.reason, 'UNKNOWN_LOT');
  });

  it('AVERAGE consumes pro rata and realizes against the average cost', () => {
    const p = picks('AVERAGE', 9);
    assert.equal(Dec.sum(p.map((x) => x.qty)).toString(), '9');
    assert.equal(show(p), 'L1:3 L2:4 L3:2');
    const avg = averageCost(lots);
    const expected = D(9).mul(D('247.8').sub(avg));
    assert.equal(realize(lots, p, sale).pnl.toFixed(6), expected.toFixed(6));
  });

  it('AVERAGE keeps the exact total with awkward fractions', () => {
    const p = picks('AVERAGE', '7.12345678');
    assert.equal(Dec.sum(p.map((x) => x.qty)).toString(), '7.12345678');
  });

  it('refuses to oversell or sell nothing', () => {
    const a = planSale(lots, 46, 'FIFO');
    assert.equal(!a.ok && a.reason, 'INSUFFICIENT');
    const b = planSale(lots, 0, 'FIFO');
    assert.equal(!b.ok && b.reason, 'INVALID_QTY');
  });

  it('skips empty lots', () => {
    const drained = applyPicks(lots, [{ lotId: 'L1', qty: D(15) }]);
    const p = planSale(drained, 1, 'FIFO');
    assert.equal(p.ok && show(p.picks), 'L2:1');
  });
});

describe('realize', () => {
  it('spreads sale fees by quantity and keeps the total exact', () => {
    const p = picks('FIFO', 25);
    const r = realize(lots, p, { ...sale, fees: '10' });
    assert.equal(r.pnl.toString(), '1323');
    assert.equal(r.pieces[0].proceeds.toString(), D(15).mul('247.8').sub(6).toString());
  });

  it('computes base-currency P&L including the FX effect', () => {
    const p = picks('FIFO', 15); // all of L1, bought at 1330 KRW/USD
    const r = realize(lots, p, { ...sale, fxRate: 1392 });
    // 15 * 247.8 * 1392 − 15 * 171.2 * 1330
    assert.equal(r.pnlBase.toString(), D(15).mul('247.8').mul(1392).sub(D(15).mul('171.2').mul(1330)).toString());
    assert.equal(r.pieces[0].holdingDays, 938);
  });
});

describe('lot helpers', () => {
  it('builds unit cost with fees', () => {
    assert.equal(lotUnitCost('100', '3', '1.5').toString(), '100.5');
    assert.throws(() => lotUnitCost(1, 0));
  });

  it('adjusts lots for a 4:1 split without changing cost basis', () => {
    const s = applySplit(lots, 4);
    assert.equal(s[0].qtyRemaining.toString(), '60');
    assert.equal(s[0].unitCost.toString(), '42.8');
    assert.equal(s[0].qtyRemaining.mul(s[0].unitCost).toString(), lots[0].qtyRemaining.mul(lots[0].unitCost).toString());
  });

  it('never lets a lot go negative', () => {
    assert.throws(() => applyPicks(lots, [{ lotId: 'L3', qty: D(11) }]));
  });
});
