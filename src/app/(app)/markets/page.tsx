import { Suspense } from 'react';
import { AskAiButton } from '@/components/ai/launcher';
import { MarketOverview } from '@/components/market-overview';
import { requireUser } from '@/server/auth';

export const metadata = { title: '시장 개요' };
export const dynamic = 'force-dynamic';

export default async function MarketsPage() {
  await requireUser();
  return (
    <>
      <header className="page-head">
        <div className="stack" style={{ gap: 6 }}>
          <h1>시장 개요</h1>
          <p className="sub">미국 섹터와 스타일의 기간 수익률, S&P 500 종목 지도, 나라별 국채 금리와 금리 곡선, 내 종목과 주요 지표의 기간 수익률을 한 화면에서 봅니다. 증권사 연동 없이 공개 시세로 그립니다.</p>
        </div>
        <div className="inline">
          <AskAiButton label="AI 시장 해석" prompt="시장 개요 화면을 보고 지금 시장을 해석해 줘. 어느 섹터와 스타일(대형·소형, 가치·성장)이 강하고 약한지, 금리 곡선과 나라별 금리 움직임이 무엇을 말하는지, 내 보유·관심 종목이 시장 대비 어떤지 정리해 줘." />
        </div>
      </header>
      <Suspense fallback={<p className="empty">불러오는 중…</p>}>
        <MarketOverview />
      </Suspense>
    </>
  );
}
