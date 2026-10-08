'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { createNoteAction } from '@/app/knowledge-actions';

interface Recent {
  id: string;
  body: string;
  updatedAt: string;
}

/**
 * Floating "메모" button on every page (Alt+M). Writes a note without leaving the
 * page; #키워드 tags it, and the stock, book or investor on screen is linked.
 */
export function QuickMemo() {
  const pathname = usePathname();
  const search = useSearchParams();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  const [recent, setRecent] = useState<Recent[]>([]);
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
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
  const save = () =>
    start(async () => {
      const r = await createNoteAction(body, where);
      setMsg(r);
      if (!r.error) {
        setBody('');
        setRecent((list) => [{ id: r.id!, body, updatedAt: new Date().toISOString() }, ...list].slice(0, 5));
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
            <span className="strong">빠른 메모</span>
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
              <span className="sub">Ctrl+Enter(⌘+Enter)로 저장 · 이 화면의 종목·책·거장이 함께 연결됩니다</span>
              <button type="button" className="btn primary small" disabled={pending || !body.trim()} onClick={save}>
                저장
              </button>
            </div>
            {(msg.ok || msg.error) && <p className={`msg ${msg.error ? 'err' : 'ok'}`}>{msg.error ?? msg.ok}</p>}
            {recent.length > 0 && (
              <div className="stack" style={{ gap: 6 }}>
                <span className="sub strong">최근 메모</span>
                <ul className="memo-recent">
                  {recent.map((n) => (
                    <li key={n.id}>
                      <a href={`/notes?open=${n.id}`}>{n.body.split('\n')[0].slice(0, 80)}</a>
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
