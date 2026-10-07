import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { D, Dec } from '../decimal';
import { dailySeries, positionsAsOf, weekdays, type LedgerTxn } from '../ledger';
import { combineSeries, downsample, summarize, twrIndex, type SeriesPoint } from '../performance';
import { minusMonths, periodStart, resolveRange } from '../period';
import { toCsv } from '../csv';

const pt = (date: string, value: number | string, flow: number | string = 0): SeriesPoint => ({
  date,
  value: D(value),
  flow: D(flow),
});

describe('summarize', () => {
  it('separates deposits from performance', () => {
    // +10% on day 2, then a 100 deposit, then +10% again
    const s = [pt('2026-01-01', 100), pt('2026-01-02', 110), pt('2026-01-05', 210, 100), pt('2026-01-06', 231)];
    const r = summarize(s, '2026-01-01', '2026-01-06')!;
    assert.equal(r.netFlow.toString(), '100');
    assert.equal(r.pnl.toString(), '31');
    assert.equal(r.twr.toFixed(6), '0.210000'); // 1.1 * 1.0 * 1.1 − 1
  });

  it('measures drawdown on the TWR index', () => {
    const s = [pt('2026-01-01', 100), pt('2026-01-02', 120), pt('2026-01-05', 90), pt('2026-01-06', 130)];
    const r = summarize(s, '2026-01-01', '2026-01-06')!;
    assert.equal(r.maxDrawdown.toFixed(4), '-0.2500');
  });

  it('uses the last point on or before the start date', () => {
    const s = [pt('2026-01-02', 100), pt('2026-01-05', 105), pt('2026-01-06', 110)];
    const r = summarize(s, '2026-01-04', '2026-01-06')!; // weekend start -> Jan 2
    assert.equal(r.startDate, '2026-01-02');
    assert.equal(r.pnl.toString(), '10');
  });

  it('starts from zero when history begins inside the period', () => {
    const s = [pt('2026-03-02', 1000, 1000), pt('2026-03-03', 1010)];
    const r = summarize(s, '2026-01-01', '2026-03-03')!;
    assert.equal(r.startValue.toString(), '0');
    assert.equal(r.netFlow.toString(), '1000');
    assert.equal(r.pnl.toString(), '10');
    assert.equal(r.twr.toFixed(3), '0.010');
  });

  it('returns null for empty series', () => {
    assert.equal(summarize([], '2026-01-01', '2026-01-02'), null);
  });
});

describe('combineSeries', () => {
  it('weights children and keeps flows on their own date', () => {
    const a = [pt('2026-01-01', 100), pt('2026-01-02', 200, 100)];
    const b = [pt('2026-01-01', 50), pt('2026-01-03', 60)];
    const c = combineSeries([
      { weight: Dec.ONE, series: a },
      { weight: D('0.5'), series: b },
    ]);
    assert.deepEqual(c.map((p) => [p.date, p.value.toString(), p.flow.toString()]), [
      ['2026-01-01', '125', '0'],
      ['2026-01-02', '225', '100'],
      ['2026-01-03', '230', '0'],
    ]);
  });
});

describe('ledger replay', () => {
  const txns: LedgerTxn[] = [
    { id: '1', type: 'DEPOSIT', tradeAt: '2026-01-02T09:00:00Z', currency: 'KRW', cashDelta: D(1_000_000), flow: D(1_000_000) },
    { id: '2', type: 'BUY', tradeAt: '2026-01-02T10:00:00Z', holdingId: 'h1', qty: D(10), currency: 'KRW', cashDelta: D(-700_000), flow: D(0) },
    { id: '3', type: 'SPLIT', tradeAt: '2026-01-06T00:00:00Z', holdingId: 'h1', splitRatio: D(2), currency: 'KRW', cashDelta: D(0), flow: D(0) },
    { id: '4', type: 'SELL', tradeAt: '2026-01-07T10:00:00Z', holdingId: 'h1', qty: D(5), currency: 'KRW', cashDelta: D(200_000), flow: D(0) },
    { id: '5', type: 'BUY', tradeAt: '2026-01-07T11:00:00Z', holdingId: 'house', qty: D(1), currency: 'KRW', cashDelta: D(0), flow: D(500_000_000) },
  ];
  const prices: Record<string, Record<string, number>> = {
    h1: { '2026-01-02': 70_000, '2026-01-05': 72_000, '2026-01-06': 36_500, '2026-01-07': 40_000 },
    house: { '2026-01-07': 500_000_000 },
  };
  const holdingRef = (id: string) => ({
    id,
    currency: 'KRW',
    priceOn: (date: string) => {
      const ds = Object.keys(prices[id]).filter((d) => d <= date).sort();
      return ds.length ? D(prices[id][ds[ds.length - 1]]) : null;
    },
  });

  it('replays quantities including splits', () => {
    const p = positionsAsOf(txns, '2026-01-07');
    assert.equal(p.qty.get('h1')!.toString(), '15');
    assert.equal(p.cash.get('KRW')!.toString(), '500000');
  });

  it('builds a daily series whose TWR ignores the in-kind contribution', () => {
    const dates = weekdays('2026-01-02', '2026-01-07');
    assert.deepEqual(dates, ['2026-01-02', '2026-01-05', '2026-01-06', '2026-01-07']);
    const s = dailySeries(dates, txns, [holdingRef('h1'), holdingRef('house')], () => Dec.ONE);
    assert.deepEqual(s.map((x) => x.value.toString()), ['1000000', '1020000', '1030000', '501100000']);
    const r = summarize(s, '2026-01-02', '2026-01-07')!;
    assert.equal(r.netFlow.toString(), '500000000');
    assert.equal(r.pnl.toString(), '100000');
    assert.equal(twrIndex(s).at(-1)!.toFixed(4), '1.1000');
  });
});

describe('periods', () => {
  it('clamps month arithmetic', () => {
    assert.equal(minusMonths('2026-03-31', 1), '2026-02-28');
    assert.equal(minusMonths('2024-03-31', 1), '2024-02-29');
    assert.equal(minusMonths('2026-01-15', 13), '2024-12-15');
  });

  it('resolves presets and custom ranges', () => {
    assert.equal(periodStart('YTD', '2026-10-07', '2020-01-01'), '2025-12-31');
    assert.equal(periodStart('ALL', '2026-10-07', '2024-05-02'), '2024-05-01');
    assert.deepEqual(resolveRange({ from: '2026-01-01', to: '2026-12-31' }, '2026-10-07', '2020-01-01'), {
      start: '2026-01-01',
      end: '2026-10-07',
      key: 'CUSTOM',
    });
    assert.equal(resolveRange({ period: 'bogus' }, '2026-10-07', '2020-01-01').key, '1Y');
  });
});

describe('misc', () => {
  it('downsamples keeping both ends', () => {
    const xs = Array.from({ length: 1000 }, (_, i) => i);
    const d = downsample(xs, 5);
    assert.deepEqual(d, [0, 250, 500, 749, 999]);
  });

  it('writes Excel-friendly CSV and defuses formulas', () => {
    const csv = toCsv([{ a: '삼성전자', b: '=HYPERLINK("x")', c: -5 }], [
      { header: '종목', value: (r) => r.a },
      { header: '메모', value: (r) => r.b },
      { header: '수량', value: (r) => r.c },
    ]);
    assert.equal(csv, '﻿종목,메모,수량\r\n삼성전자,"\'=HYPERLINK(""x"")",-5\r\n');
  });
});
