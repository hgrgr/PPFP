import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dealKey, diffSales, hitsMessage, passes, pnuOf, zoneFromLandUse, type ReRule } from '../real-estate-alerts';
import type { ApartmentMeta, AptTrade } from '../real-estate';

const meta: ApartmentMeta = {
  kind: 'apartment', address: '서울 강남구 대치동 316', roadAddress: null, placeName: '래미안대치팰리스', lat: 37.49, lng: 127.06,
  lawdCd: '11680', umdCd: '10600', umdNm: '대치동', aptNm: '래미안대치팰리스', jibun: '316', aptSeq: '11680-1', area: 84.97,
};
const t = (o: Partial<AptTrade>): AptTrade => ({
  date: '2026-09-10', price: 3_000_000_000, area: 84.97, floor: 10, aptNm: '래미안대치팰리스', umdCd: '10600', umdNm: '대치동', jibun: '316', aptSeq: '11680-1',
  buildYear: 2015, cancelled: false, dealing: '중개거래', aptDong: null, rgstDate: null, buyer: '개인', seller: '개인', ...o,
});
const rule = (o: Partial<ReRule> = {}): ReRule => ({ events: ['TRADE', 'REGISTERED', 'CANCELLED'], scope: 'AREA', minPrice: null, maxPrice: null, newHighOnly: false, dealing: 'ANY', buyer: 'ANY', ...o });
const today = '2026-10-10';

describe('real estate alerts', () => {
  it('records a baseline first, then reports new, registered and cancelled sales', () => {
    const a = t({});
    const b = t({ date: '2026-09-20', floor: 3, price: 3_100_000_000 });
    const first = diffSales([a], meta, rule(), null, today);
    assert.equal(first.hits.length, 0);
    const second = diffSales([{ ...a, rgstDate: '2026-10-05', aptDong: '101' }, b], meta, rule(), first.seen, today);
    assert.deepEqual(second.hits.map((h) => h.event), ['TRADE', 'REGISTERED']);
    const third = diffSales([{ ...a, rgstDate: '2026-10-05' }, { ...b, cancelled: true }], meta, rule(), second.seen, today);
    assert.deepEqual(third.hits.map((h) => [h.event, h.trade.floor]), [['CANCELLED', 3]]);
    // Nothing new on the next check
    assert.equal(diffSales([{ ...a, rgstDate: '2026-10-05' }, { ...b, cancelled: true }], meta, rule(), third.seen, today).hits.length, 0);
  });

  it('keeps to the scope, the events asked for and the watch window', () => {
    const base = diffSales([], meta, rule({ scope: 'AREA' }), null, today).seen;
    const other = t({ aptSeq: '11680-2', aptNm: '은마', jibun: '316' });
    const small = t({ area: 59.97 });
    const old = t({ date: '2026-05-01' });
    assert.equal(diffSales([other, small, old], meta, rule({ scope: 'AREA' }), base, today).hits.length, 0);
    assert.equal(diffSales([other, small], meta, rule({ scope: 'COMPLEX' }), base, today).hits.length, 1);
    assert.equal(diffSales([other, small], meta, rule({ scope: 'DONG' }), base, today).hits.length, 2);
    assert.equal(diffSales([t({})], meta, rule({ events: ['REGISTERED'] }), base, today).hits.length, 0);
  });

  it('applies price, dealing, buyer and new-high conditions to new sales', () => {
    const earlier = [t({ date: '2026-03-01', price: 3_200_000_000 })];
    const x = t({ price: 3_100_000_000 });
    assert.equal(passes(x, rule({ minPrice: 3_000_000_000, maxPrice: 3_100_000_000 }), earlier), true);
    assert.equal(passes(x, rule({ minPrice: 3_150_000_000 }), earlier), false);
    assert.equal(passes(x, rule({ dealing: 'DIRECT' }), earlier), false);
    assert.equal(passes(t({ dealing: '직거래' }), rule({ dealing: 'BROKER' }), earlier), false);
    assert.equal(passes(x, rule({ buyer: 'CORP' }), earlier), false);
    assert.equal(passes(x, rule({ newHighOnly: true }), [...earlier, x]), false);
    assert.equal(passes(t({ price: 3_300_000_000 }), rule({ newHighOnly: true }), earlier), true);
    // A cancelled higher sale does not count
    assert.equal(passes(x, rule({ newHighOnly: true }), [{ ...earlier[0], cancelled: true }]), true);
  });

  it('writes one message per check', () => {
    const m = hitsMessage('래미안 34평형', [
      { event: 'TRADE', trade: t({ floor: 12, price: 3_120_000_000, buyer: '법인' }) },
      { event: 'REGISTERED', trade: t({ rgstDate: '2026-10-05' }) },
    ], 'AREA');
    assert.equal(m.title, '래미안 34평형 · 새 거래 1건, 등기 완료 1건');
    assert.match(m.body, /새 거래: 12층 31억 2,000만 \(계약 2026-09-10, 매수 법인\)/);
    assert.match(m.body, /등기 2026-10-05/);
  });

  it('builds the PNU and reads 토지거래허가구역 from 토지이용계획', () => {
    assert.equal(pnuOf(meta), '1168010600103160000');
    assert.equal(pnuOf({ ...meta, jibun: '산12-3' }), '1168010600200120003');
    assert.equal(pnuOf({ ...meta, jibun: null }), null);
    assert.equal(zoneFromLandUse({ landUses: { field: [{ prposAreaDstrcCodeNm: '제3종일반주거지역' }, { prposAreaDstrcCodeNm: '토지거래계약에관한허가구역' }], totalCount: '2' } }), true);
    assert.equal(zoneFromLandUse({ landUses: { field: [{ prposAreaDstrcCodeNm: '제3종일반주거지역' }] } }), false);
    assert.equal(zoneFromLandUse({ landUses: { resultCode: 'INVALID_KEY', resultMsg: '등록되지 않은 인증키입니다.' } }), null);
    assert.equal(dealKey(t({ rgstDate: '2026-10-05', aptDong: '101' })), dealKey(t({})));
  });
});
