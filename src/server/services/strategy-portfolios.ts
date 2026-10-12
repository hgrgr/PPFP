/**
 * Strategy portfolios: shares of account holdings (StrategyMember) and of whole accounts
 * (StrategyAccount). Accounts keep the shares, cash and trades; a strategy only weighs them,
 * so net worth never counts a stock twice.
 */
import type { Prisma } from '@prisma/client';
import { Dec } from '@/domain/decimal';
import { normalizeEdges } from '@/domain/portfolio-graph';
import {
  accountWeights,
  effectiveShares,
  overlapInfo,
  shareBreach,
  strategySeries,
  type HoldingDay,
  type MemberTrade,
  type Membership,
  type OverlapInfo,
  type StrategyShares,
} from '@/domain/strategy-portfolios';
import type { SeriesPoint } from '@/domain/performance';
import { dbDate, dec, kstDate, prisma } from '../db';
import { audit, UserError } from './portfolios';

export async function ownedStrategy(userId: string, id: string) {
  const p = await prisma.portfolio.findFirst({ where: { id, userId } });
  if (!p) throw new UserError('포트폴리오를 찾을 수 없습니다.');
  if (p.kind !== 'STRATEGY') throw new UserError('전략 포트폴리오가 아닙니다.');
  return p;
}

type Db = Prisma.TransactionClient | typeof prisma;

export interface StrategyState extends StrategyShares {
  /** holdingId -> share taken directly */
  direct: Map<string, Dec>;
  /** accountId -> share of the whole account */
  accounts: Map<string, Dec>;
  /** portfolioId -> weight through those accounts (cash and holdings) */
  viaAccounts: Map<string, Dec>;
}

/** Every strategy of the user with its direct, account and effective shares. */
export async function strategyStates(userId: string, db: Db = prisma, opts: { archived?: boolean } = {}): Promise<StrategyState[]> {
  const [strategies, holdings, edges] = await Promise.all([
    db.portfolio.findMany({
      where: { userId, kind: 'STRATEGY', ...(opts.archived ? {} : { archived: false }) },
      select: { id: true, name: true, allowOverlap: true, members: true, accountMembers: true },
    }),
    db.holding.findMany({ where: { portfolio: { userId, kind: 'ACCOUNT' } }, select: { id: true, portfolioId: true } }),
    db.portfolioEdge.findMany({ where: { parent: { userId, kind: 'ACCOUNT' } } }),
  ]);
  const graph = normalizeEdges(edges.map((e) => ({ parentId: e.parentId, childId: e.childId, allocation: e.allocation.toString() })));
  return strategies.map((p) => {
    const direct = new Map(p.members.map((m) => [m.holdingId, dec(m.share)]));
    const accounts = new Map(p.accountMembers.map((m) => [m.accountId, dec(m.share)]));
    const viaAccounts = accountWeights(accounts, graph);
    return { id: p.id, name: p.name, allowOverlap: p.allowOverlap, direct, accounts, viaAccounts, shares: effectiveShares(direct, viaAccounts, holdings) };
  });
}

/** holdingId -> the strategies that take it, directly or through an account */
export async function membershipsByHolding(userId: string): Promise<Map<string, OverlapInfo>> {
  const by = new Map<string, Membership[]>();
  for (const st of await strategyStates(userId)) {
    for (const [hid, share] of st.shares) {
      const list = by.get(hid) ?? [];
      list.push({ strategyId: st.id, name: st.name, share, allowOverlap: st.allowOverlap });
      by.set(hid, list);
    }
  }
  return new Map([...by].map(([hid, list]) => [hid, overlapInfo(list)]));
}

/** One strategy's weights: direct holding shares, and portfolio weights through its accounts */
export async function strategyScope(userId: string, strategyId: string): Promise<{ direct: Map<string, Dec>; viaAccounts: Map<string, Dec> }> {
  const st = (await strategyStates(userId, prisma, { archived: true })).find((x) => x.id === strategyId);
  return { direct: st?.direct ?? new Map(), viaAccounts: st?.viaAccounts ?? new Map() };
}

/** Throws when the change just written to `strategyId` takes more than 100% somewhere (the transaction rolls back). */
async function assertShares(tx: Prisma.TransactionClient, userId: string, strategyId: string) {
  const states = await strategyStates(userId, tx, { archived: true });
  const ids = [...new Set(states.flatMap((s) => [...s.shares.keys()]))];
  const names = new Map((await tx.holding.findMany({ where: { id: { in: ids } }, select: { id: true, asset: { select: { name: true } }, portfolio: { select: { name: true } } } })).map((h) => [h.id, `${h.asset.name} (${h.portfolio.name})`]));
  const breach = shareBreach(states, strategyId, (hid) => names.get(hid) ?? '종목');
  if (breach) throw new UserError(breach);
}

export interface MemberCandidate {
  holdingId: string;
  assetId: string;
  name: string;
  symbol: string | null;
  account: string;
  /** This strategy's effective share now, if any */
  share: Dec | null;
  /** The part of it taken directly (editable here) */
  direct: Dec | null;
  /** The part that comes through whole accounts */
  viaAccount: Dec | null;
  /** What other strategies take */
  others: OverlapInfo | null;
}

/** Account holdings a strategy can take (liabilities excluded), with what is taken already. */
export async function memberCandidates(userId: string, strategyId: string): Promise<MemberCandidate[]> {
  const [holdings, members, states] = await Promise.all([
    prisma.holding.findMany({
      where: { portfolio: { userId, kind: 'ACCOUNT', archived: false }, asset: { type: { not: 'LIABILITY' } }, lots: { some: { qtyRemaining: { gt: 0 } } } },
      include: { asset: { select: { name: true, symbol: true } }, portfolio: { select: { name: true } } },
    }),
    membershipsByHolding(userId),
    strategyStates(userId, prisma, { archived: true }),
  ]);
  const self = states.find((x) => x.id === strategyId);
  return holdings
    .map((h) => {
      const info = members.get(h.id);
      const rest = info ? info.strategies.filter((s) => s.strategyId !== strategyId) : [];
      const via = self?.viaAccounts.get(h.portfolioId);
      return {
        holdingId: h.id,
        assetId: h.assetId,
        name: h.asset.name,
        symbol: h.asset.symbol,
        account: h.portfolio.name,
        share: self?.shares.get(h.id) ?? null,
        direct: self?.direct.get(h.id) ?? null,
        viaAccount: via?.isPos() ? via : null,
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
    if (!share.isPos() || share.gt(Dec.ONE)) throw new UserError('담을 비율은 0%보다 크고 100% 이하로 정하세요.');
    await tx.strategyMember.upsert({
      where: { portfolioId_holdingId: { portfolioId: strategy.id, holdingId } },
      create: { portfolioId: strategy.id, holdingId, share: share.toString() },
      update: { share: share.toString() },
    });
    await assertShares(tx, userId, strategy.id);
    await audit(tx, userId, 'strategy_member', `${strategy.id}>${holdingId}`, 'set', undefined, { share: share.toString() });
  });
}

export async function removeMember(userId: string, strategyId: string, holdingId: string) {
  await ownedStrategy(userId, strategyId);
  const r = await prisma.strategyMember.deleteMany({ where: { portfolioId: strategyId, holdingId } });
  if (!r.count) throw new UserError('담긴 종목이 아닙니다.');
  await audit(prisma, userId, 'strategy_member', `${strategyId}>${holdingId}`, 'delete');
}

/** Puts a share (percent text) of a whole account portfolio into a strategy, or changes it. */
export async function setAccount(userId: string, strategyId: string, accountId: string, percent: string) {
  const strategy = await ownedStrategy(userId, strategyId);
  const n = Number(percent.replace(/[%\s,]/g, ''));
  if (!Number.isFinite(n)) throw new UserError('담을 비율을 숫자(%)로 넣으세요.');
  const share = Dec.of(n.toString()).div(100);
  if (!share.isPos() || share.gt(Dec.ONE)) throw new UserError('담을 비율은 0%보다 크고 100% 이하로 정하세요.');
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${'strategy:' + userId}))::text`;
    const account = await tx.portfolio.findFirst({ where: { id: accountId, userId, kind: 'ACCOUNT' } });
    if (!account) throw new UserError('계좌 포트폴리오를 고르세요.');
    await tx.strategyAccount.upsert({
      where: { portfolioId_accountId: { portfolioId: strategy.id, accountId } },
      create: { portfolioId: strategy.id, accountId, share: share.toString() },
      update: { share: share.toString() },
    });
    await assertShares(tx, userId, strategy.id);
    await audit(tx, userId, 'strategy_account', `${strategy.id}>${accountId}`, 'set', undefined, { share: share.toString() });
  });
}

export async function removeAccount(userId: string, strategyId: string, accountId: string) {
  await ownedStrategy(userId, strategyId);
  const r = await prisma.strategyAccount.deleteMany({ where: { portfolioId: strategyId, accountId } });
  if (!r.count) throw new UserError('담긴 계좌가 아닙니다.');
  await audit(prisma, userId, 'strategy_account', `${strategyId}>${accountId}`, 'delete');
}

/** Turning overlap off is refused while it would leave a holding split past 100%. */
export async function setAllowOverlap(userId: string, strategyId: string, allow: boolean) {
  await ownedStrategy(userId, strategyId);
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${'strategy:' + userId}))::text`;
    await tx.portfolio.update({ where: { id: strategyId }, data: { allowOverlap: allow } });
    if (!allow) {
      try {
        await assertShares(tx, userId, strategyId);
      } catch (e) {
        if (e instanceof UserError) throw new UserError(`겹쳐 담은 종목이 있어 끌 수 없습니다. 먼저 비율을 줄이세요. ${e.message}`);
        throw e;
      }
    }
  });
}

export interface AccountCandidate {
  accountId: string;
  name: string;
  /** This strategy's share of the account now, if any */
  share: Dec | null;
  /** Other strategies taking this account: "올웨더 100%" */
  others: string | null;
}

/** Account portfolios a strategy can take whole, with what other strategies take of them. */
export async function accountCandidates(userId: string, strategyId: string): Promise<AccountCandidate[]> {
  const [accounts, states] = await Promise.all([
    prisma.portfolio.findMany({ where: { userId, kind: 'ACCOUNT', archived: false }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], select: { id: true, name: true } }),
    strategyStates(userId),
  ]);
  const pct = (d: Dec) => `${Number(d.mul(100).toFixed(2))}%`;
  return accounts.map((a) => {
    const mine = states.find((s) => s.id === strategyId)?.accounts.get(a.id) ?? null;
    const others = states.filter((s) => s.id !== strategyId && s.accounts.has(a.id)).map((s) => `${s.name} ${pct(s.accounts.get(a.id)!)}`);
    return { accountId: a.id, name: a.name, share: mine, others: others.length ? others.join(' · ') : null };
  });
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
