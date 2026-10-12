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
  monthsSinceFirst,
  periodLabel,
  pickMonths,
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
  rgstDate: null,
  buyer: '개인',
  seller: '개인',
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
          item({ aptNm: '래미안대치팰리스', dealAmount: ' 312,000', dealYear: '2026', dealMonth: '9', dealDay: '3', excluUseAr: '84.97', floor: '12', umdCd: '10600', umdNm: '대치동', jibun: '316', aptSeq: '11680-3874', buildYear: '2015', cdealType: ' ', dealingGbn: '중개거래', rgstDate: '26.09.30', buyerGbn: '법인', slerGbn: '개인' }),
          item({ aptNm: '은마', dealAmount: '250,000', dealYear: '2026', dealMonth: '9', dealDay: '20', excluUseAr: '76.79', floor: '5', umdNm: ' 대치동', jibun: '316', cdealType: 'O', cdealDay: '26.09.30' }),
          item({ aptNm: '깨진 행', dealAmount: '' }),
        ],
        3,
      ),
    );
    assert.equal(totalCount, 3);
    assert.equal(trades.length, 2);
    assert.deepEqual(trades[0], { date: '2026-09-03', price: 3_120_000_000, area: 84.97, floor: 12, aptNm: '래미안대치팰리스', umdCd: '10600', umdNm: '대치동', jibun: '316', aptSeq: '11680-3874', buildYear: 2015, cancelled: false, dealing: '중개거래', aptDong: null, rgstDate: '2026-09-30', buyer: '법인', seller: '개인' });
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
    // 30 also comes back for a service the key was not applied for, so it names the service
    assert.throws(
      () => parseMolitTrades('<OpenAPI_ServiceResponse><cmmMsgHeader><returnReasonCode>30</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>', 'officetel'),
      (e: unknown) => e instanceof MolitApiError && /오피스텔 매매 실거래가 자료/.test(e.message) && /활용신청/.test(e.message),
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
    assert.equal(opts[0].lastDate, '2026-09-01');
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

  it('reads back as far as the picker is asked, from 2006 at most', () => {
    assert.equal(monthsSinceFirst('2006-01-20'), 1);
    assert.equal(monthsSinceFirst('2026-10-10'), 250);
    assert.equal(pickMonths(36, '2026-10-10'), 36);
    assert.equal(pickMonths(0, '2026-10-10'), 250);
    assert.equal(pickMonths(60, '2007-03-01'), 15);
    assert.equal(pickMonths(7, '2026-10-10'), 12);
    assert.equal(periodLabel(36), '최근 3년');
    assert.equal(periodLabel(0), '2006년 이후');
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

describe('other kinds of real estate', () => {
  it('reads a villa back, and leaves apartments to readApartmentMeta', async () => {
    const { readPropertyMeta, propertyKindLabel } = await import('../real-estate');
    assert.deepEqual(readPropertyMeta({ kind: 'villa', address: ' 서울 마포구 망원동 123-4 ', area: '59.8' }), { kind: 'villa', address: '서울 마포구 망원동 123-4', area: 59.8 });
    assert.deepEqual(readPropertyMeta(JSON.stringify({ kind: 'land', address: '', area: '' })), { kind: 'land', address: null, area: null });
    assert.equal(readPropertyMeta({ kind: 'apartment', address: 'x' }), null);
    assert.equal(readPropertyMeta({ kind: 'castle' }), null);
    assert.equal(readPropertyMeta({ kind: 'villa', area: -3 }), null);
    assert.equal(propertyKindLabel('officetel'), '오피스텔');
  });

  it('reads the deals of villas, officetels, houses, land and shops', () => {
    const villa = parseMolitTrades(page([item({ mhouseNm: '망원 하이빌', dealAmount: '38,500', dealYear: '2026', dealMonth: '8', dealDay: '14', excluUseAr: '59.82', landAr: '31.2', floor: '3', umdNm: '망원동', jibun: '412-5', buildYear: '2018' })]), 'villa').trades[0];
    assert.equal(villa.aptNm, '망원 하이빌');
    assert.equal(villa.area, 59.82);
    assert.equal(villa.landArea, 31.2);
    assert.equal(villa.jibun, '412-5');
    const offi = parseMolitTrades(page([item({ offiNm: '강남 오피스텔', dealAmount: '21,000', dealYear: '2026', dealMonth: '7', dealDay: '1', excluUseAr: '24.5', floor: '11', umdNm: '역삼동', jibun: '823' })]), 'officetel').trades[0];
    assert.equal(offi.aptNm, '강남 오피스텔');
    const house = parseMolitTrades(page([item({ houseType: '단독', dealAmount: '150,000', dealYear: '2026', dealMonth: '6', dealDay: '30', totalFloorAr: '180.5', plottageAr: '200', umdNm: '연희동', jibun: '1**', buildYear: '1995' })]), 'house').trades[0];
    assert.deepEqual([house.aptNm, house.area, house.floorArea, house.use, house.jibun], ['', 200, 180.5, '단독', '1**']);
    const land = parseMolitTrades(page([item({ jimok: '전', landUse: '계획관리', dealAmount: '12,000', dealYear: '2026', dealMonth: '5', dealDay: '2', dealArea: '600', umdNm: '서종면 문호리', jibun: '5**', shareDealingType: '지분' })]), 'land').trades[0];
    assert.deepEqual([land.area, land.use, land.zoning, land.share, land.landArea], [600, '전', '계획관리', true, null]);
    const shop = parseMolitTrades(page([item({ buildingType: '집합', buildingUse: '제2종근린생활', landUse: '일반상업', dealAmount: '45,000', dealYear: '2026', dealMonth: '4', dealDay: '9', buildingAr: '66.1', plottageAr: '12.3', floor: '1', umdNm: '망원동', jibun: '4**' })]), 'commercial').trades[0];
    assert.deepEqual([shop.area, shop.landArea, shop.use, shop.buildingType, shop.floor, shop.share], [66.1, 12.3, '제2종근린생활', '집합', 1, false]);
    // A building kind without its name is not a deal that can be matched
    assert.equal(parseMolitTrades(page([item({ dealAmount: '1,000', dealYear: '2026', dealMonth: '1', dealDay: '1', excluUseAr: '30', umdNm: '망원동' })]), 'villa').trades.length, 0);
  });

  it('names the service to apply for when its use is not approved', () => {
    assert.throws(() => parseMolitTrades('<response><header><resultCode>20</resultCode><resultMsg>SERVICE ACCESS DENIED</resultMsg></header></response>', 'land'), /토지 매매 실거래가 자료를 활용신청/);
    assert.throws(() => parseMolitTrades('<response><header><resultCode>20</resultCode></header></response>'), /아파트 매매 실거래가 상세 자료/);
  });

  it('finds places by address, and ranks places of the kind first', async () => {
    const { parseKakaoAddresses } = await import('../real-estate');
    const hits = parseKakaoAddresses({
      documents: [
        { address_name: '서울 마포구 망원동 412-5', x: '126.90', y: '37.55', address: { address_name: '서울 마포구 망원동 412-5' }, road_address: { address_name: '서울 마포구 망원로 10', building_name: '망원 하이빌' } },
        { address_name: '서울 마포구 망원동 413', x: '126.90', y: '37.55', address: { address_name: '서울 마포구 망원동 413' }, road_address: null },
        { address_name: '', x: '1', y: '1' },
      ],
    });
    assert.deepEqual(
      hits.map((h) => [h.name, h.roadAddress]),
      [['망원 하이빌', '서울 마포구 망원로 10'], ['서울 마포구 망원동 413', null]],
    );
    const docs = { documents: [
      { place_name: '상가', address_name: 'a', x: '1', y: '1', category_name: '부동산 > 상가' },
      { place_name: '오피스텔', address_name: 'b', x: '1', y: '1', category_name: '부동산 > 주거시설 > 오피스텔' },
    ] };
    assert.equal(parseKakaoPlaces(docs, 'officetel')[0].name, '오피스텔');
    assert.equal(parseKakaoPlaces(docs, 'land')[0].name, '상가');
  });

  it('matches a 동 by code, else by name with or without its 읍·면', async () => {
    const { inDong } = await import('../real-estate');
    assert.equal(inDong({ umdCd: '10600', umdNm: 'x' }, { umdCd: '10600', umdNm: '대치동' }), true);
    assert.equal(inDong({ umdCd: null, umdNm: '대치동' }, { umdCd: '10600', umdNm: '대치동' }), true);
    assert.equal(inDong({ umdCd: null, umdNm: '문호리' }, { umdCd: '32021', umdNm: '서종면 문호리' }), true);
    assert.equal(inDong({ umdCd: null, umdNm: '서종면 문호리' }, { umdCd: '32021', umdNm: '서종면 문호리' }), true);
    assert.equal(inDong({ umdCd: null, umdNm: '양서면 문호리' }, { umdCd: '32021', umdNm: '서종면 문호리' }), false);
    assert.equal(inDong({ umdCd: null, umdNm: '역삼동' }, { umdCd: '10600', umdNm: '대치동' }), false);
    assert.deepEqual(parseRegionCode({ documents: [{ region_type: 'B', code: '4183032021', region_3depth_name: '서종면', region_4depth_name: '문호리' }] })?.umdNm, '서종면 문호리');
  });

  it('compares a lot with its 동: per ㎡ over a year, the masked 지번 that could be its own', async () => {
    const { lotReport, maskedJibunFits } = await import('../real-estate');
    assert.equal(maskedJibunFits('1**', '130'), true);
    assert.equal(maskedJibunFits('1**', '1300'), false);
    assert.equal(maskedJibunFits('13*-1*', '130-12'), true);
    assert.equal(maskedJibunFits('130-12', '130-12'), false);
    const lot = (o: Partial<AptTrade>) => trade({ aptNm: '', aptSeq: null, umdCd: null, umdNm: '연희동', jibun: '1**', use: '단독', ...o });
    const lotMeta = { kind: 'house' as const, address: '서울 서대문구 연희동 130-12', roadAddress: null, placeName: '서울 서대문구 연희동 130-12', lat: 37.57, lng: 126.93, lawdCd: '11410', umdCd: '10900', umdNm: '연희동', jibun: '130-12', area: 200, use: '단독' };
    const r = lotReport(
      [
        lot({ date: '2026-09-01', price: 2_000_000_000, area: 200, jibun: '13*-1*' }),
        lot({ date: '2026-06-01', price: 1_500_000_000, area: 100 }),
        lot({ date: '2026-05-01', price: 9_000_000_000, area: 100, cancelled: true }),
        lot({ date: '2026-04-01', price: 100_000_000, area: 100, share: true }),
        lot({ date: '2026-03-01', price: 3_000_000_000, area: 200, use: '다가구' }),
        lot({ date: '2026-03-01', price: 3_000_000_000, area: 200, umdNm: '연남동' }),
        lot({ date: '2025-01-01', price: 1_000_000_000, area: 100 }),
      ],
      lotMeta,
      '2026-10-12',
    );
    assert.equal(r.deals.length, 5);
    assert.equal(r.deals[0].maybeOwn, true);
    assert.equal(r.deals[1].maybeOwn, false);
    assert.deepEqual(r.uses, [{ use: '단독', deals: 5 }, { use: '다가구', deals: 1 }]);
    // 1천만/㎡ and 1천5백만/㎡ in the last year; the cancelled, share and older deals are left out
    assert.equal(r.perArea, 12_500_000);
    assert.equal(r.perAreaDeals, 2);
    assert.equal(r.reference?.price, 2_500_000_000);
    assert.match(r.reference!.basis, /연희동 단독 최근 1년 거래 2건/);
    assert.equal(lotReport([], { ...lotMeta, area: null }, '2026-10-12').reference, null);
  });

  it('reads linked metas back by kind, and tells the kind of any asset', async () => {
    const { readLotMeta, readLinkedMeta, readPropertyMeta, propertyKindOf } = await import('../real-estate');
    const villa = { ...meta, kind: 'villa' as const, aptNm: '망원 하이빌', aptSeq: null };
    assert.equal(readApartmentMeta(villa)?.kind, 'villa');
    assert.equal(readPropertyMeta(villa), null);
    const land = { kind: 'land', address: '경기 양평군 서종면 문호리 500', roadAddress: null, placeName: '문호리 500', lat: 37.6, lng: 127.4, lawdCd: '41830', umdCd: '32021', umdNm: '서종면 문호리', jibun: '500', area: '3300', use: '전' };
    assert.deepEqual(readLotMeta(land), { ...land, area: 3300 });
    assert.equal(readApartmentMeta(land), null);
    assert.equal(readLinkedMeta(JSON.stringify(land))?.kind, 'land');
    assert.equal(readLotMeta({ ...land, kind: 'villa' }), null);
    assert.equal(readLotMeta({ ...land, lawdCd: 'x' }), null);
    assert.equal(propertyKindOf(land), 'land');
    assert.equal(propertyKindOf({ kind: 'other', address: null, area: null }), 'other');
    assert.equal(propertyKindOf(null), 'apartment');
  });
});
