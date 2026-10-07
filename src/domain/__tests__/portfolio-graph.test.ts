import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { D } from '../decimal';
import {
  buildForest,
  checkEdge,
  effectiveWeights,
  normalizeEdges,
  rollup,
  topoOrder,
} from '../portfolio-graph';

// root ─┬─ retire ─┬─ pension
//       │          └─ growth (60%)
//       ├─ living ─┬─ emergency
//       │          └─ growth (40%)
//       └─ house
const edges = normalizeEdges([
  { parentId: 'root', childId: 'retire', allocation: 1 },
  { parentId: 'root', childId: 'living', allocation: 1 },
  { parentId: 'root', childId: 'house', allocation: 1 },
  { parentId: 'retire', childId: 'pension', allocation: 1 },
  { parentId: 'retire', childId: 'growth', allocation: '0.6' },
  { parentId: 'living', childId: 'emergency', allocation: 1 },
  { parentId: 'living', childId: 'growth', allocation: '0.4' },
]);

describe('checkEdge', () => {
  it('rejects self links', () => {
    const r = checkEdge(edges, { parentId: 'a', childId: 'a', allocation: 1 });
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.reason, 'SELF');
  });

  it('rejects cycles at any depth', () => {
    const r = checkEdge(edges, { parentId: 'growth', childId: 'root', allocation: 1 });
    assert.equal(!r.ok && r.reason, 'CYCLE');
    const r2 = checkEdge(edges, { parentId: 'pension', childId: 'retire', allocation: '0.5' });
    assert.equal(!r2.ok && r2.reason, 'CYCLE');
  });

  it('rejects allocation over 100% across parents', () => {
    const r = checkEdge(edges, { parentId: 'house', childId: 'growth', allocation: '0.01' });
    assert.equal(!r.ok && r.reason, 'OVER_ALLOCATED');
  });

  it('allows updating an existing edge within the limit', () => {
    assert.equal(checkEdge(edges, { parentId: 'retire', childId: 'growth', allocation: '0.6' }, { allowUpdate: true }).ok, true);
    const over = checkEdge(edges, { parentId: 'retire', childId: 'growth', allocation: '0.7' }, { allowUpdate: true });
    assert.equal(!over.ok && over.reason, 'OVER_ALLOCATED');
  });

  it('rejects duplicates and invalid ratios', () => {
    assert.equal((checkEdge(edges, { parentId: 'root', childId: 'house', allocation: 1 }) as { reason: string }).reason, 'DUPLICATE');
    assert.equal((checkEdge(edges, { parentId: 'house', childId: 'x', allocation: 0 }) as { reason: string }).reason, 'INVALID_ALLOCATION');
    assert.equal((checkEdge(edges, { parentId: 'house', childId: 'x', allocation: '1.01' }) as { reason: string }).reason, 'INVALID_ALLOCATION');
  });

  it('accepts a new valid link (diamond shapes are fine)', () => {
    assert.equal(checkEdge(edges, { parentId: 'house', childId: 'pension2', allocation: '0.5' }).ok, true);
  });
});

describe('effectiveWeights / rollup', () => {
  it('sums allocations over all paths', () => {
    const w = effectiveWeights(edges, 'root');
    assert.equal(w.get('growth')!.toString(), '1');
    assert.equal(w.get('pension')!.toString(), '1');
    const r = effectiveWeights(edges, 'retire');
    assert.equal(r.get('growth')!.toString(), '0.6');
    assert.equal(r.has('emergency'), false);
  });

  it('rolls up direct values without double counting', () => {
    const direct = new Map([
      ['pension', D(100)],
      ['growth', D(200)],
      ['emergency', D(50)],
      ['house', D(500)],
      ['retire', D(10)], // retire also holds some cash directly
    ]);
    assert.equal(rollup(edges, 'retire', direct).toString(), '230'); // 10 + 100 + 0.6*200
    assert.equal(rollup(edges, 'living', direct).toString(), '130'); // 50 + 0.4*200
    assert.equal(rollup(edges, 'root', direct).toString(), '860'); // everything once
  });

  it('handles deep chains', () => {
    const chain = normalizeEdges(
      Array.from({ length: 50 }, (_, i) => ({ parentId: `n${i}`, childId: `n${i + 1}`, allocation: '0.5' })),
    );
    const w = effectiveWeights(chain, 'n0');
    assert.equal(w.get('n3')!.toString(), '0.125');
    assert.equal(rollup(chain, 'n48', new Map([['n50', D(8)]])).toString(), '2');
  });
});

describe('topoOrder / buildForest', () => {
  it('orders parents before children', () => {
    const ids = ['growth', 'root', 'retire', 'living', 'pension', 'emergency', 'house'];
    const order = topoOrder(ids, edges);
    assert.ok(order.indexOf('root') < order.indexOf('retire'));
    assert.ok(order.indexOf('retire') < order.indexOf('growth'));
    assert.ok(order.indexOf('living') < order.indexOf('growth'));
  });

  it('throws on a cycle', () => {
    const bad = normalizeEdges([
      { parentId: 'a', childId: 'b', allocation: 1 },
      { parentId: 'b', childId: 'a', allocation: 1 },
    ]);
    assert.throws(() => topoOrder(['a', 'b'], bad));
  });

  it('shows shared children under every parent', () => {
    const forest = buildForest(['root', 'retire', 'living', 'house', 'pension', 'growth', 'emergency', 'solo'], edges);
    assert.deepEqual(forest.map((n) => n.id), ['root', 'solo']);
    const retire = forest[0].children.find((c) => c.id === 'retire')!;
    const living = forest[0].children.find((c) => c.id === 'living')!;
    assert.equal(retire.children.find((c) => c.id === 'growth')!.allocation.toString(), '0.6');
    assert.equal(living.children.find((c) => c.id === 'growth')!.allocation.toString(), '0.4');
  });
});
