import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { eRegionKey, locationOf, locationValues, rankLocations, splitJeonnam, taxRegionKeys, type KosisRow } from '../location';
import { roneDate } from '../indicators';
import { roneRegion, rtpiSource } from '../region-analysis';

const close = (a: number | null | undefined, b: number, eps = 1e-6) => assert.ok(a !== null && a !== undefined && Math.abs(a - b) < eps, `${a} ≈ ${b}`);

describe('실거래가격지수', () => {
  it('dates quarterly R-ONE periods on the quarter’s first month', () => {
    assert.equal(roneDate('202603', true), '2026-07-01');
    assert.equal(roneDate('202601', true), '2026-01-01');
    assert.equal(roneDate('202608'), '2026-08-01');
  });
  it('takes a 시도’s monthly index and a 시군구’s quarterly one, else the 시도’s', () => {
    assert.equal(rtpiSource(roneRegion('서울')!)?.quarterly, false);
    const gn = rtpiSource(roneRegion('서울>강남구')!)!;
    assert.equal(gn.quarterly, true);
    assert.equal(gn.req.freq, 'Q');
    assert.ok(gn.req.id.endsWith('/Q'));
    // 동탄구 (2026) has no quarterly row: 경기's monthly one
    assert.equal(rtpiSource(roneRegion('경기>화성시>동탄구')!)?.from.key, '경기');
  });
});

describe('입지 regions', () => {
  it('reads e-지방지표 codes as region keys', () => {
    assert.equal(eRegionKey('31020', '성남시'), '경기>성남시');
    assert.equal(eRegionKey('11010', '종로구'), '서울>종로구');
    assert.equal(eRegionKey('31', '경기도'), '경기');
    assert.equal(eRegionKey('00', '전국'), null);
    assert.equal(eRegionKey('31320', '경기 여주군'), '경기>여주군');
    assert.equal(eRegionKey('29', '세종특별자치시'), '세종');
    // the merged 전남광주 lists 광주's 구 and 전남's 시군 under one code
    assert.equal(eRegionKey('12010', '광산구'), '광주>광산구');
    assert.equal(eRegionKey('12500', '목포시'), '전남>목포시');
    assert.equal(eRegionKey('12001', '광주광역시'), '광주');
    assert.equal(splitJeonnam('전남광주통합특별시', '동구'), '광주');
  });
  it('reads 국세통계 codes through their 시도 rows', () => {
    const rows = [
      { C1: 'A01', C1_NM: '서울' },
      { C1: 'A0101', C1_NM: '강남구' },
      { C1: 'A04', C1_NM: '인천' },
      { C1: 'A0402', C1_NM: '미추홀구(남구)' },
    ] as KosisRow[];
    const k = taxRegionKeys(rows);
    assert.equal(k.get('A0101'), '서울>강남구');
    assert.equal(k.get('A01'), '서울');
    assert.equal(k.get('A0402'), '인천>미추홀구');
  });
});

describe('입지 score', () => {
  const r = (C1: string, C1_NM: string, ITM_ID: string, PRD_DE: string, DT: number): KosisRow => ({ C1, C1_NM, ITM_ID, PRD_DE, DT: String(DT) });
  const names: [string, string][] = [['11010', '종로구'], ['11020', '중구'], ['11030', '용산구'], ['11040', '성동구'], ['11050', '광진구']];
  const tables = {
    academy: names.flatMap(([c, n], i) => [r(c, n, 'T10', '2025', i + 1), r(c, n, 'T002', '2025', 100_000), r(c, n, 'T002', '2020', 100_000 - i * 10_000)]),
    doctor: names.map(([c, n], i) => r(c, n, 'T10', '2025', i)),
    fiscal: names.map(([c, n], i) => r(c, n, 'T20', '2026', 20 + i)),
    jobs: names.map(([c, n], i) => r(c, n, 'T001', '2024', 50_000 + i * 10_000)),
    foreign: names.map(([c, n], i) => r(c, n, 'T10', '2025', 50 - i * 10)),
    elderly: names.map(([c, n]) => r(c, n, 'T10', '2025', 20)),
    income: [{ C1: 'A01', C1_NM: '서울', ITM_ID: 'T001', PRD_DE: '2023', DT: '1' } as KosisRow, ...names.flatMap(([, n], i) => [{ C1: `A010${i + 1}`, C1_NM: n, ITM_ID: 'T001', PRD_DE: '2023', DT: '1000' }, { C1: `A010${i + 1}`, C1_NM: n, ITM_ID: 'T002', PRD_DE: '2023', DT: String(40_000 + i * 10_000) }] as KosisRow[])],
  };

  it('works out each metric', () => {
    const v = locationValues(tables);
    const yongsan = v.values['서울>용산구'];
    assert.equal(yongsan.academy, 3);
    close(yongsan.growth, (100_000 / 80_000 - 1) * 100);
    close(yongsan.jobs, 70);
    // 급여총계 백만원 ÷ 인원 → 만원
    close(yongsan.income, 60_000 * 100 / 1000);
    assert.equal(v.years.growth, '2020~2025');
    assert.equal(v.years.income, '2023');
    assert.equal(yongsan.foreign, 30);
    assert.equal(yongsan.elderly, 20);
  });

  it('ranks by the average percentile into five 급지', () => {
    const rows = rankLocations(locationValues(tables));
    assert.equal(rows.length, 5);
    assert.equal(rows[0].key, '서울>광진구');
    // 외국인 (falling here) is shown but not scored
    assert.equal(rows[0].score, 100);
    assert.equal(rows[0].pct.foreign, 0);
    assert.equal(rows[0].rank, 1);
    assert.equal(rows[0].grade, 1);
    assert.equal(rows.at(-1)!.grade, 5);
    assert.ok(rows.every((x) => x.linked));
    const map = new Map(rows.map((x) => [x.key, x]));
    assert.equal(locationOf(map, '서울>용산구')?.key, '서울>용산구');
    assert.equal(locationOf(new Map([['경기>성남시', rows[0]]]), '경기>성남시>분당구'), rows[0]);
  });
});
