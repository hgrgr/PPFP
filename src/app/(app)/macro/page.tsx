import { Suspense } from 'react';
import { AskAiButton, AskAiSuggestions } from '@/components/ai/launcher';
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
      <AskAiSuggestions
        items={[
          { label: '세계 경기는 어디쯤', prompt: '글로벌 매크로의 국가 비교와 경기 시계를 보고 주요국이 확장·둔화·수축·회복 중 어디에 있는지, 한국은 어떤지 정리해 줘.' },
          { label: '미국 경기 침체 신호', prompt: '미국 경기 국면 히트맵과 좋아지는 지표 비율을 보고 침체 신호가 커지는지 줄어드는지 근거와 함께 알려 줘.' },
          { label: '선물 시장의 쏠림', prompt: '선물 포지션 화면에서 3년 위치가 극단(10% 아래, 90% 위)에 있는 계약을 짚고 반대 방향 위험을 설명해 줘.' },
          { label: '주도 섹터 교체', prompt: '섹터 순환 그래프에서 최근 개선·주도로 옮겨 간 섹터와 약화·소외로 밀린 섹터를 정리하고 내 포트폴리오에 주는 시사점을 알려 줘.' },
        ]}
      />
      <Suspense fallback={<p className="empty">불러오는 중…</p>}>
        <Macro />
      </Suspense>
    </>
  );
}
