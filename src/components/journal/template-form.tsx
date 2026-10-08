'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { deleteTemplateAction, saveTemplateAction } from '@/app/journal-actions';
import type { FieldDef } from '@/domain/journal';
import type { JournalEditor } from './editor';
import { FieldDefsEditor, FieldInput, LazyEditor } from './fields';

/** Build a journal format: its own properties and a starting body. */
export function TemplateForm({ initial }: { initial: { id?: string; name: string; description: string; fields: FieldDef[]; content: unknown[] } }) {
  const router = useRouter();
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [defs, setDefs] = useState<FieldDef[]>(initial.fields);
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const [saving, setSaving] = useState(false);
  const editorRef = useRef<JournalEditor | null>(null);

  const save = async () => {
    setSaving(true);
    const r = await saveTemplateAction({ id: initial.id, name, description, fields: defs, content: editorRef.current?.document ?? initial.content });
    setSaving(false);
    if (r.error) return setMsg({ error: r.error });
    setMsg({ ok: '양식을 저장했습니다.' });
    if (!initial.id && r.id) router.replace(`/journal/templates/${r.id}`);
  };
  const remove = async () => {
    if (!initial.id || !confirm('이 양식을 삭제할까요? 이미 쓴 일지는 그대로 남습니다.')) return;
    const r = await deleteTemplateAction(initial.id);
    if (r.error) return setMsg({ error: r.error });
    router.push('/journal/templates');
  };

  return (
    <article className="journal-doc">
      <div className="spread doc-bar">
        <nav className="crumbs" aria-label="경로">
          <a href="/journal">매매일지</a> › <a href="/journal/templates">양식</a> › <span>{initial.id ? initial.name : '새 양식'}</span>
        </nav>
        <div className="inline">
          {initial.id && <a className="btn small" href={`/journal/new?format=${initial.id}`}>이 양식으로 쓰기</a>}
          {initial.id && <button type="button" className="btn small danger" onClick={() => void remove()}>삭제</button>}
          <button type="button" className="btn primary" onClick={() => void save()} disabled={saving}>{saving ? '저장 중…' : '저장'}</button>
        </div>
      </div>
      {(msg.error || msg.ok) && <p className={`msg ${msg.error ? 'err' : 'ok'}`} role={msg.error ? 'alert' : 'status'}>{msg.error ?? msg.ok}</p>}

      <input className="doc-title" aria-label="양식 이름" value={name} placeholder="양식 이름 (예: 실적 시즌 매매)" onChange={(e) => setName(e.target.value)} />
      <input aria-label="설명" value={description} placeholder="이 양식을 언제 쓰는지 한 줄로" onChange={(e) => setDescription(e.target.value)} />

      <section className="card tight stack">
        <div className="stack" style={{ gap: 4 }}>
          <h2>속성</h2>
          <p className="sub">종목·목표 예상 가격·기준 가격·손절가·목표 기한·상태는 모든 일지에 기본으로 들어갑니다. 여기서는 그 밖에 기록할 항목을 정합니다.</p>
        </div>
        <FieldDefsEditor defs={defs} onChange={setDefs} />
        {defs.length > 0 && (
          <details>
            <summary className="sub">미리보기</summary>
            <dl className="props" style={{ marginTop: 8 }}>
              {defs.map((d) => (
                <span key={d.key} style={{ display: 'contents' }}>
                  <dt>{d.label || '이름 없음'}</dt>
                  <dd><FieldInput def={d} value="" onChange={() => {}} /></dd>
                </span>
              ))}
            </dl>
          </details>
        )}
      </section>

      <section className="stack" style={{ gap: 6 }}>
        <h2>본문 틀</h2>
        <p className="sub">새 일지를 이 양식으로 시작하면 아래 내용이 미리 채워집니다. ‘/’를 눌러 제목·표·체크리스트·그래프를 넣으세요.</p>
        <div className="doc-body">
          <LazyEditor initialContent={initial.content} editorRef={editorRef} context={{ symbol: null, currency: 'KRW', marks: [] }} />
        </div>
      </section>
    </article>
  );
}
