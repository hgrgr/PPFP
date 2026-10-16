import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatMetric, metrics, metricsWithWeeklyMarket, perYearOf, toReturns, weeklyIndex } from '../metrics';

const close = (a: number | null | undefined, b: number, eps = 1e-9) => assert.ok(a !== null && a !== undefined && Math.abs(a - b) < eps, `${a} ≈ ${b}`);

describe('evaluation metrics', () => {
  // 60 periods alternating +2% / −1%
  const r = Array.from({ length: 60 }, (_, i) => (i % 2 ? -0.01 : 0.02));

  it('measures return, risk and drawdown', () => {
    const m = metrics(r, 52, null, 0);
    close(m.total, 1.02 ** 30 * 0.99 ** 30 - 1);
    assert.ok(m.vol! > 0 && m.downsideVol! > 0 && m.downsideVol! < m.vol!);
    close(m.maxDrawdown, -0.01);
    assert.equal(m.drawdownLength, 2);
    assert.equal(m.recovered, true);
    close(m.winRate!, 0.5);
    close(m.best!, 0.02);
    close(m.worst!, -0.01);
    // Sharpe = annual mean ÷ annual vol (rf 0)
    const mean = 0.005, sd = Math.sqrt((60 * 0.015 ** 2) / 59);
    close(m.sharpe!, (mean * 52) / (sd * Math.sqrt(52)), 1e-9);
    // Downside deviation over all periods: half the periods at −1%
    close(m.downsideVol!, Math.sqrt(0.5 * 0.0001) * Math.sqrt(52), 1e-12);
    close(m.omega!, (30 * 0.02) / (30 * 0.01));
    assert.equal(m.beta, null);
  });

  it('tracks an unrecovered drawdown and needs enough periods', () => {
    const m = metrics([0.1, -0.2, 0.05], 252);
    assert.equal(m.recovered, false);
    assert.equal(m.drawdownLength, null);
    assert.equal(m.vol, null);
    assert.equal(m.sharpe, null);
  });

  it('compares with a benchmark', () => {
    const bench = r.map((x) => x / 2);
    const m = metrics(r, 52, bench, 0);
    close(m.beta!, 2);
    close(m.correlation!, 1);
    close(m.alpha!, 0, 1e-12);
    close(m.upCapture!, 2, 1e-9);
    close(m.downCapture!, 2, 1e-9);
    close(m.hitRate!, 0.5);
    assert.ok(m.informationRatio! > 0);
    const same = metrics(r, 52, r, 0);
    close(same.trackingError!, 0);
    assert.equal(same.informationRatio, null);
  });

  it('turns indexes into returns and formats', () => {
    assert.deepEqual(toReturns([100, 110, 99]).map((x) => Number(x.toFixed(10))), [0.1, -0.1]);
    assert.equal(perYearOf(['2025-03-31', '2025-06-30', '2025-09-30']), 4);
    assert.equal(perYearOf(['2026-01-05', '2026-01-06', '2026-01-07']), 252);
    assert.equal(formatMetric('sharpe', 1.234), '1.23');
    assert.equal(formatMetric('cagr', 0.123), '+12.3%');
    assert.equal(formatMetric('drawdownLength', 45, '일'), '45일');
    assert.equal(formatMetric('beta', null), '—');
  });

  it('takes market-relative figures from weekly returns', () => {
    const dates = Array.from({ length: 200 }, (_, i) => new Date(Date.UTC(2026, 0, 5) + Math.floor(i / 5) * 7 * 86_400_000 + (i % 5) * 86_400_000).toISOString().slice(0, 10));
    assert.deepEqual(weeklyIndex(dates.slice(0, 7), [1, 2, 3, 4, 5, 6, 7]), [5, 7]);
    // The portfolio is the benchmark one day later: daily beta is off, weekly close to 1
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) / 25;
    const b: number[] = [1];
    for (let i = 1; i < dates.length; i++) b.push(b[i - 1] * (1 + rnd()));
    const p = b.map((_, i) => b[Math.max(0, i - 1)]);
    const weekly = metricsWithWeeklyMarket(dates, p, b).beta!;
    const daily = metrics(toReturns(p), 252, toReturns(b)).beta!;
    assert.ok(Math.abs(weekly - 1) < Math.abs(daily - 1), `weekly ${weekly} daily ${daily}`);
  });
});
