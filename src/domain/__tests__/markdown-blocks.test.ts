import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { blocksToMarkdown, markdownToBlocks, parseInline } from '../markdown-blocks';

describe('markdown <-> blocks', () => {
  it('writes the usual blocks', () => {
    const md = blocksToMarkdown([
      { type: 'heading', props: { level: 2 }, content: '매수 근거' },
      { type: 'paragraph', content: [{ type: 'text', text: '실적이 ', styles: {} }, { type: 'text', text: '좋다', styles: { bold: true } }, { type: 'text', text: ' ', styles: {} }, { type: 'link', href: 'https://x.test', content: [{ type: 'text', text: '기사', styles: {} }] }] },
      { type: 'bulletListItem', content: '하나', children: [{ type: 'bulletListItem', content: '하나의 하나' }] },
      { type: 'bulletListItem', content: '둘' },
      { type: 'numberedListItem', content: '첫째' },
      { type: 'numberedListItem', content: '둘째' },
      { type: 'checkListItem', props: { checked: true }, content: '손절가 적기' },
      { type: 'quote', content: '시장은 단기적으로 투표기' },
      { type: 'paragraph', content: '' },
      { type: 'table', content: { type: 'tableContent', rows: [{ cells: ['시나리오', '가격'] }, { cells: [[{ type: 'text', text: '좋을 때', styles: {} }], '90,000'] }] } },
      { type: 'chart', props: { kind: 'bar', data: 'a,b\n1,2' } },
    ]);
    assert.equal(
      md,
      [
        '## 매수 근거',
        '',
        '실적이 **좋다** [기사](https://x.test)',
        '',
        '- 하나',
        '  - 하나의 하나',
        '- 둘',
        '1. 첫째',
        '2. 둘째',
        '- [x] 손절가 적기',
        '',
        '> 시장은 단기적으로 투표기',
        '',
        '| 시나리오 | 가격 |',
        '| --- | --- |',
        '| 좋을 때 | 90,000 |',
        '',
        '```ppfp-block',
        '{"type":"chart","props":{"kind":"bar","data":"a,b\\n1,2"}}',
        '```',
      ].join('\n'),
    );
  });

  it('reads it back', () => {
    const blocks = markdownToBlocks('## 매수 근거\n\n실적이 **좋다** [기사](https://x.test)\n\n- 하나\n  - 하나의 하나\n- 둘\n1. 첫째\n- [ ] 손절가 적기\n\n> 인용\n\n| 시나리오 | 가격 |\n| --- | --- |\n| 좋을 때 | 90,000 |\n\n```ppfp-block\n{"type":"chart","props":{"kind":"bar"}}\n```\n\n```sql\nselect 1\n```\n\n![차트](https://x.test/a.png)');
    assert.deepEqual(
      blocks.map((b) => b.type),
      ['heading', 'paragraph', 'bulletListItem', 'bulletListItem', 'numberedListItem', 'checkListItem', 'quote', 'table', 'chart', 'codeBlock', 'image'],
    );
    assert.deepEqual(blocks[2].children, [{ type: 'bulletListItem', content: '하나의 하나' }]);
    assert.deepEqual(blocks[1].content, [
      { type: 'text', text: '실적이 ', styles: {} },
      { type: 'text', text: '좋다', styles: { bold: true } },
      { type: 'text', text: ' ', styles: {} },
      { type: 'link', href: 'https://x.test', content: [{ type: 'text', text: '기사', styles: {} }] },
    ]);
    assert.deepEqual((blocks[7].content as { rows: { cells: unknown[] }[] }).rows, [{ cells: ['시나리오', '가격'] }, { cells: ['좋을 때', '90,000'] }]);
    assert.deepEqual(blocks[9], { type: 'codeBlock', props: { language: 'sql' }, content: 'select 1' });
    assert.equal(blocks[5].props?.checked, false);
  });

  it('round-trips and keeps plain text plain', () => {
    const md = '# 제목\n\n본문 *기울임*과 `code`, 별표 \\*그대로\\*\n\n- a\n- b';
    assert.equal(blocksToMarkdown(markdownToBlocks(md)), md);
    assert.equal(parseInline('그냥 글'), '그냥 글');
    assert.equal(blocksToMarkdown([{ type: 'paragraph', content: '1*2*3 [x]' }]), '1\\*2\\*3 \\[x\\]');
    assert.equal(blocksToMarkdown(markdownToBlocks('1\\*2\\*3 \\[x\\]')), '1\\*2\\*3 \\[x\\]');
  });
});
