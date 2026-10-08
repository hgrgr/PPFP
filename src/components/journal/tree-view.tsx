'use client';

import { useEffect, useMemo, useState } from 'react';
import { layoutTree, UNCATEGORIZED, type PlacedNode, type TreeNode } from '@/domain/journal-tree';
import { krwShort, pct } from '@/lib/format';
import { RelatedLoader } from '@/components/knowledge/links';
import { JournalDrawer } from './dashboard-panel';

const COLS = [120, 210, 240, 280];
const ROW = 44;
const BOX: Record<TreeNode['kind'], number> = { root: 92, category: 176, asset: 206, journal: 252, trade: 252, more: 252 };

/** Rough rendered width of a label at 13px: Hangul is about twice as wide as Latin. */
function fit(text: string, px: number): string {
  let w = 0;
  for (let i = 0; i < text.length; i++) {
    w += /[ㄱ-힝]/.test(text[i]) ? 13 : 7.4;
    if (w > px) return text.slice(0, Math.max(1, i - 1)) + '…';
  }
  return text;
}

const KIND_LABEL: Record<TreeNode['kind'], string> = { root: '전체', category: '분류', asset: '종목', journal: '매매일지', trade: '거래', more: '더 보기' };

const icon = { journal: 'M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 16h5', trade: 'M4 17l5-5 4 4 7-8M20 8v5M20 8h-5' };

function walk(n: TreeNode, f: (n: TreeNode) => void) {
  f(n);
  n.children?.forEach((c) => walk(c, f));
}

/** Assets without journals start folded, so the tree opens on what has been written. */
function defaultCollapsed(root: TreeNode): Set<string> {
  const s = new Set<string>();
  walk(root, (n) => {
    if (n.kind === 'asset' && !n.badge) s.add(n.id);
  });
  return s;
}

/**
 * The journal tree drawn left to right: 순자산 → categories → assets → journals and trades.
 * Click a node to see it on the right; a journal opens in the side window. The circle on a
 * node folds or unfolds it.
 */
export function JournalTreeView({ tree, traitGrouping = false }: { tree: TreeNode; traitGrouping?: boolean }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => defaultCollapsed(tree));
  const [selected, setSelected] = useState<TreeNode | null>(null);
  const [openJournal, setOpenJournal] = useState<string | null>(null);
  const layout = useMemo(() => layoutTree(tree, collapsed, { colWidths: COLS, rowHeight: ROW, pad: 16 }), [tree, collapsed]);

  const toggle = (id: string) =>
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const pick = (n: TreeNode) => {
    if (n.kind === 'journal') {
      setSelected(null);
      setOpenJournal(n.ref!);
    } else {
      setOpenJournal(null);
      setSelected(n);
    }
  };
  const setLevel = (level: 'all' | 'journals' | 'assets') => {
    const s = new Set<string>();
    if (level === 'journals') return setCollapsed(defaultCollapsed(tree));
    if (level === 'assets') walk(tree, (n) => n.kind === 'asset' && n.children?.length && s.add(n.id));
    setCollapsed(s);
  };

  useEffect(() => {
    if (!selected) return;
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setSelected(null);
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [selected]);

  if (!tree.children?.length) return <p className="empty">보유 종목이나 매매일지가 아직 없습니다.</p>;

  const width = Math.max(layout.width, 760);
  return (
    <div className="tree-wrap">
      <div className="stack" style={{ gap: 8, minWidth: 0 }}>
        <div className="inline" style={{ gap: 6 }}>
          <button type="button" className="btn small" onClick={() => setLevel('assets')}>종목까지</button>
          <button type="button" className="btn small" onClick={() => setLevel('journals')}>일지 있는 종목 펼치기</button>
          <button type="button" className="btn small" onClick={() => setLevel('all')}>모두 펼치기</button>
          <span className="sub">원을 누르면 접고 펼칩니다 · 노드를 누르면 옆에 내용이 열립니다</span>
        </div>
        <div className="tree-scroll">
          <svg width={width} height={layout.height} role="tree" aria-label="매매일지 트리" className="tree-svg">
            {layout.links.map(({ from, to }) => {
              const x1 = from.x + BOX[from.node.kind];
              const x2 = to.x;
              const mx = (x1 + x2) / 2;
              return <path key={to.node.id} d={`M${x1},${from.y} C${mx},${from.y} ${mx},${to.y} ${x2},${to.y}`} className="tree-link" />;
            })}
            {layout.nodes.map((p) => (
              <Node key={p.node.id} p={p} selected={selected?.id === p.node.id} onPick={pick} onToggle={toggle} />
            ))}
          </svg>
        </div>
      </div>
      {selected && (
        <div className="drawer tree-detail" role="dialog" aria-modal="false" aria-label={`${selected.label} 내용`}>
          <div className="drawer-head">
            <span className="sub">{KIND_LABEL[selected.kind]}</span>
            <button type="button" className="btn small" onClick={() => setSelected(null)} aria-label="닫기">✕</button>
          </div>
          <div className="drawer-body">
            <Detail
              node={selected}
              traitGrouping={traitGrouping}
              onOpen={(id) => {
                setSelected(null);
                setOpenJournal(id);
              }}
            />
          </div>
        </div>
      )}
      {openJournal && <JournalDrawer id={openJournal} onClose={() => setOpenJournal(null)} />}
    </div>
  );
}

function Node({ p, selected, onPick, onToggle }: { p: PlacedNode; selected: boolean; onPick: (n: TreeNode) => void; onToggle: (id: string) => void }) {
  const n = p.node;
  const w = BOX[n.kind];
  const h = n.kind === 'root' || n.kind === 'category' || n.kind === 'asset' ? 34 : 30;
  const y = p.y - h / 2;
  const hasKids = !!n.children?.length;
  const record = n.kind === 'journal' || n.kind === 'trade' || n.kind === 'more';
  const right = n.kind === 'root' ? '' : n.kind === 'category' ? pct(n.share ?? 0, 0, false) : n.kind === 'asset' ? (n.value ? krwShort(n.value) : '관심') : '';
  const labelRoom = w - 20 - (record && n.kind !== 'more' ? 18 : 0) - (right ? right.length * 7.4 + 8 : 0) - (n.badge && n.kind === 'asset' ? 44 : 0);
  return (
    <g
      className={`tree-node k-${n.kind}${selected ? ' sel' : ''}`}
      role="treeitem"
      aria-selected={selected}
      aria-expanded={hasKids ? !p.folded : undefined}
      aria-label={`${n.label}${n.sub ? `, ${n.sub}` : ''}`}
      tabIndex={0}
      onClick={() => onPick(n)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onPick(n);
        if (e.key === ' ' && hasKids) {
          e.preventDefault();
          onToggle(n.id);
        }
      }}
    >
      <title>{[n.label, n.sub].filter(Boolean).join(' · ')}</title>
      <rect x={p.x} y={y} width={w} height={h} rx={n.kind === 'root' ? 10 : record ? 15 : 8} className="box" />
      {n.color && n.kind === 'category' && <rect x={p.x} y={y} width={5} height={h} rx={2} fill={n.color} />}
      {(n.kind === 'journal' || n.kind === 'trade') && (
        <path d={icon[n.kind]} transform={`translate(${p.x + 9},${p.y - 7}) scale(0.58)`} className="ico" />
      )}
      <text x={p.x + (n.kind === 'category' ? 14 : record && n.kind !== 'more' ? 26 : 10)} y={p.y + 4.5} className="lbl">
        {fit(n.label, labelRoom)}
      </text>
      {n.badge && n.kind === 'asset' && (
        <text x={p.x + w - 10 - (right ? right.length * 7.4 + 8 : 0)} y={p.y + 4} className="badge-t" textAnchor="end">
          {n.badge}
        </text>
      )}
      {right && (
        <text x={p.x + w - 10} y={p.y + 4.5} className="val" textAnchor="end">
          {right}
        </text>
      )}
      {hasKids && (
        <g
          className="tgl"
          onClick={(e) => {
            e.stopPropagation();
            onToggle(n.id);
          }}
        >
          <circle cx={p.x + w + 9} cy={p.y} r={7} />
          <path d={p.folded ? `M${p.x + w + 5.5},${p.y}h7M${p.x + w + 9},${p.y - 3.5}v7` : `M${p.x + w + 5.5},${p.y}h7`} />
        </g>
      )}
    </g>
  );
}

function Detail({ node: n, onOpen, traitGrouping }: { node: TreeNode; onOpen: (id: string) => void; traitGrouping: boolean }) {
  const kids = n.children ?? [];
  if (n.kind === 'root' || n.kind === 'category') {
    return (
      <div className="stack" style={{ gap: 10 }}>
        <div className="stack" style={{ gap: 2 }}>
          <span className="sub">{n.kind === 'root' ? '전체' : '분류'}</span>
          <h2 className="inline" style={{ gap: 8 }}>
            {n.color && <span className="dot" style={{ background: n.color }} />}
            {n.label}
          </h2>
        </div>
        <dl className="props compact">
          <dt>평가액</dt>
          <dd className="money strong">{krwShort(n.value ?? 0)}</dd>
          <dt>비중</dt>
          <dd>{pct(n.share ?? 0, 1, false)}</dd>
          <dt>{n.kind === 'root' ? '분류' : '종목'}</dt>
          <dd>{kids.length}개</dd>
        </dl>
        <ul className="detail-list">
          {kids.map((k) => (
            <li key={k.id}>
              <span className="inline" style={{ gap: 6, flexWrap: 'nowrap', minWidth: 0 }}>
                {k.color && <span className="dot" style={{ background: k.color }} />}
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{k.label}</span>
                {k.badge && n.kind === 'category' && <span className="badge">{k.badge}</span>}
              </span>
              <span className="sub">{k.value ? `${krwShort(k.value)} · ${pct(k.share ?? 0, 1, false)}` : '보유 안 함'}</span>
            </li>
          ))}
        </ul>
        {n.kind === 'category' && <a className="sub" href="/traits">성질별 목표 비중 보기 ›</a>}
        {n.kind === 'category' && traitGrouping && n.ref !== UNCATEGORIZED && (
          <div className="stack" style={{ gap: 6 }}>
            <span className="sub strong">이 성질과 이어진 투자 거장 · 책 · 메모</span>
            <RelatedLoader target={{ type: 'trait', id: n.ref! }} order={['sage', 'book', 'note', 'topic']} empty="아직 없습니다. 투자 노트에서 키워드나 거장에 이 성질을 연결하세요." />
          </div>
        )}
      </div>
    );
  }
  if (n.kind === 'asset') {
    return (
      <div className="stack" style={{ gap: 10 }}>
        <div className="stack" style={{ gap: 2 }}>
          <span className="sub">종목 {n.sub ? `· ${n.sub}` : ''}</span>
          <h2>{n.label}</h2>
        </div>
        <dl className="props compact">
          <dt>평가액</dt>
          <dd className="money strong">{n.value ? krwShort(n.value) : '보유 안 함'}</dd>
          <dt>비중</dt>
          <dd>{pct(n.share ?? 0, 1, false)}</dd>
          <dt>매매일지</dt>
          <dd>{n.badge ?? '없음'}</dd>
        </dl>
        <div className="inline" style={{ gap: 6 }}>
          <a className="btn small primary" href={`/journal/new?asset=${n.ref}`}>+ 새 일지</a>
          <a className="btn small" href={`/journal?asset=${n.ref}`}>일지 목록</a>
          <a className="btn small" href="/traits">성질 지정</a>
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <span className="sub strong">관련 투자 거장 · 책 · 메모</span>
          <RelatedLoader target={{ type: 'asset', id: n.ref! }} order={['sage', 'book', 'note', 'topic']} empty="아직 없습니다. 이 종목의 성질(예: 가치주)과 이어진 거장·책이 생기면 여기에 나옵니다." />
        </div>
        <ul className="detail-list">
          {kids.map((k) => (
            <li key={k.id}>
              {k.kind === 'journal' ? (
                <button type="button" className="linkish" onClick={() => onOpen(k.ref!)}>{k.label}</button>
              ) : k.kind === 'trade' ? (
                <span>{k.label}</span>
              ) : (
                <a href={`/journal?asset=${k.ref}`}>{k.label}</a>
              )}
              <span className="sub">
                {k.sub}
                {k.kind === 'trade' && (
                  <>
                    {' · '}
                    <a href={`/journal/new?txn=${k.ref}`}>+ 일지</a>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (n.kind === 'trade') {
    return (
      <div className="stack" style={{ gap: 10 }}>
        <span className="sub">거래 · 일지 없음</span>
        <h2>{n.label}</h2>
        <p className="sub">{n.sub}</p>
        <div>
          <a className="btn small primary" href={`/journal/new?txn=${n.ref}`}>이 거래로 일지 쓰기</a>
        </div>
      </div>
    );
  }
  if (n.kind === 'journal') {
    return (
      <div className="stack" style={{ gap: 10 }}>
        <span className="sub">매매일지 · {n.sub}</span>
        <h2>{n.label}</h2>
        <div className="inline" style={{ gap: 6 }}>
          <button type="button" className="btn small primary" onClick={() => onOpen(n.ref!)}>내용 보기</button>
          <a className="btn small" href={`/journal/${n.ref}`}>편집</a>
        </div>
      </div>
    );
  }
  return (
    <div className="stack" style={{ gap: 10 }}>
      <h2>{n.label}</h2>
      <a className="btn small" href={`/journal?asset=${n.ref}`}>이 종목의 일지 모두 보기</a>
    </div>
  );
}
