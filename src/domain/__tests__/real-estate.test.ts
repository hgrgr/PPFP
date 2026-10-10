import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  apartmentReport,
  areaLabel,
  complexesIn,
  eok,
  estimatePrice,
  guessComplex,
  jibunOf,
  MolitApiError,
  monthsBefore,
  naverLandUrl,
  parseKakaoPlaces,
  parseMolitTrades,
  parseRegionCode,
  readApartmentMeta,
  recentMonths,
  type ApartmentMeta,
  type AptTrade,
} from '../real-estate';

const item = (o: Record<string, string>) => `<item>${Object.entries(o).map(([k, v]) => `<${k}>${v}</${k}>`).join('')}</item>`;
const page = (items: string[], total = items.length) =>
  `<?xml version="1.0" encoding="UTF-8"?><response><header><resultCode>000</resultCode><resultMsg>OK</resultMsg></header><body><items>${items.join('')}</items><numOfRows>1000</numOfRows><pageNo>1</pageNo><totalCount>${total}</totalCount></body></response>`;

const trade = (o: Partial<AptTrade>): AptTrade => ({
  date: '2026-09-01',
  price: 2_000_000_000,
  area: 84.97,
  floor: 10,
  aptNm: '래미안대치팰리스',
  umdCd: '10600',
  umdNm: '대치동',
  jibun: '316',
  aptSeq: '11680-3874',
  buildYear: 2015,
  cancelled: false,
  dealing: '중개거래',
  aptDong: null,
  ...o,
});

const meta: ApartmentMeta = {
  kind: 'apartment',
  address: '서울 강남구 대치동 316',
  roadAddress: '서울 강남구 삼성로51길 37',
  placeName: '래미안대치팰리스',
  lat: 37.4943,
  lng: 127.0629,
  lawdCd: '11680',
  umdCd: '10600',
  umdNm: '대치동',
  aptNm: '래미안대치팰리스',
  jibun: '316',
  aptSeq: '11680-3874',
  area: 84.97,
};

describe('real estate', () => {
  it('reads the 실거래가 XML, in 원, with cancelled deals marked', () => {
    const { trades, totalCount } = parseMolitTrades(
      page(
        [
          item({ aptNm: '래미안대치팰리스', dealAmount: ' 312,000', dealYear: '2026', dealMonth: '9', dealDay: '3', excluUseAr: '84.97', floor: '12', umdCd: '10600', umdNm: '대치동', jibun: '316', aptSeq: '11680-3874', buildYear: '2015', cdealType: ' ', dealingGbn: '중개거래' }),
          item({ aptNm: '은마', dealAmount: '250,000', dealYear: '2026', dealMonth: '9', dealDay: '20', excluUseAr: '76.79', floor: '5', umdNm: ' 대치동', jibun: '316', cdealType: 'O', cdealDay: '26.09.30' }),
          item({ aptNm: '깨진 행', dealAmount: '' }),
        ],
        3,
      ),
    );
    assert.equal(totalCount, 3);
    assert.equal(trades.length, 2);
    assert.deepEqual(trades[0], { date: '2026-09-03', price: 3_120_000_000, area: 84.97, floor: 12, aptNm: '래미안대치팰리스', umdCd: '10600', umdNm: '대치동', jibun: '316', aptSeq: '11680-3874', buildYear: 2015, cancelled: false, dealing: '중개거래', aptDong: null });
    assert.equal(trades[1].cancelled, true);
    assert.equal(trades[1].umdCd, null);
    assert.equal(trades[1].umdNm, '대치동');
  });

  it('reads the older Korean field names too', () => {
    const { trades } = parseMolitTrades(page([item({ 아파트: '은마', 거래금액: '250,000', 년: '2025', 월: '12', 일: '1', 전용면적: '76.79', 층: '3', 법정동: '대치동', 지번: '316' })]));
    assert.equal(trades[0].date, '2025-12-01');
    assert.equal(trades[0].price, 2_500_000_000);
  });

  it('turns error answers into messages a user can act on', () => {
    assert.throws(
      () => parseMolitTrades('<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR</errMsg><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg><returnReasonCode>30</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>'),
      (e: unknown) => e instanceof MolitApiError && e.code === '30' && /Decoding/.test(e.message),
    );
    assert.throws(() => parseMolitTrades('<response><header><resultCode>22</resultCode><resultMsg>LIMITED</resultMsg></header></response>'), /한도/);
    assert.equal(parseMolitTrades('<response><header><resultCode>03</resultCode><resultMsg>NODATA_ERROR</resultMsg></header></response>').trades.length, 0);
  });

  it('puts apartment complexes first among map hits', () => {
    const hits = parseKakaoPlaces({
      documents: [
        { place_name: '래미안대치팰리스 상가', address_name: '서울 강남구 대치동 316', road_address_name: '', x: '127.06', y: '37.49', category_name: '부동산 > 상가' },
        { place_name: '래미안대치팰리스', address_name: '서울 강남구 대치동 316', road_address_name: '서울 강남구 삼성로51길 37', x: '127.0629', y: '37.4943', category_name: '부동산 > 주거시설 > 아파트' },
        { place_name: '', address_name: 'x', x: '1', y: '1' },
      ],
    });
    assert.equal(hits.length, 2);
    assert.equal(hits[0].name, '래미안대치팰리스');
    assert.equal(hits[1].roadAddress, null);
  });

  it('reads the 법정동 code from 카카오 좌표→행정구역', () => {
    assert.deepEqual(
      parseRegionCode({ documents: [{ region_type: 'H', code: '1168060000', region_3depth_name: '대치1동' }, { region_type: 'B', code: '1168010600', region_3depth_name: '대치동' }] }),
      { lawdCd: '11680', umdCd: '10600', umdNm: '대치동' },
    );
    assert.equal(parseRegionCode({ documents: [] }), null);
  });

  it('finds the complex a map place is, by 지번 then by name', () => {
    assert.equal(jibunOf('서울 강남구 대치동 316'), '316');
    assert.equal(jibunOf('경기 성남시 분당구 정자동 산 12-3'), '산12-3');
    const trades = [
      trade({}),
      trade({ aptSeq: '11680-1', aptNm: '은마', jibun: '316', date: '2026-08-01' }),
      trade({ aptSeq: '11680-1', aptNm: '은마', jibun: '316', area: 76.79 }),
      trade({ aptSeq: '11680-2', aptNm: '대치아이파크', jibun: '1026' }),
      trade({ aptSeq: '11650-9', aptNm: '반포자이', umdCd: '10700', umdNm: '반포동' }),
    ];
    const opts = complexesIn(trades, { umdCd: '10600', umdNm: '대치동' });
    assert.equal(opts.length, 3);
    assert.equal(opts[0].aptNm, '은마');
    assert.deepEqual(opts[0].areas.map((a) => a.area), [76.79, 84.97]);
    assert.equal(guessComplex(opts, { name: '래미안 대치 팰리스', address: '서울 강남구 대치동 316' }), '11680-3874');
    assert.equal(guessComplex(opts, { name: '대치아이파크아파트', address: '서울 강남구 대치동' }), '11680-2');
    assert.equal(guessComplex(opts, { name: '타워팰리스', address: '서울 강남구 도곡동 467' }), null);
  });

  it('estimates the price from recent same-area deals, leaving out cancelled ones', () => {
    const own = [
      trade({ date: '2026-09-20', price: 3_200_000_000 }),
      trade({ date: '2026-09-01', price: 3_000_000_000 }),
      trade({ date: '2026-08-15', price: 3_100_000_000 }),
      trade({ date: '2026-09-25', price: 4_000_000_000, cancelled: true }),
      trade({ date: '2026-09-10', price: 2_400_000_000, area: 59.97 }),
    ];
    const e = estimatePrice(own, 84.97, '2026-10-10')!;
    assert.equal(e.price, 3_100_000_000);
    assert.equal(e.deals, 3);
    assert.equal(e.method, 'same-area');
    // No deal of this size: the complex's price per ㎡
    const e2 = estimatePrice([trade({ area: 100, price: 3_000_000_000, date: '2026-05-01' })], 50, '2026-10-10')!;
    assert.equal(e2.method, 'complex-per-area');
    assert.equal(e2.price, 1_500_000_000);
    assert.equal(estimatePrice([trade({ date: '2024-01-01' })], 84.97, '2026-10-10'), null);
  });

  it('reports the complex, its neighbors and the 동 trend', () => {
    const r = apartmentReport(
      [
        trade({ date: '2026-09-20', price: 3_300_000_000 }),
        trade({ date: '2025-08-01', price: 2_800_000_000 }),
        trade({ date: '2026-09-02', price: 2_400_000_000, area: 59.97 }),
        trade({ aptSeq: '11680-1', aptNm: '은마', date: '2026-09-05', price: 2_500_000_000, area: 76.79 }),
        trade({ aptSeq: '11680-1', aptNm: '은마', date: '2025-08-10', price: 2_100_000_000, area: 76.79 }),
        trade({ aptSeq: '11650-9', aptNm: '반포자이', umdCd: '10700', umdNm: '반포동' }),
      ],
      meta,
      '2026-10-10',
    );
    assert.equal(r.own.length, 3);
    assert.equal(r.sameAreaDeals.length, 2);
    assert.equal(r.estimate?.price, 3_300_000_000);
    assert.deepEqual(r.areas.map((a) => [a.area, a.deals, a.high]), [[59.97, 1, 2_400_000_000], [84.97, 2, 3_300_000_000]]);
    assert.deepEqual(r.nearby.map((n) => [n.aptNm, n.own, n.deals]), [['래미안대치팰리스', true, 2], ['은마', false, 1]]);
    assert.equal(r.dong.recentDeals, 3);
    assert.ok(r.dong.recent! > r.dong.yearAgo!);
    assert.equal(r.dong.monthly[0].month, '2025-08');
  });

  it('counts months and formats 억', () => {
    assert.equal(monthsBefore('2026-03-31', 1), '2026-02-28');
    assert.equal(monthsBefore('2026-01-15', 13), '2024-12-15');
    assert.deepEqual(recentMonths('2026-02-10', 3), ['202602', '202601', '202512']);
    assert.equal(eok(3_120_000_000), '31억 2,000만');
    assert.equal(eok(3_000_000_000), '30억');
    assert.equal(eok(95_000_000), '9,500만');
    assert.equal(areaLabel(84.97), '84.97㎡ (약 34평형)');
    assert.equal(areaLabel(59.9), '59.9㎡ (약 24평형)');
  });

  it('accepts only a well-formed apartment meta', () => {
    assert.deepEqual(readApartmentMeta(JSON.stringify(meta)), meta);
    assert.equal(readApartmentMeta({ ...meta, lawdCd: '1168' }), null);
    assert.equal(readApartmentMeta({ ...meta, kind: 'house' }), null);
    assert.equal(readApartmentMeta('not json'), null);
    assert.equal(readApartmentMeta({ ...meta, area: null, aptNm: null })?.area, null);
    assert.equal(naverLandUrl(meta), 'https://m.land.naver.com/search/result/%EB%9E%98%EB%AF%B8%EC%95%88%EB%8C%80%EC%B9%98%ED%8C%B0%EB%A6%AC%EC%8A%A4');
  });
});
