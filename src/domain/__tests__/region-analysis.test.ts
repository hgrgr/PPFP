import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { addMonths, type Point } from '../indicators';
import {
  cci,
  correlationMatrix,
  diffOver,
  honeycombPath,
  lagCorrelation,
  mfi,
  pearson,
  quadrant,
  quadrantPath,
  rebase,
  regionOfAddress,
  regionReqs,
  regionSeries,
  RONE_REGIONS,
  roneRegion,
  rsi,
  seasonality,
  SIDO_KEYS,
  slowStochastic,
  sma,
  sourceOf,
  strongestLag,
  summarize,
} from '../region-analysis';

/** Monthly points from 2020-01 */
const monthly = (values: number[], start = '2020-01-01'): Point[] => values.map((value, i) => ({ date: addMonths(start, i), value }));
const close = (a: number | null | undefined, b: number, eps = 1e-9) => assert.ok(a !== null && a !== undefined && Math.abs(a - b) < eps, `${a} ≈ ${b}`);

describe('R-ONE regions', () => {
  it('has every 시도 and 시군구 with ids in the price and deal tables', () => {
    assert.equal(SIDO_KEYS.length, 18);
    assert.ok(SIDO_KEYS.includes('전국') && SIDO_KEYS.includes('세종') && !SIDO_KEYS.includes('수도권'));
    const gangnam = roneRegion('서울>강남구')!;
    assert.equal(gangnam.label, '서울 강남구');
    assert.equal(gangnam.depth, 1);
    assert.ok(gangnam.ids.price && gangnam.ids.trade);
    // Every region below the aggregates has a deal series
    for (const r of RONE_REGIONS.filter((x) => !['수도권', '지방권', '5대광역시'].includes(x.key))) assert.ok(r.ids.trade, r.key);
    assert.equal(new Set(RONE_REGIONS.map((r) => r.key)).size, RONE_REGIONS.length);
  });

  it('takes 수급동향 from the 시도 when the 시군구 has none', () => {
    const bundang = roneRegion('경기>성남시>분당구')!;
    assert.equal(sourceOf(bundang, 'demand')?.region.key, '경기');
    assert.equal(sourceOf(bundang, 'price')?.region.key, '경기>성남시>분당구');
    assert.equal(regionSeries(bundang, ['demand']).demand?.id, `IND:RONE:A_2024_00076/${roneRegion('경기')!.ids.demand}/100001`);
    // 수도권 has no deal table
    assert.equal(regionReqs(roneRegion('수도권')!, ['trade']).length, 0);
  });

  it('finds the region of an address', () => {
    assert.equal(regionOfAddress('경기 성남시 분당구 구미동 187-3')?.key, '경기>성남시>분당구');
    assert.equal(regionOfAddress('서울특별시 강남구 대치동 1')?.key, '서울>강남구');
    assert.equal(regionOfAddress('세종특별자치시 어진동 1')?.key, '세종');
    assert.equal(regionOfAddress('없는도 어딘가'), undefined);
  });
});

describe('moving windows and indicators', () => {
  it('averages, rebases and differences', () => {
    assert.deepEqual(sma(monthly([1, 2, 3, 4]), 2).map((p) => p.value), [1.5, 2.5, 3.5]);
    assert.deepEqual(rebase(monthly([50, 55, 60]), '2020-02-01').map((p) => p.value), [100, (60 / 55) * 100]);
    assert.deepEqual(diffOver(monthly([3.5, 3.25, 3.0]), 2).map((p) => p.value), [-0.5]);
  });

  it('RSI is 100 when it only rises and 0 when it only falls', () => {
    assert.ok(rsi(monthly([1, 2, 3, 4, 5, 6]), 3).every((p) => p.value === 100));
    assert.ok(rsi(monthly([6, 5, 4, 3, 2, 1]), 3).every((p) => p.value === 0));
    const mixed = rsi(monthly([10, 11, 10, 11, 10, 11, 10]), 2);
    assert.ok(mixed.every((p) => p.value > 0 && p.value < 100));
  });

  it('CCI is positive above its average and negative below', () => {
    const c = cci(monthly([10, 10, 10, 10, 14]), 5);
    assert.equal(c.length, 1);
    // mean 10.8, mean deviation 1.28 → (14 − 10.8) / (0.015 × 1.28)
    close(c[0].value, 3.2 / (0.015 * 1.28));
    assert.ok(cci(monthly([14, 14, 14, 14, 10]), 5)[0].value < 0);
  });

  it('slow stochastic sits at 100 at the top of its range and 0 at the bottom', () => {
    const up = slowStochastic(monthly([1, 2, 3, 4, 5, 6, 7, 8]), 3, 2, 2);
    assert.ok(up.k.every((p) => p.value === 100));
    assert.ok(up.d.every((p) => p.value === 100));
    const down = slowStochastic(monthly([8, 7, 6, 5, 4, 3, 2, 1]), 3, 2, 2);
    assert.ok(down.k.every((p) => p.value === 0));
  });

  it('MFI weighs rising months by their deals', () => {
    const price = monthly([100, 101, 100, 101]);
    const heavyUp = mfi(price, monthly([10, 30, 10, 30]), 3);
    const heavyDown = mfi(price, monthly([30, 10, 30, 10]), 3);
    assert.equal(heavyUp.length, 1);
    assert.ok(heavyUp[0].value > 50 && heavyDown[0].value < 50);
  });
});

describe('correlation', () => {
  it('pearson is 1, −1 or null', () => {
    close(pearson([1, 2, 3, 4], [2, 4, 6, 8]), 1);
    close(pearson([1, 2, 3, 4], [8, 6, 4, 2]), -1);
    assert.equal(pearson([1, 1, 1], [1, 2, 3]), null);
    assert.equal(pearson([1, 2], [1, 2]), null);
  });

  it('builds a symmetric matrix on shared dates', () => {
    const a = monthly([1, 2, 3, 2, 1, 2]), b = monthly([2, 4, 6, 4, 2, 4]), c = monthly([3, 2, 1, 2, 3, 2]);
    const m = correlationMatrix([{ key: 'a', pts: a }, { key: 'b', pts: b }, { key: 'c', pts: c }]);
    close(m[0][1], 1);
    close(m[0][2], -1);
    assert.equal(m[1][0], m[0][1]);
    assert.equal(m[2][2], 1);
  });

  it('finds the lead of a series that moves first', () => {
    // y repeats x three months later
    const xs = Array.from({ length: 60 }, (_, i) => Math.sin(i / 4) + (i % 7) / 10);
    const x = monthly(xs);
    const y = monthly(xs, '2020-04-01');
    const lags = lagCorrelation(x, y, 6);
    assert.equal(lags.length, 13);
    const best = strongestLag(lags, 24)!;
    assert.equal(best.lag, 3);
    close(best.r, 1);
  });
});

describe('phases', () => {
  it('names the four quadrants', () => {
    assert.equal(quadrant(1, 1).n, 1);
    assert.equal(quadrant(-1, 1).n, 2);
    assert.equal(quadrant(-1, -1).n, 3);
    assert.equal(quadrant(1, -1).n, 4);
  });

  it('walks the quadrant month by month', () => {
    const price = monthly([100, 101, 102, 103, 102, 101]);
    const jeonse = monthly([100, 100.5, 101, 101.5, 102, 102.5]);
    const path = quadrantPath(price, jeonse, 1, 10);
    assert.equal(path.length, 5);
    assert.equal(path[0].q.n, 1);
    assert.equal(path.at(-1)!.q.n, 2);
    close(path[0].x, 1);
  });

  it('places prices and deals on the honeycomb, real when given CPI', () => {
    // Deals jump in the last six months while prices rise 3% over six
    const price = monthly(Array.from({ length: 18 }, (_, i) => 100 + i * 0.5));
    const trades = monthly(Array.from({ length: 18 }, (_, i) => (i < 12 ? 100 : 200)));
    const nominal = honeycombPath(price, trades, { window: 6 });
    const last = nominal.at(-1)!;
    assert.equal(last.date, '2021-06-01');
    close(last.x, 100); // 1200 deals against 600
    close(last.y, (108.5 / 105.5 - 1) * 100);
    assert.equal(last.phase, 1);
    // Prices rising exactly with CPI are flat in real terms
    const cpi = price.map((p) => ({ ...p }));
    const real = honeycombPath(price, trades, { window: 6, cpi }).at(-1)!;
    close(real.y, 0);
    assert.equal(real.phase, 6);
  });
});

describe('summaries', () => {
  it('reads changes, distance from the peak and the median price', () => {
    const r = roneRegion('서울')!;
    const price = monthly([...Array.from({ length: 40 }, (_, i) => 100 + i), 130]);
    const s = summarize(r, { price, ratio: monthly([55, 52]), median: monthly([1_050_000, 1_071_000]), trade: monthly(Array.from({ length: 24 }, (_, i) => (i < 12 ? 100 : 150))) });
    assert.equal(s.date, addMonths('2020-01-01', 40));
    close(s.m1, (130 / 139 - 1) * 100);
    close(s.fromPeak, (130 / 139 - 1) * 100);
    assert.equal(s.peakDate, addMonths('2020-01-01', 39));
    assert.equal(s.ratio, 52);
    close(s.median, 10.71);
    close(s.tradeY1, 50);
  });

  it('lays deals out by month and year with each month’s share', () => {
    const trades = monthly(Array.from({ length: 30 }, (_, i) => (i % 12 === 2 ? 300 : 100)));
    const s = seasonality(trades, 3);
    assert.deepEqual(s.years, ['2020', '2021', '2022']);
    assert.equal(s.rows[2].y2020, 300);
    assert.equal(s.rows[11].y2022, null);
    // Two complete years, March is 300 of 1400 each
    close(s.share[2].pct, (300 / 1400) * 100);
    close(s.share.reduce((a, b) => a + b.pct, 0), 100);
  });
});
