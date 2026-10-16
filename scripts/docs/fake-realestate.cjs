/**
 * Fake 카카오 로컬 (keyword and address search, 좌표→행정구역) and 국토교통부 매매 실거래가
 * (아파트, 연립다세대, 오피스텔, 단독/다가구, 토지, 상업업무용) for documentation screenshots.
 * Loaded by fake-market.cjs.
 *
 * The buildings are made up (names included), placed in 서울 강남구 대치동 so the codes are
 * real; their deals follow a deterministic path per building and area, rising slowly, so the
 * estimate, the chart and the neighborhood table agree with each other. Houses, land and
 * shops are reported with the 지번 masked, as the real services do.
 */
'use strict';

const LAWD = '11680';
const UMD = '10600';
const DONG = '대치동';

/** name, 지번, serial, build year, lat, lng, [area ㎡, price now in 만원, deals per year], [months ago it traded from, to] (default [0, 36]) */
const COMPLEXES = [
  ['한빛마을래미안', '508', '11680-9001', 2015, 37.4949, 127.0631, [[59.97, 248000, 6], [84.97, 312000, 9], [114.6, 395000, 3]]],
  ['대치푸른숲', '316', '11680-9002', 1979, 37.4993, 127.0628, [[76.79, 236000, 10], [84.43, 268000, 7]]],
  ['대치리버뷰자이', '1026', '11680-9003', 2008, 37.4986, 127.0573, [[84.95, 285000, 5], [134.9, 420000, 2]]],
  ['도곡로한신', '972', '11680-9004', 1993, 37.4917, 127.0582, [[84.6, 221000, 4]]],
  ['선릉벽산', '890', '11680-9005', 2001, 37.5001, 127.0512, [[59.8, 172000, 3], [84.9, 214000, 4]]],
  // Rarely traded: nothing in the last year and a half, so only a wider search finds it
  ['대치은하수', '660', '11680-9006', 1985, 37.4962, 127.0655, [[101.6, 248000, 8]], [20, 180]],
];

/**
 * More complexes for 지역 분석's 단지 분석, in other 동 of 강남구 and ten years back, with the
 * 2021 peak and the 2022–23 fall (only read by the month deals, not by place search):
 * [name, 지번, serial, build year, umdCd, umdNm, areas]
 */
const DISTRICT_COMPLEXES = [
  ['도곡하늘채', '467', '11680-9101', 2004, '11800', '도곡동', [[84.99, 298000, 8], [114.8, 372000, 3]]],
  ['개포숲마을', '1220', '11680-9102', 2019, '10300', '개포동', [[59.99, 241000, 9], [84.98, 305000, 10]]],
  ['개포한마음', '660', '11680-9103', 1983, '10300', '개포동', [[49.5, 198000, 6], [76.5, 262000, 4]]],
  ['역삼센트럴', '735', '11680-9104', 2010, '10100', '역삼동', [[84.9, 251000, 7], [59.9, 196000, 6]]],
  ['삼성리버파크', '91', '11680-9105', 1999, '10500', '삼성동', [[84.5, 276000, 5], [101.9, 318000, 3]]],
];
/** The market path for the district complexes: −20% from the 2021 peak to 2023, back since */
const cycle = (back) => {
  const k = back / 12; // years ago
  if (k < 3) return 1 - 0.04 * k; // recovering
  if (k < 5) return 0.88 - 0.09 * (k - 3) + 0.27 * Math.max(0, k - 4); // the fall, deepest 3–4 years ago
  return 1.06 * Math.pow(0.93, k - 5); // the run-up to the peak
};

/** Villas and officetels: name, 지번, build year, lat, lng, [area ㎡, price now in 만원, deals per year] */
const VILLAS = [
  ['대치 그린빌', '903-12', 2016, 37.4982, 127.0601, [[49.52, 52000, 5], [59.84, 63500, 4]]],
  ['선릉 하우스토리', '944-7', 2019, 37.5012, 127.0539, [[39.81, 41000, 6]]],
  ['대치 로얄맨션', '920-3', 1998, 37.4975, 127.0612, [[84.2, 98000, 3]]],
];
const OFFICETELS = [['대치 센트럴타워', '1003', 2012, 37.4968, 127.0579, [[24.6, 28500, 8], [42.3, 47000, 4]]]];
/** Houses, land and shops: [use, masked 지번, area ㎡ (대지 · 토지 · 건물), price per ㎡ now in 만원, deals per year, extra] */
const LOTS = {
  house: [['단독', '9**', 165, 2850, 6, { floor: 210, built: 1991 }], ['다가구', '9**', 231, 2700, 3, { floor: 395, built: 2003 }], ['단독', '1**', 198, 2950, 4, { floor: 180, built: 1987 }], ['단독', '8**', 182, 2900, 4, { floor: 196, built: 1996 }]],
  land: [['대', '9**', 330, 3100, 1, { zoning: '제2종일반주거' }], ['대', '1**', 165, 3300, 1, { zoning: '제2종일반주거' }]],
  commercial: [['제2종근린생활', '9**', 66, 4200, 3, { type: '집합', plot: 14, zoning: '일반상업' }], ['업무', '1***', 920, 3600, 1, { type: '일반', plot: 410, zoning: '일반상업' }]],
};

/** Deterministic 0..1 from a string */
function rnd(s) {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

const today = () => {
  const d = new Date(Date.now() + 9 * 3600_000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
};

/** Deals of every complex in one contract month (YYYYMM). */
function monthDeals(ym) {
  const y = Number(ym.slice(0, 4)), m = Number(ym.slice(4));
  const t = today();
  const back = (t.y - y) * 12 + (t.m - m); // months ago
  if (back < 0 || back > 250) return [];
  const out = [];
  for (const [name, jibun, seq, built, , , areas, active = [0, 36]] of COMPLEXES) {
    if (back < active[0] || back > active[1]) continue;
    for (const [area, now, perYear] of areas) {
      const n = Math.floor((perYear / 12) * 2 * rnd(`${seq}:${area}:${ym}:n`) + 0.35);
      for (let i = 0; i < n; i++) {
        const day = 1 + Math.floor(rnd(`${seq}:${area}:${ym}:${i}:d`) * 27);
        if (back === 0 && day > t.d) continue;
        // About 9% a year up to now, with ±3% scatter
        const level = now / Math.pow(1.0075, back);
        const price = Math.round((level * (0.97 + 0.06 * rnd(`${seq}:${area}:${ym}:${i}:p`))) / 100) * 100;
        out.push({
          aptNm: name, jibun, aptSeq: seq, buildYear: built, area, price, day,
          floor: 2 + Math.floor(rnd(`${seq}:${ym}:${i}:f`) * 22),
          cancelled: rnd(`${seq}:${area}:${ym}:${i}:c`) > 0.95,
          direct: rnd(`${seq}:${area}:${ym}:${i}:g`) > 0.9,
          corp: rnd(`${seq}:${area}:${ym}:${i}:b`) > 0.92,
          // Registered 35–75 days after the contract, once that day has passed
          rgstAfter: 35 + Math.floor(rnd(`${seq}:${area}:${ym}:${i}:r`) * 40),
          dong: 101 + Math.floor(rnd(`${seq}:${area}:${ym}:${i}:dong`) * 8),
        });
      }
    }
  }
  for (const [name, jibun, seq, built, umdCd, umdNm, areas] of DISTRICT_COMPLEXES) {
    if (back > 120) continue;
    for (const [area, now, perYear] of areas) {
      const n = Math.floor((perYear / 12) * 2 * rnd(`${seq}:${area}:${ym}:n`) + 0.35);
      for (let i = 0; i < n; i++) {
        const day = 1 + Math.floor(rnd(`${seq}:${area}:${ym}:${i}:d`) * 27);
        if (back === 0 && day > t.d) continue;
        const price = Math.round((now * cycle(back) * (0.97 + 0.06 * rnd(`${seq}:${area}:${ym}:${i}:p`))) / 100) * 100;
        out.push({
          aptNm: name, jibun, aptSeq: seq, buildYear: built, area, price, day, umdCd, umdNm,
          floor: 2 + Math.floor(rnd(`${seq}:${ym}:${i}:f`) * 22),
          cancelled: rnd(`${seq}:${area}:${ym}:${i}:c`) > 0.95,
          direct: rnd(`${seq}:${area}:${ym}:${i}:g`) > 0.9,
          corp: rnd(`${seq}:${area}:${ym}:${i}:b`) > 0.92,
          rgstAfter: 35 + Math.floor(rnd(`${seq}:${area}:${ym}:${i}:r`) * 40),
          dong: 101 + Math.floor(rnd(`${seq}:${area}:${ym}:${i}:dong`) * 8),
        });
      }
    }
  }
  return out;
}

/** One month's deals of villas or officetels, by the same path as the apartments. */
function buildingDeals(list, ym, tag) {
  const y = Number(ym.slice(0, 4)), m = Number(ym.slice(4));
  const t = today();
  const back = (t.y - y) * 12 + (t.m - m);
  if (back < 0 || back > 36) return [];
  const out = [];
  for (const [name, jibun, built, , , areas] of list) {
    for (const [area, now, perYear] of areas) {
      const n = rnd(`${tag}:${name}:${area}:${ym}:n`) < perYear / 12 ? 1 : 0;
      for (let i = 0; i < n; i++) {
        const day = 1 + Math.floor(rnd(`${tag}:${name}:${area}:${ym}:${i}:d`) * 27);
        if (back === 0 && day > t.d) continue;
        const price = Math.round((now / Math.pow(1.005, back)) * (0.96 + 0.08 * rnd(`${tag}:${name}:${area}:${ym}:${i}:p`)) / 100) * 100;
        out.push({ name, jibun, built, area, price, day, floor: 2 + Math.floor(rnd(`${tag}:${name}:${ym}:${i}:f`) * (tag === 'offi' ? 18 : 4)), cancelled: rnd(`${tag}:${name}:${area}:${ym}:${i}:c`) > 0.96, direct: rnd(`${tag}:${name}:${area}:${ym}:${i}:g`) > 0.85 });
      }
    }
  }
  return out;
}

/** One month's deals of houses, land or shops: masked 지번, a price per ㎡ rising about 5% a year. */
function lotDeals(kind, ym) {
  const y = Number(ym.slice(0, 4)), m = Number(ym.slice(4));
  const t = today();
  const back = (t.y - y) * 12 + (t.m - m);
  if (back < 0 || back > 36) return [];
  const out = [];
  LOTS[kind].forEach(([use, jibun, area, perArea, perYear, extra], k) => {
    const n = rnd(`${kind}:${k}:${ym}:n`) < perYear / 12 ? 1 : 0;
    for (let i = 0; i < n; i++) {
      const day = 1 + Math.floor(rnd(`${kind}:${k}:${ym}:${i}:d`) * 27);
      if (back === 0 && day > t.d) continue;
      const a = Math.round(area * (0.8 + 0.4 * rnd(`${kind}:${k}:${ym}:${i}:a`)) * 10) / 10;
      const price = Math.round(((perArea / Math.pow(1.004, back)) * a * (0.92 + 0.16 * rnd(`${kind}:${k}:${ym}:${i}:p`))) / 100) * 100;
      out.push({ use, jibun, area: a, price, day, extra, cancelled: rnd(`${kind}:${k}:${ym}:${i}:c`) > 0.95, direct: rnd(`${kind}:${k}:${ym}:${i}:g`) > 0.85 });
    }
  });
  return out;
}

const tagged = (o) => Object.entries(o).map(([k, v]) => `<${k}>${v ?? ''}</${k}>`).join('');
const xml = (items, total) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><response><header><resultCode>000</resultCode><resultMsg>OK</resultMsg></header><body><items>${items}</items><numOfRows>1000</numOfRows><pageNo>1</pageNo><totalCount>${total}</totalCount></body></response>`;

/** The services other than apartments; null for one this fake does not know. */
function otherKind(service, url) {
  const ym = url.searchParams.get('DEAL_YMD') || '';
  const here = url.searchParams.get('LAWD_CD') === LAWD;
  const date = (d) => ({ dealYear: ym.slice(0, 4), dealMonth: Number(ym.slice(4)), dealDay: d.day });
  const common = (d) => ({ ...date(d), dealAmount: d.price.toLocaleString('en-US'), cdealType: d.cancelled ? 'O' : '', dealingGbn: d.direct ? '직거래' : '중개거래', sggCd: LAWD, umdNm: DONG });
  if (service === 'RTMSDataSvcRHTrade' || service === 'RTMSDataSvcOffiTrade') {
    const offi = service === 'RTMSDataSvcOffiTrade';
    const deals = here ? buildingDeals(offi ? OFFICETELS : VILLAS, ym, offi ? 'offi' : 'villa') : [];
    const items = deals.map((d) => `<item>${tagged({ ...common(d), [offi ? 'offiNm' : 'mhouseNm']: d.name, jibun: d.jibun, buildYear: d.built, excluUseAr: d.area, floor: d.floor, ...(offi ? {} : { landAr: Math.round(d.area * 0.45 * 100) / 100 }), buyerGbn: '개인', slerGbn: '개인' })}</item>`);
    return xml(items.join(''), deals.length);
  }
  const kind = { RTMSDataSvcSHTrade: 'house', RTMSDataSvcLandTrade: 'land', RTMSDataSvcNrgTrade: 'commercial' }[service];
  if (!kind) return null;
  const deals = here ? lotDeals(kind, ym) : [];
  const items = deals.map((d) => {
    const fields =
      kind === 'house'
        ? { houseType: d.use, jibun: d.jibun, plottageAr: d.area, totalFloorAr: Math.round(d.extra.floor * (d.area / LOTS.house.find((x) => x[0] === d.use)[2]) * 10) / 10, buildYear: d.extra.built }
        : kind === 'land'
          ? { jimok: d.use, landUse: d.extra.zoning, jibun: d.jibun, dealArea: d.area, shareDealingType: '' }
          : { buildingType: d.extra.type, buildingUse: d.use, landUse: d.extra.zoning, jibun: d.jibun, buildingAr: d.area, plottageAr: d.extra.plot, floor: d.extra.type === '집합' ? 1 : '', buildYear: 2004, shareDealingType: '' };
    return `<item>${tagged({ ...common(d), ...fields })}</item>`;
  });
  return xml(items.join(''), deals.length);
}

function molit(url) {
  const lawd = url.searchParams.get('LAWD_CD');
  const ym = url.searchParams.get('DEAL_YMD') || '';
  const deals = lawd === LAWD ? monthDeals(ym) : [];
  const now = Date.now();
  const items = deals
    .map((d) => {
      const contract = Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(4)) - 1, d.day);
      const rgst = !d.cancelled && contract + d.rgstAfter * 86400_000 < now ? new Date(contract + d.rgstAfter * 86400_000).toISOString().slice(2, 10).replace(/-/g, '.') : '';
      return { d, rgst };
    })
    .map(
      ({ d, rgst }) =>
        `<item><aptDong>${rgst ? d.dong : ''}</aptDong><rgstDate>${rgst}</rgstDate><buyerGbn>${d.corp ? '법인' : '개인'}</buyerGbn><slerGbn>개인</slerGbn><aptNm>${d.aptNm}</aptNm><aptSeq>${d.aptSeq}</aptSeq><buildYear>${d.buildYear}</buildYear><cdealDay></cdealDay><cdealType>${d.cancelled ? 'O' : ''}</cdealType>` +
        `<dealAmount>${d.price.toLocaleString('en-US')}</dealAmount><dealDay>${d.day}</dealDay><dealMonth>${Number(ym.slice(4))}</dealMonth><dealYear>${ym.slice(0, 4)}</dealYear>` +
        `<dealingGbn>${d.direct ? '직거래' : '중개거래'}</dealingGbn><excluUseAr>${d.area}</excluUseAr><floor>${d.floor}</floor><jibun>${d.jibun}</jibun><sggCd>${LAWD}</sggCd><umdCd>${d.umdCd ?? UMD}</umdCd><umdNm>${d.umdNm ?? DONG}</umdNm></item>`,
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><response><header><resultCode>000</resultCode><resultMsg>OK</resultMsg></header><body><items>${items}</items><numOfRows>1000</numOfRows><pageNo>1</pageNo><totalCount>${deals.length}</totalCount></body></response>`;
}

/** Addresses in the demo 동: "대치동 903-12" finds that lot, named by its building when it has one. */
function address(url) {
  const q = (url.searchParams.get('query') || '').replace(/\s+/g, ' ').trim();
  const m = q.match(/대치동\s*(산?\d+(?:-\d+)?)/);
  if (!m) return { documents: [], meta: { total_count: 0 } };
  const jibun = m[1];
  const building = [...VILLAS, ...OFFICETELS].find(([, j]) => j === jibun);
  const [lat, lng] = building ? [building[3], building[4]] : [37.4979 + (jibun.length % 3) * 0.0007, 127.0598];
  const doc = {
    address_name: `서울 강남구 대치동 ${jibun}`,
    x: String(lng),
    y: String(lat),
    address: { address_name: `서울 강남구 대치동 ${jibun}` },
    road_address: { address_name: `서울 강남구 역삼로${jibun.length * 3}길 ${(Number(jibun.split('-')[0]) % 60) + 1}`, building_name: building ? building[0] : '' },
  };
  return { documents: [doc], meta: { total_count: 1 } };
}

function keyword(url) {
  const q = (url.searchParams.get('query') || '').replace(/\s+/g, '');
  const other = [...OFFICETELS.map((b) => [b, '오피스텔']), ...VILLAS.map((b) => [b, '주택'])].filter(([[name]]) => name.replace(/\s+/g, '').includes(q) || q.includes(name.replace(/\s+/g, '')));
  if (other.length) {
    const docs = other.map(([[name, jibun, , lat, lng], cat]) => ({ place_name: name, address_name: `서울 강남구 대치동 ${jibun}`, road_address_name: '', x: String(lng), y: String(lat), category_name: `부동산 > 주거시설 > ${cat}` }));
    return { documents: docs, meta: { total_count: docs.length } };
  }
  const named = COMPLEXES.filter(([name]) => name.includes(q) || q.includes(name));
  const hits = named.length ? named : COMPLEXES.filter(() => q.includes('대치'));
  const docs = (hits.length ? hits : COMPLEXES.slice(0, 1)).flatMap(([name, jibun, , , lat, lng]) => [
    { place_name: name, address_name: `서울 강남구 대치동 ${jibun}`, road_address_name: `서울 강남구 삼성로 ${jibun.length * 17}`, x: String(lng), y: String(lat), category_name: '부동산 > 주거시설 > 아파트' },
    { place_name: `${name} 상가`, address_name: `서울 강남구 대치동 ${jibun}`, road_address_name: '', x: String(lng + 0.0004), y: String(lat), category_name: '부동산 > 상가' },
  ]);
  return { documents: docs, meta: { total_count: docs.length } };
}

/** 브이월드 토지이용계획 for any lot in the demo 동: inside a 토지거래허가구역 */
function landUse(url) {
  const pnu = url.searchParams.get('pnu') || '';
  if (!pnu.startsWith(LAWD + UMD)) return { landUses: { field: [], totalCount: '0', numOfRows: '100', pageNo: '1', resultCode: '', resultMsg: '' } };
  const row = (nm) => ({ pnu, ldCode: LAWD + UMD, ldCodeNm: '서울특별시 강남구 대치동', prposAreaDstrcCodeNm: nm, cnflcAtNm: '포함' });
  return { landUses: { field: [row('제3종일반주거지역'), row('아파트지구'), row('토지거래계약에관한허가구역')], totalCount: '3', numOfRows: '100', pageNo: '1', resultCode: '', resultMsg: '' } };
}

function region() {
  return {
    documents: [
      { region_type: 'B', code: `${LAWD}${UMD}`, region_1depth_name: '서울특별시', region_2depth_name: '강남구', region_3depth_name: DONG },
      { region_type: 'H', code: '1168060000', region_1depth_name: '서울특별시', region_2depth_name: '강남구', region_3depth_name: '대치1동' },
    ],
  };
}

const prevFetch = globalThis.fetch;
globalThis.fetch = async function realEstateDemoFetch(input, init) {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return prevFetch(input, init);
  }
  if (url.hostname === 'apis.data.go.kr' && url.pathname.includes('RTMSDataSvcAptTrade')) {
    return new Response(molit(url), { status: 200, headers: { 'content-type': 'application/xml; charset=utf-8' } });
  }
  if (url.hostname === 'apis.data.go.kr' && url.pathname.startsWith('/1613000/RTMSDataSvc')) {
    const body = otherKind(url.pathname.split('/')[2], url);
    if (body) return new Response(body, { status: 200, headers: { 'content-type': 'application/xml; charset=utf-8' } });
  }
  if (url.hostname === 'api.vworld.kr' && url.pathname === '/ned/data/getLandUseAttr') {
    return new Response(JSON.stringify(landUse(url)), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } });
  }
  if (url.hostname === 'dapi.kakao.com' && ['/v2/local/search/keyword.json', '/v2/local/search/address.json', '/v2/local/geo/coord2regioncode.json'].includes(url.pathname)) {
    const body = url.pathname.endsWith('keyword.json') ? keyword(url) : url.pathname.endsWith('address.json') ? address(url) : region();
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } });
  }
  return prevFetch(input, init);
};

module.exports = { COMPLEXES, VILLAS, OFFICETELS, LOTS, LAWD, UMD, DONG, monthDeals };
