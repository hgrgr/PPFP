'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { dismissAiAction, executeAiAction } from '@/app/ai-actions';
import { AGENTS, type AgentKind, type ChatTurn } from '@/domain/ai';
import type { ActionView, ConversationView } from '@/server/services/ai/actions';

export interface SageOption {
  id: string;
  name: string;
}

export function Md({ text }: { text: string }) {
  return (
    <div className="ai-md">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target={href?.startsWith('/') ? undefined : '_blank'} rel="noreferrer">
              {children}
            </a>
          ),
          table: ({ children }) => (
            <div className="table-wrap">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = { DONE: '실행함', DISMISSED: '넘김', FAILED: '실패' };
const KIND_LABEL: Record<string, string> = { note: '메모', price_alert: '가격 알림', target_weights: '목표 비중', journal_review: '일지 복기', journal_draft: '일지 초안', book: '읽을 책' };

function ActionCard({ action, onChange }: { action: ActionView; onChange: () => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const act = (fn: () => Promise<{ error?: string }>) =>
    start(async () => {
      const r = await fn();
      setError(r.error ?? null);
      onChange();
    });
  return (
    <div className={`ai-action s-${action.status.toLowerCase()}`} aria-busy={pending}>
      <div className="spread" style={{ alignItems: 'flex-start' }}>
        <div className="stack" style={{ gap: 2 }}>
          <span className="sub strong">제안 · {KIND_LABEL[action.kind] ?? action.kind}</span>
          <span>{action.summary}</span>
        </div>
        {action.status === 'PENDING' ? (
          <span className="inline" style={{ gap: 6, flexWrap: 'nowrap' }}>
            <button type="button" className="btn small primary" disabled={pending} onClick={() => act(() => executeAiAction(action.id))}>
              실행
            </button>
            <button type="button" className="btn small" disabled={pending} onClick={() => act(() => dismissAiAction(action.id))}>
              넘기기
            </button>
          </span>
        ) : (
          <span className="inline" style={{ gap: 6, flexWrap: 'nowrap' }}>
            <span className={`badge ${action.status === 'DONE' ? 'ok' : action.status === 'FAILED' ? 'warn' : ''}`}>{STATUS_LABEL[action.status] ?? action.status}</span>
            {action.href && (
              <a className="btn small" href={action.href}>
                보기
              </a>
            )}
          </span>
        )}
      </div>
      {(error || (action.status === 'FAILED' && action.result)) && <p className="msg err">{error ?? action.result}</p>}
    </div>
  );
}

function AssistantTurn({ turn, actions, onChange }: { turn: Extract<ChatTurn, { role: 'assistant' }>; actions: ActionView[]; onChange: () => void }) {
  // Tool steps between answer text collapse into one quiet line
  const out: React.ReactNode[] = [];
  let steps: string[] = [];
  const flush = (k: string) => {
    if (steps.length) out.push(<div key={k} className="ai-steps">{[...new Set(steps)].join(' · ')}</div>);
    steps = [];
  };
  turn.parts.forEach((p, i) => {
    if (p.kind === 'tool') steps.push(p.label);
    else if (p.kind === 'search') steps.push(p.query ? `웹 검색 “${p.query}”` : '웹 검색');
    else {
      flush(`s${i}`);
      if (p.kind === 'text') out.push(<Md key={i} text={p.text} />);
      else {
        const a = actions.find((x) => x.toolUseId === p.toolUseId);
        if (a) out.push(<ActionCard key={i} action={a} onChange={onChange} />);
      }
    }
  });
  flush('end');
  return (
    <div className="ai-turn assistant">
      {out}
      {turn.sources.length > 0 && (
        <details className="ai-sources">
          <summary>출처 {turn.sources.length}</summary>
          <ol>
            {turn.sources.map((s) => (
              <li key={s.url}>
                <a href={s.url} target="_blank" rel="noreferrer">
                  {s.title}
                </a>
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}

/**
 * A conversation with an advisor agent. Without `initial` it starts a new one with
 * `agent` (and `sageId` for an investor's lens) on the first message.
 */
export function AiChat({
  initial,
  agent,
  sageId,
  path,
  prefill,
  autoSend,
  onConversation,
  urlOnStart,
  compact,
  modelLabel,
}: {
  initial: ConversationView | null;
  agent: AgentKind;
  sageId?: string | null;
  path?: string | null;
  prefill?: string;
  autoSend?: boolean;
  onConversation?: (id: string) => void;
  /** Put the new conversation in the address bar (the /ai page) */
  urlOnStart?: boolean;
  compact?: boolean;
  /** What a new conversation answers with */
  modelLabel?: string;
}) {
  const [conv, setConv] = useState<ConversationView | null>(initial);
  const [pendingUser, setPendingUser] = useState<string | null>(null);
  const [live, setLive] = useState<{ text: string; status: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState(prefill ?? '');
  const area = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const sentAuto = useRef(false);
  const busy = live !== null;

  useEffect(() => setConv(initial), [initial]);

  const reload = useCallback(async (id: string) => {
    const r = await fetch(`/api/ai/conversations/${id}`, { cache: 'no-store' });
    if (r.ok) setConv(await r.json());
  }, []);

  const send = useCallback(
    async (q: string) => {
      const question = q.trim();
      if (!question || busy) return;
      setError(null);
      setText('');
      setPendingUser(question);
      setLive({ text: '', status: '생각 중…' });
      let id = conv?.id ?? null;
      try {
        const res = await fetch('/api/ai/chat', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ conversationId: id ?? undefined, agent, sageId: sageId ?? null, text: question, path: path ?? null }),
        });
        if (!res.ok || !res.body) throw new Error(res.status === 401 ? '다시 로그인하세요.' : '요청을 보내지 못했습니다.');
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let nl;
          while ((nl = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, nl);
            buf = buf.slice(nl + 1);
            if (!line) continue;
            const e = JSON.parse(line);
            if (e.t === 'start') {
              id = e.conversationId;
              if (!conv) {
                onConversation?.(e.conversationId);
                if (urlOnStart) window.history.replaceState(null, '', `/ai?c=${e.conversationId}`);
              }
            } else if (e.t === 'text') setLive((l) => ({ text: (l?.text ?? '') + e.d, status: null }));
            else if (e.t === 'status') setLive((l) => ({ text: l?.text ?? '', status: e.label }));
            else if (e.t === 'error') setError(e.message);
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : '연결이 끊겼습니다.');
      }
      if (id) await reload(id);
      setPendingUser(null);
      setLive(null);
      area.current?.focus();
    },
    [agent, sageId, path, conv, busy, reload, onConversation, urlOnStart],
  );

  useEffect(() => {
    if (autoSend && prefill && !sentAuto.current) {
      sentAuto.current = true;
      void send(prefill);
    }
  }, [autoSend, prefill, send]);

  useEffect(() => {
    // Scroll the log itself, never the page around it
    const log = end.current?.parentElement;
    if (log) log.scrollTop = log.scrollHeight;
  }, [conv?.turns.length, live?.text, pendingUser]);

  const turns = conv?.turns ?? [];
  const info = AGENTS[(conv?.agent as AgentKind) ?? agent];
  const disabled = agent === 'SAGE' && !conv && !sageId;
  return (
    <div className={`ai-chat${compact ? ' compact' : ''}`}>
      <div className="ai-log" aria-live="polite">
        {!turns.length && !pendingUser && (
          <div className="ai-empty stack">
            <p className="sub">{info.description}</p>
            <div className="stack" style={{ gap: 6 }}>
              {info.starters.map((s) => (
                <button key={s} type="button" className="ai-starter" disabled={disabled} onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {turns.map((t, i) =>
          t.role === 'user' ? (
            <div key={i} className="ai-turn user">
              {t.text}
            </div>
          ) : (
            <AssistantTurn key={i} turn={t} actions={conv!.actions} onChange={() => conv && reload(conv.id)} />
          ),
        )}
        {pendingUser && <div className="ai-turn user">{pendingUser}</div>}
        {live && (
          <div className="ai-turn assistant">
            {live.text && <Md text={live.text} />}
            {live.status && <div className="ai-steps live">{live.status}</div>}
          </div>
        )}
        {error && <p className="msg err">{error}</p>}
        <div ref={end} />
      </div>
      <form
        className="ai-input"
        onSubmit={(e) => {
          e.preventDefault();
          void send(text);
        }}
      >
        <textarea
          ref={area}
          value={text}
          rows={compact ? 2 : 3}
          disabled={disabled}
          placeholder={disabled ? '먼저 관점으로 삼을 투자 거장을 고르세요' : '무엇이든 물어보세요 · Enter로 보내기, Shift+Enter로 줄바꿈'}
          aria-label="AI에게 질문"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send(text);
            }
          }}
        />
        <div className="spread">
          <span className="sub">{[conv?.modelLabel ?? modelLabel, conv ? `이 대화 약 $${conv.costUsd.toFixed(2)}` : null, '숫자는 앱의 기록, 판단은 참고용입니다'].filter(Boolean).join(' · ')}</span>
          <button type="submit" className="btn primary small" disabled={busy || disabled || !text.trim()}>
            {busy ? '답하는 중…' : '보내기'}
          </button>
        </div>
      </form>
    </div>
  );
}
