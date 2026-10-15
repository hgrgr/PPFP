import { Suspense } from 'react';
import { AskAiButton, AskAiSuggestions } from '@/components/ai/launcher';
import { Gurus } from '@/components/gurus';
import { requireUser } from '@/server/auth';

export const metadata = { title: '거장 포트폴리오' };
export const dynamic = 'force-dynamic';

export default async function GurusPage() {
  await requireUser();
  return (
    <>
      <header className="page-head">
        <div className="stack" style={{ gap: 6 }}>
          <h1>거장 포트폴리오</h1>
          <p className="sub">버핏·달리오·애크먼 등 이름난 운용자 40여 명이 SEC에 분기마다 내는 13F 보고서로 무엇을 들고, 사고, 팔았는지 봅니다. 여럿이 함께 산 종목, 공통 보유 종목, 내 포트폴리오와 닮은 거장도 찾습니다.</p>
        </div>
        <div className="inline">
          <AskAiButton label="AI 거장 동향 해석" prompt="거장 포트폴리오 화면을 보고 이번 분기 거장들의 매매를 해석해 줘. 여러 거장이 함께 사거나 판 종목과 그 이유로 짐작되는 것, 공통 보유 종목의 특징, 내 포트폴리오와 비슷한 거장이 누구인지와 시사점을 정리해 줘." />
        </div>
      </header>
      <AskAiSuggestions
        items={[
          { label: '이번 분기 공통 매매', prompt: '거장 포트폴리오에서 이번 분기에 여러 거장이 함께 산 종목과 판 종목을 보고, 공통된 테마나 이유로 짐작되는 것을 정리해 줘.' },
          { label: '나와 닮은 거장에게 배울 점', prompt: '나와 비슷한 거장 목록에서 겹침이 가장 큰 거장의 포트폴리오와 내 포트폴리오를 비교해 차이와 배울 점을 알려 줘.' },
          { label: '버핏은 무엇을 바꿨나', prompt: '워런 버핏(버크셔 해서웨이)의 최근 13F에서 새로 사거나 늘리거나 줄인 종목과 그 의미를 설명해 줘.' },
        ]}
      />
      <Suspense fallback={<p className="empty">불러오는 중…</p>}>
        <Gurus />
      </Suspense>
    </>
  );
}
