import { Suspense } from 'react';
import { AskAiButton, AskAiSuggestions } from '@/components/ai/launcher';
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
      <AskAiSuggestions
        items={[
          { label: '어느 섹터가 강한가', prompt: '시장 개요의 섹터·스타일 화면을 보고 최근 1개월과 3개월 동안 어느 섹터와 스타일이 강하고 약했는지, 그 흐름이 경기 국면상 무엇을 뜻하는지 설명해 줘.' },
          { label: '금리 곡선이 말하는 것', prompt: '시장 개요의 국채 금리 화면을 보고 나라별 금리 곡선의 모양(평탄화·가팔라짐·역전)과 최근 변화가 경기와 주식시장에 주는 신호를 정리해 줘.' },
          { label: '내 종목 vs 시장', prompt: '기간 수익률 화면에서 내 보유·관심 종목이 S&P 500·코스피 같은 지수보다 잘했는지 못했는지 기간별로 비교하고, 눈에 띄는 종목을 짚어 줘.' },
          { label: '과열·과매도 종목', prompt: '기술적 순위에서 RSI 과매수·과매도와 200일선 위 비율을 보고 지금 시장의 폭(breadth)과 과열 정도를 해석해 줘.' },
        ]}
      />
      <Suspense fallback={<p className="empty">불러오는 중…</p>}>
        <MarketOverview />
      </Suspense>
    </>
  );
}
