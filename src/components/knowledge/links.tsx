'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { addLinkAction, addTopicLinkAction, removeLinkAction } from '@/app/knowledge-actions';
import { KTYPE_LABEL, type KRef, type KType } from '@/domain/knowledge';
import type { KItem, RelatedItem } from '@/server/services/knowledge';

const ICON: Record<KType, string> = { note: '✎', book: '📖', sage: '👤', topic: '#', trait: '◆', asset: '₩' };

export function KnowledgeTabs({ current }: { current: 'notes' | 'books' | 'sages' | 'topics' }) {
  const tabs = [
    ['notes', '메모'],
    ['books', '독서 노트'],
    ['sages', '투자 거장'],
    ['topics', '키워드'],
  ] as const;
  return (
    <nav className="seg" aria-label="투자 노트" style={{ alignSelf: 'flex-start' }}>
      {tabs.map(([k, label]) => (
        <a key={k} href={`/${k}`} aria-current={current === k ? 'true' : undefined}>
          {label}
        </a>
      ))}
    </nav>
  );
}

export function KChip({ item, onRemove }: { item: KItem; onRemove?: () => void }) {
  return (
    <span className={`kchip k-${item.type}`} style={item.color ? { ['--c' as string]: item.color } : undefined} title={`${KTYPE_LABEL[item.type]}${item.sub ? ` · ${item.sub}` : ''}`}>
      <span className="ico" aria-hidden="true">{ICON[item.type]}</span>
      <a href={item.href}>{item.label}</a>
      {onRemove && (
        <button type="button" aria-label={`${item.label} 연결 풀기`} onClick={onRemove}>
          ✕
        </button>
      )}
    </span>
  );
}

/**
 * The properties of a note, book or investor: linked keywords, traits, stocks and
 * other notes. "+ 속성" opens a search over everything; typing a new word makes a keyword.
 */
export function LinkChips({ self, links, options, types }: { self: KRef; links: KItem[]; options: KItem[]; types?: KType[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const linked = new Set(links.map((l) => `${l.type}:${l.id}`));
  const pool = options.filter((o) => !linked.has(`${o.type}:${o.id}`) && !(o.type === self.type && o.id === self.id) && (!types || types.includes(o.type)) && !(self.type === 'asset' && o.type === 'trait'));
  const query = q.trim().replace(/^#/, '').toLowerCase();
  const hits = useMemo(() => (query ? pool.filter((o) => o.label.toLowerCase().includes(query) || o.sub?.toLowerCase().includes(query)) : pool).slice(0, 40), [pool, query]);
  const exact = options.some((o) => o.type === 'topic' && o.label.toLowerCase() === query);

  const act = (fn: () => Promise<{ error?: string }>) =>
    start(async () => {
      const r = await fn();
      setError(r.error ?? null);
      if (!r.error) {
        setQ('');
        router.refresh();
      }
    });
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const groups = (['topic', 'trait', 'asset', 'sage', 'book', 'note'] as KType[]).map((t) => [t, hits.filter((h) => h.type === t)] as const).filter(([, l]) => l.length);
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="inline" style={{ gap: 6 }} aria-busy={pending}>
        {links.map((l) => (
          <KChip key={`${l.type}:${l.id}`} item={l} onRemove={() => act(() => removeLinkAction(self, l))} />
        ))}
        <button type="button" className="btn small" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? '닫기' : '+ 속성'}
        </button>
      </div>
      {open && (
        <div className="kpicker">
          <input
            ref={inputRef}
            value={q}
            placeholder="키워드·성질·종목·거장·책 검색, 새 키워드는 입력 후 Enter"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && query) {
                e.preventDefault();
                if (hits.length === 1) act(() => addLinkAction(self, hits[0]));
                else if (!exact) act(() => addTopicLinkAction(self, q));
              }
              if (e.key === 'Escape') setOpen(false);
            }}
          />
          {query && !exact && (
            <button type="button" className="btn small" onClick={() => act(() => addTopicLinkAction(self, q))}>
              새 키워드 ‘#{q.trim().replace(/^#/, '')}’ 만들어 연결
            </button>
          )}
          <div className="kpicker-list">
            {groups.map(([t, list]) => (
              <div key={t}>
                <div className="sub">{KTYPE_LABEL[t]}</div>
                <div className="inline" style={{ gap: 4 }}>
                  {list.map((o) => (
                    <button key={o.id} type="button" className={`kchip k-${o.type} pick`} style={o.color ? { ['--c' as string]: o.color } : undefined} onClick={() => act(() => addLinkAction(self, o))} title={o.sub}>
                      <span className="ico" aria-hidden="true">{ICON[o.type]}</span>
                      {o.label}
                      {o.type === 'trait' && o.sub && <span className="sub">{o.sub}</span>}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {!groups.length && <p className="sub">맞는 항목이 없습니다.</p>}
          </div>
          {error && <p className="msg err">{error}</p>}
        </div>
      )}
    </div>
  );
}

const GROUP_TITLE: Record<KType, string> = { sage: '투자 거장', book: '책', note: '메모', topic: '키워드', trait: '자산 성질', asset: '내 종목' };

/** What relates to an item, grouped: investors, books, notes, keywords, traits, stocks. */
export function RelatedPanel({ data, order = ['sage', 'book', 'note', 'topic', 'trait', 'asset'], empty }: { data: Record<KType, RelatedItem[]>; order?: KType[]; empty?: string }) {
  const groups = order.filter((t) => data[t]?.length);
  if (!groups.length) return <p className="sub">{empty ?? '아직 연결된 항목이 없습니다.'}</p>;
  return (
    <div className="related">
      {groups.map((t) => (
        <div key={t} className="stack" style={{ gap: 6 }}>
          <div className="sub strong" style={{ color: 'var(--ink-2)' }}>
            {GROUP_TITLE[t]} {data[t].length}
          </div>
          <ul>
            {data[t].map((r) => (
              <li key={r.id}>
                <KChip item={r} />
                <span className="sub">{r.direct ? (r.sub && t !== 'trait' && t !== 'asset' ? r.sub : '직접 연결') : `${r.via.join(', ')}(으)로 연결`}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** RelatedPanel that loads its data in the browser (for side windows). */
export function RelatedLoader({ target, order, empty }: { target: KRef; order?: KType[]; empty?: string }) {
  const [data, setData] = useState<Record<KType, RelatedItem[]> | null>(null);
  useEffect(() => {
    let live = true;
    setData(null);
    fetch(`/api/knowledge/related?type=${target.type}&id=${encodeURIComponent(target.id)}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => live && setData(j))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [target.type, target.id]);
  return data ? <RelatedPanel data={data} order={order} empty={empty} /> : <p className="sub">불러오는 중…</p>;
}
