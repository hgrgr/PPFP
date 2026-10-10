/**
 * Fake 카카오 로컬 (keyword search, 좌표→행정구역) and 국토교통부 아파트 매매 실거래가 for
 * documentation screenshots. Loaded by fake-market.cjs.
 *
 * The complexes are made up (names included), placed in 서울 강남구 대치동 so the codes are
 * real; their deals follow a deterministic path per complex and area, rising slowly, so the
 * estimate, the chart and the neighborhood table agree with each other.
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
  return out;
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
        `<dealingGbn>${d.direct ? '직거래' : '중개거래'}</dealingGbn><excluUseAr>${d.area}</excluUseAr><floor>${d.floor}</floor><jibun>${d.jibun}</jibun><sggCd>${LAWD}</sggCd><umdCd>${UMD}</umdCd><umdNm>${DONG}</umdNm></item>`,
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><response><header><resultCode>000</resultCode><resultMsg>OK</resultMsg></header><body><items>${items}</items><numOfRows>1000</numOfRows><pageNo>1</pageNo><totalCount>${deals.length}</totalCount></body></response>`;
}

function keyword(url) {
  const q = (url.searchParams.get('query') || '').replace(/\s+/g, '');
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
  if (url.hostname === 'api.vworld.kr' && url.pathname === '/ned/data/getLandUseAttr') {
    return new Response(JSON.stringify(landUse(url)), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } });
  }
  if (url.hostname === 'dapi.kakao.com' && (url.pathname === '/v2/local/search/keyword.json' || url.pathname === '/v2/local/geo/coord2regioncode.json')) {
    const body = url.pathname.endsWith('keyword.json') ? keyword(url) : region();
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } });
  }
  return prevFetch(input, init);
};

module.exports = { COMPLEXES, LAWD, UMD, DONG };
