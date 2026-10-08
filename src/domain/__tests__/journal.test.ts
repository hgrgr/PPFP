import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILTIN_FORMATS,
  JournalInputError,
  normalizeFieldValue,
  normalizeFieldValues,
  parseChartData,
  parseFieldDefs,
  plainText,
  recommendFormats,
  safeHref,
  sanitizeContent,
  targetProgress,
} from '../journal';

describe('journal properties', () => {
  it('gives every property a unique key', () => {
    const defs = parseFieldDefs([
      { label: 'Setup', type: 'text' },
      { label: 'Setup', type: 'number' },
      { label: '확신도', type: 'rating' },
    ]);
    assert.deepEqual(
      defs.map((d) => d.key),
      ['setup', 'setup_2', 'f3'],
    );
  });

  it('rejects unnamed properties, unknown types and empty select lists', () => {
    assert.throws(() => parseFieldDefs([{ label: '', type: 'text' }]), JournalInputError);
    assert.throws(() => parseFieldDefs([{ label: 'x', type: 'formula' }]), JournalInputError);
    assert.throws(() => parseFieldDefs([{ label: 'x', type: 'select', options: [] }]), JournalInputError);
    assert.throws(() => parseFieldDefs('nope'), JournalInputError);
  });

  it('splits comma separated options and drops duplicates', () => {
    const [d] = parseFieldDefs([{ label: '셋업', type: 'select', options: '돌파, 눌림목,돌파,' }]);
    assert.deepEqual(d.options, ['돌파', '눌림목']);
  });

  it('normalizes values by type', () => {
    const price = { key: 'p', label: '가격', type: 'price' as const };
    assert.equal(normalizeFieldValue(price, '₩71,800'), '71800');
    assert.equal(normalizeFieldValue(price, ''), '');
    assert.throws(() => normalizeFieldValue(price, 'abc'), JournalInputError);
    assert.equal(normalizeFieldValue({ key: 'w', label: '비중', type: 'percent' }, '12.5%'), '12.5');
    assert.equal(normalizeFieldValue({ key: 'r', label: '별점', type: 'rating' }, '4'), '4');
    assert.throws(() => normalizeFieldValue({ key: 'r', label: '별점', type: 'rating' }, '6'), JournalInputError);
    assert.equal(normalizeFieldValue({ key: 'c', label: '체크', type: 'checkbox' }, 'on'), 'true');
    assert.equal(normalizeFieldValue({ key: 'c', label: '체크', type: 'checkbox' }, 'false'), '');
    assert.throws(() => normalizeFieldValue({ key: 'd', label: '날짜', type: 'date' }, '2026-13-40'), JournalInputError);
    assert.throws(() => normalizeFieldValue({ key: 's', label: '사유', type: 'select', options: ['a'] }, 'b'), JournalInputError);
    assert.throws(() => normalizeFieldValue({ key: 'u', label: '링크', type: 'url' }, 'javascript:alert(1)'), JournalInputError);
  });

  it('keeps the definitions next to the values', () => {
    const out = normalizeFieldValues([{ key: 'r', label: '확신도', type: 'rating' }], { r: 3 });
    assert.deepEqual(out, [{ key: 'r', label: '확신도', type: 'rating', value: '3' }]);
  });
});

describe('journal body', () => {
  it('removes unsafe links and media addresses', () => {
    const blocks = sanitizeContent([
      {
        type: 'paragraph',
        content: [
          { type: 'link', href: 'javascript:alert(1)', content: [{ type: 'text', text: 'click', styles: {} }] },
          { type: 'link', href: 'https://dart.fss.or.kr', content: [{ type: 'text', text: '공시', styles: {} }] },
        ],
      },
      { type: 'image', props: { url: 'data:image/svg+xml,<svg/>' } },
      { type: 'image', props: { url: '/api/journal/images/abc' } },
    ]) as { content?: unknown[]; props?: { url: string } }[];
    assert.deepEqual(blocks[0].content![0], { type: 'text', text: 'click', styles: {} });
    assert.equal((blocks[0].content![1] as { href: string }).href, 'https://dart.fss.or.kr');
    assert.equal(blocks[1].props!.url, '');
    assert.equal(blocks[2].props!.url, '/api/journal/images/abc');
  });

  it('turns undefined into JSON-safe values', () => {
    const [t] = sanitizeContent([{ type: 'table', content: { type: 'tableContent', columnWidths: [undefined, 120] }, props: { x: undefined } }]) as { content: { columnWidths: unknown[] }; props: object }[];
    assert.deepEqual(t.content.columnWidths, [null, 120]);
    assert.deepEqual(t.props, {});
  });

  it('rejects non-arrays and oversize bodies', () => {
    assert.throws(() => sanitizeContent({ type: 'paragraph' }), JournalInputError);
    assert.throws(() => sanitizeContent([{ type: 'paragraph', content: 'x'.repeat(1_100_000) }]), JournalInputError);
    assert.deepEqual(sanitizeContent(null), []);
  });

  it('extracts plain text from headings, nested lists and tables', () => {
    const text = plainText([
      { type: 'heading', content: [{ type: 'text', text: '매수 근거', styles: {} }] },
      { type: 'bulletListItem', content: '실적 개선', children: [{ type: 'bulletListItem', content: '영업이익 +30%' }] },
      { type: 'table', content: { type: 'tableContent', rows: [{ cells: ['시나리오', '가격'] }, { cells: [[{ type: 'text', text: '좋을 때' }], '90000'] }, { cells: ['', ''] }, { cells: ['나쁠 때', ''] }] } },
      { type: 'paragraph', content: [] },
    ]);
    assert.equal(text, '매수 근거\n실적 개선\n영업이익 +30%\n시나리오 | 가격\n좋을 때 | 90000\n나쁠 때');
  });

  it('allows only http(s), mailto and same-site links', () => {
    assert.ok(safeHref('https://a.com'));
    assert.ok(safeHref('/holdings/1'));
    assert.ok(!safeHref('//evil.com'));
    assert.ok(!safeHref('data:text/html,x'));
  });
});

describe('target price progress', () => {
  it('measures progress toward a higher target', () => {
    const p = targetProgress('120', '100', '110');
    assert.equal(p.direction, 'up');
    assert.equal(p.ratio, 0.5);
    assert.equal(p.reached, false);
    assert.ok(Math.abs(p.remaining! - 0.0909) < 1e-3);
    assert.equal(targetProgress('120', '100', '125').reached, true);
  });

  it('treats a target below the base price as a fall to wait for', () => {
    const p = targetProgress('80', '100', '78');
    assert.equal(p.direction, 'down');
    assert.equal(p.reached, true);
    assert.ok(p.ratio! > 1);
  });

  it('works without a base or current price', () => {
    assert.deepEqual(targetProgress('120', null, null), { direction: 'up', ratio: null, reached: false, remaining: null });
  });
});

describe('formats', () => {
  it('recommends a review for sales and a plan for purchases', () => {
    assert.equal(recommendFormats(['BUY', 'SELL']).order[0], 'builtin:sell');
    assert.equal(recommendFormats(['BUY']).order[0], 'builtin:buy');
    assert.equal(recommendFormats([]).order[0], 'builtin:thesis');
    assert.equal(recommendFormats([]).order.length, BUILTIN_FORMATS.length);
  });

  it('ships formats whose properties pass validation', () => {
    for (const f of BUILTIN_FORMATS) assert.deepEqual(parseFieldDefs(f.fields), f.fields);
  });
});

describe('chart block data', () => {
  it('reads comma separated series', () => {
    const d = parseChartData('분기,매출,영업이익\n1Q,120,10\n2Q,150,18%\n');
    assert.deepEqual(d.series, ['매출', '영업이익']);
    assert.deepEqual(d.rows[1], { label: '2Q', 매출: 150, 영업이익: 18 });
  });

  it('reads tab separated rows pasted from a spreadsheet', () => {
    const d = parseChartData('월\t평가액\n1월\t1,200,000\n2월\tN/A');
    assert.deepEqual(d.rows, [{ label: '1월', 평가액: 1200000 }, { label: '2월', 평가액: 0 }]);
  });

  it('needs a header and at least one row', () => {
    assert.deepEqual(parseChartData('a,b'), { series: [], rows: [] });
  });
});
