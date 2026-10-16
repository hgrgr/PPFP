import { Basket, type BasketData } from '@/components/basket';
import { requireUser } from '@/server/auth';
import { prisma } from '@/server/db';
import { currentState } from '@/server/services/analytics';

export const metadata = { title: '바구니 담기' };
export const dynamic = 'force-dynamic';

export default async function BasketPage() {
  const user = await requireUser();
  const [state, accounts, virtual] = await Promise.all([
    currentState(user.id),
    prisma.portfolio.findMany({ where: { userId: user.id, kind: 'ACCOUNT', archived: false }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], select: { id: true, name: true, color: true } }),
    prisma.virtualPortfolio.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'asc' }, select: { id: true, name: true } }),
  ]);
  const ids = new Set(accounts.map((a) => a.id));
  const items = state.holdings
    .filter((h) => ids.has(h.portfolioId) && h.type !== 'LIABILITY' && h.valueFull.isPos())
    .map((h) => {
      const value = h.valueFull.toNumber();
      const cost = h.costFull.toNumber();
      return { id: h.holdingId, name: h.name, type: h.type, value, ret: cost > 0 ? value / cost - 1 : null, portfolioId: h.portfolioId };
    });
  // Portfolios that only group others (no holdings of their own) still show: a stock can be dropped there
  const data: BasketData = { baskets: accounts, virtual, items };
  return (
    <>
      <header className="page-head">
        <div className="stack" style={{ gap: 6 }}>
          <h1>바구니 담기 🧺</h1>
          <p className="sub">내 종목이 금액만큼 큰 물건이 되고, 포트폴리오는 바구니가 됩니다. 끌어서 담아 보세요.</p>
        </div>
        <div className="inline">
          <a className="btn" href="/portfolios">‹ 포트폴리오</a>
        </div>
      </header>
      <Basket data={data} />
    </>
  );
}
