import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ApplyApiError, inRegion, monthlyApply, parseApply, readListing, readModels, summarizeListing, typeName } from '../subscriptions';
import { mapValues, regionOfShape, shapeValue } from '../region-map';
import { addMonths, type Point } from '../indicators';
import { roneRegion } from '../region-analysis';

const close = (a: number | null | undefined, b: number, eps = 1e-6) => assert.ok(a !== null && a !== undefined && Math.abs(a - b) < eps, `${a} ≈ ${b}`);

describe('청약홈', () => {
  it('reads odcloud answers and refuses errors', () => {
    assert.deepEqual(parseApply({ data: [{ a: 1 }], matchCount: 7 }), { rows: [{ a: 1 }], total: 7 });
    assert.throws(() => parseApply({ code: -4, msg: '등록되지 않은 인증키 입니다.' }), ApplyApiError);
  });

  it('reads a 공고 with its flags', () => {
    const l = readListing({ HOUSE_MANAGE_NO: 2026000123, PBLANC_NO: 2026000123, HOUSE_NM: '예시 아파트', SUBSCRPT_AREA_CODE_NM: '서울', HSSPLY_ADRES: '서울특별시 강남구 대치동 1', TOT_SUPLY_HSHLDCO: '642', RCRIT_PBLANC_DE: '2026-09-24', RCEPT_BGNDE: '20261006', PRZWNER_PRESNATN_DE: '2026-10-14', MVN_PREARNGE_YM: '202909', SPECLT_RDN_EARTH_AT: 'Y', PARCPRC_ULS_AT: 'Y', MDAT_TRGET_AREA_SECD: 'N' });
    assert.equal(l.id, '2026000123');
    assert.equal(l.households, 642);
    assert.equal(l.receiptFrom, '2026-10-06');
    assert.equal(l.moveIn, '2029.09');
    assert.deepEqual(l.flags, ['투기과열지구', '분양가상한제']);
  });

  it('names 주택형 the way they are read', () => {
    assert.equal(typeName('084.9800A'), '84.98A');
    assert.equal(typeName('059.9000B'), '59.9B');
    assert.equal(typeName('114.0000'), '114');
  });

  it('works out 경쟁률, 분양가 per 평 and 가점 per 주택형 and in all', () => {
    const models = readModels(
      [
        { MODEL_NO: '01', HOUSE_TY: '059.9800A', SUPLY_AR: '84.1', SUPLY_HSHLDCO: 40, SPSPLY_HSHLDCO: 20, LTTOT_TOP_AMOUNT: '100000' },
        { MODEL_NO: '02', HOUSE_TY: '084.9700A', SUPLY_AR: '113.2', SUPLY_HSHLDCO: 60, SPSPLY_HSHLDCO: 30, LTTOT_TOP_AMOUNT: '150,000' },
      ],
      [
        { MODEL_NO: '01', SUBSCRPT_RANK_CODE: 1, RESIDE_SECD: '01', REQ_CNT: '300', CMPET_RATE: '7.50', SUPLY_HSHLDCO: 40 },
        { MODEL_NO: '01', SUBSCRPT_RANK_CODE: 1, RESIDE_SECD: '03', REQ_CNT: '100', CMPET_RATE: '' },
        { MODEL_NO: '02', SUBSCRPT_RANK_CODE: 1, RESIDE_SECD: '01', REQ_CNT: '30', CMPET_RATE: '(△30)' },
        { MODEL_NO: '02', SUBSCRPT_RANK_CODE: 2, RESIDE_SECD: '01', REQ_CNT: '99' },
      ],
      [{ MODEL_NO: '01', LWET_SCORE: 52, TOP_SCORE: 69, AVRG_SCORE: '58.5' }],
    );
    assert.equal(models[0].type, '59.98A');
    assert.equal(models[0].rank1, 400);
    close(models[0].rate, 10);
    assert.equal(models[0].localRate, '7.50');
    assert.equal(models[0].topPrice, 10e8);
    assert.deepEqual(models[0].score, { min: 52, max: 69, avg: 58.5 });
    close(models[1].rate, 0.5);
    const s = summarizeListing(models);
    close(s.rate, 430 / 100);
    assert.equal(s.maxRate!.type, '59.98A');
    // households-weighted price per 3.3㎡ of 공급면적
    const pp0 = (10e8 / 84.1) * 3.305785, pp1 = (15e8 / 113.2) * 3.305785;
    close(s.perPyeong, (pp0 * 60 + pp1 * 90) / 150, 1);
    assert.deepEqual(s.score, { min: 52, avg: 58.5 });
  });

  it('keeps 공고 of the region', () => {
    const l = { area: '경기', address: '경기도 성남시 분당구 정자동 1' };
    assert.ok(inRegion(l, '경기', ['성남시', '분당구']));
    assert.ok(!inRegion(l, '서울', []));
    assert.ok(!inRegion(l, '경기', ['수원시']));
    assert.ok(inRegion(l, '전국', []));
  });

  it('draws 공고 month by month', () => {
    const l = (d: string) => ({ announced: d }) as never;
    const c = monthlyApply([
      { listing: l('2026-07-05'), summary: { rate: 10, maxRate: null, perPyeong: 50_000_000, score: null }, general: 100, rank1: 1000 },
      { listing: l('2026-07-20'), summary: { rate: 2, maxRate: null, perPyeong: null, score: null }, general: 100, rank1: 200 },
      { listing: l('2026-09-01'), summary: { rate: 1, maxRate: null, perPyeong: 30_000_000, score: null }, general: 10, rank1: 10 },
    ]);
    assert.deepEqual(c.rate.rows.map((r) => [r.date, r.n, r.rate]), [['2026-07-01', 2, 6], ['2026-08-01', 0, null], ['2026-09-01', 1, 1]]);
    assert.deepEqual(c.price.rows.map((r) => r.pp), [5000, null, 3000]);
  });
});

describe('지도', () => {
  const monthly = (values: number[], start = '2025-01-01'): Point[] => values.map((value, i) => ({ date: addMonths(start, i), value }));
  it('reads each region’s numbers from whole tables', () => {
    const r = roneRegion('부산>해운대구')!;
    const v = mapValues({
      price: new Map([[`/${r.ids.price}`, monthly(Array.from({ length: 14 }, (_, i) => 100 + i))]]),
      ratio: new Map([[`/${r.ids.ratio}`, monthly([60, 61])]]),
      trade: new Map([[`/${r.ids.trade}`, monthly(Array.from({ length: 24 }, (_, i) => (i < 12 ? 100 : 150)))]]),
      residence: new Map([500001, 500003, 500004, 500005].map((c, i) => [`${r.groups.residence}/${c}`, monthly(Array(12).fill([100, 20, 10, 5][i]))])),
    })[r.key];
    close(v.y1, (113 / 101 - 1) * 100);
    close(v.m1, (113 / 112 - 1) * 100);
    assert.equal(v.ratio, 61);
    close(v.trade, 50);
    close(v.outside, 35);
    assert.equal(v.phase, 1);
  });

  it('draws a 구 with its own row and falls back to its 시', () => {
    assert.equal(regionOfShape('41135').own?.key, '경기>성남시>분당구');
    assert.equal(regionOfShape('41135').parent?.key, '경기>성남시');
    assert.equal(regionOfShape('36110').own?.key, '세종');
    assert.equal(regionOfShape('41800').own, null);
    const values = { '경기>성남시': { y1: 5 }, '경기>성남시>분당구': { ratio: 40 } };
    assert.deepEqual(shapeValue('41135', 'ratio', values)?.value, 40);
    assert.equal(shapeValue('41135', 'y1', values)?.region.key, '경기>성남시');
    assert.equal(shapeValue('41800', 'y1', values), null);
  });
});
