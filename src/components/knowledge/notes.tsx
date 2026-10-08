'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { createNoteAction, deleteNoteAction, updateNoteAction } from '@/app/knowledge-actions';
import type { KItem } from '@/server/services/knowledge';
import { kstDateTime } from '@/lib/format';
import { LinkChips } from './links';

/** Body with #tags shown as links to their keyword. */
function Body({ text, topics }: { text: string; topics: KItem[] }) {
  const parts = text.split(/((?:^|[^\p{L}\p{N}_&])#[\p{L}\p{N}_·-]{1,30})/u);
  return (
    <p className="note-body">
      {parts.map((p, i) => {
        const m = /^(.*?)#([\p{L}\p{N}_·-]+)$/u.exec(p);
        const t = m && topics.find((x) => x.label === m[2].replace(/[·-]+$/, '').replace(/_+/g, ' ').trim());
        return t ? (
          <span key={i}>
            {m![1]}
            <a className="hashtag" href={`/notes?topic=${t.id}`}>#{m![2]}</a>
          </span>
        ) : (
          <span key={i}>{p}</span>
        );
      })}
    </p>
  );
}

export function NoteComposer() {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const save = () =>
    start(async () => {
      const r = await createNoteAction(body, '/notes');
      setError(r.error ?? null);
      if (!r.error) {
        setBody('');
        router.refresh();
      }
    });
  return (
    <div className="card tight stack" style={{ gap: 8 }}>
      <textarea
        value={body}
        rows={3}
        placeholder="새 메모 · #키워드로 묶기(띄어쓰기는 #리스크_관리) · Ctrl+Enter로 저장 (어느 화면에서든 오른쪽 아래 ✎ 메모 또는 Alt+M)"
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && body.trim()) {
            e.preventDefault();
            save();
          }
        }}
      />
      <div className="spread">
        {error ? <span className="msg err">{error}</span> : <span />}
        <button type="button" className="btn primary small" disabled={pending || !body.trim()} onClick={save}>
          메모 추가
        </button>
      </div>
    </div>
  );
}

export function NoteCard({ note, links, options, open }: { note: { id: string; body: string; pinned: boolean; sourceUrl: string | null; updatedAt: string }; links: KItem[]; options: KItem[]; open: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(note.body);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (open) ref.current?.scrollIntoView({ block: 'center' });
  }, [open]);
  const act = (fn: () => Promise<{ error?: string }>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      setError(r.error ?? null);
      if (!r.error) {
        after?.();
        router.refresh();
      }
    });
  return (
    <article ref={ref} className={`card tight note-card${open ? ' open' : ''}${note.pinned ? ' pinned' : ''}`} aria-busy={pending}>
      <div className="spread" style={{ alignItems: 'flex-start' }}>
        <span className="sub">
          {kstDateTime(note.updatedAt)}
          {note.sourceUrl && (
            <>
              {' · '}
              <a href={note.sourceUrl}>쓴 화면</a>
            </>
          )}
        </span>
        <span className="inline" style={{ gap: 4 }}>
          <button type="button" className="icon-btn" aria-pressed={note.pinned} title={note.pinned ? '고정 풀기' : '위에 고정'} onClick={() => act(() => updateNoteAction(note.id, { pinned: !note.pinned }))}>
            📌
          </button>
          <button type="button" className="btn small" onClick={() => setEditing((v) => !v)}>{editing ? '취소' : '고치기'}</button>
          <button type="button" className="btn small danger" onClick={() => confirm('이 메모를 지울까요?') && act(() => deleteNoteAction(note.id))}>지우기</button>
        </span>
      </div>
      {editing ? (
        <div className="stack" style={{ gap: 6 }}>
          <textarea value={body} rows={5} onChange={(e) => setBody(e.target.value)} />
          <div>
            <button type="button" className="btn primary small" disabled={pending} onClick={() => act(() => updateNoteAction(note.id, { body }), () => setEditing(false))}>
              저장
            </button>
          </div>
        </div>
      ) : (
        <Body text={note.body} topics={links.filter((l) => l.type === 'topic')} />
      )}
      <LinkChips self={{ type: 'note', id: note.id }} links={links} options={options} />
      {error && <p className="msg err">{error}</p>}
    </article>
  );
}
