/**
 * Fake book search for documentation screenshots (loaded by fake-market.cjs): answers
 * 카카오 책 검색 (dapi.kakao.com/v3/search/book) and Open Library (search.json) from a small
 * catalog of well-known investing books, matched on title or author.
 */
'use strict';

const CATALOG = [
  ['현명한 투자자', ['벤저민 그레이엄'], '국일증권경제연구소', 2020],
  ['현명한 투자자 2', ['벤저민 그레이엄', '제이슨 츠바이크'], '국일증권경제연구소', 2021],
  ['돈의 심리학', ['모건 하우절'], '인플루엔셜', 2021],
  ['전설로 떠나는 월가의 영웅', ['피터 린치', '존 로스차일드'], '국일증권경제연구소', 2017],
  ['위대한 기업에 투자하라', ['필립 피셔'], '굿모닝북스', 2005],
  ['원칙', ['레이 달리오'], '한빛비즈', 2018],
  ['투자에 대한 생각', ['하워드 막스'], '비즈니스맵', 2012],
  ['모든 주식을 소유하라', ['존 보글'], '비즈니스맵', 2019],
  ['안전마진', ['세스 클라먼'], '부크온', 2017],
];
const EN = [
  ['The Intelligent Investor', ['Benjamin Graham'], 'Harper & Brothers', 1949],
  ['One Up On Wall Street', ['Peter Lynch'], 'Simon & Schuster', 1989],
  ['The Psychology of Money', ['Morgan Housel'], 'Harriman House', 2020],
];

const norm = (s) => s.replace(/\s+/g, '').toLowerCase();
const match = (list, q) => {
  const words = q.split(/\s+/).filter(Boolean).map(norm);
  return list.filter(([title, authors]) => words.every((w) => norm(title).includes(w) || authors.some((a) => norm(a).includes(w))));
};

function kakao(url) {
  const q = url.searchParams.get('query') ?? '';
  const documents = match(CATALOG, q).map(([title, authors, publisher, year]) => ({ title, authors, publisher, datetime: `${year}-01-01T00:00:00.000+09:00`, isbn: '', translators: [], contents: '', thumbnail: '' }));
  return { meta: { total_count: documents.length, pageable_count: documents.length, is_end: true }, documents };
}

function openLibrary(url) {
  const q = url.searchParams.get('q') ?? '';
  const docs = match(EN, q).map(([title, author_name, publisher, first_publish_year]) => ({ title, author_name, publisher: [publisher], first_publish_year }));
  return { numFound: docs.length, docs };
}

const prevFetch = globalThis.fetch;
globalThis.fetch = async function booksDemoFetch(input, init) {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return prevFetch(input, init);
  }
  const body = url.hostname === 'dapi.kakao.com' && url.pathname === '/v3/search/book' ? kakao(url) : url.hostname === 'openlibrary.org' && url.pathname === '/search.json' ? openLibrary(url) : null;
  if (!body) return prevFetch(input, init);
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } });
};
