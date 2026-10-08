'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { createTopicAction, deleteTopicAction, saveTopicAction } from '@/app/knowledge-actions';

export function TopicCreate() {
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
          const r = await createTopicAction(name);
          if (r.error) setError(r.error);
          else {
            setName('');
            router.push(`/topics?t=${r.id}`);
          }
        });
      }}
    >
      <input value={name} placeholder="새 키워드 (예: 안전마진)" onChange={(e) => setName(e.target.value)} style={{ maxWidth: 240 }} required />
      <button className="btn" type="submit" disabled={pending}>+ 키워드</button>
      {error && <span className="msg err">{error}</span>}
    </form>
  );
}

export function TopicEdit({ topic }: { topic: { id: string; name: string; color: string; description: string | null } }) {
  const router = useRouter();
  const [f, setF] = useState({ name: topic.name, color: topic.color, description: topic.description ?? '' });
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="inline" style={{ gap: 8 }}>
        <input type="color" aria-label="색" value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} style={{ width: 44 }} />
        <input aria-label="키워드 이름" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} style={{ maxWidth: 220, fontWeight: 700, fontSize: 18 }} />
        <button type="button" className="btn small primary" disabled={pending} onClick={() => start(async () => { const r = await saveTopicAction(topic.id, f); setMsg(r); if (!r.error) router.refresh(); })}>저장</button>
        <button type="button" className="btn small danger" disabled={pending} onClick={() => confirm(`#${topic.name} 키워드와 연결을 지울까요?`) && start(async () => { const r = await deleteTopicAction(topic.id); if (!r.error) router.push('/topics'); else setMsg(r); })}>지우기</button>
      </div>
      <input aria-label="설명" value={f.description} placeholder="설명 (선택)" onChange={(e) => setF({ ...f, description: e.target.value })} />
      {(msg.ok || msg.error) && <p className={`msg ${msg.error ? 'err' : 'ok'}`}>{msg.error ?? msg.ok}</p>}
    </div>
  );
}
