import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dedupeHits, hitLine, isKorean, parseKakao, parseOpenLibrary } from '../book-search';

describe('book search', () => {
  it('reads 카카오 책 검색 results', () => {
    const hits = parseKakao({
      documents: [
        { title: '현명한 투자자', authors: ['벤저민 그레이엄'], publisher: '국일증권경제연구소', datetime: '2020-05-25T00:00:00.000+09:00', isbn: '8957821839 9788957821831' },
        { title: '  ', authors: [], publisher: '', datetime: '', isbn: '' },
        { title: '돈의 심리학', authors: ['모건 하우절'], publisher: '', datetime: '', isbn: '9791191056556' },
      ],
    });
    assert.equal(hits.length, 2);
    assert.deepEqual(hits[0], { title: '현명한 투자자', authors: ['벤저민 그레이엄'], publisher: '국일증권경제연구소', year: 2020, isbn: '9788957821831', source: 'kakao' });
    assert.equal(hits[1].publisher, null);
    assert.equal(hits[1].year, null);
    assert.deepEqual(parseKakao({ errorType: 'AccessDeniedError' }), []);
  });

  it('reads Open Library results', () => {
    const [h] = parseOpenLibrary({ docs: [{ title: 'The Intelligent Investor', author_name: ['Benjamin Graham'], publisher: ['Harper & Brothers', 'HarperBusiness'], first_publish_year: 1949, isbn: ['0060555661', '9780060555665'] }] });
    assert.deepEqual(h, { title: 'The Intelligent Investor', authors: ['Benjamin Graham'], publisher: 'Harper & Brothers', year: 1949, isbn: '9780060555665', source: 'openlibrary' });
  });

  it('drops repeats of the same book', () => {
    const a = { title: '현명한 투자자', authors: ['벤저민 그레이엄'], publisher: '국일', year: 2020, isbn: '1', source: 'kakao' as const };
    assert.equal(dedupeHits([a, { ...a, year: 2016 }, { ...a, isbn: '2' }]).length, 2);
    assert.equal(dedupeHits([{ ...a, isbn: null }, { ...a, isbn: null, title: '현명한  투자자' }]).length, 1);
  });

  it('tells Korean titles apart', () => {
    assert.equal(isKorean('현명한 투자자'), true);
    assert.equal(isKorean('The Intelligent Investor'), false);
    assert.equal(hitLine({ title: 'x', authors: ['A', 'B'], publisher: null, year: 2001, isbn: null, source: 'kakao' }), 'A, B · 2001');
  });
});
