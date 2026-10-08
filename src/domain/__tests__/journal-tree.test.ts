import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildJournalTree, layoutTree, UNCATEGORIZED, type TreeInput } from '../journal-tree';

const input: TreeInput = {
  rootLabel: '순자산',
  categories: [
    { key: 'g', label: '성장 상승', color: '#1' },
    { key: 'd', label: '물가 하락', color: '#2' },
  ],
  assets: [
    { id: 'aapl', name: '애플', symbol: 'AAPL', value: 600, categories: ['g', 'd'] },
    { id: 'tlt', name: '미국 장기채', symbol: 'TLT', value: 300, categories: ['d'] },
    { id: 'btc', name: '비트코인', symbol: 'KRW-BTC', value: 100, categories: ['other-group-trait'] },
  ],
  journals: [
    { id: 'j1', assetId: 'aapl', title: '애플 매수 계획', date: '2026-06-11', status: 'OPEN', txnIds: ['t1'] },
    { id: 'j2', assetId: 'aapl', title: '애플 점검', date: '2026-08-01', status: 'CLOSED', txnIds: [] },
  ],
  trades: [
    { id: 't1', assetId: 'aapl', type: 'BUY', date: '2026-06-11', label: '매수 10주' },
    { id: 't2', assetId: 'aapl', type: 'BUY', date: '2026-07-01', label: '매수 5주' },
    ...Array.from({ length: 12 }, (_, i) => ({ id: `b${i}`, assetId: 'btc', type: 'BUY', date: `2026-01-${String(i + 10)}`, label: '매수' })),
  ],
  maxPerAsset: 5,
};

describe('journal tree', () => {
  const tree = buildJournalTree(input);

  it('groups assets under their categories, unknown ones under 미분류', () => {
    assert.deepEqual(
      tree.children!.map((c) => [c.label, c.children!.map((a) => a.ref)]),
      [
        ['성장 상승', ['aapl']],
        ['물가 하락', ['aapl', 'tlt']],
        ['미분류', ['btc']],
      ],
    );
    assert.equal(tree.children![2].id, UNCATEGORIZED);
  });

  it('splits an asset in two categories evenly between them', () => {
    assert.equal(tree.children![0].value, 300);
    assert.equal(tree.children![1].value, 600);
    assert.equal(tree.value, 1000);
    assert.equal(tree.children![1].share, 0.6);
  });

  it('lists journals first, then trades without a journal', () => {
    const aapl = tree.children![0].children![0];
    assert.deepEqual(
      aapl.children!.map((n) => [n.kind, n.ref]),
      [
        ['journal', 'j2'],
        ['journal', 'j1'],
        ['trade', 't2'],
      ],
    );
    assert.equal(aapl.badge, '일지 2');
  });

  it('folds records past the limit into one node', () => {
    const btc = tree.children![2].children![0];
    assert.equal(btc.children!.length, 5);
    assert.equal(btc.children![4].kind, 'more');
    assert.equal(btc.children![4].label, '외 8건');
  });

  it('lays leaves out one per row with parents centred on their children', () => {
    const layout = layoutTree(tree, new Set([UNCATEGORIZED, 'd']), { colWidths: [100, 100, 100], rowHeight: 10, pad: 0 });
    const at = (id: string) => layout.nodes.find((n) => n.node.id === id)!;
    // visible leaves: 3 records of aapl under g, folded 'd', folded 미분류 → 5 rows
    assert.equal(layout.height, 50);
    assert.equal(at('g/aapl').y, 15);
    assert.equal(at('g').y, 15);
    assert.equal(at('d').folded, true);
    assert.equal(at('root').x, 0);
    assert.equal(at('g/aapl').x, 200);
    assert.equal(layout.links.length, 3 + 1 + 3);
  });
});
