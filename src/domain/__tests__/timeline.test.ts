import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { addMonths, type Point } from '../indicators';
import { timelineFrames } from '../region-map';
import { permitChart, permitIds, permitReq } from '../buyer-trends';
import { roneRegion } from '../region-analysis';

const monthly = (values: number[], start = '2020-01-01'): Point[] => values.map((value, i) => ({ date: addMonths(start, i), value }));

describe('map time-lapse', () => {
  it('lays every region’s metrics on the last months', () => {
    const seoul = roneRegion('서울')!;
    const price = new Map([[`/${seoul.ids.price}`, monthly(Array.from({ length: 30 }, (_, i) => 100 + i))]]);
    const ratio = new Map([[`/${seoul.ids.ratio}`, monthly(Array.from({ length: 30 }, () => 55))]]);
    const trade = new Map([[`/${seoul.ids.trade}`, monthly(Array.from({ length: 30 }, (_, i) => (i < 18 ? 100 : 200)))]]);
    const f = timelineFrames({ price, ratio, trade }, 6);
    assert.deepEqual(f.dates, ['2022-01-01', '2022-02-01', '2022-03-01', '2022-04-01', '2022-05-01', '2022-06-01']);
    const v = f.values['서울'];
    // 2022-06 is month 29: (129 / 117 − 1)
    assert.equal(v.y1!.at(-1), Math.round((129 / 117 - 1) * 10000) / 100);
    assert.equal(v.ratio!.at(-1), 55);
    assert.equal(v.phase!.at(-1), 1);
    assert.equal(v.y1!.length, 6);
    // Regions without data are left out
    assert.equal(f.values['부산'], undefined);
  });
});

describe('토지거래허가', () => {
  it('reads every class of the region at once and charts granted, refused and the share', () => {
    const r = roneRegion('서울>강남구')!;
    const req = permitReq(r)!;
    assert.ok(req.code.startsWith('A_2024_00655/*/100001/'));
    const [, ok, no] = permitIds(r);
    const data = new Map([
      [ok, monthly([90, 95, 100, 110])],
      [no, monthly([10, 5, 0, 10])],
    ]);
    const c = permitChart(r, (id) => data.get(id) ?? []);
    assert.equal(c.rows.length, 4);
    // three months: (5 + 0 + 10) / (100 + 100 + 120)
    assert.equal(c.latest[1].value, `${(15 / 320 * 100).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}%`);
    const none = permitChart(r, () => monthly([0, 0, 0]));
    assert.equal(none.rows.length, 0);
    assert.equal(permitReq(roneRegion('수도권')!), null);
  });
});
