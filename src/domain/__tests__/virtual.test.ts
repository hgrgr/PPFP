import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cleanFx, dropSpikes, maxDrawdown, portfolioPath, toKrw, valuePosition, weekdays, type VPosition } from '../virtual';

const close = (a: number | null | undefined, b: number, eps = 1e-6) => assert.ok(a !== null && a !== undefined && Math.abs(a - b) < eps, `${a} ≈ ${b}`);
const pos = (o: Partial<VPosition>): VPosition => ({ id: 'p', kind: 'STOCK', name: 'x', buyDate: '2026-01-05', sellDate: null, mode: 'AMOUNT', amount: 1000, qty: null, rate: null, ...o });

describe('가상 포트폴리오', () => {
  const cal = weekdays('2026-01-05', '2026-01-16');
  const series = cal.map((date, i) => ({ date, close: 100 + i * 10 }));

  it('makes a weekday calendar', () => {
    assert.equal(cal.length, 10);
    assert.equal(cal[5], '2026-01-12');
  });

  it('buys an amount or a quantity at the buy-date close and sells into cash', () => {
    const a = valuePosition(pos({ buyDate: '2026-01-06' }), series, cal);
    assert.equal(a.buyPrice, 110);
    close(a.units, 1000 / 110);
    assert.equal(a.values[0], null);
    close(a.values[9], (1000 / 110) * 190);
    const q = valuePosition(pos({ mode: 'QTY', qty: 2, amount: null, sellDate: '2026-01-09' }), series, cal);
    assert.equal(q.cost, 200);
    assert.equal(q.values[4], 280);
    // Proceeds held flat after the sale
    assert.equal(q.values[9], 280);
    // A weekend buy takes Friday's close
    assert.equal(valuePosition(pos({ buyDate: '2026-01-10' }), series, cal).buyPrice, 140);
  });

  it('refuses a buy before the history starts', () => {
    const r = valuePosition(pos({ buyDate: '2025-06-01' }), series, cal);
    assert.match(r.problem!, /시세가 없습니다/);
    assert.equal(valuePosition(pos({}), null, cal).problem, '시세 이력을 받지 못했습니다');
  });

  it('compounds fixed rates and keeps cash flat', () => {
    const f = valuePosition(pos({ kind: 'FIXED', rate: 0.1, buyDate: '2025-01-05' }), null, ['2026-01-05']);
    close(f.values[0], 1000 * 1.1 ** (365 / 365));
    assert.equal(valuePosition(pos({ kind: 'CASH' }), null, cal).values[9], 1000);
  });

  it('follows a monthly index for real estate', () => {
    const idx = [{ date: '2025-12-01', close: 100 }, { date: '2026-01-01', close: 105 }];
    const r = valuePosition(pos({ kind: 'REAL_ESTATE', amount: 1e9, buyDate: '2026-01-05' }), idx, cal);
    assert.equal(r.buyPrice, 105);
    assert.equal(r.units, null);
    close(r.values[9], 1e9);
  });

  it('sums positions with time-weighted returns and a benchmark fed the same cash', () => {
    const p1 = pos({ id: 'a' }), p2 = pos({ id: 'b', buyDate: '2026-01-12', amount: 1000 });
    const flat = cal.map((date) => ({ date, close: 50 }));
    const r1 = valuePosition(p1, series, cal), r2 = valuePosition(p2, flat, cal);
    const path = portfolioPath([{ p: p1, r: r1 }, { p: p2, r: r2 }], cal, series);
    assert.equal(path.invested[4], 1000);
    assert.equal(path.invested[5], 2000);
    // New money on day 5 is not a gain
    close(path.twr[5] / path.twr[4], (r1.values[5]! + 1000 - 1000) / r1.values[4]!);
    // 1.4 before the second buy, 1.5 after day 5, then 2900 / 2500
    close(path.twr[9], 1.5 * (2900 / 2500));
    // Benchmark = the same flows into the benchmark series (here the first one)
    close(path.bench[9]!, (1000 / 100) * 190 + (1000 / 150) * 190);
    close(maxDrawdown([1, 1.2, 0.9, 1.3]), 0.9 / 1.2 - 1);
  });

  it('cleans bad price points', () => {
    const fx = [1100, 1110, 0.11, 0.11, 1120, 1130].map((close, i) => ({ date: `d${i}`, close }));
    assert.deepEqual(cleanFx(fx).map((c) => c.close), [1100, 1110, 1120, 1130]);
    const s = [10, 10, 10, 1, 10, 10].map((close, i) => ({ date: `d${i}`, close }));
    assert.equal(dropSpikes(s).length, 5);
    assert.deepEqual(toKrw([{ date: 'd2', close: 2 }], [{ date: 'd1', close: 1000 }]), [{ date: 'd2', close: 2000 }]);
  });
});
