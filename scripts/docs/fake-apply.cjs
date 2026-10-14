/**
 * Fake 청약홈 (공공데이터포털 odcloud: 분양정보, 경쟁률, 당첨가점) for documentation screenshots.
 * Loaded by fake-market.cjs; answers only when PPFP_FAKE_INDICATORS=1, like the other 지역 분석
 * fakes. The 공고 are made up (names included), placed in real 서울·경기 districts.
 */
'use strict';

if (process.env.PPFP_FAKE_INDICATORS === '1') {
  const rnd = (s) => {
    let h = 2166136261;
    for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    return ((h >>> 0) % 10000) / 10000;
  };
  const kst = () => new Date(Date.now() + 9 * 3600_000);
  const dayAgo = (n) => new Date(kst().getTime() - n * 86_400_000).toISOString().slice(0, 10);
  /** name, 공급지역, address, households, days ago announced, [주택형, 공급면적, 일반, 특별, 최고가 만원] */
  const LISTINGS = [
    ['대치 하늘숲 리버뷰', '서울', '서울특별시 강남구 대치동 316', 642, 20, [['059.9800A', 84.1, 38, 22, 198000], ['084.9700A', 113.2, 61, 30, 263000], ['114.8600A', 149.6, 12, 0, 342000]]],
    ['개포 새솔마을', '서울', '서울특별시 강남구 개포동 1220', 1210, 120, [['049.9500A', 69.8, 44, 31, 141000], ['059.9900A', 83.6, 102, 64, 172000], ['084.9800B', 112.9, 88, 40, 228000]]],
    ['역삼 센트럴포레', '서울', '서울특별시 강남구 역삼동 735', 389, 300, [['074.9200A', 99.5, 41, 18, 196000], ['084.9900A', 112.7, 55, 20, 221000]]],
    ['송파 한빛마루', '서울', '서울특별시 송파구 거여동 51', 870, 200, [['059.9700A', 82.1, 90, 70, 101000], ['084.9600A', 111.8, 120, 60, 138000]]],
    ['분당 정자 하늘채', '경기', '경기도 성남시 분당구 정자동 178', 455, 80, [['084.9500A', 113.4, 70, 33, 168000], ['101.9800A', 134.6, 22, 0, 199000]]],
    ['동탄 호수공원 리젠트', '경기', '경기도 화성시 동탄구 오산동 920', 1530, 160, [['074.9800A', 101.2, 220, 180, 66000], ['084.9900B', 113.9, 260, 150, 74000]]],
    ['평택 고덕 숲세권', '경기', '경기도 평택시 고덕동 2000', 980, 400, [['084.9800A', 112.5, 300, 160, 52000]]],
    ['대치 아카데미힐', '서울', '서울특별시 강남구 대치동 890', 230, -5, [['084.9500A', 112.8, 40, 18, 271000]]],
  ];
  const detail = LISTINGS.map(([name, area, addr, hh, ago], i) => {
    const ann = dayAgo(ago);
    const r = dayAgo(ago - 10), r2 = dayAgo(ago - 12), w = dayAgo(ago - 18);
    return {
      HOUSE_MANAGE_NO: `2026${String(900100 + i)}`, PBLANC_NO: `2026${String(900100 + i)}`, HOUSE_NM: name, HOUSE_SECD: '01', HOUSE_SECD_NM: 'APT', HOUSE_DTL_SECD: '01', HOUSE_DTL_SECD_NM: '민영',
      SUBSCRPT_AREA_CODE: area === '서울' ? '100' : '410', SUBSCRPT_AREA_CODE_NM: area, HSSPLY_ADRES: addr, TOT_SUPLY_HSHLDCO: hh, RCRIT_PBLANC_DE: ann,
      RCEPT_BGNDE: r, RCEPT_ENDDE: r2, PRZWNER_PRESNATN_DE: w, CNSTRCT_ENTRPS_NM: '예시건설(주)', MVN_PREARNGE_YM: `${Number(ann.slice(0, 4)) + 3}${ann.slice(5, 7)}`,
      SPECLT_RDN_EARTH_AT: area === '서울' && addr.includes('강남') ? 'Y' : 'N', MDAT_TRGET_AREA_SECD: area === '서울' ? 'Y' : 'N', PARCPRC_ULS_AT: addr.includes('강남') ? 'Y' : 'N', IMPRMN_BSNS_AT: i % 2 ? 'Y' : 'N', PUBLIC_HOUSE_EARTH_AT: 'N',
      PBLANC_URL: 'https://www.applyhome.co.kr',
    };
  });
  const models = LISTINGS.flatMap((l, i) => l[5].map(([ty, ar, gen, sp, top], k) => ({ HOUSE_MANAGE_NO: detail[i].HOUSE_MANAGE_NO, PBLANC_NO: detail[i].PBLANC_NO, MODEL_NO: String(k + 1).padStart(2, '0'), HOUSE_TY: ty, SUPLY_AR: String(ar), SUPLY_HSHLDCO: gen, SPSPLY_HSHLDCO: sp, LTTOT_TOP_AMOUNT: String(top) })));
  const heat = (i) => (detail[i].SUBSCRPT_AREA_CODE_NM === '서울' ? 60 : 8) * (0.3 + 1.6 * rnd(`heat${i}`));
  const cmpet = models.flatMap((m) => {
    const i = detail.findIndex((d) => d.HOUSE_MANAGE_NO === m.HOUSE_MANAGE_NO);
    const total = Math.round(m.SUPLY_HSHLDCO * heat(i) * (0.6 + 0.8 * rnd(`${m.HOUSE_MANAGE_NO}${m.MODEL_NO}`)));
    const local = Math.round(total * 0.7);
    return [
      { HOUSE_MANAGE_NO: m.HOUSE_MANAGE_NO, PBLANC_NO: m.PBLANC_NO, MODEL_NO: m.MODEL_NO, HOUSE_TY: m.HOUSE_TY, SUPLY_HSHLDCO: m.SUPLY_HSHLDCO, SUBSCRPT_RANK_CODE: 1, RESIDE_SECD: '01', RESIDE_SENM: '해당지역', REQ_CNT: String(local), CMPET_RATE: (local / m.SUPLY_HSHLDCO).toFixed(2) },
      { HOUSE_MANAGE_NO: m.HOUSE_MANAGE_NO, PBLANC_NO: m.PBLANC_NO, MODEL_NO: m.MODEL_NO, HOUSE_TY: m.HOUSE_TY, SUPLY_HSHLDCO: m.SUPLY_HSHLDCO, SUBSCRPT_RANK_CODE: 1, RESIDE_SECD: '03', RESIDE_SENM: '기타지역', REQ_CNT: String(total - local), CMPET_RATE: '' },
    ];
  });
  const scores = models.map((m) => {
    const i = detail.findIndex((d) => d.HOUSE_MANAGE_NO === m.HOUSE_MANAGE_NO);
    const lo = Math.round(Math.min(74, 30 + heat(i) / 2.5));
    return { HOUSE_MANAGE_NO: m.HOUSE_MANAGE_NO, PBLANC_NO: m.PBLANC_NO, MODEL_NO: m.MODEL_NO, HOUSE_TY: m.HOUSE_TY, RESIDE_SECD: '01', RESIDE_SENM: '해당지역', LWET_SCORE: lo, TOP_SCORE: Math.min(84, lo + 12), AVRG_SCORE: Math.min(80, lo + 5).toFixed(2) };
  });
  const cond = (url, k) => url.searchParams.get(`cond[${k}]`);
  const answer = (rows, url) => {
    const per = Number(url.searchParams.get('perPage') ?? 10), page = Number(url.searchParams.get('page') ?? 1);
    const data = rows.slice((page - 1) * per, page * per);
    return new Response(JSON.stringify({ currentCount: data.length, data, matchCount: rows.length, page, perPage: per, totalCount: rows.length }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async function applyDemoFetch(input, init) {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    let url;
    try {
      url = new URL(raw);
    } catch {
      return prevFetch(input, init);
    }
    if (url.hostname !== 'api.odcloud.kr') return prevFetch(input, init);
    const id = cond(url, 'HOUSE_MANAGE_NO::EQ');
    if (url.pathname.endsWith('/getAPTLttotPblancDetail')) {
      const since = cond(url, 'RCRIT_PBLANC_DE::GTE') ?? '';
      const area = cond(url, 'SUBSCRPT_AREA_CODE_NM::EQ');
      return answer(detail.filter((d) => d.RCRIT_PBLANC_DE >= since && (!area || d.SUBSCRPT_AREA_CODE_NM === area)), url);
    }
    if (url.pathname.endsWith('/getAPTLttotPblancMdl')) return answer(models.filter((m) => m.HOUSE_MANAGE_NO === id), url);
    if (url.pathname.endsWith('/getAPTLttotPblancCmpet')) return answer(cmpet.filter((m) => m.HOUSE_MANAGE_NO === id), url);
    if (url.pathname.endsWith('/getAptLttotPblancScore')) return answer(scores.filter((m) => m.HOUSE_MANAGE_NO === id), url);
    return new Response(JSON.stringify({ code: -1, msg: 'unknown' }), { status: 404 });
  };
}
