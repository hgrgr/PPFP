/**
 * Autopilot policies, order intents and paper fills. Every order runs through domain/autopilot
 * checkOrder under a per-policy advisory lock, with open orders' amounts held as reservations,
 * so simultaneous proposals cannot overrun a limit. No live order path exists yet.
 */
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { Dec } from '@/domain/decimal';
import {
  checkOrder,
  estimateCosts,
  kstParts,
  LEVEL_LABEL,
  MODE_LABEL,
  OPEN_STATUSES,
  paperBook,
  parsePolicy,
  policyChange,
  policySummary,
  usageToday,
  verdictOf,
  type CheckResult,
  type OrderSide,
  type OrderUsageRow,
  type Policy,
  type PolicyInput,
  type PreTradeReport,
  type Verdict,
} from '@/domain/autopilot';
import { PaperRouter, type PaperQuote } from '../brokers/orders';
import { dec, prisma } from '../db';
import { getQuotes } from '../market';
import { audit, ownedPortfolio, UserError } from './portfolios';
import { verifyIdentity } from './security';

/** Password re-entry stays valid this long for order execution, raising delegation and un-halting */
export const STEP_UP_MINUTES = 10;
/** A pending order not approved within this long expires */
export const ORDER_TTL_MINUTES = 10;

type Tx = Prisma.TransactionClient;

const policyInput = (p: {
  name: string; level: PolicyInput['level']; mode: PolicyInput['mode']; objective: string; allowedTypes: string[]; allowSymbols: string[]; denySymbols: string[];
  maxOrder: unknown; maxDaily: unknown; maxDailyOrders: number; dailyLossStop: unknown; maxPriceGap: unknown; paperCash: unknown; slippageBp: number;
}): PolicyInput => ({
  name: p.name,
  level: p.level,
  mode: p.mode,
  objective: p.objective,
  allowedTypes: p.allowedTypes as PolicyInput['allowedTypes'],
  allowSymbols: p.allowSymbols,
  denySymbols: p.denySymbols,
  maxOrder: dec(p.maxOrder as string).toNumber(),
  maxDaily: dec(p.maxDaily as string).toNumber(),
  maxDailyOrders: p.maxDailyOrders,
  dailyLossStop: dec(p.dailyLossStop as string).toNumber(),
  maxPriceGap: dec(p.maxPriceGap as string).toNumber(),
  paperCash: dec(p.paperCash as string).toNumber(),
  slippageBp: p.slippageBp,
});

/** Prisma rows → the shapes the domain reads (Prisma Decimals become Dec) */
const asPolicy = (p: { level: PolicyInput['level']; mode: PolicyInput['mode']; allowedTypes: string[]; allowSymbols: string[]; denySymbols: string[]; maxOrder: Prisma.Decimal; maxDaily: Prisma.Decimal; maxDailyOrders: number; dailyLossStop: Prisma.Decimal; maxPriceGap: Prisma.Decimal; haltedAt: Date | null; haltReason: string | null }): Policy => ({
  ...p,
  maxOrder: dec(p.maxOrder),
  maxDaily: dec(p.maxDaily),
  dailyLossStop: dec(p.dailyLossStop),
  maxPriceGap: dec(p.maxPriceGap),
});
const usageRows = (rows: { status: string; reserved: Prisma.Decimal; filledQty: Prisma.Decimal; avgFillPrice: Prisma.Decimal | null; createdAt: Date }[]): OrderUsageRow[] =>
  rows.map((o) => ({ status: o.status, reserved: dec(o.reserved), filledQty: dec(o.filledQty), avgFillPrice: o.avgFillPrice ? dec(o.avgFillPrice) : null, createdAt: o.createdAt }));

// ── Step-up ──────────────────────────────────────────────────────

export async function stepUpValid(sessionId: string | null): Promise<boolean> {
  if (!sessionId) return false;
  const s = await prisma.session.findUnique({ where: { id: sessionId }, select: { stepUpUntil: true } });
  return !!s?.stepUpUntil && s.stepUpUntil > new Date();
}

export async function stepUp(userId: string, sessionId: string, password: string, code?: string): Promise<Date> {
  await verifyIdentity(userId, password, code);
  const until = new Date(Date.now() + STEP_UP_MINUTES * 60_000);
  const r = await prisma.session.updateMany({ where: { id: sessionId, userId }, data: { stepUpUntil: until } });
  if (!r.count) throw new UserError('로그인 세션을 찾을 수 없습니다. 다시 로그인하세요.');
  return until;
}

// ── Overview ─────────────────────────────────────────────────────

export async function autopilotOverview(userId: string) {
  const now = new Date();
  const dayStart = new Date(`${kstParts(now).date}T00:00:00+09:00`);
  const [settings, policies, orders, portfolios] = await Promise.all([
    prisma.aiSettings.findUnique({ where: { userId }, select: { tradingHaltedAt: true, tradingHaltReason: true } }),
    prisma.autopilotPolicy.findMany({
      where: { userId },
      include: { portfolio: { select: { name: true } }, connection: { select: { label: true, broker: true, paper: true } }, orders: { where: { createdAt: { gte: dayStart } } } },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.tradeOrder.findMany({ where: { userId }, include: { policy: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: 30 }),
    prisma.portfolio.findMany({ where: { userId, archived: false, autopilot: null }, select: { id: true, name: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
  ]);
  return {
    haltedAt: settings?.tradingHaltedAt ?? null,
    haltReason: settings?.tradingHaltReason ?? null,
    pendingCount: orders.filter((o) => o.status === 'PENDING_APPROVAL').length,
    freePortfolios: portfolios,
    policies: policies.map((p) => {
      const usage = usageToday(usageRows(p.orders), now);
      return {
        id: p.id,
        name: p.name,
        level: p.level,
        levelLabel: LEVEL_LABEL[p.level],
        mode: p.mode,
        modeLabel: MODE_LABEL[p.mode],
        portfolioName: p.portfolio.name,
        connection: p.connection ? `${p.connection.label}${p.connection.paper ? ' (모의)' : ''}` : null,
        version: p.version,
        haltedAt: p.haltedAt,
        haltReason: p.haltReason,
        maxDaily: dec(p.maxDaily).toNumber(),
        maxDailyOrders: p.maxDailyOrders,
        usedAmount: usage.amount.toNumber(),
        usedOrders: usage.orders,
        summary: policySummary({ ...asPolicy(p), paperCash: dec(p.paperCash) }),
      };
    }),
    orders: orders.map((o) => ({
      id: o.id,
      policyName: o.policy.name,
      mode: o.mode,
      symbol: o.symbol,
      side: o.side,
      qty: dec(o.qty).toString(),
      limitPrice: o.limitPrice ? dec(o.limitPrice).toString() : null,
      status: o.status,
      checks: (Array.isArray(o.checks) ? o.checks : []) as unknown as CheckResult[],
      filledQty: dec(o.filledQty).toString(),
      avgFillPrice: o.avgFillPrice ? dec(o.avgFillPrice).toString() : null,
      error: o.error,
      expiresAt: o.expiresAt,
      createdAt: o.createdAt,
    })),
  };
}

export type AutopilotOverview = Awaited<ReturnType<typeof autopilotOverview>>;

// ── Policies ─────────────────────────────────────────────────────

export async function savePolicy(userId: string, input: { id?: string; portfolioId: string; raw: unknown }, stepUpOk: boolean): Promise<string> {
  const parsed = parsePolicy(input.raw);
  if (!parsed.ok) throw new UserError(parsed.errors.join(' '));
  const after = parsed.value;
  if (after.mode === 'LIVE') throw new UserError('실전 주문은 아직 열리지 않았습니다. 페이퍼로 먼저 운용하세요.');

  return prisma.$transaction(async (tx) => {
    const existing = input.id ? await tx.autopilotPolicy.findFirst({ where: { id: input.id, userId } }) : null;
    if (input.id && !existing) throw new UserError('정책을 찾을 수 없습니다.');
    const before = existing ? policyInput(existing) : null;
    const change = policyChange(before, after);
    if (change.review) throw new UserError('자동 단계와 실전 전환은 승급 심사를 통과해야 합니다(아직 준비 중).');
    if (change.stepUp && !stepUpOk) throw new UserError('단계를 올리거나 한도를 넓히려면 비밀번호를 다시 확인하세요.');
    const data = { ...after, maxOrder: String(after.maxOrder), maxDaily: String(after.maxDaily), dailyLossStop: String(after.dailyLossStop), maxPriceGap: String(after.maxPriceGap), paperCash: String(after.paperCash) };

    if (existing) {
      // The portfolio and account stay fixed; a different one is a new policy
      const row = await tx.autopilotPolicy.update({ where: { id: existing.id }, data: { ...data, version: change.bump ? { increment: 1 } : undefined } });
      if (change.bump) await audit(tx, userId, 'autopilot_policy', row.id, 'update', before, { ...after, version: row.version });
      return row.id;
    }
    await ownedPortfolio(userId, input.portfolioId);
    if (await tx.autopilotPolicy.findUnique({ where: { portfolioId: input.portfolioId } })) throw new UserError('이 포트폴리오에는 이미 정책이 있습니다.');
    // TODO(AP-01): refuse portfolios holding lots imported from another account (Transaction.importSource),
    // and for crypto links require the connection's historyPortfolioId.
    const row = await tx.autopilotPolicy.create({ data: { userId, portfolioId: input.portfolioId, ...data } });
    await audit(tx, userId, 'autopilot_policy', row.id, 'create', undefined, after);
    return row.id;
  });
}

// ── Kill switches ────────────────────────────────────────────────

/** Close open paper orders; live ones would need a broker cancel (none exist yet). */
async function closeOpenOrders(tx: Tx, where: Prisma.TradeOrderWhereInput) {
  const now = new Date();
  await tx.tradeOrder.updateMany({ where: { ...where, status: 'PENDING_APPROVAL' }, data: { status: 'DISMISSED', reserved: 0, closedAt: now } });
  await tx.tradeOrder.updateMany({ where: { ...where, mode: 'PAPER', status: { in: ['SUBMITTED', 'PARTIAL'] } }, data: { status: 'CANCELLED', reserved: 0, closedAt: now } });
  // TODO(AP-06): LIVE SUBMITTED/PARTIAL → router.cancelOrder, and notify the ones that fail
}

export async function setGlobalHalt(userId: string, on: boolean, reason: string | null, stepUpOk: boolean) {
  if (!on && !stepUpOk) throw new UserError('정지를 풀려면 비밀번호를 다시 확인하세요.');
  await prisma.$transaction(async (tx) => {
    const data = on ? { tradingHaltedAt: new Date(), tradingHaltReason: reason?.slice(0, 200) || '직접 정지' } : { tradingHaltedAt: null, tradingHaltReason: null };
    await tx.aiSettings.upsert({ where: { userId }, update: data, create: { userId, ...data } });
    if (on) await closeOpenOrders(tx, { userId });
    await audit(tx, userId, 'autopilot', userId, on ? 'halt' : 'resume', undefined, data);
  });
}

export async function setPolicyHalt(userId: string, policyId: string, on: boolean, reason: string | null, stepUpOk: boolean) {
  if (!on && !stepUpOk) throw new UserError('정지를 풀려면 비밀번호를 다시 확인하세요.');
  await prisma.$transaction(async (tx) => {
    const data = on ? { haltedAt: new Date(), haltReason: reason?.slice(0, 200) || '직접 정지' } : { haltedAt: null, haltReason: null };
    const r = await tx.autopilotPolicy.updateMany({ where: { id: policyId, userId }, data });
    if (!r.count) throw new UserError('정책을 찾을 수 없습니다.');
    if (on) await closeOpenOrders(tx, { policyId });
    await audit(tx, userId, 'autopilot_policy', policyId, on ? 'halt' : 'resume', undefined, data);
  });
}

// ── Orders ───────────────────────────────────────────────────────

export interface OrderProposal {
  policyId: string;
  symbol: string;
  side: OrderSide;
  qty: string;
  limitPrice: string;
  /** Shown to the user only; never used to decide anything */
  rationale?: string;
  counterpoints?: string;
  trigger?: 'USER' | 'SCHEDULE' | 'DRIFT' | 'ALERT';
  conversationId?: string | null;
  tainted?: boolean;
  taintSources?: string[];
  model?: string | null;
}

async function lockPolicy(tx: Tx, policyId: string) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${'autopilot:' + policyId}))::text`;
}

async function quoteFor(userId: string, symbol: string): Promise<{ assetId: string | null; assetType: string; quote: PaperQuote | null }> {
  const asset = await prisma.asset.findFirst({ where: { userId, symbol } });
  if (!asset) return { assetId: null, assetType: 'KR_STOCK', quote: null };
  // TODO(AP-03): read the ordering broker's quote without the cache, plus 20-day traded value
  const q = (await getQuotes(userId, [asset])).get(asset.id);
  const quote = q ? { price: q.price.toString(), asOf: q.stale ? (q.asOf ? new Date(q.asOf) : null) : q.asOf ? new Date(q.asOf) : new Date() } : null;
  return { assetId: asset.id, assetType: asset.type, quote };
}

/** Everything checkOrder needs about the policy's account, read inside the policy lock. */
async function checkState(tx: Tx, policy: { id: string; userId: string; paperCash: Prisma.Decimal }, symbol: string, excludeOrderId?: string) {
  const now = new Date();
  const since = new Date(now.getTime() - 36 * 3_600_000);
  const [settings, recent, fills] = await Promise.all([
    tx.aiSettings.findUnique({ where: { userId: policy.userId }, select: { tradingHaltedAt: true } }),
    tx.tradeOrder.findMany({ where: { policyId: policy.id, createdAt: { gte: since }, id: excludeOrderId ? { not: excludeOrderId } : undefined } }),
    tx.orderFill.findMany({ where: { order: { policyId: policy.id, mode: 'PAPER' } }, include: { order: { select: { symbol: true, side: true } } }, orderBy: { filledAt: 'asc' } }),
  ]);
  const book = paperBook(dec(policy.paperCash), fills.map((f) => ({ symbol: f.order.symbol, side: f.order.side, qty: dec(f.qty), price: dec(f.price), fee: dec(f.fee), tax: dec(f.tax) })));
  // Cash already promised to open buys is not available again
  const reservedBuys = Dec.sum(recent.filter((o) => o.side === 'BUY' && (OPEN_STATUSES as readonly string[]).includes(o.status)).map((o) => dec(o.reserved)));
  return {
    globalHaltedAt: settings?.tradingHaltedAt ?? null,
    usedToday: usageToday(usageRows(recent), now),
    cash: book.cash.sub(reservedBuys),
    heldQty: book.positions.get(symbol)?.qty ?? Dec.ZERO,
    openOnSymbol: recent.filter((o) => o.symbol === symbol && (OPEN_STATUSES as readonly string[]).includes(o.status)).length,
    fills,
  };
}

/**
 * Check an intent and store it: BLOCKED, or PENDING_APPROVAL holding its amount against the
 * limits. SUGGEST policies keep it as a draft the screen shows without an execute button.
 */
export async function proposeOrder(userId: string, p: OrderProposal): Promise<{ orderId: string; verdict: Verdict; report: PreTradeReport }> {
  const symbol = p.symbol.trim().toUpperCase();
  const { assetId, assetType, quote } = await quoteFor(userId, symbol);
  return prisma.$transaction(async (tx) => {
    await lockPolicy(tx, p.policyId);
    const policy = await tx.autopilotPolicy.findFirst({ where: { id: p.policyId, userId } });
    if (!policy) throw new UserError('정책을 찾을 수 없습니다.');
    if (policy.mode !== 'PAPER') throw new UserError('실전 주문은 아직 열리지 않았습니다.');
    const state = await checkState(tx, policy, symbol);
    const now = new Date();
    const lastOpposite = state.fills.filter((f) => f.order.symbol === symbol && f.order.side !== p.side).at(-1)?.filledAt ?? null;
    const report = checkOrder(
      { symbol, assetType, side: p.side, qty: p.qty, limitPrice: p.limitPrice },
      asPolicy(policy),
      {
        now,
        globalHaltedAt: state.globalHaltedAt,
        liveEnabled: false,
        quote,
        usedToday: state.usedToday,
        cash: state.cash,
        heldQty: state.heldQty,
        openOnSymbol: state.openOnSymbol,
        lastOppositeFillAt: lastOpposite,
        // TODO(AP-06): previous close value of the paper book (PaperDaily) and its value now
        dayStartValue: null,
        currentValue: null,
        // TODO(AP-03): band from PortfolioTarget ± driftTolerance once paper positions map to target keys
      },
    );
    const { verdict, reason } = verdictOf(report, policy.level, !!p.tainted);
    const decision = await tx.agentDecision.create({
      data: {
        userId,
        policyId: policy.id,
        policyVersion: policy.version,
        trigger: p.trigger ?? 'USER',
        conversationId: p.conversationId ?? null,
        outcome: verdict === 'BLOCKED' ? 'BLOCKED' : 'ORDERS',
        rationale: (p.rationale ?? '').slice(0, 2000),
        counterpoints: (p.counterpoints ?? '').slice(0, 2000),
        tainted: !!p.tainted,
        taintSources: p.taintSources ?? [],
        model: p.model ?? null,
      },
    });
    const fee = estimateCosts(p.side, assetType, report.notional, kstParts(now).year).fee;
    const order = await tx.tradeOrder.create({
      data: {
        userId,
        policyId: policy.id,
        decisionId: decision.id,
        connectionId: policy.connectionId,
        mode: policy.mode,
        assetId,
        symbol,
        side: p.side,
        qty: p.qty,
        limitPrice: p.limitPrice,
        reserved: verdict === 'BLOCKED' ? '0' : report.notional.add(p.side === 'BUY' ? fee : Dec.ZERO).toString(),
        clientOrderId: `ap_${randomUUID()}`,
        status: verdict === 'BLOCKED' ? 'BLOCKED' : 'PENDING_APPROVAL',
        checks: report.results as unknown as Prisma.InputJsonValue,
        error: verdict === 'BLOCKED' ? reason.slice(0, 500) : null,
        expiresAt: verdict === 'BLOCKED' ? null : new Date(now.getTime() + 60_000 * ORDER_TTL_MINUTES),
        closedAt: verdict === 'BLOCKED' ? now : null,
      },
    });
    // TODO(AP-08): verdict AUTO executes right away through the same path as approveOrder
    return { orderId: order.id, verdict, report };
  });
}

/** Approve a pending paper order: claim it, re-check under the lock, then fill or rest it. */
export async function approveOrder(userId: string, orderId: string, stepUpOk: boolean): Promise<string> {
  if (!stepUpOk) throw new UserError('주문을 실행하려면 비밀번호를 다시 확인하세요.');
  const head = await prisma.tradeOrder.findFirst({ where: { id: orderId, userId }, include: { policy: true } });
  if (!head) throw new UserError('주문을 찾을 수 없습니다.');
  if (head.policy.level === 'SUGGEST') throw new UserError('초안 단계 정책의 주문은 실행할 수 없습니다.');
  if (head.mode !== 'PAPER') throw new UserError('실전 주문은 아직 열리지 않았습니다.');
  const { assetType, quote } = await quoteFor(userId, head.symbol);

  return prisma.$transaction(async (tx) => {
    await lockPolicy(tx, head.policyId);
    const now = new Date();
    // Atomic claim: a double click or a second tab finds nothing to claim
    const claimed = await tx.tradeOrder.updateMany({ where: { id: orderId, userId, status: 'PENDING_APPROVAL' }, data: { status: 'SUBMITTING', approvedAt: now } });
    if (!claimed.count) throw new UserError('이미 처리된 주문입니다.');
    if (head.expiresAt && head.expiresAt < now) {
      await tx.tradeOrder.update({ where: { id: orderId }, data: { status: 'EXPIRED', reserved: 0, closedAt: now } });
      return '유효시간이 지나 주문을 닫았습니다.';
    }
    const policy = head.policy;
    const state = await checkState(tx, policy, head.symbol, orderId);
    const report = checkOrder(
      { symbol: head.symbol, assetType, side: head.side, qty: head.qty.toString(), limitPrice: head.limitPrice?.toString() ?? null },
      asPolicy(policy),
      { now, globalHaltedAt: state.globalHaltedAt, liveEnabled: false, quote, usedToday: state.usedToday, cash: state.cash, heldQty: state.heldQty, openOnSymbol: state.openOnSymbol, dayStartValue: null, currentValue: null },
    );
    if (!report.passed) {
      await tx.tradeOrder.update({ where: { id: orderId }, data: { status: 'BLOCKED', reserved: 0, closedAt: now, checks: report.results as unknown as Prisma.InputJsonValue, error: report.blocks.map((b) => b.message).join(' / ').slice(0, 500) } });
      return `다시 확인해 보니 막혔습니다: ${report.blocks[0].message}`;
    }
    const router = new PaperRouter({ cash: async () => state.cash.toString(), quote: async () => quote, slippageBp: policy.slippageBp, now: () => now });
    const placed = await router.placeOrder({ clientOrderId: head.clientOrderId, symbol: head.symbol, assetType, side: head.side, qty: head.qty.toString(), limitPrice: head.limitPrice!.toString(), exchange: head.exchange });
    if (placed.status !== 'ACCEPTED') {
      await tx.tradeOrder.update({ where: { id: orderId }, data: { status: placed.status === 'UNKNOWN' ? 'UNKNOWN' : 'REJECTED', error: placed.reason, closedAt: placed.status === 'UNKNOWN' ? null : now, reserved: placed.status === 'UNKNOWN' ? undefined : 0 } });
      return placed.reason;
    }
    const base = { brokerOrderId: placed.brokerOrderId, submittedAt: now, lastCheckedAt: now, checks: report.results as unknown as Prisma.InputJsonValue };
    if (!placed.fill) {
      // Rests until the poller fills or expires it
      // TODO(AP-07): alert-loop tick retries PaperRouter.tryFill for SUBMITTED paper orders
      await tx.tradeOrder.update({ where: { id: orderId }, data: { ...base, status: 'SUBMITTED' } });
      return '지정가에 닿지 않아 대기 중입니다.';
    }
    const f = placed.fill;
    await tx.orderFill.create({ data: { orderId, seq: 1, qty: f.qty, price: f.price, fee: f.fee, tax: f.tax, estimated: f.estimated, filledAt: f.filledAt } });
    await tx.tradeOrder.update({ where: { id: orderId }, data: { ...base, status: 'FILLED', filledQty: f.qty, avgFillPrice: f.price, reserved: 0, closedAt: now } });
    return `페이퍼 체결: ${f.qty} × ${f.price}`;
  });
}

export async function dismissOrder(userId: string, orderId: string) {
  const r = await prisma.tradeOrder.updateMany({ where: { id: orderId, userId, status: 'PENDING_APPROVAL' }, data: { status: 'DISMISSED', reserved: 0, closedAt: new Date() } });
  if (!r.count) throw new UserError('이미 처리된 주문입니다.');
}
