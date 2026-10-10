'use client';

import { useState, useTransition } from 'react';
import type { ActionState } from '@/app/actions';
import { adoptVersionAction, archivePhilosophyAction, createPhilosophyAction, deletePhilosophyAction, lintPreviewAction } from '@/app/philosophy-actions';
import { ActionForm, Submit } from '@/components/forms';

/** New philosophy: prose principles plus the v1 rules as JSON (a row editor comes later). */
export function PhilosophyForm({ templates }: { templates: { key: string; label: string; oneLine: string; rules: string }[] }) {
  const [rules, setRules] = useState(templates[0]?.rules ?? '');
  const [origin, setOrigin] = useState(templates[0] ? `template:${templates[0].key}` : 'custom');
  return (
    <ActionForm action={createPhilosophyAction} className="grid" resetOnSuccess aria-label="새 철학">
      <input type="hidden" name="origin" value={origin} />
      <label className="field">
        이름
        <input name="name" maxLength={40} placeholder="장기 분산, 배당 성장 …" required />
      </label>
      <label className="field">
        한 줄 요약
        <input name="oneLine" maxLength={120} placeholder="주식 60, 채권 40을 해마다 맞춘다" />
      </label>
      <label className="field">
        시작점
        <select
          defaultValue={origin}
          onChange={(e) => {
            const t = templates.find((x) => `template:${x.key}` === e.target.value);
            setOrigin(e.target.value);
            setRules(t?.rules ?? '');
          }}
        >
          {templates.map((t) => (
            <option key={t.key} value={`template:${t.key}`}>
              템플릿 · {t.label}
            </option>
          ))}
          <option value="custom">빈 규칙에서</option>
        </select>
      </label>
      <label className="field full">
        원칙 (선택, 8,000자까지)
        <textarea name="principles" rows={4} maxLength={8000} placeholder="무엇을 왜 들고, 언제 비중을 맞추는지 내 말로 적습니다." />
      </label>
      <label className="field full">
        규칙 (JSON, schemaVersion 1)
        <textarea name="rules" rows={10} className="mono" value={rules} onChange={(e) => setRules(e.target.value)} spellCheck={false} required />
      </label>
      <p className="sub full">종목 비중과 현금 비중의 합이 100%여야 하고, 정해진 키 밖의 값(레버리지, 부채 등)은 받지 않습니다. 템플릿의 ETF 종목 코드는 저장 전에 확인하세요.</p>
      <div className="full">
        <Submit>저장하고 채택</Submit>
      </div>
    </ActionForm>
  );
}

/** Paste text from elsewhere and see what the lint finds, without saving anything. */
export function LintPreviewForm() {
  return (
    <ActionForm action={lintPreviewAction} className="grid" aria-label="위험 문구 검사">
      <label className="field full">
        가져올 글
        <textarea name="text" rows={4} placeholder="스킬이나 블로그에서 가져올 철학 글을 붙여 넣으세요." required />
      </label>
      <div className="full">
        <Submit className="btn">위험 문구 검사</Submit>
      </div>
    </ActionForm>
  );
}

/** Adopt the waiting draft, archive or delete one philosophy. */
export function PhilosophyRowActions({ id, name, draft, archived }: { id: string; name: string; draft: number | null; archived: boolean }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<ActionState>({});
  const go = (fn: () => Promise<ActionState>) => start(async () => setMsg(await fn()));
  return (
    <span className="inline" style={{ justifyContent: 'flex-end' }}>
      {draft !== null && (
        <button type="button" className="btn small primary" disabled={pending} onClick={() => go(() => adoptVersionAction(id, draft))}>
          v{draft} 채택
        </button>
      )}
      <button type="button" className="btn small" disabled={pending} onClick={() => go(() => archivePhilosophyAction(id, !archived))}>
        {archived ? '꺼내기' : '보관'}
      </button>
      <button
        type="button"
        className="btn small danger"
        disabled={pending}
        onClick={() => {
          if (window.confirm(`'${name}'과 모든 버전·운용 기록을 지울까요?`)) go(() => deletePhilosophyAction(id));
        }}
      >
        삭제
      </button>
      {(msg.error || msg.ok) && (
        <span role={msg.error ? 'alert' : 'status'} className="sub" style={msg.error ? { color: 'var(--danger)' } : undefined}>
          {msg.error ?? msg.ok}
        </span>
      )}
    </span>
  );
}
