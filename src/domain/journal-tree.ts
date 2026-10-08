/**
 * The journal tree: asset categories → assets → trading records (journal
 * entries, and trades nobody has written about yet), and a left-to-right
 * layout for drawing it. Pure functions; the page feeds them what it read.
 */

export type NodeKind = 'root' | 'category' | 'asset' | 'journal' | 'trade' | 'more';

export interface TreeNode {
  /** Unique within the tree. */
  id: string;
  kind: NodeKind;
  label: string;
  sub?: string;
  color?: string;
  /** KRW value (categories, assets) */
  value?: number;
  /** Share of the root value */
  share?: number;
  /** The record it stands for: asset id, journal id, transaction id, category key. */
  ref?: string;
  /** Badge, e.g. number of journals */
  badge?: string;
  children?: TreeNode[];
}

export interface TreeInput {
  rootLabel: string;
  categories: { key: string; label: string; color: string }[];
  assets: { id: string; name: string; symbol: string | null; value: number; categories: string[] }[];
  journals: { id: string; assetId: string; title: string; date: string; status: 'OPEN' | 'CLOSED'; txnIds: string[] }[];
  trades: { id: string; assetId: string; type: string; date: string; label: string }[];
  /** Records shown under one asset before folding the rest into a "외 n건" node. */
  maxPerAsset?: number;
}

export const UNCATEGORIZED = '__none__';

export function buildJournalTree(input: TreeInput): TreeNode {
  const max = input.maxPerAsset ?? 10;
  const total = input.assets.reduce((a, b) => a + Math.max(0, b.value), 0);
  const share = (v: number) => (total > 0 ? Math.max(0, v) / total : 0);
  const journalsOf = new Map<string, TreeInput['journals']>();
  for (const j of input.journals) journalsOf.set(j.assetId, [...(journalsOf.get(j.assetId) ?? []), j]);
  const written = new Set(input.journals.flatMap((j) => j.txnIds));
  const tradesOf = new Map<string, TreeInput['trades']>();
  for (const t of input.trades) if (!written.has(t.id)) tradesOf.set(t.assetId, [...(tradesOf.get(t.assetId) ?? []), t]);

  const assetNode = (a: TreeInput['assets'][number], cat: string): TreeNode => {
    const js = [...(journalsOf.get(a.id) ?? [])].sort((x, y) => y.date.localeCompare(x.date));
    const ts = [...(tradesOf.get(a.id) ?? [])].sort((x, y) => y.date.localeCompare(x.date));
    const records: TreeNode[] = [
      ...js.map((j) => ({
        id: `${cat}/${a.id}/j/${j.id}`,
        kind: 'journal' as const,
        label: j.title,
        sub: `${j.date}${j.txnIds.length ? ` · 거래 ${j.txnIds.length}건` : ''}${j.status === 'CLOSED' ? ' · 종료' : ''}`,
        ref: j.id,
      })),
      ...ts.map((t) => ({ id: `${cat}/${a.id}/t/${t.id}`, kind: 'trade' as const, label: t.label, sub: `${t.date} · 일지 없음`, ref: t.id })),
    ];
    const shown = records.length > max ? records.slice(0, max - 1) : records;
    if (shown.length < records.length) {
      shown.push({ id: `${cat}/${a.id}/more`, kind: 'more', label: `외 ${records.length - shown.length}건`, ref: a.id });
    }
    return {
      id: `${cat}/${a.id}`,
      kind: 'asset',
      label: a.name,
      sub: a.symbol ?? undefined,
      value: a.value,
      share: share(a.value),
      ref: a.id,
      badge: js.length ? `일지 ${js.length}` : undefined,
      children: shown,
    };
  };

  const known = new Set(input.categories.map((c) => c.key));
  const assets = input.assets.map((a) => ({ ...a, categories: [...new Set(a.categories.filter((k) => known.has(k)))] }));
  const cats = [...input.categories, { key: UNCATEGORIZED, label: '미분류', color: 'var(--series-other)' }];
  const children: TreeNode[] = [];
  for (const c of cats) {
    const members = assets.filter((a) => (c.key === UNCATEGORIZED ? !a.categories.length : a.categories.includes(c.key)));
    if (!members.length) continue;
    // An asset in several categories counts its value evenly in each
    const valueIn = (a: TreeInput['assets'][number]) => (a.categories.length > 1 ? a.value / a.categories.length : a.value);
    const value = members.reduce((s, a) => s + valueIn(a), 0);
    children.push({
      id: c.key,
      kind: 'category',
      label: c.label,
      color: c.color,
      value,
      share: share(value),
      ref: c.key,
      badge: `${members.length}종목`,
      children: members
        .sort((x, y) => y.value - x.value || x.name.localeCompare(y.name))
        .map((a) => ({ ...assetNode(a, c.key), value: valueIn(a), share: share(valueIn(a)), sub: [a.symbol, a.categories.length > 1 ? `${a.categories.length}곳에 나눠 셈` : ''].filter(Boolean).join(' · ') || undefined })),
    });
  }
  return { id: 'root', kind: 'root', label: input.rootLabel, value: total, share: total > 0 ? 1 : 0, children };
}

// ── layout ──────────────────────────────────────────

export interface PlacedNode {
  node: TreeNode;
  depth: number;
  x: number;
  y: number;
  /** Has children that are hidden */
  folded: boolean;
}

export interface TreeLayout {
  nodes: PlacedNode[];
  links: { from: PlacedNode; to: PlacedNode }[];
  width: number;
  height: number;
}

/**
 * Left-to-right tidy layout: every visible leaf gets its own row, a parent sits
 * level with the middle of its children. Nodes in `collapsed` hide their children.
 */
export function layoutTree(root: TreeNode, collapsed: ReadonlySet<string>, opts: { colWidths: number[]; rowHeight: number; pad?: number }): TreeLayout {
  const pad = opts.pad ?? 12;
  const xOf = (depth: number) => pad + opts.colWidths.slice(0, depth).reduce((a, b) => a + b, 0);
  const nodes: PlacedNode[] = [];
  const links: TreeLayout['links'] = [];
  let row = 0;
  const place = (n: TreeNode, depth: number): PlacedNode => {
    const kids = n.children ?? [];
    const open = kids.length > 0 && !collapsed.has(n.id);
    let y: number;
    const placedKids: PlacedNode[] = [];
    if (open) {
      for (const k of kids) placedKids.push(place(k, depth + 1));
      y = (placedKids[0].y + placedKids[placedKids.length - 1].y) / 2;
    } else {
      y = pad + row * opts.rowHeight + opts.rowHeight / 2;
      row++;
    }
    const p: PlacedNode = { node: n, depth, x: xOf(depth), y, folded: kids.length > 0 && !open };
    nodes.push(p);
    for (const k of placedKids) links.push({ from: p, to: k });
    return p;
  };
  place(root, 0);
  const maxDepth = Math.max(...nodes.map((n) => n.depth));
  return { nodes, links, width: xOf(maxDepth + 1) + pad, height: pad * 2 + row * opts.rowHeight };
}
