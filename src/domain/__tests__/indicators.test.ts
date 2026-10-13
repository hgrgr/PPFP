import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { addMonths, affordability, changeOver, clip, combine, cyclePhase, honeycombPhase, indicatorById, INDICATORS, isOn, joinSeries, parseAcm, parseEcosAny, parseKosis, parseLw, parseRone, popCodes, readPrefs, regionOf, rollingSum, shiftMonths, shiftYears, splice, toggled, yearlyMean, yoy, type Point } from '../indicators';
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
  it('explains the market 10-year with ACM parts, leaving the model residual', () => {
    const ind = indicatorById('us-10y-acm')!;
    const data: Record<string, Point[]> = {
      'IND:FRED:DGS10': pts(['2026-09-01', 5.29]),
      'IND:ACM:ACMTP10': pts(['2026-09-01', 0.885]),
      'IND:ACM:ACMRNY10': pts(['2026-09-01', 4.375]),
      'IND:FRED:DFF': pts(['2026-09-01', 3.88]),
      'IND:FRED:DGS3MO': pts(['2026-09-01', 4.2]),
    };
    assert.ok(!ind.needs({ region: '11', incomeBase: 'region' }).some((r) => r.id === 'IND:ACM:ACMY10'));
    const c = ind.build((id) => data[id] ?? [], { region: '11', incomeBase: 'region' });
    assert.equal(c.rows[0].n, 5.29);
    // 5.29 = 4.20 now + 0.17 expected change (4.375 − 4.2) + 0.89 term premium + 0.03 residual
    assert.deepEqual(c.latest.map((l) => l.value), ['5.29%', '4.2%', '0.17%p', '0.89%p', '0.03%p']);
  });

  it('splits the market 10-year exactly into real yield and breakeven', () => {
    const ind = indicatorById('us-10y-fisher')!;
    const data: Record<string, Point[]> = { 'IND:FRED:DGS10': pts(['2026-09-01', 5.29]), 'IND:FRED:DFII10': pts(['2026-09-01', 2.9]) };
    const c = ind.build((id) => data[id] ?? [], { region: '11', incomeBase: 'region' });
    assert.equal(Number(c.rows[0].r) + Number(c.rows[0].b), Number(c.rows[0].n));
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
    assert.deepEqual(c.lines.map((l) => l.label), ['0~9세', '10대', '20대', '30대', '40대', '50대', '총인구']);
    // Young bands are requested too: 0–4 … 15–19
    const ids = ind.needs({ region: '11', incomeBase: 'region' }).map((r) => r.id);
    for (const age of ['5', '10', '15', '20']) assert.ok(ids.includes(`IND:KOSIS:pop:11:${age}`), age);
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

describe('cycle and liquidity helpers', () => {
  it('rolls, shifts and compares months', () => {
    const s = pts(['2026-01-01', 1], ['2026-02-01', 2], ['2026-03-01', 3], ['2026-05-01', 5]);
    assert.deepEqual(rollingSum(s, 2), pts(['2026-02-01', 3], ['2026-03-01', 5]));
    assert.deepEqual(shiftMonths(pts(['2025-11-01', 1]), 30), pts(['2028-05-01', 1]));
    assert.equal(addMonths('2026-01-01', -1), '2025-12-01');
    assert.deepEqual(changeOver(pts(['2026-01-01', 100], ['2026-07-01', 103]), 6).map((p) => Number(p.value.toFixed(6))), [3]);
    const months = Array.from({ length: 12 }, (_, i) => ({ date: `2025-${String(i + 1).padStart(2, '0')}-01`, value: i < 6 ? 4 : 5 }));
    assert.deepEqual(yearlyMean([...months, { date: '2026-01-01', value: 9 }]), pts(['2025-01-01', 4.5]));
  });

  it('names the business cycle phase from the leading index', () => {
    assert.equal(cyclePhase(104.2, 0.3), '확장');
    assert.equal(cyclePhase(101, -0.4), '둔화');
    assert.equal(cyclePhase(98, -0.2), '수축');
    assert.equal(cyclePhase(98, 0.5), '회복');
  });

  it('walks the honeycomb cycle', () => {
    assert.equal(honeycombPhase(2, 10).n, 1);
    assert.equal(honeycombPhase(2, -10).n, 2);
    assert.equal(honeycombPhase(0.2, -10).n, 3);
    assert.equal(honeycombPhase(-2, -10).n, 4);
    assert.equal(honeycombPhase(-2, 10).n, 5);
    assert.equal(honeycombPhase(-0.3, 10).n, 6);
  });

  it('computes a K-HAI style affordability index', () => {
    // 5억 house, 47.9% loan over 20 years at 4%: about 145만원 a month; 연소득 6,960만원 → 580만원 a month; 25% of it is 145만원
    const v = affordability(50_000, 6_960, 4);
    assert.ok(Math.abs(v - 100) < 1, String(v));
    assert.ok(affordability(50_000, 6_960, 6) > v);
  });
});

describe('R-ONE and Laubach-Williams parsers', () => {
  it('reads R-ONE rows, skipping empty values, and its errors', () => {
    const ok = parseRone({ SttsApiTblData: [{ head: [{ list_total_count: 3 }, { RESULT: { CODE: 'INFO-000', MESSAGE: '정상' } }] }, { row: [{ WRTTIME_IDTFR_ID: '202607', DTA_VAL: 114.18 }, { WRTTIME_IDTFR_ID: '202606', DTA_VAL: null }, { WRTTIME_IDTFR_ID: '202605', DTA_VAL: '110.5' }] }] });
    assert.deepEqual(ok.points, pts(['2026-05-01', 110.5], ['2026-07-01', 114.18]));
    assert.equal(ok.total, 3);
    const bad = parseRone({ RESULT: { CODE: 'ERROR-290', MESSAGE: '인증키가 유효하지 않습니다.' } });
    assert.equal(bad.code, 'ERROR-290');
    assert.match(bad.error ?? '', /인증키/);
  });

  it('reads the one-sided r* and output gap from the LW sheet', () => {
    const rows: unknown[][] = [
      [undefined, 'This spreadsheet contains updated estimates'],
      [undefined, undefined, undefined, 'One-Sided Estimates', undefined, undefined, undefined, undefined, 'Two-Sided Estimates'],
      [undefined, 'Date', undefined, 'rstar', 'g', 'z', 'Output gap', undefined, 'rstar', 'g', 'z', 'Output gap'],
      [undefined, new Date('2026-04-01T00:00:00Z'), undefined, 1.65, 2.49, -1.01, 1.2, undefined, 1.7, 2.5, -1, 1.1],
    ];
    assert.deepEqual(parseLw(rows), { rstar: pts(['2026-04-01', 1.65]), gap: pts(['2026-04-01', 1.2]) });
  });
});

describe('new indicators', () => {
  const P = { region: '11', incomeBase: 'region' as const };
  it('reads the market policy path as 2-year minus policy rate', () => {
    const data: Record<string, Point[]> = { 'IND:FRED:DGS2': pts(['2026-09-01', 4.75]), 'IND:FRED:DFF': pts(['2026-09-01', 3.88]) };
    const c = indicatorById('policy-path')!.build((id) => data[id] ?? [], P);
    assert.equal(c.latest[0].value, '0.87%p');
  });

  it('computes the Taylor rule rate', () => {
    const data: Record<string, Point[]> = {
      'IND:LW:rstar': pts(['2026-04-01', 1]),
      'IND:LW:gap': pts(['2026-04-01', 2]),
      'IND:FRED:PCEPILFE': pts(['2025-04-01', 100], ['2026-04-01', 103]),
      'IND:FRED:DFF': pts(['2026-04-01', 4]),
    };
    const c = indicatorById('taylor')!.build((id) => data[id] ?? [], P);
    // 1 + 3 + 0.5 × 1 + 0.5 × 2 = 5.5
    assert.equal(c.latest[0].value, '5.5%');
  });

  it('names the cycle phase on the leading index card', () => {
    const data: Record<string, Point[]> = { 'IND:ECOS:901Y067/M/I16E': pts(['2026-05-01', 103.8], ['2026-08-01', 104.2]), 'IND:ECOS:901Y067/M/I16D': pts(['2026-08-01', 99.6]) };
    const c = indicatorById('kr-leading')!.build((id) => data[id] ?? [], P);
    assert.deepEqual(c.latest[0], { label: '경기 국면 (선행 기준)', value: '확장', date: '2026-08' });
  });

  it('uses each R-ONE table’s own region codes', () => {
    const ids = indicatorById('trade-cycle')!.needs(P).map((r) => r.id);
    assert.deepEqual(ids, ['IND:RONE:A_2024_00045/500008/100001', 'IND:RONE:A_2024_00549/500002/100001']);
    // 광주 has no current trade rows
    assert.equal(indicatorById('trade-cycle')!.needs({ ...P, region: '29' }).length, 1);
  });

  it('nets the Fed balance sheet of TGA and reverse repos', () => {
    const data: Record<string, Point[]> = {
      'IND:FRED:WALCL': pts(['2026-09-01', 6_747_560]),
      'IND:FRED:WTREGEN': pts(['2026-09-01', 880_253]),
      'IND:FRED:RRPONTSYD': pts(['2026-09-01', 0.3]),
      'IND:FRED:WRESBAL': pts(['2026-09-01', 3_029_659]),
    };
    const c = indicatorById('us-net-liquidity')!.build((id) => data[id] ?? [], P);
    assert.equal(c.latest[0].value, '5.87조 달러');
  });
});
