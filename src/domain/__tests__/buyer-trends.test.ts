import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { addMonths, parseRoneByClass, type Point } from '../indicators';
import { ageChart, buyerReq, classId, peersOf, rankRow, residenceChart, shareOver } from '../buyer-trends';
import { roneRegion } from '../region-analysis';

const monthly = (values: number[], start = '2025-01-01'): Point[] => values.map((value, i) => ({ date: addMonths(start, i), value }));
const close = (a: number | null | undefined, b: number, eps = 1e-9) => assert.ok(a !== null && a !== undefined && Math.abs(a - b) < eps, `${a} ≈ ${b}`);

describe('buyer tables', () => {
  it('asks for every class of a region at once and reads each back', () => {
    const r = roneRegion('경기>성남시>분당구')!;
    const req = buyerReq(r, 'residence')!;
    assert.equal(req.code, `A_2024_00609/*/100001/${r.groups.residence}`);
    assert.equal(classId(r, 'residence', 500004), `IND:RONE:A_2024_00609/500004/100001/${r.groups.residence}`);
    // The three tables number regions their own way
    assert.notEqual(r.groups.residence, 0);
    assert.notEqual(r.groups.owner, 0);
    assert.equal(buyerReq(roneRegion('수도권')!, 'age'), null);
  });

  it('reads an R-ONE answer by class', () => {
    const row = (t: string, cls: number, v: number | string) => ({ WRTTIME_IDTFR_ID: t, CLS_ID: cls, DTA_VAL: v });
    const res = parseRoneByClass({ SttsApiTblData: [{ head: [{ list_total_count: 4 }, { RESULT: { CODE: 'INFO-000' } }] }, { row: [row('202602', 1, 5), row('202601', 1, 3), row('202601', 2, 7), row('202601', 3, '')] }] });
    assert.deepEqual([...res.byClass.keys()], ['1', '2']);
    assert.deepEqual(res.byClass.get('1')!.map((p) => p.date), ['2026-01-01', '2026-02-01']);
    assert.equal(res.total, 4);
    assert.equal(parseRoneByClass({ RESULT: { CODE: 'INFO-200' } }).error, null);
  });

  it('shares are taken over summed months', () => {
    const total = monthly([10, 10, 20, 0]);
    const part = monthly([1, 2, 3, 0]);
    // three months: (1+2+3)/(10+10+20); then (2+3+0)/(10+20+0)
    const s = shareOver([part], total, 3);
    assert.deepEqual(s.map((p) => p.date), ['2025-03-01', '2025-04-01']);
    close(s[0].value, 15);
    close(s[1].value, (5 / 30) * 100);
  });
});

describe('charts and ranking', () => {
  const r = roneRegion('부산>해운대구')!;
  const data = new Map<string, Point[]>([
    [classId(r, 'residence', 500001), monthly(Array(24).fill(100))],
    [classId(r, 'residence', 500002), monthly(Array.from({ length: 24 }, (_, i) => (i < 12 ? 70 : 55)))],
    [classId(r, 'residence', 500003), monthly(Array(24).fill(20))],
    [classId(r, 'residence', 500004), monthly(Array.from({ length: 24 }, (_, i) => (i < 12 ? 5 : 20)))],
    [classId(r, 'residence', 500005), monthly(Array(24).fill(5))],
  ]);
  const get = (id: string) => data.get(id) ?? [];

  it('draws residence bars and the outsiders’ share', () => {
    const c = residenceChart(r, get);
    assert.deepEqual(c.lines.filter((l) => l.kind === 'bar').map((l) => l.stack), ['r', 'r', 'r', 'r']);
    assert.equal(c.latest[0].label, '외지인 비율');
    assert.equal(c.latest[0].value, '45%');
    assert.equal(c.latest[2].value, '20%');
    // A 시도 has no 시군구 to be outside of
    assert.ok(!residenceChart(roneRegion('부산')!, get).lines.some((l) => l.key === 'outside'));
    assert.equal(ageChart(r, get).latest.length, 0);
  });

  it('ranks a region on twelve months', () => {
    const row = rankRow(r, get);
    assert.equal(row.deals, 1200);
    close(row.outside, 45);
    close(row.otherSido, 25);
    close(row.seoul, 20);
    // a year earlier: 30%
    close(row.change, 15);
    assert.equal(row.months.length, 12);
    close(row.months[0].value, 45);
  });

  it('sets a region beside its 시도’s 시군구, and the 시도 beside each other', () => {
    assert.ok(peersOf(r).every((p) => p.sido === '부산' && p.depth === 1));
    assert.ok(peersOf(roneRegion('부산')!).some((p) => p.key === '부산>해운대구'));
    const sidos = peersOf(roneRegion('전국')!);
    assert.equal(sidos.length, 17);
    assert.ok(peersOf(roneRegion('세종')!).some((p) => p.key === '서울'));
    const bundang = peersOf(roneRegion('경기>성남시>분당구')!);
    assert.ok(bundang.some((p) => p.key === '경기>성남시>분당구') && bundang.some((p) => p.key === '경기>수원시'));
  });
});
