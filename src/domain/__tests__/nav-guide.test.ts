import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { cleanHidden, NAV_ITEMS, splitNav } from '../nav';
import { guideHref, guideImage, htmlImagesToMarkdown, slugger, slugify } from '../guide';

describe('menu', () => {
  it('hides only known, hideable screens, each once', () => {
    assert.deepEqual(cleanHidden(['/tax', '/tax', '/nope', '/settings', '/dashboard', '/ai']), ['/tax', '/ai']);
  });
  it('keeps menu order on both sides', () => {
    const { shown, hidden } = splitNav(['/ai', '/tax']);
    assert.deepEqual(hidden.map((i) => i.href), ['/tax', '/ai']);
    assert.equal(shown.length + hidden.length, NAV_ITEMS.length);
    assert.equal(shown[0].href, '/dashboard');
    assert.equal(shown.at(-1)!.href, '/settings');
  });
});

describe('guide', () => {
  it('makes GitHub heading ids, Korean and middle dots included', () => {
    assert.equal(slugify('순자산 · 부채'), '순자산--부채');
    assert.equal(slugify('AI 어드바이저'), 'ai-어드바이저');
    assert.equal(slugify('종목 상세 · 봉 차트'), '종목-상세--봉-차트');
    assert.equal(slugify('API 키 백업 · 복원'), 'api-키-백업--복원');
    const s = slugger();
    assert.equal(s('설정'), '설정');
    assert.equal(s('설정'), '설정-1');
  });
  it('points links and images where the app serves them', () => {
    assert.deepEqual(guideHref('#시작하기'), { href: '#시작하기', external: false });
    assert.equal(guideHref('../README.md#db-백업').href, 'https://github.com/hgrgr/PPFP/blob/main/README.md#db-백업');
    assert.equal(guideHref('deploy-cloud.md').href, 'https://github.com/hgrgr/PPFP/blob/main/docs/deploy-cloud.md');
    assert.equal(guideHref('https://example.com').external, true);
    assert.equal(guideImage('images/login.webp'), '/guide/images/login.webp');
  });

  it('turns the guide HTML images into Markdown with their width', () => {
    assert.equal(htmlImagesToMarkdown('a <img src="images/login.webp" alt="로그인 화면" width="420"> b'), 'a ![로그인 화면](images/login.webp "w=420") b');
    assert.equal(htmlImagesToMarkdown('<img alt="x">'), '<img alt="x">');
  });
});
