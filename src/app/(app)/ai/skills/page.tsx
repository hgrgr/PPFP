import { CommunitySkills, MySkills } from '@/components/ai/skills';
import type { AgentKind } from '@/domain/ai';
import { requireUser } from '@/server/auth';
import { communityCatalog, listSkills } from '@/server/services/ai/skills';
import { UserError } from '@/server/services/portfolios';

export const metadata = { title: 'AI 스킬' };
export const dynamic = 'force-dynamic';

export default async function SkillsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const tab = (await searchParams).tab === 'community' ? 'community' : 'mine';
  const skills = await listSkills(user.id);
  let catalog: Awaited<ReturnType<typeof communityCatalog>> | null = null;
  let error: string | null = null;
  if (tab === 'community') {
    try {
      catalog = await communityCatalog();
    } catch (e) {
      error = e instanceof UserError ? e.message : '커뮤니티 스킬 목록을 받지 못했습니다. 잠시 후 다시 시도하세요.';
      if (!(e instanceof UserError)) console.error('[skills] catalog', e);
    }
  }
  const installed: Record<string, { agents: AgentKind[] }> = Object.fromEntries(skills.filter((s) => s.sourceId).map((s) => [s.sourceId!, { agents: s.agents }]));
  return (
    <>
      <header className="page-head">
        <div className="stack" style={{ gap: 6 }}>
          <nav className="crumbs" aria-label="경로">
            <a href="/ai">AI 어드바이저</a> › <span>스킬</span>
          </nav>
          <h1>AI 스킬</h1>
          <p className="sub">에이전트에게 나만의 분석 순서·체크리스트·투자 원칙을 가르칩니다. 에이전트는 질문이 스킬 설명에 맞을 때 그 지침을 읽고 따릅니다.</p>
        </div>
      </header>
      <nav className="seg" aria-label="스킬" style={{ alignSelf: 'flex-start' }}>
        <a href="/ai/skills" aria-current={tab === 'mine' ? 'true' : undefined}>
          내 스킬 {skills.length ? skills.length : ''}
        </a>
        <a href="/ai/skills?tab=community" aria-current={tab === 'community' ? 'true' : undefined}>
          커뮤니티 스킬
        </a>
      </nav>
      {tab === 'mine' ? <MySkills skills={skills} /> : catalog ? <CommunitySkills items={catalog.items} fetchedAt={catalog.fetchedAt} installed={installed} /> : <p className="msg err">{error}</p>}
    </>
  );
}
