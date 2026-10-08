/** Inputs for the tax estimate (domain/tax.ts) from the user's sales, income and open lots. */
import { bucketOf, taxYear, type IncomeRow, type OpenRow, type RealizedRow } from '@/domain/tax';
import { dec, kstDate, prisma } from '../db';
import { currentState } from './analytics';

const yearRange = (year: number) => ({ gte: new Date(`${year}-01-01T00:00:00+09:00`), lt: new Date(`${year + 1}-01-01T00:00:00+09:00`) });

/** Years with sales or income, newest first, always including this year. */
export async function taxYears(userId: string): Promise<number[]> {
  const rows = await prisma.transaction.findMany({ where: { portfolio: { userId }, type: { in: ['SELL', 'DIVIDEND', 'INTEREST'] } }, select: { tradeAt: true } });
  const now = Number(kstDate().slice(0, 4));
  return [...new Set([now, ...rows.map((r) => Number(kstDate(r.tradeAt).slice(0, 4)))])].sort((a, b) => b - a);
}

export async function taxReport(userId: string, year: number) {
  const range = yearRange(year);
  const [sells, incomeTx] = await Promise.all([
    prisma.transaction.findMany({
      where: { portfolio: { userId }, type: 'SELL', tradeAt: range },
      include: { consumptions: { select: { pnlBase: true } }, holding: { include: { asset: { select: { name: true, type: true, currency: true } } } } },
      orderBy: { tradeAt: 'asc' },
    }),
    prisma.transaction.findMany({
      where: { portfolio: { userId }, type: { in: ['DIVIDEND', 'INTEREST'] }, tradeAt: range },
      include: { holding: { include: { asset: { select: { name: true } } } } },
      orderBy: { tradeAt: 'asc' },
    }),
  ]);
  const realized: RealizedRow[] = sells
    .filter((t) => t.holding && t.consumptions.length)
    .map((t) => ({
      date: kstDate(t.tradeAt),
      asset: t.holding!.asset.name,
      bucket: bucketOf(t.holding!.asset.type, t.holding!.asset.currency),
      pnlKrw: t.consumptions.reduce((s, c) => s + Number(c.pnlBase), 0),
    }));
  const income: IncomeRow[] = incomeTx.map((t) => ({
    date: kstDate(t.tradeAt),
    asset: t.holding?.asset.name ?? null,
    kind: t.type === 'DIVIDEND' ? 'DIVIDEND' : 'INTEREST',
    amountKrw: dec(t.cashDelta).mul(dec(t.fxRate, dec(1))).toNumber(),
  }));

  // Suggestions only make sense for the year still open
  let open: OpenRow[] | null = null;
  if (year === Number(kstDate().slice(0, 4))) {
    const state = await currentState(userId);
    const byAsset = new Map<string, OpenRow>();
    for (const h of state.holdings) {
      const b = bucketOf(h.type, h.currency);
      const row = byAsset.get(h.assetId) ?? { assetId: h.assetId, asset: h.name, symbol: h.symbol, bucket: b, valueKrw: 0, unrealizedKrw: 0 };
      row.valueKrw += h.valueFull.toNumber();
      row.unrealizedKrw += h.valueFull.sub(h.costFull).toNumber();
      byAsset.set(h.assetId, row);
    }
    open = [...byAsset.values()];
  }
  return { ...taxYear(year, realized, income, open), realized, income };
}

export type TaxReport = Awaited<ReturnType<typeof taxReport>>;
