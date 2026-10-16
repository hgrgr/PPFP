import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { align, correlation, perYearOf, stats, yearly } from '../compare';

const close = (a: number | null | undefined, b: number, eps = 1e-9) => assert.ok(a !== null && a !== undefined && Math.abs(a - b) < eps, `${a} ≈ ${b}`);

describe('포트폴리오 비교', () => {
  it('aligns from the latest start and rebases to 1', () => {
    const a = align([
      { key: 'a', label: 'A', kind: 'real', points: [{ date: 'd1', index: 1 }, { date: 'd2', index: 1.1 }, { date: 'd4', index: 1.21 }] },
      { key: 'b', label: 'B', kind: 'index', points: [{ date: 'd2', index: 200 }, { date: 'd3', index: 220 }, { date: 'd4', index: 210 }] },
      { key: 'c', label: 'C', kind: 'virtual', points: [{ date: 'd1', index: 1 }] },
    ]);
    assert.deepEqual(a.dates, ['d2', 'd3', 'd4']);
    assert.deepEqual(a.values.a.map((v) => Number(v.toFixed(6))), [1, 1, 1.1]);
    assert.deepEqual(a.values.b, [1, 1.1, 1.05]);
    assert.equal(a.values.c, undefined);
  });

  it('computes return, drawdown, Sharpe and correlation', () => {
    const dates = Array.from({ length: 253 }, (_, i) => new Date(Date.UTC(2025, 0, 1) + i * 86_400_000 * 1.44).toISOString().slice(0, 10));
    const idx = dates.map((_, i) => 1 + i * 0.001 + (i === 100 ? -0.05 : 0));
    const s = stats(idx, dates, 252);
    close(s.total, 0.252, 1e-9);
    assert.ok(s.maxDrawdown < -0.04);
    assert.ok(s.vol! > 0 && s.sharpe !== null && s.cagr !== null);
    close(correlation(idx, idx.map((v) => v * 3)), 1, 1e-9);
    assert.equal(correlation([1, 2], [1, 2]), null);
    assert.equal(perYearOf(['2026-01-05', '2026-01-12', '2026-01-19']), 52);
  });

  it('splits calendar years', () => {
    const y = yearly([1, 1.1, 1.21, 1.331], ['2024-06-03', '2024-12-31', '2025-06-02', '2025-12-31']);
    assert.equal(y.length, 2);
    close(y[0].ret, 0.1);
    close(y[1].ret, 1.331 / 1.1 - 1);
    assert.equal(y[0].partial, true);
    assert.equal(y[1].partial, false);
  });
});
