import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { asOf, benchmarkReturns, contributions } from '../benchmark';

describe('benchmark returns', () => {
  const closes = [
    { date: '2026-01-02', close: 100 },
    { date: '2026-01-05', close: 110 },
    { date: '2026-01-07', close: 99 },
  ];

  it('uses the last close on or before each day', () => {
    assert.equal(asOf(closes, '2026-01-06')!.close, 110);
    assert.equal(asOf(closes, '2026-01-01'), null);
    const r = benchmarkReturns(['2026-01-02', '2026-01-06', '2026-01-07'], closes);
    assert.deepEqual(r.map((x) => Math.round(x! * 1000) / 10), [0, 10, -1]);
  });

  it('converts a foreign benchmark into won', () => {
    const fx = [
      { date: '2026-01-02', close: 1400 },
      { date: '2026-01-07', close: 1540 },
    ];
    const r = benchmarkReturns(['2026-01-02', '2026-01-07'], closes, fx);
    // 99 × 1540 / (100 × 1400) − 1 = 8.9%
    assert.equal(Math.round(r[1]! * 1000) / 10, 8.9);
  });

  it('is null before the benchmark has data', () => {
    assert.deepEqual(benchmarkReturns(['2025-12-31', '2026-01-05'], closes), [null, null]);
  });
});

describe('contributions', () => {
  it('splits the period P&L into positions and groups', () => {
    const c = contributions(
      [
        { key: 'A', label: '애플', group: '해외 주식', startKrw: 1_000_000, endKrw: 1_200_000, cashKrw: 10_000 },
        // Bought 500k more during the period and it is worth 1.4M now: +100k
        { key: 'B', label: '삼성전자', group: '국내 주식', startKrw: 800_000, endKrw: 1_400_000, cashKrw: -500_000 },
        // Sold out: worth 0 now, 450k came back
        { key: 'C', label: '카카오', group: '국내 주식', startKrw: 500_000, endKrw: 0, cashKrw: 450_000 },
        { key: 'D', label: '변동 없음', group: '현금', startKrw: 100, endKrw: 100, cashKrw: 0 },
      ],
      2_000_000,
    );
    assert.deepEqual(
      c.rows.map((r) => [r.key, r.pnlKrw, r.contributionPct]),
      [
        ['A', 210_000, 10.5],
        ['B', 100_000, 5],
        ['C', -50_000, -2.5],
      ],
    );
    assert.deepEqual(
      c.byGroup.map((g) => [g.label, g.pnlKrw]),
      [
        ['해외 주식', 210_000],
        ['국내 주식', 50_000],
      ],
    );
    assert.equal(c.totalPnlKrw, 260_000);
  });
});
