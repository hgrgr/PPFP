import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { alignedReturns, convert, correlation, portfolioReturns, regress, riskContributions, riskStats, rollingBeta } from '../risk';

const close = (a: number | null | undefined, b: number, eps = 1e-9) => assert.ok(a !== null && a !== undefined && Math.abs(a - b) < eps, `${a} ≈ ${b}`);

describe('risk', () => {
  it('aligns series on one calendar and carries over holidays', () => {
    const s = new Map([
      ['A', [{ date: 'd1', close: 100 }, { date: 'd2', close: 110 }, { date: 'd4', close: 121 }]],
      ['B', [{ date: 'd2', close: 50 }, { date: 'd3', close: 55 }, { date: 'd4', close: 55 }]],
    ]);
    const a = alignedReturns(s, ['d1', 'd2', 'd3', 'd4']);
    assert.deepEqual(a.dates, ['d3', 'd4']);
    assert.equal(a.returns.get('A')![0], 0);
    close(a.returns.get('A')![1], 0.1);
    close(a.returns.get('B')![0], 0.1);
    assert.equal(a.returns.get('B')![1], 0);
    assert.deepEqual(convert([{ date: 'd1', close: 2 }, { date: 'd3', close: 3 }], [{ date: 'd1', close: 1000 }, { date: 'd2', close: 1100 }]), [{ date: 'd1', close: 2000 }, { date: 'd3', close: 3300 }]);
  });

  it('weights, contributes and correlates', () => {
    const r = new Map([
      ['A', [0.01, -0.02, 0.03, -0.01, 0.02]],
      ['B', [0.01, -0.02, 0.03, -0.01, 0.02]],
    ]);
    const w = new Map([['A', 0.25], ['B', 0.75]]);
    assert.deepEqual(portfolioReturns(r, w).map((x) => Number(x.toFixed(10))), [0.01, -0.02, 0.03, -0.01, 0.02]);
    const rc = riskContributions(r, w);
    close(rc.get('A'), 0.25);
    close(rc.get('B'), 0.75);
    close(correlation(r.get('A')!, r.get('B')!), 1);
  });

  it('measures volatility, VaR and drawdown', () => {
    const r = [0.1, -0.5, 0.2, 0.1, ...new Array(36).fill(0)];
    const d = r.map((_, i) => `d${i}`);
    const s = riskStats(r, d);
    close(s.maxDrawdown, -0.5);
    assert.equal(s.drawdownFrom, 'd0');
    assert.equal(s.drawdownTo, 'd1');
    assert.deepEqual(s.worstDay, { date: 'd1', ret: -0.5 });
    // 5% of 40 days = 2: the second worst day
    close(s.var95, 0);
    assert.ok(s.cvar95 > 0.2);
  });

  it('recovers betas by least squares', () => {
    const x1 = Array.from({ length: 200 }, (_, i) => Math.sin(i * 1.3) / 100);
    const x2 = Array.from({ length: 200 }, (_, i) => Math.cos(i * 0.7) / 100);
    const y = x1.map((v, i) => 0.0001 + 1.2 * v - 0.5 * x2[i]);
    const f = regress(y, [x1, x2])!;
    close(f.betas[0], 1.2, 1e-9);
    close(f.betas[1], -0.5, 1e-9);
    close(f.alpha, 0.0001, 1e-12);
    close(f.r2, 1, 1e-9);
    assert.equal(regress([1, 2], [[1, 2]]), null);
    const rb = rollingBeta(y, x1, x1.map((_, i) => `d${i}`), 60, 20);
    assert.equal(rb.length, 8);
  });
});
