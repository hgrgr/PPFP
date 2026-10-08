import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { backtest, mixAssumptions, monthlyNeeded, simulateGoal } from '../goals';

describe('goal simulation', () => {
  it('blends assumptions by mix, with diversification lowering volatility', () => {
    const a = mixAssumptions({ US_STOCK: 50, BOND: 50 });
    assert.equal(Math.round(a.ret * 10000) / 100, 5.75);
    assert.ok(a.vol < (0.17 + 0.06) / 2);
    assert.deepEqual(mixAssumptions({}), { ret: 0.05, vol: 0.12 });
  });

  it('without volatility is the plain compound path', () => {
    const s = simulateGoal({ start: 1_000_000, monthly: 0, months: 24, target: 1_210_000, ret: 0.1, vol: 0, paths: 20 });
    assert.equal(Math.round(s.years.at(-1)!.p50), 1_210_000);
    assert.equal(Math.round(s.years.at(-1)!.expected), 1_210_000);
    assert.equal(s.probability, 1);
    assert.equal(s.medianReachMonth, 24);
    assert.equal(s.years.length, 2);
  });

  it('spreads outcomes with volatility and repeats with the same seed', () => {
    const g = { start: 10_000_000, monthly: 500_000, months: 120, target: 100_000_000, ret: 0.07, vol: 0.18, paths: 500 };
    const a = simulateGoal(g);
    const b = simulateGoal(g);
    assert.deepEqual(a, b);
    const end = a.years.at(-1)!;
    assert.ok(end.p10 < end.p50 && end.p50 < end.p90);
    assert.ok(a.probability > 0.2 && a.probability < 0.9);
    assert.equal(a.contributed, 70_000_000);
  });

  it('shows values in today\'s money when inflation is given', () => {
    const s = simulateGoal({ start: 1_000_000, monthly: 0, months: 12, target: 0, ret: 0, vol: 0, inflation: 0.03, paths: 5 });
    assert.equal(Math.round(s.years[0].p50), Math.round(1_000_000 / 1.03));
  });

  it('finds the monthly saving that reaches the target', () => {
    const m = monthlyNeeded(0, 1_200_000, 12, 0);
    assert.equal(Math.round(m), 100_000);
    assert.equal(monthlyNeeded(2_000_000, 1_000_000, 12, 0.05), 0);
  });
});

describe('rebalancing backtest', () => {
  // Asset A doubles then falls back, B stays flat
  const dates = ['2026-01-02', '2026-01-30', '2026-02-02', '2026-02-27', '2026-03-02'];
  const prices = [
    [100, 100],
    [200, 100],
    [200, 100],
    [100, 100],
    [100, 100],
  ];

  it('buy and hold drifts with the winner', () => {
    const r = backtest(dates, prices, [0.5, 0.5], 'NONE');
    assert.equal(r.rebalances, 0);
    assert.equal(Math.round(r.totalReturn * 1000), 0);
    assert.equal(Math.round(r.maxDrawdown * 1000), Math.round((1 / 1.5 - 1) * 1000));
  });

  it('monthly rebalancing trims the winner at month start', () => {
    const r = backtest(dates, prices, [0.5, 0.5], 'MONTHLY');
    assert.equal(r.rebalances, 2);
    // Feb 2: rebalanced at 1.5 into 0.75/0.75; A halves → 0.375 + 0.75 = 1.125
    assert.equal(Math.round(r.values[3] * 1000), 1125);
    assert.ok(r.turnover > 0);
  });

  it('band rebalancing trades only when a weight drifts out of band', () => {
    const r = backtest(dates, prices, [0.5, 0.5], 'BAND', 0.1);
    assert.ok(r.rebalances >= 1);
    assert.throws(() => backtest(dates, [[null, 100]], [0.5, 0.5], 'NONE'));
  });
});
