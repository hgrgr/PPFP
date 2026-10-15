import { Suspense } from 'react';
import { AskAiButton } from '@/components/ai/launcher';
import { Macro } from '@/components/macro';
import { requireUser } from '@/server/auth';

export const metadata = { title: '글로벌 매크로' };
export const dynamic = 'force-dynamic';

export default async function MacroPage() {
  await requireUser();
  return (
    <>
      <header className="page-head">
        <div className="stack" style={{ gap: 6 }}>
          <h1>글로벌 매크로</h1>
          <p className="sub">나라별 경기선행지수와 경제 지표, 미국 경기 국면 히트맵, 섹터 순환, 선물 시장의 투기적 포지션, GDP 성장 기여도를 봅니다. 시간에 따른 변화는 ▶로 재생합니다.</p>
        </div>
        <div className="inline">
          <AskAiButton label="AI 매크로 해석" prompt="글로벌 매크로 화면을 보고 지금 세계 경기와 시장 흐름을 해석해 줘. 나라별 경기 국면, 미국 경기 지표의 방향, 섹터 순환에서 주도·소외 섹터, 선물 포지션의 쏠림, GDP를 끌어올리거나 깎은 항목을 정리하고 내 포트폴리오에 주는 시사점을 알려 줘." />
        </div>
      </header>
      <Suspense fallback={<p className="empty">불러오는 중…</p>}>
        <Macro />
      </Suspense>
    </>
  );
}
