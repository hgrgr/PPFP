import { AiChat } from '@/components/ai/chat';
import { AiConversations } from '@/components/ai/conversations';
import { AGENTS, type AgentKind } from '@/domain/ai';
import { requireUser } from '@/server/auth';
import { prisma } from '@/server/db';
import { conversationView, listConversations } from '@/server/services/ai/actions';
import { aiStatus } from '@/server/services/ai/agent';

export const metadata = { title: 'AI 어드바이저' };
export const dynamic = 'force-dynamic';

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function AiPage({ searchParams }: { searchParams: SP }) {
  const user = await requireUser();
  const sp = await searchParams;
  const [status, list, sages] = await Promise.all([aiStatus(user.id), listConversations(user.id), prisma.sage.findMany({ where: { userId: user.id }, orderBy: { name: 'asc' }, select: { id: true, name: true } })]);
  const view = one(sp.c) ? await conversationView(user.id, one(sp.c)!) : null;
  const agent: AgentKind = (view?.agent as AgentKind) ?? (one(sp.agent) === 'SAGE' ? 'SAGE' : 'MANAGER');
  const sageId = view?.sage?.id ?? (agent === 'SAGE' ? (one(sp.sage) ?? null) : null);
  const sageName = sages.find((s) => s.id === sageId)?.name;
  const sageNames = Object.fromEntries(sages.map((s) => [s.id, s.name]));

  return (
    <>
      <header className="page-head">
        <div className="stack" style={{ gap: 6 }}>
          <h1>AI 어드바이저</h1>
          <p className="sub">내 포트폴리오·매매일지·투자 노트를 읽고 점검과 제안을 해 줍니다. 데이터를 바꾸는 일은 확인 카드에서 실행해야 반영됩니다.</p>
        </div>
        {status.configured && (
          <span className="sub">
            이번 달 약 ${status.spent.toFixed(2)}
            {status.monthlyLimit !== null ? ` / 한도 $${status.monthlyLimit.toFixed(2)}` : ''} · <a href="/settings#ai">설정</a>
          </span>
        )}
      </header>
      {!status.configured ? (
        <section className="card stack">
          <h2>API 키가 필요합니다</h2>
          <p>AI 어드바이저는 Anthropic의 Claude로 동작합니다. 연동 · 설정에서 API 키를 넣으면 바로 쓸 수 있습니다.</p>
          <a className="btn primary" href="/settings#ai" style={{ alignSelf: 'flex-start' }}>
            키 넣으러 가기
          </a>
        </section>
      ) : (
        <div className="ai-layout">
          <aside className="stack" style={{ gap: 12 }}>
            <nav className="stack ai-new" aria-label="새 대화">
              <span className="sub strong">새 대화</span>
              <a className="ai-agent" href="/ai" aria-current={!view && agent === 'MANAGER' ? 'true' : undefined}>
                <span className="strong">{AGENTS.MANAGER.name}</span>
                <span className="sub">포트폴리오 점검 · 리밸런싱 · 일지 복기 · 웹 리서치</span>
              </a>
              {sages.map((s) => (
                <a key={s.id} className="ai-agent" href={`/ai?agent=SAGE&sage=${s.id}`} aria-current={!view && sageId === s.id ? 'true' : undefined}>
                  <span className="strong">{s.name}의 관점</span>
                  <span className="sub">{AGENTS.SAGE.name}</span>
                </a>
              ))}
              {!sages.length && (
                <a className="sub" href="/sages">
                  투자 거장을 추가하면 그 관점으로 물어볼 수 있습니다 ›
                </a>
              )}
            </nav>
            <AiConversations items={list.map((c) => ({ id: c.id, title: c.title, who: c.agent === 'SAGE' ? `${sageNames[c.sageId ?? ''] ?? '거장'}의 관점` : AGENTS.MANAGER.name, at: c.updatedAt.toISOString() }))} current={view?.id ?? null} />
          </aside>
          <section className="card ai-main">
            <div className="spread">
              <h2>{view ? view.title : agent === 'SAGE' ? `${sageName ?? '투자 거장'}의 관점` : AGENTS.MANAGER.name}</h2>
              {view && <span className="badge">{view.agent === 'SAGE' ? `${view.sage?.name ?? '거장'}의 관점` : AGENTS.MANAGER.name}</span>}
            </div>
            <AiChat key={view?.id ?? `${agent}:${sageId}`} initial={view} agent={agent} sageId={sageId} path="/ai" urlOnStart />
          </section>
        </div>
      )}
    </>
  );
}
