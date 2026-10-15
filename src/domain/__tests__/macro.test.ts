import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cliFrames, cliPhase, contributionRows, cotSummary, cyclePhases, monthly, parseCot, parseOecdCsv, parseWorldBank, quadrantOf, rrg, weekly, type Point } from '../macro';

const series = (from: string, values: number[]): Point[] =>
  values.map((value, k) => {
    const d = new Date(`${from}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + k);
    return { date: d.toISOString().slice(0, 10), value };
  });

describe('countries', () => {
  it('reads OECD CSV and World Bank JSON', () => {
    const csv = 'STRUCTURE,REF_AREA,Reference area,TIME_PERIOD,OBS_VALUE\nDATAFLOW,KOR,"Korea, Rep.",2026-07,100.5\nDATAFLOW,KOR,"Korea, Rep.",2026-06,100.1\nDATAFLOW,USA,United States,2026-07,\n';
    const m = parseOecdCsv(csv);
    assert.deepEqual(m.get('KOR'), [{ date: '2026-06-01', value: 100.1 }, { date: '2026-07-01', value: 100.5 }]);
    assert.equal(m.has('USA'), false);
    const wb = parseWorldBank([{ page: 1 }, [{ countryiso3code: 'KOR', date: '2025', value: null }, { countryiso3code: 'KOR', date: '2024', value: 47.8 }, { countryiso3code: 'KOR', date: '2023', value: 48.5 }]]);
    assert.deepEqual(wb.get('KOR'), { year: '2024', value: 47.8 });
  });

  it('reads CLI phases and frames', () => {
    assert.equal(cliPhase(100.4, 0.2), '확장');
    assert.equal(cliPhase(100.4, -0.1), '둔화');
    assert.equal(cliPhase(99.5, -0.1), '수축');
    assert.equal(cliPhase(99.5, 0.3), '회복');
    const f = cliFrames(new Map([['KOR', series('2026-01-01', [99, 99.2, 99.5, 100, 100.3])]]), ['KOR', 'USA'], 3);
    assert.deepEqual(f.dates, ['2026-03-01', '2026-04-01', '2026-05-01']);
    assert.deepEqual(f.values.KOR, [null, [0, 1], [0.3, 1.1]]);
    assert.deepEqual(f.values.USA, [null, null, null]);
  });
});

describe('US cycle', () => {
  it('phases a level series and an inverted one', () => {
    const up = series('2024-01-01', [...Array(12).fill(10), 11, 12, 13, 12.5]);
    const p = cyclePhases(up, {});
    assert.equal(p.get('2025-01-01'), '확장');
    assert.equal(p.get('2025-04-01'), '확장');
    const inv = cyclePhases(up, { invert: true });
    assert.equal(inv.get('2025-03-01'), '수축');
    // Falling against three months back while still above the average
    const top = series('2024-01-01', [...Array(12).fill(10), 14, 15, 16, 13]);
    assert.equal(cyclePhases(top, {}).get('2025-04-01'), '둔화');
  });

  it('phases the year-over-year change', () => {
    const s = series('2023-01-01', Array.from({ length: 30 }, (_, k) => 100 * 1.001 ** (k * k)));
    const p = cyclePhases(s, { yoy: true });
    assert.equal(p.size, 30 - 12 - 12);
    assert.ok([...p.values()].every((x) => x === '확장'));
  });

  it('keeps the last value of each month', () => {
    assert.deepEqual(monthly([{ date: '2026-01-03', value: 1 }, { date: '2026-01-31', value: 2 }, { date: '2026-02-07', value: 3 }]), [{ date: '2026-01-01', value: 2 }, { date: '2026-02-01', value: 3 }]);
  });
});

describe('rotation', () => {
  it('takes the last close of each week', () => {
    const w = weekly([{ date: '2026-10-05', close: 1 }, { date: '2026-10-09', close: 2 }, { date: '2026-10-12', close: 3 }]);
    assert.deepEqual(w, [{ date: '2026-10-09', close: 2 }, { date: '2026-10-12', close: 3 }]);
  });

  it('puts an outperformer that is speeding up in 주도', () => {
    const dates = Array.from({ length: 40 }, (_, k) => new Date(Date.UTC(2026, 0, 2 + 7 * k)).toISOString().slice(0, 10));
    const bench = dates.map((date) => ({ date, close: 100 }));
    const asset = dates.map((date, k) => ({ date, close: 100 * 1.002 ** (k * k) }));
    const r = rrg(asset, bench);
    assert.equal(r.length, 40 - 25 - 4);
    const last = r.at(-1)!;
    assert.ok(last.ratio > 100 && last.momentum > 100);
    assert.equal(quadrantOf(last), '주도');
    assert.equal(quadrantOf({ ratio: 99, momentum: 101 }), '개선');
    assert.equal(quadrantOf({ ratio: 101, momentum: 99 }), '약화');
  });
});

describe('CFTC', () => {
  it('summarizes net speculative positions', () => {
    const rows = Array.from({ length: 60 }, (_, k) => ({
      cftc_contract_market_code: '088691',
      report_date_as_yyyy_mm_dd: new Date(Date.UTC(2025, 6, 1 + 7 * k)).toISOString().slice(0, 10) + 'T00:00:00.000',
      open_interest_all: '1000',
      noncomm_positions_long_all: String(300 + k),
      noncomm_positions_short_all: '200',
    }));
    const m = parseCot([...rows].reverse());
    const s = cotSummary(m.get('088691')!)!;
    assert.equal(s.net, 159);
    assert.equal(s.netPct, 0.159);
    assert.equal(s.index3y, 1);
    assert.equal(s.change1w, 1);
    assert.equal(cotSummary([]), null);
  });
});

describe('GDP contributions', () => {
  it('stacks quarters and sums when there is no total', () => {
    const rows = contributionRows(
      [
        { key: 'a', points: [{ date: '2026-01-01', value: 1 }, { date: '2026-04-01', value: 0.5 }] },
        { key: 'b', points: [{ date: '2026-04-01', value: -0.2 }] },
      ],
      null,
      4,
    );
    assert.deepEqual(rows, [{ date: '2026-01-01', a: 1, b: null, total: 1 }, { date: '2026-04-01', a: 0.5, b: -0.2, total: 0.3 }]);
  });
});
