import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { AptTrade } from '../real-estate';
import { areaClassOf, complexDetail, complexRanking, complexRows, dayOfMonthRun, dongRanking, drawdownBuckets, forecastMonth, leaderSeries, perPyeong } from '../complex-analysis';

const deal = (date: string, price: number, o: Partial<AptTrade> = {}): AptTrade => ({
  date,
  price,
  area: 84.97,
  floor: 10,
  aptNm: '푸른마을',
  umdCd: '10300',
  umdNm: '정자동',
  jibun: '1',
  aptSeq: 'A1',
  buildYear: 2005,
  cancelled: false,
  dealing: '중개거래',
  aptDong: null,
  rgstDate: null,
  buyer: null,
  seller: null,
  ...o,
});
const close = (a: number | null | undefined, b: number, eps = 1e-6) => assert.ok(a !== null && a !== undefined && Math.abs(a - b) < eps, `${a} ≈ ${b}`);
const TODAY = '2026-10-14';

describe('complex rows', () => {
  const trades = [
    deal('2021-09-10', 15e8),
    deal('2023-02-01', 11e8),
    deal('2026-08-20', 13e8),
    deal('2026-09-30', 14e8, { floor: 20 }),
    deal('2026-10-01', 20e8, { cancelled: true }),
    deal('2026-09-01', 9e8, { area: 59.9 }),
    deal('2026-09-02', 30e8, { aptSeq: 'B1', aptNm: '한솔', umdNm: '수내동', area: 84.5 }),
  ];
  const rows = complexRows(trades, () => '41135', TODAY);

  it('groups by complex and 평형 and leaves out cancelled deals', () => {
    assert.equal(rows.length, 3);
    const main = rows.find((r) => r.complex === 'A1' && r.area > 80)!;
    assert.equal(main.deals, 4);
    assert.equal(main.deals1y, 2);
    assert.equal(main.last.date, '2026-09-30');
    assert.equal(main.last.floor, 20);
    // recent = median of the last three months (13억, 14억)
    close(main.recent, 13.5e8);
    assert.equal(main.high.price, 15e8);
    close(main.fromHigh, (13.5 / 15 - 1) * 100);
    assert.equal(main.cls, 'MS');
    assert.equal(main.areaLabel, '85㎡ (34평형)');
    close(main.perPyeong, (13.5e8 / 84.97) * 3.305785);
  });

  it('sorts by price per 평 and buckets the distance from the high', () => {
    assert.equal(rows[0].name, '한솔');
    const b = drawdownBuckets(rows);
    assert.deepEqual(b.map((x) => x.count), [2, 1, 0, 0, 0]);
  });

  it('classes areas by 전용면적', () => {
    assert.equal(areaClassOf(59.99), 'S');
    assert.equal(areaClassOf(84.99), 'MS');
    assert.equal(areaClassOf(101), 'ML');
    assert.equal(areaClassOf(150), 'L');
  });
});

describe('급지', () => {
  const trades = [
    deal('2026-05-01', 10e8, { umdNm: '정자동' }),
    deal('2026-06-01', 12e8, { umdNm: '정자동' }),
    deal('2026-06-01', 20e8, { umdNm: '백현동', aptSeq: 'C', aptNm: '판교' }),
    deal('2024-01-01', 99e8, { umdNm: '구미동', aptSeq: 'D', aptNm: '오래' }),
  ];
  it('ranks 동 by the median price per 평 of the last year', () => {
    const r = dongRanking(trades, TODAY);
    assert.deepEqual(r.map((x) => x.name), ['백현동', '정자동']);
    close(r[1].perPyeong, perPyeong({ price: 11e8, area: 84.97 }));
  });
  it('ranks complexes with enough deals', () => {
    assert.deepEqual(complexRanking(trades, TODAY, 12, 2).map((x) => x.key), ['A1']);
    assert.equal(complexRanking(trades, TODAY, 12, 1)[0].key, 'C');
  });
  it('draws the leaders month by month in 억', () => {
    const rows = leaderSeries(trades, ['A1', 'C']);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0], { date: '2026-05-01', c0: 10, c1: null });
    assert.deepEqual(rows[1], { date: '2026-06-01', c0: 12, c1: 20 });
  });
});

describe('one complex', () => {
  it('lists every deal and the monthly median per 평형', () => {
    const d = complexDetail([deal('2026-01-05', 10e8), deal('2026-01-25', 12e8), deal('2026-03-01', 7e8, { area: 59.8, dealing: '직거래' }), deal('2026-02-01', 1e8, { aptSeq: 'X' })], 'A1')!;
    assert.deepEqual(d.areas.map((a) => a.key), [60, 85]);
    assert.equal(d.deals.length, 3);
    assert.equal(d.deals[2].direct, true);
    assert.deepEqual(d.monthly.map((m) => [m.date, m.a85, m.a60]), [['2026-01-01', 11, null], ['2026-02-01', null, null], ['2026-03-01', null, 7]]);
    assert.equal(complexDetail([], 'A1'), null);
  });
});

describe('month forecast', () => {
  it('counts days of a month’s run past its end', () => {
    assert.equal(dayOfMonthRun('202609', '2026-09-01'), 1);
    assert.equal(dayOfMonthRun('202609', '2026-10-14'), 44);
  });
  it('scales this month by how earlier months grew from the same day', () => {
    const snaps = [
      { ym: '202607', day: '2026-07-10', count: 100 },
      { ym: '202608', day: '2026-08-10', count: 80 },
      { ym: '202608', day: '2026-08-11', count: 90 },
      { ym: '202610', day: '2026-10-10', count: 50 },
    ];
    const f = forecastMonth(snaps, { '202607': 400, '202608': 400 }, '202610', '2026-10-11');
    // Known on day 10; July grew 4×, August 5× from day 10
    assert.equal(f.known, 50);
    assert.equal(f.day, 10);
    assert.deepEqual(f.ratios.map((r) => r.ym), ['202608', '202607']);
    assert.equal(f.estimate, 225);
    assert.equal(f.rows[9].m202610, 50);
    const none = forecastMonth([{ ym: '202610', day: '2026-10-10', count: 50 }], {}, '202610', '2026-10-11');
    assert.equal(none.estimate, null);
    assert.equal(none.known, 50);
  });
});
