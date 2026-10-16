import { Suspense } from 'react';
import { AskAiButton, AskAiSuggestions } from '@/components/ai/launcher';
import { StockAnalysis } from '@/components/stock-analysis';
import { requireUser } from '@/server/auth';
import { prisma } from '@/server/db';

export const metadata = { title: '종목 분석' };
export const dynamic = 'force-dynamic';

export default async function StocksPage() {
  const user = await requireUser();
  // The user's US stocks first among the quick picks
  const held = await prisma.asset.findMany({
    where: { currency: 'USD', symbol: { not: null }, holdings: { some: { portfolio: { userId: user.id }, lots: { some: { qtyRemaining: { gt: 0 } } } } } },
    select: { symbol: true, name: true },
    take: 12,
  });
  const quick = held.filter((a) => /^[A-Z][A-Z.\-]{0,9}$/.test(a.symbol!)).map((a) => ({ ticker: a.symbol!, name: a.name }));
  return (
    <>
      <header className="page-head">
        <div className="stack" style={{ gap: 6 }}>
          <h1>종목 분석</h1>
          <p className="sub">미국 상장 종목의 재무제표, 같은 산업 종목과의 밸류에이션 비교, 임원·대주주 매매(Form 4), DCF·역DCF·DDM·RIM 적정가 계산을 SEC 공시 자료로 봅니다.</p>
        </div>
        <div className="inline">
          <AskAiButton label="AI 종목 해석" agent="EARNINGS" prompt="종목 분석 화면에서 보고 있는 종목의 실적 흐름, 동종 대비 밸류에이션, 내부자 매매, 적정가 계산 결과를 종합해 해석해 줘. 가정이 무리한 부분이 있으면 짚어 줘." />
        </div>
      </header>
      <AskAiSuggestions
        items={[
          { label: '실적 흐름 요약', prompt: '종목 분석 화면에서 보고 있는 종목의 최근 연간·분기 실적과 이익률 흐름을 요약하고 좋아지거나 나빠지는 점을 짚어 줘.', agent: 'EARNINGS' },
          { label: '비싼가 싼가', prompt: '동종 비교에서 이 종목의 PER·PSR·EV/EBIT·FCF 수익률을 같은 산업 중앙값과 비교해 비싼지 싼지, 그 차이를 정당화할 근거가 있는지 알려 줘.', agent: 'EARNINGS' },
          { label: '적정가 가정 점검', prompt: '적정가 계산 화면의 입력(성장률·할인율·영구 성장률)이 이 회사에 현실적인지 점검하고, 보수적·낙관적 시나리오 값을 제안해 줘.', agent: 'EARNINGS' },
          { label: '내부자 매매 의미', prompt: '내부자 거래 화면의 최근 장내 매수·매도를 보고 의미 있는 신호인지(정기 매도·세금 처분과 구분해) 해석해 줘.', agent: 'EARNINGS' },
        ]}
      />
      <Suspense fallback={<p className="empty">불러오는 중…</p>}>
        <StockAnalysis quick={quick.length ? quick : [{ ticker: 'AAPL', name: 'Apple' }, { ticker: 'MSFT', name: 'Microsoft' }, { ticker: 'NVDA', name: 'NVIDIA' }, { ticker: 'BRK.B', name: 'Berkshire Hathaway' }]} />
      </Suspense>
    </>
  );
}
