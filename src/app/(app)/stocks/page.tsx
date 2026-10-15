import { Suspense } from 'react';
import { AskAiButton } from '@/components/ai/launcher';
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
      <Suspense fallback={<p className="empty">불러오는 중…</p>}>
        <StockAnalysis quick={quick.length ? quick : [{ ticker: 'AAPL', name: 'Apple' }, { ticker: 'MSFT', name: 'Microsoft' }, { ticker: 'NVDA', name: 'NVIDIA' }, { ticker: 'BRK.B', name: 'Berkshire Hathaway' }]} />
      </Suspense>
    </>
  );
}
