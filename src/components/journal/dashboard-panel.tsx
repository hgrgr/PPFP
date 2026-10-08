'use client';

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Donut, type DonutSlice } from '@/components/charts';
import { STATUS_LABEL } from '@/domain/journal';
import { money } from '@/lib/format';
import type { JournalDetail, JournalSummary } from '@/server/services/journal';
import { JournalView, TargetBar } from './viewer';

interface Picked {
  assetId: string;
  name: string;
}

interface Ctx {
  counts: Record<string, number>;
  picked: Picked | null;
  pick: (p: Picked | null) => void;
}

const PanelContext = createContext<Ctx>({ counts: {}, picked: null, pick: () => {} });

/** Shares the stock picked on the dashboard (from the ring chart or the holdings table) with the journal panel. */
export function JournalPanelProvider({ counts, children }: { counts: Record<string, number>; children: React.ReactNode }) {
  const [picked, setPicked] = useState<Picked | null>(null);
  const pick = (p: Picked | null) => {
    setPicked(p);
    if (p) requestAnimationFrame(() => document.getElementById('journal-panel')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
  };
  return <PanelContext.Provider value={{ counts, picked, pick }}>{children}</PanelContext.Provider>;
}

/** The allocation ring; in 종목 mode each stock opens its journals. */
export function AllocationDonut({ slices, centerLabel, centerValue, byStock }: { slices: DonutSlice[]; centerLabel: string; centerValue: string; byStock: boolean }) {
  const { counts, picked, pick } = useContext(PanelContext);
  if (!byStock) return <Donut slices={slices} centerLabel={centerLabel} centerValue={centerValue} />;
  const pickable = new Set(slices.filter((s) => s.key !== 'OTHER' && s.key !== 'CASH_BAL').map((s) => s.key));
  const notes = Object.fromEntries(slices.filter((s) => counts[s.key]).map((s) => [s.key, `일지 ${counts[s.key]}`]));
  return (
    <Donut
      slices={slices}
      centerLabel={centerLabel}
      centerValue={centerValue}
      pickable={pickable}
      picked={picked?.assetId ?? null}
      notes={notes}
      onPick={(s) => pick(picked?.assetId === s.key ? null : { assetId: s.key, name: s.label })}
    />
  );
}

/** Button in a holdings row that shows that stock's journals. */
export function JournalPickButton({ assetId, name }: { assetId: string; name: string }) {
  const { counts, picked, pick } = useContext(PanelContext);
  const n = counts[assetId] ?? 0;
  return (
    <button
      type="button"
      className={`btn small${picked?.assetId === assetId ? ' primary' : ''}`}
      aria-pressed={picked?.assetId === assetId}
      title={`${name} 매매일지`}
      onClick={() => pick(picked?.assetId === assetId ? null : { assetId, name })}
    >
      일지 {n}
    </button>
  );
}

/** Journals of the picked stock; clicking one opens it in a side window over the dashboard. */
export function JournalPanel() {
  const { picked, pick } = useContext(PanelContext);
  const [rows, setRows] = useState<JournalSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    setRows(null);
    setOpenId(null);
    if (!picked) return;
    let live = true;
    fetch(`/api/journal?asset=${encodeURIComponent(picked.assetId)}`, { cache: 'no-store' })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? '불러오지 못했습니다.');
        if (live) {
          setRows(j as JournalSummary[]);
          setError(null);
        }
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : '불러오지 못했습니다.'));
    return () => {
      live = false;
    };
  }, [picked]);

  if (!picked) {
    return <p className="sub">자산 배분을 ‘종목’으로 보고 원형 차트의 조각이나 범례, 또는 보유 종목 표의 ‘일지’ 버튼을 누르면 그 종목의 매매일지가 여기에 나옵니다.</p>;
  }
  return (
    <section id="journal-panel" className="card" aria-label={`${picked.name} 매매일지`}>
      <div className="spread">
        <div className="stack" style={{ gap: 2 }}>
          <h2>{picked.name} 매매일지</h2>
          <span className="sub">{rows ? `${rows.length}개` : '불러오는 중…'} · 누르면 옆에 열립니다</span>
        </div>
        <div className="inline">
          <a className="btn small primary" href={`/journal/new?asset=${picked.assetId}`}>+ 새 일지</a>
          <a className="btn small" href={`/journal?asset=${picked.assetId}`}>전체 보기</a>
          <button type="button" className="btn small" onClick={() => pick(null)} aria-label="닫기">✕</button>
        </div>
      </div>
      {error && <p className="msg err">{error}</p>}
      {rows && !rows.length && <p className="empty">아직 이 종목의 매매일지가 없습니다.</p>}
      {rows && rows.length > 0 && (
        <ul className="journal-list">
          {rows.map((r) => (
            <li key={r.id}>
              <button type="button" aria-current={openId === r.id} onClick={() => setOpenId(r.id)}>
                <span className="stack" style={{ gap: 2, minWidth: 0, alignItems: 'flex-start' }}>
                  <span className="sub">
                    {r.entryDate} · {STATUS_LABEL[r.status]}
                    {r.txnCount ? ` · 거래 ${r.txnCount}건` : ''}
                  </span>
                  <span className="strong">{r.title}</span>
                  {r.excerpt && <span className="sub excerpt">{r.excerpt}</span>}
                </span>
                <span className="stack" style={{ gap: 4, alignItems: 'flex-end' }}>
                  <span className="sub">목표 <span className="strong money" style={{ color: 'var(--ink)' }}>{money(r.targetPrice, r.currency)}</span></span>
                  <TargetBar entry={r} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {openId && <JournalDrawer id={openId} onClose={() => setOpenId(null)} />}
    </section>
  );
}

export function JournalDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const [entry, setEntry] = useState<JournalDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let live = true;
    setEntry(null);
    fetch(`/api/journal/${id}`, { cache: 'no-store' })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? '불러오지 못했습니다.');
        if (live) setEntry(j as JournalDetail);
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : '불러오지 못했습니다.'));
    return () => {
      live = false;
    };
  }, [id]);
  useEffect(() => {
    ref.current?.focus();
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  return (
    <div className="drawer" role="dialog" aria-modal="false" aria-label="매매일지 보기" ref={ref} tabIndex={-1}>
      <div className="drawer-head">
        <span className="sub">매매일지</span>
        <div className="inline" style={{ gap: 6 }}>
          <a className="btn small" href={`/journal/${id}`}>편집</a>
          <button type="button" className="btn small" onClick={onClose} aria-label="닫기">✕</button>
        </div>
      </div>
      <div className="drawer-body">
        {error ? <p className="msg err">{error}</p> : entry ? <JournalView entry={entry} /> : <p className="empty">불러오는 중…</p>}
      </div>
    </div>
  );
}
