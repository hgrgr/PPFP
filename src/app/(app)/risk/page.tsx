import { Suspense } from 'react';
import { AskAiButton, AskAiSuggestions } from '@/components/ai/launcher';
import { Risk } from '@/components/risk';
import { requireUser } from '@/server/auth';

export const metadata = { title: '리스크 분석' };
export const dynamic = 'force-dynamic';

export default async function RiskPage() {
  await requireUser();
  return (
    <>
      <header className="page-head">
        <div className="stack" style={{ gap: 6 }}>
          <h1>리스크 분석</h1>
          <p className="sub">지금 포트폴리오가 얼마나 흔들리는지, 어떤 종목이 그 흔들림을 만드는지, 어떤 요인(시장·환율·스타일·금리·금)에 기대고 있는지 봅니다.</p>
        </div>
        <div className="inline">
          <AskAiButton label="AI 리스크 점검" prompt="리스크 분석 화면을 보고 내 포트폴리오의 위험을 점검해 줘. 변동성·최대 낙폭·VaR를 코스피·S&P 500과 비교하고, 위험 기여가 비중보다 큰 종목, 요인 노출의 쏠림, 상관관계가 높은 종목 묶음을 짚은 뒤 위험을 줄일 방법을 제안해 줘." />
        </div>
      </header>
      <AskAiSuggestions
        items={[
          { label: '위험을 키우는 종목', prompt: '리스크 분석의 비중 vs 위험 기여에서 비중보다 위험 기여가 큰 종목을 짚고, 비중을 어떻게 조정하면 변동성이 얼마나 줄지 알려 줘.' },
          { label: '환율에 얼마나 기대나', prompt: '요인 노출에서 원/달러 계수를 보고 환율이 10% 움직일 때 내 포트폴리오가 대략 얼마나 움직이는지, 환 위험을 줄일지 설명해 줘.' },
          { label: '분산이 잘 되어 있나', prompt: '종목 간 상관관계를 보고 사실상 같은 방향으로 움직이는 종목 묶음과 분산 효과를 평가해 줘.' },
        ]}
      />
      <Suspense fallback={<p className="empty">불러오는 중…</p>}>
        <Risk />
      </Suspense>
    </>
  );
}
