import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { dartList, DartError, dartTables, parseCorpCodes, parseElestock, sharesOutstanding, unzipFirst, REPORTS, type DartRow } from '../dart';
import { cleanSheet, headline, majorOf, parseReleaseDates, transform } from '../fred';

/** A minimal one-file zip, deflated */
function zip(name: string, content: string): Buffer {
  const data = deflateRawSync(Buffer.from(content));
  const h = Buffer.alloc(30);
  h.writeUInt32LE(0x04034b50, 0);
  h.writeUInt16LE(20, 4);
  h.writeUInt16LE(0, 6);
  h.writeUInt16LE(8, 8);
  h.writeUInt32LE(data.length, 18);
  h.writeUInt32LE(content.length, 22);
  h.writeUInt16LE(name.length, 26);
  return Buffer.concat([h, Buffer.from(name), data]);
}

const row = (sj: string, id: string, nm: string, th: string, add?: string, fr?: string, bf?: string): DartRow => ({ sj_div: sj, account_id: id, account_nm: nm, thstrm_amount: th, thstrm_add_amount: add, frmtrm_amount: fr, bfefrmtrm_amount: bf });

describe('OpenDART', () => {
  it('unzips the company list and keeps listed companies', () => {
    const xml = '<result><list><corp_code>00126380</corp_code><corp_name>삼성전자</corp_name><stock_code>005930</stock_code></list><list><corp_code>00999999</corp_code><corp_name>비상장</corp_name><stock_code> </stock_code></list></result>';
    const out = unzipFirst(zip('CORPCODE.xml', xml)).toString('utf8');
    assert.equal(out, xml);
    assert.deepEqual(parseCorpCodes(out), [{ corp: '00126380', name: '삼성전자', stock: '005930' }]);
  });

  it('reads statuses', () => {
    assert.deepEqual(dartList({ status: '000', list: [1] }), [1]);
    assert.deepEqual(dartList({ status: '013', message: '조회된 데이타가 없습니다.' }), []);
    assert.throws(() => dartList({ status: '010', message: '등록되지 않은 키입니다.' }), DartError);
  });

  it('builds yearly and quarterly tables', () => {
    const fy = (year: number, rev: string, prev: string, prev2: string, cf: string) => ({
      year,
      report: REPORTS.FY,
      rows: [
        row('IS', 'ifrs-full_Revenue', '매출액', rev, undefined, prev, prev2),
        row('IS', 'dart_OperatingIncomeLoss', '영업이익', '100', undefined, '90', '80'),
        row('CF', 'ifrs-full_CashFlowsFromUsedInOperatingActivities', '영업활동현금흐름', cf, undefined, '0', '0'),
        row('BS', 'ifrs-full_Assets', '자산총계', '5,000', undefined, '4,000', '3,000'),
      ],
    });
    const q = (year: number, report: (typeof REPORTS)[keyof typeof REPORTS], rev: string, cum: string, cf: string) => ({
      year,
      report,
      rows: [row('IS', 'ifrs-full_Revenue', '매출액', rev, cum), row('CF', '-표준계정코드 미사용-', '영업활동으로 인한 현금흐름', cf), row('BS', 'ifrs-full_Assets', '자산총계', '4,500')],
    });
    const t = dartTables([fy(2025, '1,000', '800', '700', '400'), q(2025, REPORTS.Q1, '200', '200', '80'), q(2025, REPORTS.H1, '250', '450', '190'), q(2025, REPORTS.Q3, '250', '700', '300')]);
    assert.deepEqual(t.annual.periods.map((p) => p.key), ['2025', '2024', '2023']);
    const rev = t.annual.rows.find((r) => r.key === 'revenue')!;
    assert.deepEqual(rev.values, [1000, 800, 700]);
    assert.equal(rev.yoy[0], 25);
    assert.deepEqual(t.annual.margins.operating, [10, 11.3, 11.4]);
    const qr = t.quarterly.rows.find((r) => r.key === 'revenue')!;
    assert.deepEqual(t.quarterly.periods.map((p) => p.key), ['2025Q4', '2025Q3', '2025Q2', '2025Q1']);
    // Q4 = year − first three quarters
    assert.deepEqual(qr.values, [300, 250, 250, 200]);
    const cf = t.quarterly.rows.find((r) => r.key === 'operatingCashFlow')!;
    // Year-to-date cash flows differenced, matched by name when the id is missing
    assert.deepEqual(cf.values, [100, 110, 110, 80]);
    assert.equal(t.quarterly.periods[1].end, '2025-09-30');
  });

  it('reads insider holdings and share counts', () => {
    const h = parseElestock([{ rcept_no: '20261001000123', rcept_dt: '20261001', repror: '홍길동', isu_exctv_ofcps: '부사장', isu_main_shrholdr: '-', sp_stock_lmp_cnt: '12,000', sp_stock_lmp_irds_cnt: '-3,000', sp_stock_lmp_rate: '0.01', sp_stock_lmp_irds_rate: '-0.00' }]);
    assert.equal(h[0].role, '부사장');
    assert.equal(h[0].change, -3000);
    assert.equal(sharesOutstanding([{ se: '보통주', istc_totqy: '1,000', tesstk_co: '100', distb_stock_co: '900' }, { se: '합계', istc_totqy: '1,100' }]), 900);
    assert.equal(sharesOutstanding([{ se: '합계', istc_totqy: '1,000', tesstk_co: '50', distb_stock_co: '-' }]), 950);
  });
});

describe('FRED', () => {
  it('matches major releases and reads dates', () => {
    assert.equal(majorOf(10)?.series, 'CPIAUCSL');
    assert.equal(majorOf(50)?.show, 'diff');
    assert.equal(majorOf(101), null);
    assert.deepEqual(parseReleaseDates({ release_dates: [{ release_id: 10, release_name: 'Consumer Price Index', date: '2026-10-21' }, { release_id: 1 }] }), [{ id: 10, name: 'Consumer Price Index', date: '2026-10-21' }]);
  });

  it('transforms series', () => {
    const m = Array.from({ length: 14 }, (_, k) => ({ date: `2025-${String((k % 12) + 1).padStart(2, '0')}-01`.replace(/^2025-(0[1-2])/, k >= 12 ? '2026-$1' : '2025-$1'), value: 100 + k }));
    const y = transform(m, 'yoy');
    assert.equal(y.length, 2);
    assert.equal(y[0].value, 12);
    assert.equal(transform(m, 'diff')[0].value, 1);
    assert.equal(transform(m, 'mom')[0].value, 1);
    assert.deepEqual(headline(m, 'level'), { date: m.at(-1)!.date, value: 113, prev: 112 });
  });

  it('cleans a saved sheet', () => {
    assert.deepEqual(cleanSheet([{ id: 'cpiaucsl', title: 'CPI', units: 'Index', frequency: 'M', transform: 'yoy' }, { id: 'CPIAUCSL' }, { id: 'bad id!' }, { id: 'UNRATE', transform: 'nope' }]), [
      { id: 'CPIAUCSL', title: 'CPI', units: 'Index', frequency: 'M', transform: 'yoy' },
      { id: 'UNRATE', title: 'UNRATE', units: '', frequency: '', transform: 'level' },
    ]);
  });
});
