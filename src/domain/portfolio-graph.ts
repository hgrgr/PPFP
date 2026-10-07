/**
 * Portfolio hierarchy as a directed acyclic graph.
 *
 * A portfolio can contain holdings and child portfolios. A child may sit
 * under several parents, each edge carrying the share of the child that is
 * counted in that parent (allocation, 0 < a <= 1). A child's allocations
 * across all its parents must not exceed 1, otherwise its value would be
 * double counted.
 */
import { Dec, type DecInput } from './decimal';

export interface Edge {
  parentId: string;
  childId: string;
  allocation: Dec;
}

export type EdgeInput = { parentId: string; childId: string; allocation: DecInput };

export type EdgeCheck =
  | { ok: true }
  | { ok: false; reason: 'SELF' | 'CYCLE' | 'DUPLICATE' | 'INVALID_ALLOCATION' | 'OVER_ALLOCATED'; message: string };

export function normalizeEdges(edges: EdgeInput[]): Edge[] {
  return edges.map((e) => ({ parentId: e.parentId, childId: e.childId, allocation: Dec.of(e.allocation) }));
}

function childrenMap(edges: Edge[]): Map<string, Edge[]> {
  const m = new Map<string, Edge[]>();
  for (const e of edges) {
    const list = m.get(e.parentId) ?? [];
    list.push(e);
    m.set(e.parentId, list);
  }
  return m;
}

function parentsMap(edges: Edge[]): Map<string, Edge[]> {
  const m = new Map<string, Edge[]>();
  for (const e of edges) {
    const list = m.get(e.childId) ?? [];
    list.push(e);
    m.set(e.childId, list);
  }
  return m;
}

/** All nodes reachable downward from `id` (excluding `id`). */
export function descendants(edges: Edge[], id: string): Set<string> {
  const kids = childrenMap(edges);
  const seen = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const e of kids.get(cur) ?? []) {
      if (!seen.has(e.childId)) {
        seen.add(e.childId);
        stack.push(e.childId);
      }
    }
  }
  return seen;
}

/** All nodes reachable upward from `id` (excluding `id`). */
export function ancestors(edges: Edge[], id: string): Set<string> {
  const pars = parentsMap(edges);
  const seen = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const e of pars.get(cur) ?? []) {
      if (!seen.has(e.parentId)) {
        seen.add(e.parentId);
        stack.push(e.parentId);
      }
    }
  }
  return seen;
}

/** Sum of allocations a child already has, optionally ignoring one parent edge. */
export function allocatedShare(edges: Edge[], childId: string, ignoreParentId?: string): Dec {
  return Dec.sum(
    edges.filter((e) => e.childId === childId && e.parentId !== ignoreParentId).map((e) => e.allocation),
  );
}

/**
 * Validate adding (or updating) the edge parent -> child.
 * If an edge between the same pair already exists, `allowUpdate` treats the
 * call as an update of its allocation instead of a duplicate.
 */
export function checkEdge(
  edges: Edge[],
  candidate: EdgeInput,
  opts: { allowUpdate?: boolean } = {},
): EdgeCheck {
  const { parentId, childId } = candidate;
  const allocation = Dec.of(candidate.allocation);
  if (parentId === childId) {
    return { ok: false, reason: 'SELF', message: '포트폴리오를 자기 자신의 하위로 넣을 수 없습니다.' };
  }
  if (!allocation.isPos() || allocation.gt(1)) {
    return { ok: false, reason: 'INVALID_ALLOCATION', message: '할당 비율은 0% 초과 100% 이하여야 합니다.' };
  }
  const existing = edges.find((e) => e.parentId === parentId && e.childId === childId);
  if (existing && !opts.allowUpdate) {
    return { ok: false, reason: 'DUPLICATE', message: '이미 연결된 하위 포트폴리오입니다.' };
  }
  if (!existing && (childId === parentId || descendants(edges, childId).has(parentId))) {
    return {
      ok: false,
      reason: 'CYCLE',
      message: '순환 구조가 됩니다. 상위 포트폴리오가 이미 이 포트폴리오의 하위에 있습니다.',
    };
  }
  const others = allocatedShare(edges, childId, parentId);
  if (others.add(allocation).gt(1)) {
    const left = Dec.ONE.sub(others);
    return {
      ok: false,
      reason: 'OVER_ALLOCATED',
      message: `할당 합계가 100%를 넘습니다. 남은 할당 가능 비율은 ${left.mul(100).toFixed(2)}% 입니다.`,
    };
  }
  return { ok: true };
}

/**
 * Effective weight of every node seen from `rootId`: the sum, over all paths
 * from the root to that node, of the product of allocations along the path.
 * The root itself has weight 1.
 */
export function effectiveWeights(edges: Edge[], rootId: string): Map<string, Dec> {
  const reachable = descendants(edges, rootId);
  reachable.add(rootId);
  const sub = edges.filter((e) => reachable.has(e.parentId) && reachable.has(e.childId));
  const order = topoOrder([...reachable], sub); // parents before children
  const kids = childrenMap(sub);
  const weights = new Map<string, Dec>([[rootId, Dec.ONE]]);
  for (const id of order) {
    const w = weights.get(id);
    if (!w) continue;
    for (const e of kids.get(id) ?? []) {
      weights.set(e.childId, (weights.get(e.childId) ?? Dec.ZERO).add(w.mul(e.allocation)));
    }
  }
  return weights;
}

/** Kahn's algorithm. Returns parents before children; throws on a cycle. */
export function topoOrder(nodes: string[], edges: Edge[]): string[] {
  const indeg = new Map<string, number>(nodes.map((n) => [n, 0]));
  for (const e of edges) indeg.set(e.childId, (indeg.get(e.childId) ?? 0) + 1);
  const kids = childrenMap(edges);
  const queue = [...indeg.entries()].filter(([, d]) => d === 0).map(([n]) => n).sort();
  const out: string[] = [];
  while (queue.length) {
    const n = queue.shift()!;
    out.push(n);
    for (const e of kids.get(n) ?? []) {
      const d = (indeg.get(e.childId) ?? 0) - 1;
      indeg.set(e.childId, d);
      if (d === 0) queue.push(e.childId);
    }
  }
  if (out.length !== indeg.size) throw new Error('Portfolio graph contains a cycle');
  return out;
}

/**
 * Value of `rootId` including everything under it.
 * `direct` maps a portfolio id to the value of what it holds directly
 * (holdings + cash), in one common currency.
 */
export function rollup(edges: Edge[], rootId: string, direct: Map<string, Dec>): Dec {
  let total = Dec.ZERO;
  for (const [id, w] of effectiveWeights(edges, rootId)) {
    total = total.add(w.mul(direct.get(id) ?? Dec.ZERO));
  }
  return total;
}

export interface TreeNode {
  id: string;
  allocation: Dec; // share of this node under its displayed parent (1 for roots)
  depth: number;
  children: TreeNode[];
}

/**
 * Build a display forest. A node with several parents appears under each of
 * them; roots are nodes with no parent. Depth is capped to guard against
 * pathological data.
 */
export function buildForest(ids: string[], edges: Edge[], maxDepth = 64): TreeNode[] {
  const kids = childrenMap(edges);
  const hasParent = new Set(edges.map((e) => e.childId));
  const make = (id: string, allocation: Dec, depth: number): TreeNode => ({
    id,
    allocation,
    depth,
    children:
      depth >= maxDepth
        ? []
        : (kids.get(id) ?? []).map((e) => make(e.childId, e.allocation, depth + 1)),
  });
  return ids.filter((id) => !hasParent.has(id)).map((id) => make(id, Dec.ONE, 0));
}
