import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { clip, combine, indicatorById, INDICATORS, isOn, joinSeries, parseAcm, parseEcosAny, parseKosis, popCodes, readPrefs, regionOf, shiftYears, splice, toggled, yoy, type Point } from '../indicators';
import { excelDate } from '../xls';

const pts = (...v: [string, number][]): Point[] => v.map(([date, value]) => ({ date, value }));

describe('indicator parsers', () => {
  it('reads ECOS rows of every cycle onto the period start', () => {
    const body = (time: string, v: string) => ({ StatisticSearch: { row: [{ TIME: time, DATA_VALUE: v }] } });
    assert.deepEqual(parseEcosAny(body('202509', '2.5')).points, pts(['2025-09-01', 2.5]));
    assert.deepEqual(parseEcosAny(body('2025Q3', '1924990.1')).points, pts(['2025-07-01', 1924990.1]));
    assert.deepEqual(parseEcosAny(body('2024', '8164')).points, pts(['2024-01-01', 8164]));
    assert.deepEqual(parseEcosAny(body('2024', '')).points, []);
    // No data is not an error; a bad key is
    assert.equal(parseEcosAny({ RESULT: { CODE: 'INFO-200', MESSAGE: '해당하는 데이터가 없습니다.' } }).error, null);
    assert.equal(parseEcosAny({ RESULT: { CODE: 'INFO-100', MESSAGE: '인증키가 유효하지 않습니다.' } }).error, '인증키가 유효하지 않습니다.');
  });

  it('reads KOSIS rows and its error answers', () => {
    const r = parseKosis([{ PRD_DE: '202508', C1: '11', C2: '30', DT: '712,345' }, { PRD_DE: '2025', C1: '11', C2: '30', DT: '1' }]);
    assert.deepEqual(r.rows, [{ region: '11', age: '30', date: '2025-08-01', value: 712345 }]);
    const e = parseKosis({ err: '30', errMsg: '데이터가 존재하지 않습니다.' });
    assert.equal(e.code, '30');
    assert.equal(e.error, '데이터가 존재하지 않습니다.');
  });

  it('reads the ACM sheet with text or serial dates', () => {
    const rows = [
      ['DATE', 'ACMY10', 'ACMTP10', 'ACMRNY10'],
      ['30-Sep-2026', 5.26, 0.885, 4.374],
      [46265, 5.1, 0.8, 4.3],
      ['note', 'x'],
    ];
    const cols = parseAcm(rows, excelDate);
    assert.deepEqual(cols.get('ACMY10'), pts(['2026-09-01', 5.26], ['2026-08-01', 5.1]));
    assert.equal(cols.get('ACMTP10')?.length, 2);
  });
});

describe('series math', () => {
  it('joins, combines, and takes year-on-year change', () => {
    const a = pts(['2024-01-01', 100], ['2025-01-01', 110]);
    const b = pts(['2025-01-01', 2]);
    assert.deepEqual(combine(a, b, (x, y) => x / y), pts(['2025-01-01', 55]));
    assert.deepEqual(yoy(a).map((p) => [p.date, Number(p.value.toFixed(6))]), [['2025-01-01', 10]]);
    assert.deepEqual(joinSeries({ a, b }), [
      { date: '2024-01-01', a: 100, b: null },
      { date: '2025-01-01', a: 110, b: 2 },
    ]);
  });

  it('splices tables that continue each other and shifts survey years', () => {
    const older = pts(['2016-01-01', 1], ['2017-01-01', 2]);
    const newer = pts(['2017-01-01', 3], ['2018-01-01', 4]);
    assert.deepEqual(splice(older, newer), pts(['2016-01-01', 1], ['2017-01-01', 3], ['2018-01-01', 4]));
    assert.deepEqual(shiftYears(pts(['2025-01-01', 8164]), -1), pts(['2024-01-01', 8164]));
  });

  it('clips rows to the last years', () => {
    const rows = [{ date: '2014-12-01' }, { date: '2015-10-01' }, { date: '2025-10-01' }];
    assert.deepEqual(clip(rows, 10, '2025-10-13').map((r) => r.date), ['2015-10-01', '2025-10-01']);
    assert.equal(clip(rows, 0, '2025-10-13').length, 3);
  });
});

describe('regions', () => {
  it('maps a 시군구 to its 시도, including 강원·전북 under their new codes', () => {
    assert.equal(regionOf('41135').name, '경기');
    assert.equal(regionOf('51110').name, '강원');
    assert.equal(regionOf('52111').name, '전북');
    assert.equal(regionOf('00').name, '전국');
    assert.equal(regionOf('zz').name, '서울');
    assert.deepEqual(popCodes('41135'), ['41135']);
    assert.deepEqual(popCodes('42'), ['51', '42']);
  });
});

describe('indicators', () => {
  it('builds the ACM decomposition so the parts add up to the yield', () => {
    const ind = indicatorById('us-10y-acm')!;
    const data: Record<string, Point[]> = {
      'IND:ACM:ACMY10': pts(['2026-09-01', 5.26]),
      'IND:ACM:ACMTP10': pts(['2026-09-01', 0.885]),
      'IND:ACM:ACMRNY10': pts(['2026-09-01', 4.375]),
      'IND:FRED:DFF': pts(['2026-09-01', 3.88]),
    };
    const c = ind.build((id) => data[id] ?? [], { region: '11', incomeBase: 'region' });
    const row = c.rows[0];
    assert.equal(Number(row.rn) + Number(row.tp), Number(row.y));
    assert.equal(c.latest[0].value, '5.26%');
  });

  it('computes PIR as the average house value over the previous year’s household income', () => {
    const ind = indicatorById('pir')!;
    const reqs = ind.needs({ region: '11', incomeBase: 'region' }).map((r) => r.id);
    assert.ok(reqs.includes('IND:ECOS:291Y524/A/REG11'));
    assert.ok(reqs.includes('IND:ECOS:903Y201/A/T01/A0100/B0511/C04'));
    const data: Record<string, Point[]> = {
      'IND:ECOS:291Y524/A/REG11': pts(['2024-01-01', 2_000_000]), // 2,000조원
      'IND:ECOS:901Y106/A/HSEO': pts(['2024-01-01', 4_000]), // 400만 호
      'IND:ECOS:903Y201/A/T01/A0100/B0511/C04': pts(['2025-01-01', 8_000]), // income of 2024, 8,000만원
    };
    const c = ind.build((id) => data[id] ?? [], { region: '11', incomeBase: 'region' });
    // 2,000조 ÷ 400만 호 = 5억 = 50,000만원; ÷ 8,000만원 = 6.25배
    assert.equal(c.rows[0].date, '2024-01-01');
    assert.equal(c.rows[0].pir, 6.25);
    assert.equal(c.rows[0].v, 5);
    // A national age band for the income side
    const young = ind.needs({ region: '11', incomeBase: 'B1601' }).map((r) => r.id);
    assert.ok(young.includes('IND:ECOS:903Y206/A/T01/A0100/B1601/C04'));
  });

  it('sums 5-year KOSIS bands into decades and falls back to an old region code', () => {
    const ind = indicatorById('population')!;
    const data: Record<string, Point[]> = {
      'IND:KOSIS:pop:42:0': pts(['2025-01-01', 1_520_000]),
      'IND:KOSIS:pop:42:25': pts(['2025-01-01', 70_000]),
      'IND:KOSIS:pop:42:30': pts(['2025-01-01', 80_000]),
    };
    const c = ind.build((id) => data[id] ?? [], { region: '42', incomeBase: 'region' });
    assert.equal(c.rows[0].total, 152);
    assert.equal(c.rows[0].a20, 15);
  });

  it('every indicator builds from no data without throwing', () => {
    for (const ind of INDICATORS) {
      const c = ind.build(() => [], { region: '11', incomeBase: 'region' });
      assert.equal(c.rows.length, 0, ind.id);
      assert.ok(ind.needs({ region: '11', incomeBase: 'region' }).length > 0, ind.id);
    }
  });
});

describe('preferences', () => {
  it('reads defaults and switches indicators on and off', () => {
    const p = readPrefs({ region: '99', years: 7, off: ['nope'] });
    assert.deepEqual(p, { off: [], on: [], region: '11', incomeBase: 'region', years: 10 });
    const acm = indicatorById('us-10y-acm')!;
    const nfci = indicatorById('financial-conditions')!;
    assert.equal(isOn(acm, p), true);
    assert.equal(isOn(nfci, p), false);
    const q = toggled(toggled(p, 'us-10y-acm', false), 'financial-conditions', true);
    assert.equal(isOn(acm, q), false);
    assert.equal(isOn(nfci, q), true);
    assert.deepEqual(readPrefs({ ...q, region: '41135' }).region, '41135');
  });
});
