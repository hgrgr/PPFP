'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AGENTS, type AgentKind } from '@/domain/ai';
import { AiChat, type SageOption } from './chat';

export interface AskAiDetail {
  prompt?: string;
  agent?: AgentKind;
  sageId?: string | null;
}

const EVENT = 'ppfp:ai';
const LENSES: AgentKind[] = ['MANAGER', 'RESEARCH', 'COACH'];

/** Opens the AI side window with a question about the current screen. */
export function askAi(detail: AskAiDetail) {
  window.dispatchEvent(new CustomEvent<AskAiDetail>(EVENT, { detail }));
}

export function AskAiButton({ label, prompt, agent, sageId, className = 'btn' }: AskAiDetail & { label: string; className?: string }) {
  return (
    <button type="button" className={className} onClick={() => askAi({ prompt, agent, sageId })}>
      <span aria-hidden="true">✦</span> {label}
    </button>
  );
}

/**
 * Floating "AI" button (Alt+K) and the side window it opens. The chat knows which
 * screen it was opened on; buttons elsewhere open it with a question via askAi().
 */
export function AiLauncher({ sages, configured, models }: { sages: SageOption[]; configured: boolean; models: Partial<Record<AgentKind, string | null>> }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState<{ key: number; agent: AgentKind; sageId: string | null; prompt?: string; conversationId: string | null }>({ key: 0, agent: 'MANAGER', sageId: null, conversationId: null });

  useEffect(() => {
    const onAsk = (e: Event) => {
      const d = (e as CustomEvent<AskAiDetail>).detail ?? {};
      setSession((s) => ({ key: s.key + 1, agent: d.agent ?? 'MANAGER', sageId: d.sageId ?? null, prompt: d.prompt, conversationId: null }));
      setOpen(true);
    };
    const key = (e: KeyboardEvent) => {
      if (e.altKey && e.code === 'KeyK') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener(EVENT, onAsk);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener(EVENT, onAsk);
      window.removeEventListener('keydown', key);
    };
  }, []);

  if (pathname === '/ai') return null;
  const path = `${pathname}${search.toString() ? `?${search}` : ''}`;
  const lens = session.agent === 'SAGE' ? (session.sageId ?? '') : session.agent;
  const fresh = (value: string) =>
    setSession((s) => {
      const agent = (LENSES as string[]).includes(value) ? (value as AgentKind) : 'SAGE';
      return { key: s.key + 1, agent, sageId: agent === 'SAGE' ? value || null : null, conversationId: null };
    });

  return (
    <>
      <button type="button" className="ai-fab" aria-expanded={open} aria-label="AI 어드바이저 (Alt+K)" title="AI 어드바이저 (Alt+K)" onClick={() => setOpen((v) => !v)}>
        ✦ <span>AI</span>
      </button>
      <div className="drawer ai-drawer" role="dialog" aria-label="AI 어드바이저" hidden={!open} onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}>
        <div className="drawer-head">
          <select aria-label="에이전트" value={lens} onChange={(e) => fresh(e.target.value)}>
            {LENSES.map((k) => (
              <option key={k} value={k}>
                {AGENTS[k].name}
              </option>
            ))}
            {sages.length > 0 && (
              <optgroup label="투자 거장 관점">
                {sages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}의 관점
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          <div className="inline" style={{ gap: 6, flexWrap: 'nowrap' }}>
            <button type="button" className="btn small" onClick={() => fresh(lens)}>
              새 대화
            </button>
            <a className="btn small" href={session.conversationId ? `/ai?c=${session.conversationId}` : '/ai'}>
              전체 화면
            </a>
            <button type="button" className="btn small" aria-label="닫기" onClick={() => setOpen(false)}>
              ✕
            </button>
          </div>
        </div>
        {configured ? (
          <AiChat
            key={session.key}
            initial={null}
            agent={session.agent}
            sageId={session.sageId}
            path={path}
            prefill={session.prompt}
            autoSend={!!session.prompt}
            onConversation={(id) => setSession((s) => ({ ...s, conversationId: id }))}
            modelLabel={models[session.agent] ?? undefined}
            compact
          />
        ) : (
          <div className="drawer-body stack">
            <p>AI 어드바이저를 쓰려면 Claude·ChatGPT·Gemini·Grok·DeepSeek 중 한 곳의 API 키가 필요합니다.</p>
            <a className="btn primary" href="/settings#ai">
              연동 · 설정에서 키 넣기
            </a>
          </div>
        )}
      </div>
    </>
  );
}
