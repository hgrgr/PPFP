'use client';

import dynamic from 'next/dynamic';
import { FIELD_TYPE_LABEL, FIELD_TYPES, type FieldDef, type FieldType } from '@/domain/journal';
import { TXN_LABEL, type TxnType } from '@/domain/ledger';
import { kstDateTime, money, qty } from '@/lib/format';
import type { JournalTxnView } from '@/server/services/journal';

/** The block editor only runs in the browser. */
export const LazyEditor = dynamic(() => import('./editor'), {
  ssr: false,
  loading: () => <p className="empty">편집기를 불러오는 중…</p>,
});

export function Stars({ value, onChange }: { value: string; onChange?: (v: string) => void }) {
  const n = Number(value) || 0;
  return (
    <span className="stars" role={onChange ? 'radiogroup' : undefined} aria-label={`별점 ${n}점`}>
      {[1, 2, 3, 4, 5].map((i) =>
        onChange ? (
          <button key={i} type="button" role="radio" aria-checked={n === i} aria-label={`${i}점`} className={i <= n ? 'on' : ''} onClick={() => onChange(n === i ? '' : String(i))}>
            ★
          </button>
        ) : (
          <span key={i} className={i <= n ? 'on' : ''} aria-hidden="true">★</span>
        ),
      )}
    </span>
  );
}

/** Input for one custom property. */
export function FieldInput({ def, value, onChange, id }: { def: FieldDef; value: string; onChange: (v: string) => void; id?: string }) {
  switch (def.type) {
    case 'select':
      return (
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          {def.options?.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      );
    case 'rating':
      return <Stars value={value} onChange={onChange} />;
    case 'checkbox':
      return <input id={id} type="checkbox" checked={value === 'true'} onChange={(e) => onChange(e.target.checked ? 'true' : '')} />;
    case 'date':
      return <input id={id} type="date" value={value} onChange={(e) => onChange(e.target.value)} />;
    case 'number':
    case 'price':
    case 'percent':
      return (
        <span className="inline" style={{ flexWrap: 'nowrap', gap: 6 }}>
          <input id={id} inputMode="decimal" value={value} placeholder="비어 있음" onChange={(e) => onChange(e.target.value)} />
          {def.type === 'percent' && <span className="muted">%</span>}
        </span>
      );
    case 'url':
      return <input id={id} type="url" value={value} placeholder="https://" onChange={(e) => onChange(e.target.value)} />;
    default:
      return <input id={id} value={value} placeholder="비어 있음" onChange={(e) => onChange(e.target.value)} />;
  }
}

/** Read-only rendering of a property value. */
export function FieldDisplay({ def, value, currency }: { def: FieldDef; value: string; currency: string }) {
  if (value === '') return <span className="muted">—</span>;
  switch (def.type) {
    case 'rating':
      return <Stars value={value} />;
    case 'checkbox':
      return <span>✓</span>;
    case 'price':
      return <span className="money">{money(value, currency)}</span>;
    case 'percent':
      return <span>{value}%</span>;
    case 'number':
      return <span>{Number(value).toLocaleString('ko-KR', { maximumFractionDigits: 6 })}</span>;
    case 'url':
      return (
        <a href={value} target="_blank" rel="noopener noreferrer nofollow" style={{ overflowWrap: 'anywhere' }}>
          {value.replace(/^https?:\/\//, '')}
        </a>
      );
    case 'select':
      return <span className="badge">{value}</span>;
    default:
      return <span style={{ whiteSpace: 'pre-wrap' }}>{value}</span>;
  }
}

/** Editor for a list of property definitions (used for an entry and for a format). */
export function FieldDefsEditor({ defs, onChange }: { defs: FieldDef[]; onChange: (d: FieldDef[]) => void }) {
  const set = (i: number, patch: Partial<FieldDef>) => onChange(defs.map((d, k) => (k === i ? { ...d, ...patch } : d)));
  const move = (i: number, by: number) => {
    const j = i + by;
    if (j < 0 || j >= defs.length) return;
    const next = [...defs];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  return (
    <div className="stack" style={{ gap: 8 }}>
      {defs.map((d, i) => (
        <div key={d.key || i} className="def-row">
          <input aria-label="속성 이름" value={d.label} placeholder="속성 이름" onChange={(e) => set(i, { label: e.target.value })} />
          <select aria-label="종류" value={d.type} onChange={(e) => set(i, { type: e.target.value as FieldType, options: e.target.value === 'select' ? d.options ?? [] : undefined })}>
            {FIELD_TYPES.map((t) => (
              <option key={t} value={t}>{FIELD_TYPE_LABEL[t]}</option>
            ))}
          </select>
          {d.type === 'select' ? (
            <input
              aria-label="선택지"
              placeholder="선택지를 쉼표로: 돌파, 눌림목"
              defaultValue={d.options?.join(', ') ?? ''}
              onBlur={(e) => set(i, { options: e.target.value.split(',').map((o) => o.trim()).filter(Boolean) })}
            />
          ) : (
            <span />
          )}
          <span className="inline" style={{ gap: 4, flexWrap: 'nowrap' }}>
            <button type="button" className="btn small" aria-label="위로" onClick={() => move(i, -1)} disabled={i === 0}>↑</button>
            <button type="button" className="btn small" aria-label="아래로" onClick={() => move(i, 1)} disabled={i === defs.length - 1}>↓</button>
            <button type="button" className="btn small danger" aria-label="삭제" onClick={() => onChange(defs.filter((_, k) => k !== i))}>✕</button>
          </span>
        </div>
      ))}
      <div>
        <button type="button" className="btn small" onClick={() => onChange([...defs, { key: `f${Date.now().toString(36)}`, label: '', type: 'text' }])}>
          + 속성 추가
        </button>
      </div>
    </div>
  );
}

/** One linked trade in a line: 매도 · 2026-08-25 · 25주 · @ $188.13 */
export function txnText(t: JournalTxnView) {
  const parts = [TXN_LABEL[t.type as TxnType] ?? t.type, kstDateTime(t.tradeAt).slice(0, 10)];
  if (t.qty) parts.push(`${qty(t.qty)}주`);
  if (t.price) parts.push(`@ ${money(t.price, t.currency)}`);
  return parts.join(' · ');
}
