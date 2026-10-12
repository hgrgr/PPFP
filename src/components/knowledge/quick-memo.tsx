'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { createNoteAction, updateNoteAction } from '@/app/knowledge-actions';

interface Recent {
  id: string;
  body: string;
  updatedAt: string;
}

/**
 * Floating "메모" button on every page (Alt+M). Writes a note without leaving the
 * page; #키워드 tags it, and the stock, book or investor on screen is linked. A saved
 * note opens back in the panel to edit and save again.
 */
export function QuickMemo() {
  const pathname = usePathname();
  const search = useSearchParams();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  const [recent, setRecent] = useState<Recent[]>([]);
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  /** The note being edited, or null for a new one */
  const [editing, setEditing] = useState<string | null>(null);
  /** The note just written, to reopen from the message */
  const [last, setLast] = useState<Recent | null>(null);
  const [pending, start] = useTransition();
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.altKey && e.code === 'KeyM') {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  useEffect(() => {
    if (!open) return;
    area.current?.focus();
    fetch('/api/notes', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => Array.isArray(j) && setRecent(j))
      .catch(() => {});
  }, [open]);

  const where = `${pathname}${search.toString() ? `?${search}` : ''}`;
  const edit = (n: Recent) => {
    setEditing(n.id);
    setBody(n.body);
    setMsg({});
    area.current?.focus();
  };
  const fresh = () => {
    setEditing(null);
    setBody('');
    setMsg({});
    area.current?.focus();
  };
  const save = () =>
    start(async () => {
      const now = new Date().toISOString();
      if (editing) {
        const r = await updateNoteAction(editing, { body });
        setMsg(r);
        if (!r.error) {
          const id = editing;
          setRecent((list) => [{ id, body, updatedAt: now }, ...list.filter((n) => n.id !== id)].slice(0, 5));
          router.refresh();
        }
        return;
      }
      const r = await createNoteAction(body, where);
      setMsg(r);
      if (!r.error) {
        const note = { id: r.id!, body, updatedAt: now };
        setBody('');
        setLast(note);
        setRecent((list) => [note, ...list].slice(0, 5));
        router.refresh();
      }
    });

  return (
    <>
      <button type="button" className="memo-fab" aria-expanded={open} aria-label="빠른 메모 (Alt+M)" title="빠른 메모 (Alt+M)" onClick={() => setOpen((v) => !v)}>
        ✎ <span>메모</span>
      </button>
      {open && (
        <div className="drawer memo-drawer" role="dialog" aria-label="빠른 메모">
          <div className="drawer-head">
            <span className="strong">{editing ? '메모 고치기' : '빠른 메모'}</span>
            <div className="inline" style={{ gap: 6 }}>
              <a className="btn small" href="/notes">메모 모두 보기</a>
              <button type="button" className="btn small" aria-label="닫기" onClick={() => setOpen(false)}>✕</button>
            </div>
          </div>
          <div className="drawer-body stack" style={{ gap: 10 }}>
            <textarea
              ref={area}
              value={body}
              rows={7}
              placeholder={'떠오른 생각을 적으세요.\n#가치투자 처럼 쓰면 키워드로 묶입니다.'}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && body.trim()) {
                  e.preventDefault();
                  save();
                }
              }}
            />
            <div className="spread">
              <span className="sub">
                {editing ? 'Ctrl+Enter(⌘+Enter)로 다시 저장' : 'Ctrl+Enter(⌘+Enter)로 저장 · 이 화면의 종목·책·거장이 함께 연결됩니다'}
              </span>
              <div className="inline" style={{ gap: 6 }}>
                {editing && (
                  <button type="button" className="btn small" onClick={fresh}>
                    새 메모
                  </button>
                )}
                <button type="button" className="btn primary small" disabled={pending || !body.trim()} onClick={save}>
                  {editing ? '다시 저장' : '저장'}
                </button>
              </div>
            </div>
            {(msg.ok || msg.error) && (
              <p className={`msg ${msg.error ? 'err' : 'ok'}`}>
                {msg.error ?? msg.ok}
                {!msg.error && !editing && last && (
                  <>
                    {' '}
                    <button type="button" className="linkish" onClick={() => edit(last)}>
                      방금 메모 고치기
                    </button>
                  </>
                )}
              </p>
            )}
            {recent.length > 0 && (
              <div className="stack" style={{ gap: 6 }}>
                <span className="sub strong">최근 메모 · 누르면 여기서 고칩니다</span>
                <ul className="memo-recent">
                  {recent.map((n) => (
                    <li key={n.id} className={n.id === editing ? 'on' : undefined}>
                      <button type="button" className="linkish" onClick={() => edit(n)} title="여기서 불러와 고치기">
                        {n.body.split('\n')[0].slice(0, 80)}
                      </button>
                      <span className="sub">{new Date(n.updatedAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
