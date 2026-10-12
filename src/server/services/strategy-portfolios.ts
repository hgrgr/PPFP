/**
 * Strategy portfolios: shares of account holdings (StrategyMember). Accounts keep the shares,
 * cash and trades; a strategy only weighs them, so net worth never counts a stock twice.
 */
import { Dec } from '@/domain/decimal';
import { checkShare, overlapInfo, strategySeries, type HoldingDay, type MemberTrade, type Membership, type OverlapInfo } from '@/domain/strategy-portfolios';
import type { SeriesPoint } from '@/domain/performance';
import { dbDate, dec, kstDate, prisma } from '../db';
import { audit, UserError } from './portfolios';

export async function ownedStrategy(userId: string, id: string) {
  const p = await prisma.portfolio.findFirst({ where: { id, userId } });
  if (!p) throw new UserError('포트폴리오를 찾을 수 없습니다.');
  if (p.kind !== 'STRATEGY') throw new UserError('전략 포트폴리오가 아닙니다.');
  return p;
}

/** holdingId -> the strategies that take it */
export async function membershipsByHolding(userId: string): Promise<Map<string, OverlapInfo>> {
  const rows = await prisma.strategyMember.findMany({
    where: { portfolio: { userId, archived: false } },
    include: { portfolio: { select: { id: true, name: true, allowOverlap: true } } },
  });
  const by = new Map<string, Membership[]>();
  for (const r of rows) {
    const list = by.get(r.holdingId) ?? [];
    list.push({ strategyId: r.portfolioId, name: r.portfolio.name, share: dec(r.share), allowOverlap: r.portfolio.allowOverlap });
    by.set(r.holdingId, list);
  }
  return new Map([...by].map(([hid, list]) => [hid, overlapInfo(list)]));
}

/** A strategy's shares: holdingId -> fraction */
export async function strategyShares(strategyId: string): Promise<Map<string, Dec>> {
  const rows = await prisma.strategyMember.findMany({ where: { portfolioId: strategyId } });
  return new Map(rows.map((r) => [r.holdingId, dec(r.share)]));
}

export interface MemberCandidate {
  holdingId: string;
  assetId: string;
  name: string;
  symbol: string | null;
  account: string;
  /** This strategy's share now, if any */
  share: Dec | null;
  /** What other strategies take */
  others: OverlapInfo | null;
}

/** Account holdings a strategy can take (liabilities excluded), with what is taken already. */
export async function memberCandidates(userId: string, strategyId: string): Promise<MemberCandidate[]> {
  const [holdings, members] = await Promise.all([
    prisma.holding.findMany({
      where: { portfolio: { userId, kind: 'ACCOUNT', archived: false }, asset: { type: { not: 'LIABILITY' } }, lots: { some: { qtyRemaining: { gt: 0 } } } },
      include: { asset: { select: { name: true, symbol: true } }, portfolio: { select: { name: true } } },
    }),
    membershipsByHolding(userId),
  ]);
  return holdings
    .map((h) => {
      const info = members.get(h.id);
      const mine = info?.strategies.find((s) => s.strategyId === strategyId);
      const rest = info ? info.strategies.filter((s) => s.strategyId !== strategyId) : [];
      return {
        holdingId: h.id,
        assetId: h.assetId,
        name: h.asset.name,
        symbol: h.asset.symbol,
        account: h.portfolio.name,
        share: mine?.share ?? null,
        others: rest.length ? overlapInfo(rest) : null,
      };
    })
    .sort((a, b) => Number(!!b.share) - Number(!!a.share) || a.name.localeCompare(b.name) || a.account.localeCompare(b.account));
}

/** Puts a share (percent text, "60") of an account holding into a strategy, or changes it. */
export async function setMember(userId: string, strategyId: string, holdingId: string, percent: string) {
  const strategy = await ownedStrategy(userId, strategyId);
  const n = Number(percent.replace(/[%\s,]/g, ''));
  if (!Number.isFinite(n)) throw new UserError('담을 비율을 숫자(%)로 넣으세요.');
  const share = Dec.of(n.toString()).div(100);
  await prisma.$transaction(async (tx) => {
    // One check at a time per user, so two strategies cannot split past 100% together
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${'strategy:' + userId}))::text`;
    const holding = await tx.holding.findFirst({ where: { id: holdingId, portfolio: { userId, kind: 'ACCOUNT' } }, include: { asset: { select: { type: true } } } });
    if (!holding) throw new UserError('계좌 포트폴리오의 종목을 고르세요.');
    if (holding.asset.type === 'LIABILITY') throw new UserError('부채는 전략에 담지 않습니다.');
    const others = await tx.strategyMember.findMany({ where: { holdingId }, include: { portfolio: { select: { allowOverlap: true } } } });
    const check = checkShare(
      others.map((o) => ({ strategyId: o.portfolioId, share: dec(o.share), allowOverlap: o.portfolio.allowOverlap })),
      { id: strategy.id, allowOverlap: strategy.allowOverlap },
      share,
    );
    if (!check.ok) throw new UserError(check.message);
    await tx.strategyMember.upsert({
      where: { portfolioId_holdingId: { portfolioId: strategy.id, holdingId } },
      create: { portfolioId: strategy.id, holdingId, share: share.toString() },
      update: { share: share.toString() },
    });
    await audit(tx, userId, 'strategy_member', `${strategy.id}>${holdingId}`, 'set', undefined, { share: share.toString() });
  });
}

export async function removeMember(userId: string, strategyId: string, holdingId: string) {
  await ownedStrategy(userId, strategyId);
  const r = await prisma.strategyMember.deleteMany({ where: { portfolioId: strategyId, holdingId } });
  if (!r.count) throw new UserError('담긴 종목이 아닙니다.');
  await audit(prisma, userId, 'strategy_member', `${strategyId}>${holdingId}`, 'delete');
}

/** Turning overlap off is refused while it would leave a holding split past 100%. */
export async function setAllowOverlap(userId: string, strategyId: string, allow: boolean) {
  const strategy = await ownedStrategy(userId, strategyId);
  if (!allow && strategy.allowOverlap) {
    const mine = await prisma.strategyMember.findMany({ where: { portfolioId: strategyId } });
    for (const m of mine) {
      const others = await prisma.strategyMember.findMany({ where: { holdingId: m.holdingId, portfolioId: { not: strategyId } }, include: { portfolio: { select: { allowOverlap: true } } } });
      const check = checkShare(
        others.map((o) => ({ strategyId: o.portfolioId, share: dec(o.share), allowOverlap: o.portfolio.allowOverlap })),
        { id: strategyId, allowOverlap: false },
        dec(m.share),
      );
      if (!check.ok) throw new UserError(`겹쳐 담은 종목이 있어 끌 수 없습니다. 먼저 비율을 줄이세요: ${check.message}`);
    }
  }
  await prisma.portfolio.update({ where: { id: strategyId }, data: { allowOverlap: allow } });
}

/** The strategy's daily series up to `to`, from its accounts' snapshots and trades. */
export async function strategyDailySeries(shares: Map<string, Dec>, to: string): Promise<{ series: SeriesPoint[]; days: HoldingDay[] }> {
  const holdingIds = [...shares.keys()];
  if (!holdingIds.length) return { series: [], days: [] };
  const holdings = await prisma.holding.findMany({ where: { id: { in: holdingIds } }, select: { portfolioId: true } });
  const accounts = [...new Set(holdings.map((h) => h.portfolioId))];
  const [snaps, txns] = await Promise.all([
    prisma.snapshot.findMany({ where: { portfolioId: { in: accounts }, date: { lte: dbDate(to) } }, orderBy: { date: 'asc' }, select: { date: true, holdings: true } }),
    prisma.transaction.findMany({ where: { holdingId: { in: holdingIds }, type: { in: ['BUY', 'SELL'] } }, select: { tradeAt: true, holdingId: true, type: true, qty: true, price: true, fee: true, tax: true, fxRate: true } }),
  ]);
  const days: HoldingDay[] = snaps.map((s) => ({ date: kstDate(s.date), holdings: (s.holdings ?? {}) as Record<string, string> }));
  const trades: MemberTrade[] = txns.map((t) => ({
    date: kstDate(t.tradeAt),
    holdingId: t.holdingId!,
    type: t.type as 'BUY' | 'SELL',
    qty: dec(t.qty),
    price: dec(t.price),
    fee: dec(t.fee),
    tax: dec(t.tax),
    fxRate: dec(t.fxRate, Dec.ONE),
  }));
  return { series: strategySeries(days, trades, shares), days };
}

/** Today's buys and sales of member holdings, as the strategy's flow (KRW) */
export async function strategyTodaysFlow(shares: Map<string, Dec>, today: string): Promise<Dec> {
  if (!shares.size) return Dec.ZERO;
  const txns = await prisma.transaction.findMany({
    where: { holdingId: { in: [...shares.keys()] }, type: { in: ['BUY', 'SELL'] }, tradeAt: { gte: new Date(Date.parse(today + 'T00:00:00+09:00')) } },
    select: { tradeAt: true, holdingId: true, type: true, qty: true, price: true, fee: true, tax: true, fxRate: true },
  });
  const series = strategySeries(
    [{ date: today, holdings: {} }],
    txns.map((t) => ({ date: today, holdingId: t.holdingId!, type: t.type as 'BUY' | 'SELL', qty: dec(t.qty), price: dec(t.price), fee: dec(t.fee), tax: dec(t.tax), fxRate: dec(t.fxRate, Dec.ONE) })),
    shares,
  );
  return series[0]?.flow ?? Dec.ZERO;
}
