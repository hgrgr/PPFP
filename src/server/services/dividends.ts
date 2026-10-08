/** Dividend history with the shares held on each payment day, and the forecast built from it. */
import { byAsset, cashflow, forecast, type HeldAsset, type Payment } from '@/domain/dividends';
import { dec, kstDate, prisma } from '../db';
import { currentState } from './analytics';

export async function dividendReport(userId: string) {
  const today = kstDate();
  const since = new Date(Date.now() - 2 * 365 * 86_400_000);
  const [tx, state] = await Promise.all([
    prisma.transaction.findMany({
      where: { portfolio: { userId }, type: 'DIVIDEND', holdingId: { not: null }, tradeAt: { gte: since } },
      include: {
        holding: {
          include: {
            asset: { select: { id: true, name: true } },
            lots: { select: { acquiredAt: true, qtyOriginal: true, consumptions: { select: { qty: true, txn: { select: { tradeAt: true } } } } } },
          },
        },
      },
      orderBy: { tradeAt: 'asc' },
    }),
    currentState(userId),
  ]);
  // Shares held when each dividend was paid: lots bought by then, less what was sold by then
  const history: Payment[] = tx.map((t) => {
    let qty = 0;
    for (const l of t.holding!.lots) {
      if (l.acquiredAt > t.tradeAt) continue;
      qty += Number(l.qtyOriginal);
      for (const c of l.consumptions) if (c.txn.tradeAt <= t.tradeAt) qty -= Number(c.qty);
    }
    const amount = Number(t.cashDelta);
    return { assetId: t.holding!.asset.id, date: kstDate(t.tradeAt), amount, qty, krw: dec(t.cashDelta).mul(dec(t.fxRate, dec(1))).toNumber() };
  });
  const names = new Map(tx.map((t) => [t.holding!.asset.id, t.holding!.asset.name]));
  const heldMap = new Map<string, HeldAsset>();
  for (const h of state.holdings) {
    const a = heldMap.get(h.assetId) ?? { assetId: h.assetId, name: h.name, symbol: h.symbol, currency: h.currency, qty: 0, fx: h.currency === 'KRW' ? 1 : state.usdkrw.toNumber(), valueKrw: 0 };
    a.qty += h.qty.toNumber();
    a.valueKrw += h.valueFull.toNumber();
    heldMap.set(h.assetId, a);
  }
  const held = [...heldMap.values()];
  const projected = forecast(today, held, history);
  const flow = cashflow(today, history, projected);
  const rows = byAsset(today, held, history, projected);
  const totalValue = held.reduce((s, a) => s + Math.max(0, a.valueKrw), 0);
  const trailing = flow.filter((m) => m.month <= today.slice(0, 7)).reduce((s, m) => s + m.received, 0);
  const next = projected.reduce((s, p) => s + p.krw, 0);
  return {
    today,
    projected,
    flow,
    rows,
    // Payers that stopped (sold out) still show in the history
    pastOnly: [...names.entries()].filter(([id]) => !heldMap.has(id)).map(([, n]) => n),
    totals: { trailingKrw: Math.round(trailing), nextKrw: Math.round(next), monthlyKrw: Math.round(next / 12), yieldPct: totalValue > 0 ? Math.round((next / totalValue) * 10000) / 100 : null },
  };
}

export type DividendReport = Awaited<ReturnType<typeof dividendReport>>;
