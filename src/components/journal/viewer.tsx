'use client';

import { STATUS_LABEL } from '@/domain/journal';
import { money, pct } from '@/lib/format';
import type { JournalDetail, JournalSummary } from '@/server/services/journal';
import { FieldDisplay, LazyEditor, txnText } from './fields';

/** Bar from the base price to the target, filled up to where the price is now. */
export function TargetBar({ entry }: { entry: Pick<JournalSummary, 'progress' | 'currentPrice' | 'targetPrice' | 'currency'> }) {
  const { progress: p } = entry;
  const fill = p.ratio === null ? null : Math.max(0, Math.min(1, p.ratio));
  return (
    <span className="target-bar" title={p.ratio === null ? '기준 가격이나 현재가가 없어 진행률을 계산할 수 없습니다.' : `기준가→목표가 ${pct(p.ratio, 0, false)} 진행`}>
      <span className="track">{fill !== null && <span className={`fill ${p.direction}`} style={{ width: `${fill * 100}%` }} />}</span>
      <span className="sub">
        {p.reached ? <span className="badge ok">목표 도달</span> : p.remaining !== null ? `목표까지 ${pct(p.remaining, 1)}` : '현재가 없음'}
      </span>
    </span>
  );
}

/** A whole entry, read-only: properties, linked trades and body. */
export function JournalView({ entry }: { entry: JournalDetail }) {
  return (
    <article className="stack journal-view" style={{ gap: 14 }}>
      <header className="stack" style={{ gap: 4 }}>
        <span className="sub">
          {entry.entryDate} · {entry.assetName}
          {entry.symbol ? ` (${entry.symbol})` : ''}
        </span>
        <h2 style={{ fontSize: 20 }}>{entry.title}</h2>
      </header>
      <dl className="props compact">
        <dt>목표 예상 가격</dt>
        <dd className="strong money">{money(entry.targetPrice, entry.currency)}</dd>
        <dt>현재가</dt>
        <dd className="money">{entry.currentPrice ? money(entry.currentPrice, entry.currency) : '—'}</dd>
        <dt>진행</dt>
        <dd><TargetBar entry={entry} /></dd>
        {entry.basePrice && (
          <>
            <dt>기준 가격</dt>
            <dd className="money">{money(entry.basePrice, entry.currency)}</dd>
          </>
        )}
        {entry.stopPrice && (
          <>
            <dt>손절가</dt>
            <dd className="money">{money(entry.stopPrice, entry.currency)}</dd>
          </>
        )}
        {entry.targetDate && (
          <>
            <dt>목표 기한</dt>
            <dd>{entry.targetDate}</dd>
          </>
        )}
        <dt>상태</dt>
        <dd>{STATUS_LABEL[entry.status]}</dd>
        {entry.fields.map((f) => (
          <span key={f.key} style={{ display: 'contents' }}>
            <dt>{f.label}</dt>
            <dd><FieldDisplay def={f} value={f.value} currency={entry.currency} /></dd>
          </span>
        ))}
        {entry.txns.length > 0 && (
          <>
            <dt>연결된 거래</dt>
            <dd className="stack" style={{ gap: 4, alignItems: 'flex-start' }}>
              {entry.txns.map((t) => (
                <span key={t.id} className="sub" style={{ color: 'var(--ink-2)' }}>{txnText(t)}</span>
              ))}
            </dd>
          </>
        )}
      </dl>
      <div className="doc-body">
        <LazyEditor
          key={entry.id + entry.updatedAt}
          initialContent={entry.content}
          editable={false}
          context={{
            symbol: entry.symbol,
            currency: entry.currency,
            marks: [
              { y: Number(entry.targetPrice), label: '목표가', color: 'var(--series-1)' },
              ...(entry.stopPrice ? [{ y: Number(entry.stopPrice), label: '손절가', color: 'var(--danger)' }] : []),
            ],
          }}
        />
      </div>
    </article>
  );
}
