'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { deleteAiConversation } from '@/app/ai-actions';
import { kstDateTime } from '@/lib/format';

export function AiConversations({ items, current }: { items: { id: string; title: string; who: string; at: string }[]; current: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (!items.length) return null;
  return (
    <nav className="stack" style={{ gap: 4 }} aria-label="지난 대화" aria-busy={pending}>
      <span className="sub strong">지난 대화</span>
      <ul className="ai-history">
        {items.map((c) => (
          <li key={c.id} aria-current={c.id === current ? 'true' : undefined}>
            <a href={`/ai?c=${c.id}`}>
              <span className="strong">{c.title}</span>
              <span className="sub">
                {c.who} · {kstDateTime(c.at).slice(5)}
              </span>
            </a>
            <button
              type="button"
              className="icon-btn"
              aria-label={`${c.title} 대화 지우기`}
              onClick={() =>
                confirm('이 대화를 지울까요?') &&
                start(async () => {
                  await deleteAiConversation(c.id);
                  if (c.id === current) router.push('/ai');
                  else router.refresh();
                })
              }
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
