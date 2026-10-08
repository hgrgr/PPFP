'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { deleteJournalAction, saveJournalAction, saveTemplateAction } from '@/app/journal-actions';
import { recommendFormats, STATUS_LABEL, targetProgress, type FieldDef, type JournalFormat } from '@/domain/journal';
import { money, pct } from '@/lib/format';
import type { JournalDetail, JournalTxnView } from '@/server/services/journal';
import type { JournalEditor } from './editor';
import { FieldDefsEditor, FieldInput, LazyEditor, txnText } from './fields';

export interface JournalAssetOption {
  id: string;
  name: string;
  symbol: string | null;
  currency: string;
  type: string;
  /** Asset traits, for showing next to the asset */
  traits?: { name: string; color: string }[];
}

export interface Prefill {
  assetId?: string;
  txnId?: string;
  txnType?: string;
  price?: string | null;
  date?: string;
  format?: string;
}

type Format = JournalFormat & { custom: boolean };

const today = () => new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
const LISTED = ['KR_STOCK', 'US_STOCK', 'CRYPTO'];


/** Write or edit one journal entry: properties on top, linked trades, then the block body. Existing entries save themselves. */
export function JournalEntryForm({ entry, assets, formats, prefill = {} }: { entry: JournalDetail | null; assets: JournalAssetOption[]; formats: Format[]; prefill?: Prefill }) {
  const router = useRouter();
  const isNew = !entry;
  const firstFormat = useMemo(() => {
    if (entry) return null;
    const wanted = prefill.format && formats.find((f) => f.id === prefill.format);
    if (wanted) return wanted;
    const id = recommendFormats(prefill.txnType ? [prefill.txnType] : []).order[0];
    return formats.find((f) => f.id === id) ?? formats[0];
  }, [entry, formats, prefill.format, prefill.txnType]);

  const [assetId, setAssetId] = useState(entry?.assetId ?? prefill.assetId ?? '');
  const [title, setTitle] = useState(entry?.title ?? '');
  const [entryDate, setEntryDate] = useState(entry?.entryDate ?? prefill.date ?? today());
  const [status, setStatus] = useState<'OPEN' | 'CLOSED'>(entry?.status ?? 'OPEN');
  const [targetPrice, setTargetPrice] = useState(entry?.targetPrice ?? '');
  const [basePrice, setBasePrice] = useState(entry?.basePrice ?? prefill.price ?? '');
  const [stopPrice, setStopPrice] = useState(entry?.stopPrice ?? '');
  const [targetDate, setTargetDate] = useState(entry?.targetDate ?? '');
  const [alertTarget, setAlertTarget] = useState(entry ? entry.alerts.target !== null : true);
  const [alertStop, setAlertStop] = useState(entry ? entry.alerts.stop !== null || !entry.stopPrice : true);
  const [template, setTemplate] = useState(entry?.template ?? firstFormat?.id ?? '');
  const [defs, setDefs] = useState<FieldDef[]>(entry?.fields.map(({ value: _v, ...d }) => d) ?? firstFormat?.fields ?? []);
  const [values, setValues] = useState<Record<string, string>>(Object.fromEntries(entry?.fields.map((f) => [f.key, f.value]) ?? []));
  const [txnIds, setTxnIds] = useState<string[]>(entry?.txns.map((t) => t.id) ?? (prefill.txnId ? [prefill.txnId] : []));
  const [candidates, setCandidates] = useState<JournalTxnView[]>(entry?.txns ?? []);
  const [current, setCurrent] = useState<string | null>(entry?.currentPrice ?? null);
  const [showTxns, setShowTxns] = useState(false);
  const [editDefs, setEditDefs] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [bodyTouched, setBodyTouched] = useState(false);
  const [state, setState] = useState<{ saving?: boolean; error?: string; savedAt?: number }>({});
  const content = useRef<unknown[]>(entry?.content ?? firstFormat?.content ?? []);
  const editorRef = useRef<JournalEditor | null>(null);

  const asset = assets.find((a) => a.id === assetId);
  const currency = asset?.currency ?? entry?.currency ?? 'KRW';
  const touch = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setDirty(true);
  };

  // Trades of the chosen asset, and its current price
  useEffect(() => {
    if (!assetId) return;
    let live = true;
    fetch(`/api/journal/txns?asset=${encodeURIComponent(assetId)}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j: { txns?: JournalTxnView[]; currentPrice?: string | null }) => {
        if (!live || !j.txns) return;
        setCandidates(j.txns);
        setCurrent(j.currentPrice ?? null);
        setTxnIds((ids) => ids.filter((id) => j.txns!.some((t) => t.id === id)));
        if (isNew) setBasePrice((b) => b || j.currentPrice || '');
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [assetId, isNew]);

  const linked = candidates.filter((t) => txnIds.includes(t.id));
  const rec = recommendFormats(linked.map((t) => t.type));
  const ordered = [...rec.order.map((id) => formats.find((f) => f.id === id)!).filter(Boolean), ...formats.filter((f) => f.custom)];
  const currentFormat = formats.find((f) => f.id === template);
  const progress = targetPrice ? targetProgress(targetPrice, basePrice || null, current) : null;

  const applyFormat = (f: Format) => {
    if (f.id === template) return;
    if (bodyTouched && !confirm(`본문을 '${f.name}' 양식으로 바꿀까요? 지금 쓴 본문은 사라집니다. (속성 값은 이름이 같으면 남습니다)`)) return;
    setTemplate(f.id);
    setDefs(f.fields);
    content.current = f.content;
    const ed = editorRef.current;
    if (ed) ed.replaceBlocks(ed.document, f.content as Parameters<JournalEditor['replaceBlocks']>[1]);
    setBodyTouched(false);
    setDirty(true);
  };

  const save = useCallback(async () => {
    if (!assetId) return setState({ error: '종목을 고르세요.' });
    if (!targetPrice) return setState({ error: '목표 예상 가격을 입력하세요.' });
    setState((s) => ({ ...s, saving: true, error: undefined }));
    setDirty(false);
    const r = await saveJournalAction({
      id: entry?.id,
      assetId,
      title: title.trim() || `${asset?.name ?? ''} ${currentFormat?.name ?? '매매일지'}`.trim(),
      entryDate,
      status,
      targetPrice,
      basePrice,
      stopPrice,
      targetDate,
      template,
      fields: defs,
      values,
      content: editorRef.current?.document ?? content.current,
      txnIds,
      alertTarget,
      alertStop,
    });
    if (r.error) {
      setDirty(true);
      return setState({ error: r.error });
    }
    setState({ savedAt: r.at });
    if (isNew && r.id) router.replace(`/journal/${r.id}`);
  }, [alertStop, alertTarget, asset?.name, assetId, basePrice, currentFormat?.name, defs, entry?.id, entryDate, isNew, router, status, stopPrice, targetDate, targetPrice, template, title, txnIds, values]);

  // Existing entries save themselves shortly after the last change
  useEffect(() => {
    if (isNew || !dirty || !targetPrice || !assetId) return;
    const t = setTimeout(() => void save(), 1500);
    return () => clearTimeout(t);
  }, [dirty, isNew, save, targetPrice, assetId]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save();
      }
    };
    const leave = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener('keydown', key);
    window.addEventListener('beforeunload', leave);
    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener('beforeunload', leave);
    };
  }, [dirty, save]);

  const remove = async () => {
    if (!entry || !confirm('이 매매일지를 삭제할까요? 되돌릴 수 없습니다.')) return;
    const r = await deleteJournalAction(entry.id);
    if (r.error) return setState({ error: r.error });
    setDirty(false);
    router.push('/journal');
  };

  const saveAsFormat = async () => {
    const name = prompt('양식 이름', currentFormat && currentFormat.custom ? currentFormat.name : `${currentFormat?.name ?? '나의'} 양식`);
    if (!name) return;
    const r = await saveTemplateAction({ name, description: '', fields: defs, content: editorRef.current?.document ?? content.current });
    setState(r.error ? { error: r.error } : { savedAt: r.at });
    if (!r.error) alert(`'${name}' 양식을 저장했습니다. 다음 일지부터 고를 수 있습니다.`);
  };

  const statusText = state.saving ? '저장 중…' : state.error ? '' : dirty ? (isNew ? '저장하지 않음' : '변경됨') : state.savedAt ? '저장됨' : isNew ? '' : '저장됨';

  return (
    <article className="journal-doc">
      <div className="spread doc-bar">
        <nav className="crumbs" aria-label="경로">
          <a href="/journal">매매일지</a> › <span>{isNew ? '새 일지' : entry.title}</span>
        </nav>
        <div className="inline">
          <span className="sub" role="status">{statusText}</span>
          {isNew ? (
            <button type="button" className="btn primary" onClick={() => void save()} disabled={state.saving}>
              저장
            </button>
          ) : (
            <>
              <a className="btn small" href="/journal/new">+ 새 일지</a>
              <button type="button" className="btn small danger" onClick={() => void remove()}>삭제</button>
            </>
          )}
        </div>
      </div>
      {state.error && <p className="msg err" role="alert">{state.error}</p>}

      <input
        className="doc-title"
        aria-label="제목"
        value={title}
        placeholder={`${asset?.name ?? '종목'} ${currentFormat?.name ?? '매매일지'}`}
        onChange={(e) => touch(setTitle)(e.target.value)}
      />

      <dl className="props">
        <dt><label htmlFor="j-asset">종목</label></dt>
        <dd>
          <select id="j-asset" value={assetId} onChange={(e) => touch(setAssetId)(e.target.value)} required>
            <option value="">종목 고르기</option>
            {assets.map((a) => (
              <option key={a.id} value={a.id}>{a.name}{a.symbol ? ` (${a.symbol})` : ''}</option>
            ))}
          </select>
          {current && <span className="sub">현재가 <span className="money">{money(current, currency)}</span></span>}
          {asset && (
            <span className="inline" style={{ gap: 4 }}>
              {asset.traits?.map((t) => (
                <span key={t.name} className="chip" style={{ paddingRight: 10 }}>
                  <span className="dot" style={{ background: t.color }} />
                  {t.name}
                </span>
              ))}
              <a className="sub" href="/traits">{asset.traits?.length ? '성질 바꾸기' : '성질 지정'}</a>
            </span>
          )}
        </dd>

        <dt><label htmlFor="j-target">목표 예상 가격 <span className="req" title="필수">*</span></label></dt>
        <dd>
          <input id="j-target" inputMode="decimal" value={targetPrice} placeholder="필수" onChange={(e) => touch(setTargetPrice)(e.target.value.replace(/[^\d.]/g, ''))} required aria-required="true" />
          <span className="muted">{currency}</span>
          {progress?.remaining !== null && progress?.remaining !== undefined && (
            <span className={`sub ${progress.reached ? 'strong' : ''}`}>
              {progress.reached ? '목표 도달' : `현재가에서 ${pct(progress.remaining, 1)}`}
            </span>
          )}
          <AlertSwitch on={alertTarget} onChange={touch(setAlertTarget)} state={entry?.alerts.target ?? null} label="닿으면 알림" />
        </dd>

        <dt><label htmlFor="j-base">기준 가격</label></dt>
        <dd>
          <input id="j-base" inputMode="decimal" value={basePrice} placeholder="작성 시점 가격" onChange={(e) => touch(setBasePrice)(e.target.value.replace(/[^\d.]/g, ''))} />
          {current && current !== basePrice && (
            <button type="button" className="btn small" onClick={() => touch(setBasePrice)(current)}>현재가 넣기</button>
          )}
        </dd>

        <dt><label htmlFor="j-stop">손절가</label></dt>
        <dd>
          <input id="j-stop" inputMode="decimal" value={stopPrice} placeholder="비어 있음" onChange={(e) => touch(setStopPrice)(e.target.value.replace(/[^\d.]/g, ''))} />
          {stopPrice && <AlertSwitch on={alertStop} onChange={touch(setAlertStop)} state={entry?.alerts.stop ?? null} label="닿으면 알림" />}
        </dd>

        <dt><label htmlFor="j-tdate">목표 기한</label></dt>
        <dd><input id="j-tdate" type="date" value={targetDate} onChange={(e) => touch(setTargetDate)(e.target.value)} /></dd>

        <dt><label htmlFor="j-date">작성일</label></dt>
        <dd><input id="j-date" type="date" value={entryDate} onChange={(e) => touch(setEntryDate)(e.target.value)} /></dd>

        <dt>상태</dt>
        <dd>
          <div className="seg" role="group" aria-label="상태">
            {(['OPEN', 'CLOSED'] as const).map((s) => (
              <button key={s} type="button" aria-pressed={status === s} onClick={() => touch(setStatus)(s)}>{STATUS_LABEL[s]}</button>
            ))}
          </div>
        </dd>

        {defs.map((d) => (
          <FieldRow key={d.key} def={d} value={values[d.key] ?? ''} onChange={(v) => touch(setValues)({ ...values, [d.key]: v })} />
        ))}

        <dt>연결된 거래</dt>
        <dd className="stack" style={{ gap: 6, alignItems: 'flex-start' }}>
          {linked.length ? (
            <div className="inline" style={{ gap: 6 }}>
              {linked.map((t) => (
                <span key={t.id} className="chip">
                  {txnText(t)}
                  <button type="button" aria-label="연결 해제" onClick={() => touch(setTxnIds)(txnIds.filter((x) => x !== t.id))}>✕</button>
                </span>
              ))}
            </div>
          ) : (
            <span className="muted">없음</span>
          )}
          {assetId && (
            <button type="button" className="btn small" aria-expanded={showTxns} onClick={() => setShowTxns((v) => !v)}>
              {showTxns ? '닫기' : '거래 연결'}
            </button>
          )}
          {showTxns && (
            <div className="txn-pick">
              {candidates.length ? (
                candidates.map((t) => (
                  <label key={t.id} className="inline" style={{ flexWrap: 'nowrap' }}>
                    <input type="checkbox" checked={txnIds.includes(t.id)} onChange={(e) => touch(setTxnIds)(e.target.checked ? [...txnIds, t.id] : txnIds.filter((x) => x !== t.id))} />
                    <span>{txnText(t)}</span>
                    <span className="sub">{t.portfolioName}</span>
                  </label>
                ))
              ) : (
                <p className="sub">이 종목의 거래 기록이 없습니다.</p>
              )}
            </div>
          )}
        </dd>
      </dl>

      <div className="inline" style={{ gap: 8 }}>
        <button type="button" className="btn small" aria-expanded={editDefs} onClick={() => setEditDefs((v) => !v)}>
          {editDefs ? '속성 편집 닫기' : '속성 편집'}
        </button>
        <button type="button" className="btn small" onClick={() => void saveAsFormat()}>이 구성을 양식으로 저장</button>
        <a className="btn small" href="/journal/templates">양식 관리</a>
      </div>
      {editDefs && (
        <div className="card tight">
          <p className="sub">이 일지에만 적용됩니다. 다른 일지에도 쓰려면 ‘이 구성을 양식으로 저장’을 누르세요.</p>
          <FieldDefsEditor defs={defs} onChange={touch(setDefs)} />
        </div>
      )}

      <section className="format-pick" aria-label="양식">
        <div className="spread">
          <span className="sub">양식 · {rec.reason}</span>
        </div>
        <div className="inline" style={{ gap: 6 }}>
          {ordered.map((f, i) => (
            <button key={f.id} type="button" className="chip-btn" aria-pressed={template === f.id} title={f.description} onClick={() => applyFormat(f)}>
              {f.name}
              {i === 0 && !f.custom && <span className="badge">추천</span>}
              {f.custom && <span className="badge">내 양식</span>}
            </button>
          ))}
        </div>
      </section>

      <div className="doc-body">
        <LazyEditor
          key={entry?.id ?? 'new'}
          initialContent={content.current}
          editorRef={editorRef}
          onChange={(blocks) => {
            content.current = blocks;
            setBodyTouched(true);
            setDirty(true);
          }}
          context={{
            symbol: asset && LISTED.includes(asset.type) ? asset.symbol : null,
            currency,
            marks: [
              ...(Number(targetPrice) > 0 ? [{ y: Number(targetPrice), label: '목표가', color: 'var(--series-1)' }] : []),
              ...(Number(stopPrice) > 0 ? [{ y: Number(stopPrice), label: '손절가', color: 'var(--danger)' }] : []),
            ],
          }}
        />
      </div>
      {isNew && <p className="sub">처음 저장한 뒤부터는 고칠 때마다 자동으로 저장됩니다. Ctrl+S(⌘S)로 바로 저장할 수도 있습니다.</p>}
    </article>
  );
}

function FieldRow({ def, value, onChange }: { def: FieldDef; value: string; onChange: (v: string) => void }) {
  const id = `jf-${def.key}`;
  return (
    <>
      <dt><label htmlFor={id}>{def.label || '이름 없음'}</label></dt>
      <dd><FieldInput id={id} def={def} value={value} onChange={onChange} /></dd>
    </>
  );
}

/** Switch for a journal price alert, with what the alert is doing now. */
function AlertSwitch({ on, onChange, state, label }: { on: boolean; onChange: (v: boolean) => void; state: { active: boolean; triggeredAt: string | null } | null; label: string }) {
  const note = !on || !state ? null : state.active ? '대기 중' : state.triggeredAt ? `${state.triggeredAt.slice(0, 10)} 도달 — 가격을 바꾸면 다시 켜짐` : '일지 종료로 쉬는 중';
  return (
    <label className="inline sub" style={{ gap: 5, flexWrap: 'nowrap' }} title="가격에 닿으면 알림함과 푸시로 알립니다">
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} />
      🔔 {label}
      {note && <span className="badge" style={{ height: 20, fontSize: 11 }}>{note}</span>}
    </label>
  );
}
