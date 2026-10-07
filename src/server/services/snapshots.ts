/**
 * Daily snapshots: the value each portfolio holds directly, per business day,
 * in KRW. Rebuilt from the ledger + stored closes, so editing an old
 * transaction only requires re-running from that date.
 */
import type { Asset, Transaction } from '@prisma/client';
import { Dec } from '@/domain/decimal';
import { dailySeries, weekdays, type HoldingRef, type LedgerTxn } from '@/domain/ledger';
import { dbDate, dec, kstDate, kstIso, out, prisma } from '../db';

type Series = { date: string; v: Dec }[];

function lastOnOrBefore(series: Series | undefined, date: string): Dec | null {
  if (!series?.length) return null;
  let lo = 0, hi = series.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid].date <= date) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans < 0 ? null : series[ans].v;
}

export function toLedgerTxn(t: Transaction): LedgerTxn {
  return {
    id: t.id,
    type: t.type,
    tradeAt: kstIso(t.tradeAt),
    holdingId: t.holdingId,
    qty: t.qty ? dec(t.qty) : null,
    splitRatio: t.splitRatio ? dec(t.splitRatio) : null,
    currency: t.currency,
    cashDelta: dec(t.cashDelta),
    flow: dec(t.flow),
  };
}

export async function rebuildSnapshots(userId: string, fromDate?: string): Promise<{ portfolios: number; days: number }> {
  const today = kstDate();
  const portfolios = await prisma.portfolio.findMany({
    where: { userId },
    include: { holdings: { include: { asset: true } }, transactions: true },
  });
  const allTxns = portfolios.flatMap((p) => p.transactions);
  if (!allTxns.length) return { portfolios: 0, days: 0 };
  const firstDate = allTxns.map((t) => kstDate(t.tradeAt)).sort()[0];
  const start = fromDate && fromDate > firstDate ? fromDate : firstDate;
  const dates = weekdays(start, today);
  if (!dates.length || dates.at(-1) !== today) dates.push(today);

  const assets = new Map<string, Asset>();
  for (const p of portfolios) for (const h of p.holdings) assets.set(h.assetId, h.asset);
  const symbols = [...new Set([...assets.values()].filter((a) => a.symbol).map((a) => a.symbol!.toUpperCase()))];
  const lookback = dbDate(start);
  lookback.setUTCDate(lookback.getUTCDate() - 30);

  const [closes, fxRows, pricedTxns] = await Promise.all([
    prisma.priceDaily.findMany({ where: { symbol: { in: symbols }, date: { gte: lookback } }, orderBy: { date: 'asc' } }),
    prisma.fxDaily.findMany({ where: { pair: 'USDKRW' }, orderBy: { date: 'asc' } }),
    prisma.transaction.findMany({
      where: { portfolio: { userId }, price: { not: null }, type: { in: ['BUY', 'SELL', 'VALUATION'] } },
      include: { holding: { select: { assetId: true } } },
      orderBy: { tradeAt: 'asc' },
    }),
  ]);

  const closeBySymbol = new Map<string, Series>();
  for (const c of closes) {
    const s = closeBySymbol.get(c.symbol) ?? [];
    s.push({ date: kstDate(c.date), v: dec(c.close) });
    closeBySymbol.set(c.symbol, s);
  }
  const ledgerPriceByAsset = new Map<string, Series>();
  const fxFromTxns: Series = [];
  for (const t of pricedTxns) {
    if (!t.holding) continue;
    const s = ledgerPriceByAsset.get(t.holding.assetId) ?? [];
    s.push({ date: kstDate(t.tradeAt), v: dec(t.price) });
    ledgerPriceByAsset.set(t.holding.assetId, s);
    if (t.currency === 'USD') fxFromTxns.push({ date: kstDate(t.tradeAt), v: dec(t.fxRate) });
  }
  const fxStored: Series = fxRows.map((r) => ({ date: kstDate(r.date), v: dec(r.rate) }));
  const fallbackFx = Dec.of(process.env.FALLBACK_USDKRW ?? '1390');
  const fxOn = (ccy: string, date: string): Dec => {
    if (ccy === 'KRW') return Dec.ONE;
    return lastOnOrBefore(fxStored, date) ?? lastOnOrBefore(fxFromTxns, date) ?? fxStored[0]?.v ?? fxFromTxns[0]?.v ?? fallbackFx;
  };

  for (const p of portfolios) {
    if (!p.transactions.length) {
      await prisma.snapshot.deleteMany({ where: { portfolioId: p.id } });
      continue;
    }
    const pFirst = p.transactions.map((t) => kstDate(t.tradeAt)).sort()[0];
    const refs: HoldingRef[] = p.holdings.map((h) => {
      const a = h.asset;
      const sign = a.type === 'LIABILITY' ? -1 : 1;
      const closesS = a.symbol ? closeBySymbol.get(a.symbol.toUpperCase()) : undefined;
      const ledgerS = ledgerPriceByAsset.get(a.id);
      return {
        id: h.id,
        currency: a.currency,
        priceOn: (date) => {
          const v = (a.priceSource === 'BROKER' ? lastOnOrBefore(closesS, date) : null) ?? lastOnOrBefore(ledgerS, date);
          return v ? v.mul(sign) : null;
        },
      };
    });
    const series = dailySeries(dates, p.transactions.map(toLedgerTxn), refs, fxOn);
    await prisma.$transaction([
      prisma.snapshot.deleteMany({ where: { portfolioId: p.id, date: { gte: dbDate(start) } } }),
      prisma.snapshot.createMany({
        data: series
          .filter((pt) => pt.date >= pFirst)
          .map((pt) => ({
            portfolioId: p.id,
            date: dbDate(pt.date),
            value: out(pt.value.round(6)),
            flow: out(pt.flow.round(6)),
            cash: out(pt.cash.round(6)),
            holdings: Object.fromEntries([...pt.byHolding].map(([k, v]) => [k, v.round(2).toString()])),
          })),
      }),
    ]);
  }
  return { portfolios: portfolios.length, days: dates.length };
}
