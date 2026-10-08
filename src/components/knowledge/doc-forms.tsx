'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import {
  addPresetSageAction,
  createBookAction,
  createSageAction,
  deleteBookAction,
  deleteSageAction,
  saveBookAction,
  saveSageAction,
  type KResult,
} from '@/app/knowledge-actions';
import { BOOK_STATUS_LABEL } from '@/domain/knowledge';
import type { JournalEditor } from '@/components/journal/editor';
import { LazyEditor, Stars } from '@/components/journal/fields';

const NO_CONTEXT = { symbol: null, currency: 'KRW', marks: [] };

/** Saves 1.5 s after the last change, and on Ctrl+S. */
function useAutosave(save: () => Promise<KResult>) {
  const [dirty, setDirty] = useState(false);
  const [state, setState] = useState<{ saving?: boolean; error?: string; savedAt?: number }>({});
  const run = useCallback(async () => {
    setDirty(false);
    setState({ saving: true });
    const r = await save();
    setState(r.error ? { error: r.error } : { savedAt: r.at });
    if (r.error) setDirty(true);
  }, [save]);
  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(() => void run(), 1500);
    return () => clearTimeout(t);
  }, [dirty, run]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void run();
      }
    };
    const leave = (e: BeforeUnloadEvent) => dirty && e.preventDefault();
    window.addEventListener('keydown', key);
    window.addEventListener('beforeunload', leave);
    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener('beforeunload', leave);
    };
  }, [dirty, run]);
  const status = state.saving ? '저장 중…' : state.error ? '' : dirty ? '변경됨' : '저장됨';
  return { touch: () => setDirty(true), status, error: state.error };
}

// ── books ───────────────────────────────────────────

export interface BookData {
  id: string;
  title: string;
  author: string | null;
  publisher: string | null;
  publishedYear: number | null;
  status: 'WANT' | 'READING' | 'DONE';
  rating: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  oneLine: string | null;
  content: unknown[];
}

export function BookForm({ book, children }: { book: BookData; children?: React.ReactNode }) {
  const router = useRouter();
  const [f, setF] = useState({
    title: book.title,
    author: book.author ?? '',
    publisher: book.publisher ?? '',
    publishedYear: book.publishedYear ? String(book.publishedYear) : '',
    status: book.status as string,
    rating: book.rating ? String(book.rating) : '',
    startedAt: book.startedAt ?? '',
    finishedAt: book.finishedAt ?? '',
    oneLine: book.oneLine ?? '',
  });
  const editor = useRef<JournalEditor | null>(null);
  const content = useRef<unknown[]>(book.content);
  const save = useCallback(() => saveBookAction(book.id, { ...f, content: editor.current?.document ?? content.current }), [book.id, f]);
  const { touch, status, error } = useAutosave(save);
  const set = (k: keyof typeof f) => (v: string) => {
    setF((x) => ({ ...x, [k]: v }));
    touch();
  };
  return (
    <article className="journal-doc">
      <div className="spread doc-bar">
        <nav className="crumbs" aria-label="경로">
          <a href="/books">독서 노트</a> › <span>{f.title}</span>
        </nav>
        <div className="inline">
          <span className="sub" role="status">{status}</span>
          <button type="button" className="btn small danger" onClick={async () => confirm('이 책 정리를 지울까요?') && !(await deleteBookAction(book.id)).error && router.push('/books')}>
            삭제
          </button>
        </div>
      </div>
      {error && <p className="msg err">{error}</p>}
      <input className="doc-title" aria-label="책 제목" value={f.title} onChange={(e) => set('title')(e.target.value)} />
      <dl className="props">
        <dt><label htmlFor="b-author">저자</label></dt>
        <dd><input id="b-author" value={f.author} placeholder="비어 있음" onChange={(e) => set('author')(e.target.value)} /></dd>
        <dt><label htmlFor="b-pub">출판사 · 연도</label></dt>
        <dd>
          <input id="b-pub" value={f.publisher} placeholder="출판사" onChange={(e) => set('publisher')(e.target.value)} style={{ maxWidth: 180 }} />
          <input aria-label="출간 연도" inputMode="numeric" value={f.publishedYear} placeholder="연도" onChange={(e) => set('publishedYear')(e.target.value.replace(/\D/g, '').slice(0, 4))} style={{ maxWidth: 90 }} />
        </dd>
        <dt>상태</dt>
        <dd>
          <div className="seg" role="group" aria-label="읽은 상태">
            {(Object.keys(BOOK_STATUS_LABEL) as (keyof typeof BOOK_STATUS_LABEL)[]).map((s) => (
              <button key={s} type="button" aria-pressed={f.status === s} onClick={() => set('status')(s)}>{BOOK_STATUS_LABEL[s]}</button>
            ))}
          </div>
        </dd>
        <dt>별점</dt>
        <dd><Stars value={f.rating} onChange={set('rating')} /></dd>
        <dt><label htmlFor="b-start">읽은 기간</label></dt>
        <dd>
          <input id="b-start" type="date" value={f.startedAt} onChange={(e) => set('startedAt')(e.target.value)} style={{ maxWidth: 170 }} />
          <span className="muted">~</span>
          <input aria-label="다 읽은 날" type="date" value={f.finishedAt} onChange={(e) => set('finishedAt')(e.target.value)} style={{ maxWidth: 170 }} />
        </dd>
        <dt><label htmlFor="b-one">한 줄 요약</label></dt>
        <dd><input id="b-one" value={f.oneLine} placeholder="이 책을 한 문장으로" onChange={(e) => set('oneLine')(e.target.value)} style={{ maxWidth: 560 }} /></dd>
      </dl>
      {children}
      <div className="doc-body">
        <LazyEditor initialContent={book.content} editorRef={editor} context={NO_CONTEXT} onChange={(b) => ((content.current = b), touch())} />
      </div>
    </article>
  );
}

export function NewBook() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="inline"
      style={{ gap: 8 }}
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await createBookAction(title);
          if (r.error) setError(r.error);
          else router.push(`/books/${r.id}`);
        });
      }}
    >
      <input value={title} placeholder="책 제목 (예: 현명한 투자자)" onChange={(e) => setTitle(e.target.value)} style={{ maxWidth: 320 }} required />
      <button className="btn primary" type="submit" disabled={pending}>+ 책 추가</button>
      {error && <span className="msg err">{error}</span>}
    </form>
  );
}

// ── investors ───────────────────────────────────────

export interface SageData {
  id: string;
  name: string;
  nameEn: string | null;
  lived: string | null;
  affiliation: string | null;
  oneLine: string | null;
  content: unknown[];
}

export function SageForm({ sage, children }: { sage: SageData; children?: React.ReactNode }) {
  const router = useRouter();
  const [f, setF] = useState({ name: sage.name, nameEn: sage.nameEn ?? '', lived: sage.lived ?? '', affiliation: sage.affiliation ?? '', oneLine: sage.oneLine ?? '' });
  const editor = useRef<JournalEditor | null>(null);
  const content = useRef<unknown[]>(sage.content);
  const save = useCallback(() => saveSageAction(sage.id, { ...f, content: editor.current?.document ?? content.current }), [sage.id, f]);
  const { touch, status, error } = useAutosave(save);
  const set = (k: keyof typeof f) => (v: string) => {
    setF((x) => ({ ...x, [k]: v }));
    touch();
  };
  return (
    <article className="journal-doc">
      <div className="spread doc-bar">
        <nav className="crumbs" aria-label="경로">
          <a href="/sages">투자 거장</a> › <span>{f.name}</span>
        </nav>
        <div className="inline">
          <span className="sub" role="status">{status}</span>
          <button type="button" className="btn small danger" onClick={async () => confirm('이 인물 정리를 지울까요?') && !(await deleteSageAction(sage.id)).error && router.push('/sages')}>
            삭제
          </button>
        </div>
      </div>
      {error && <p className="msg err">{error}</p>}
      <input className="doc-title" aria-label="이름" value={f.name} onChange={(e) => set('name')(e.target.value)} />
      <dl className="props">
        <dt><label htmlFor="s-en">영문 이름</label></dt>
        <dd><input id="s-en" value={f.nameEn} placeholder="비어 있음" onChange={(e) => set('nameEn')(e.target.value)} /></dd>
        <dt><label htmlFor="s-lived">생몰 · 소속</label></dt>
        <dd>
          <input id="s-lived" value={f.lived} placeholder="1930–" onChange={(e) => set('lived')(e.target.value)} style={{ maxWidth: 140 }} />
          <input aria-label="소속" value={f.affiliation} placeholder="회사·펀드" onChange={(e) => set('affiliation')(e.target.value)} style={{ maxWidth: 300 }} />
        </dd>
        <dt><label htmlFor="s-one">핵심 철학</label></dt>
        <dd><input id="s-one" value={f.oneLine} placeholder="한 문장으로" onChange={(e) => set('oneLine')(e.target.value)} style={{ maxWidth: 620 }} /></dd>
      </dl>
      {children}
      <div className="doc-body">
        <LazyEditor initialContent={sage.content} editorRef={editor} context={NO_CONTEXT} onChange={(b) => ((content.current = b), touch())} />
      </div>
    </article>
  );
}

export function SagePresetButton({ presetKey }: { presetKey: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        className="btn small primary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await addPresetSageAction(presetKey);
            if (r.error) setError(r.error);
            else router.push(`/sages/${r.id}`);
          })
        }
      >
        추가
      </button>
      {error && <span className="sub down">{error}</span>}
    </>
  );
}

export function NewSage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="inline"
      style={{ gap: 8 }}
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await createSageAction(name);
          if (r.error) setError(r.error);
          else router.push(`/sages/${r.id}`);
        });
      }}
    >
      <input value={name} placeholder="이름 (목록에 없는 인물)" onChange={(e) => setName(e.target.value)} style={{ maxWidth: 260 }} required />
      <button className="btn" type="submit" disabled={pending}>직접 추가</button>
      {error && <span className="msg err">{error}</span>}
    </form>
  );
}
