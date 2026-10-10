/**
 * Household balance sheet over the existing ledger: every holding and portfolio cash once
 * (net worth scope), grouped by asset type and Asset.kind, plus loan terms (Loan, LoanRate,
 * LoanPayment) turned into repayment schedules. Balances stay in the ledger; Loan holds terms only.
 */
import type { RepaymentMethod } from '@prisma/client';
import {
  balanceSheet,
  dsr,
  LIABILITY_KINDS,
  loanSchedule,
  loanStatus,
  paymentsBetween,
  rateOn,
  weightedRate,
  addMonths,
  type BalanceItem,
} from '@/domain/net-worth';
import { dbDate, kstDate, prisma } from '../db';
import { currentState } from './analytics';
import { audit, UserError, userGraph } from './portfolios';

const iso = (d: Date | null | undefined) => (d ? kstDate(d) : null);
// @db.Date columns come back at UTC midnight; read them as the stored calendar date
const day = (d: Date) => d.toISOString().slice(0, 10);
const dayOrNull = (d: Date | null | undefined) => (d ? day(d) : null);

// ---------------------------------------------------------------- balance sheet

/** Balance sheet of everything the user holds, every portfolio counted once. */
export async function netWorthView(userId: string) {
  const [state, graph, kinds] = await Promise.all([
    currentState(userId),
    userGraph(userId),
    prisma.asset.findMany({ where: { userId }, select: { id: true, kind: true } }),
  ]);
  const kindOf = new Map(kinds.map((a) => [a.id, a.kind]));
  const nameOf = new Map(graph.portfolios.map((p) => [p.id, p.name]));
  const items: BalanceItem[] = state.holdings.map((h) => ({
    id: h.holdingId,
    name: h.name,
    type: h.type,
    kind: kindOf.get(h.assetId) ?? null,
    value: h.valueFull.toNumber(),
    href: `/holdings/${h.holdingId}`,
  }));
  for (const [pid, list] of state.cashByPortfolio) {
    const value = list.reduce((s, c) => s + c.krw.toNumber(), 0);
    if (value !== 0) items.push({ id: `cash:${pid}`, name: `${nameOf.get(pid) ?? '포트폴리오'} 현금`, type: 'CASH_BAL', value, href: `/portfolios/${pid}` });
  }
  return { sheet: balanceSheet(items), stale: state.anyStale };
}

// ---------------------------------------------------------------- loans

const loanInclude = {
  rates: { orderBy: { from: 'asc' as const } },
  asset: { select: { id: true, name: true, kind: true, type: true } },
  collateral: { select: { id: true, name: true } },
  payments: { orderBy: { paidAt: 'asc' as const } },
};

/**
 * Every loan with its schedule and where it stands today, the liabilities that have no terms
 * yet, and the totals the ratios need (12-month debt service, weighted rate).
 */
export async function loanViews(userId: string, asOf = kstDate()) {
  const [loans, state, profile] = await Promise.all([
    prisma.loan.findMany({ where: { userId }, include: loanInclude, orderBy: { startDate: 'asc' } }),
    currentState(userId),
    prisma.financialProfile.findUnique({ where: { userId } }),
  ]);
  const ledgerBalance = new Map<string, number>();
  const holdingOf = new Map<string, string>();
  for (const h of state.holdings) {
    ledgerBalance.set(h.assetId, (ledgerBalance.get(h.assetId) ?? 0) + Math.abs(h.valueFull.toNumber()));
    holdingOf.set(h.assetId, h.holdingId);
  }
  const yearOut = addMonths(asOf, 12);
  const views = loans.map((l) => {
    const rates = l.rates.map((r) => ({ from: day(r.from), rate: Number(r.rate) }));
    const principal = Number(l.principal);
    const schedule = loanSchedule({
      principal,
      startDate: day(l.startDate),
      maturityDate: dayOrNull(l.maturityDate),
      method: l.method,
      graceMonths: l.graceMonths,
      paymentDay: l.paymentDay,
      rates,
    });
    const status = loanStatus(principal, schedule, asOf);
    return {
      id: l.id,
      assetId: l.assetId,
      holdingId: holdingOf.get(l.assetId) ?? null,
      name: l.asset.name,
      kind: l.asset.kind,
      kindLabel: l.asset.kind ? (LIABILITY_KINDS[l.asset.kind] ?? l.asset.kind) : null,
      lent: l.lent,
      lender: l.lender,
      method: l.method,
      rateType: l.rateType,
      rate: rates.length ? rateOn(rates, asOf) : null,
      principal,
      startDate: day(l.startDate),
      maturityDate: dayOrNull(l.maturityDate),
      paymentDay: l.paymentDay,
      graceMonths: l.graceMonths,
      nextResetAt: dayOrNull(l.nextResetAt),
      collateral: l.collateral,
      /** Balance the ledger carries (manual valuations); the schedule's is an estimate */
      ledgerBalance: ledgerBalance.get(l.assetId) ?? null,
      schedule,
      status,
      next12: paymentsBetween(schedule, asOf, yearOut),
      payments: l.payments.map((p) => ({ id: p.id, dueDate: dayOrNull(p.dueDate), paidAt: iso(p.paidAt), principal: Number(p.principal), interest: Number(p.interest), balanceAfter: Number(p.balanceAfter) })),
    };
  });
  const withTerms = new Set(loans.map((l) => l.assetId));
  const missing = state.holdings
    .filter((h) => h.type === 'LIABILITY' && !withTerms.has(h.assetId))
    .map((h) => ({ assetId: h.assetId, holdingId: h.holdingId, name: h.name, balance: Math.abs(h.valueFull.toNumber()) }));
  const borrowed = views.filter((v) => !v.lent);
  const debtService = borrowed.reduce((s, v) => s + v.next12, 0);
  const income = profile?.annualIncome ? Number(profile.annualIncome) : null;
  return {
    loans: views,
    missing,
    debtService,
    dsr: dsr(debtService, income),
    weightedRate: weightedRate(borrowed.filter((v) => v.rate !== null).map((v) => ({ balance: v.ledgerBalance ?? v.status.remaining, rate: v.rate! }))),
    hasIncome: income !== null,
  };
}

export type LoanView = Awaited<ReturnType<typeof loanViews>>['loans'][number];

const METHODS: RepaymentMethod[] = ['AMORTIZING', 'EQUAL_PRINCIPAL', 'BULLET', 'REVOLVING', 'CUSTOM'];
const num = (v: string) => Number(v.replace(/[,\s원₩%]/g, ''));
const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

export interface LoanInput {
  id?: string;
  assetId: string;
  kind: string;
  method: string;
  principal: string;
  /** Annual %, e.g. "4.5" */
  rate: string;
  startDate: string;
  maturityDate: string;
  graceMonths: string;
  paymentDay: string;
  rateType: string;
  lender: string;
  payFromId: string;
  collateralId: string;
}

/** Create or update a loan's terms. The first rate row is the rate at start. */
export async function saveLoan(userId: string, input: LoanInput): Promise<string> {
  const asset = await prisma.asset.findFirst({ where: { id: input.assetId, userId }, include: { holdings: { select: { id: true } } } });
  if (!asset) throw new UserError('부채 자산을 찾을 수 없습니다.');
  const lent = asset.type !== 'LIABILITY';
  if (lent && asset.type !== 'ALTERNATIVE') throw new UserError('부채 또는 대안자산(빌려준 돈)에만 대출 조건을 붙일 수 있습니다.');
  if (asset.holdings.length > 1) throw new UserError('대출은 한 포트폴리오에만 담겨 있어야 합니다.');
  const method = input.method as RepaymentMethod;
  if (!METHODS.includes(method)) throw new UserError('상환 방식을 고르세요.');
  const principal = num(input.principal);
  if (!Number.isFinite(principal) || principal <= 0) throw new UserError('대출 원금을 확인하세요.');
  const rate = num(input.rate) / 100;
  if (!Number.isFinite(rate) || rate < 0 || rate > 0.3) throw new UserError('금리를 확인하세요 (연 0~30%).');
  if (!isDay(input.startDate)) throw new UserError('대출 시작일을 넣으세요.');
  const maturity = input.maturityDate.trim();
  if (maturity && (!isDay(maturity) || maturity <= input.startDate)) throw new UserError('만기일은 시작일 뒤여야 합니다.');
  if (!maturity && method !== 'REVOLVING' && method !== 'CUSTOM') throw new UserError('이 상환 방식은 만기일이 필요합니다.');
  const graceMonths = input.graceMonths.trim() ? Math.trunc(num(input.graceMonths)) : 0;
  if (!Number.isFinite(graceMonths) || graceMonths < 0 || graceMonths > 600) throw new UserError('거치 기간을 확인하세요.');
  const paymentDay = input.paymentDay.trim() ? Math.trunc(num(input.paymentDay)) : Number(input.startDate.slice(8, 10));
  if (!(paymentDay >= 1 && paymentDay <= 31)) throw new UserError('납입일은 1~31일 사이로 넣으세요.');
  const payFromId = input.payFromId || null;
  if (payFromId && !(await prisma.portfolio.findFirst({ where: { id: payFromId, userId } }))) throw new UserError('납입 포트폴리오를 찾을 수 없습니다.');
  const collateralId = input.collateralId || null;
  if (collateralId && !(await prisma.asset.findFirst({ where: { id: collateralId, userId } }))) throw new UserError('담보 자산을 찾을 수 없습니다.');
  const kind = input.kind && (LIABILITY_KINDS[input.kind] || input.kind === 'RECEIVABLE') ? input.kind : null;

  const data = {
    lent,
    lender: input.lender.trim().slice(0, 60) || null,
    principal: principal.toFixed(2),
    startDate: dbDate(input.startDate),
    maturityDate: maturity ? dbDate(maturity) : null,
    method,
    graceMonths,
    paymentDay,
    rateType: ['FIXED', 'VARIABLE', 'MIXED'].includes(input.rateType) ? input.rateType : 'FIXED',
    payFromId,
    collateralId,
  };
  return prisma.$transaction(async (tx) => {
    if (kind && kind !== asset.kind) await tx.asset.update({ where: { id: asset.id }, data: { kind } });
    if (input.id) {
      const before = await tx.loan.findFirst({ where: { id: input.id, userId } });
      if (!before) throw new UserError('대출을 찾을 수 없습니다.');
      await tx.loan.update({ where: { id: input.id }, data });
      // The start rate is the first row; later rows come from addLoanRate
      const first = await tx.loanRate.findFirst({ where: { loanId: input.id }, orderBy: { from: 'asc' } });
      if (first) await tx.loanRate.delete({ where: { loanId_from: { loanId: input.id, from: first.from } } });
      await tx.loanRate.create({ data: { loanId: input.id, from: dbDate(input.startDate), rate: rate.toFixed(8) } });
      await audit(tx, userId, 'loan', input.id, 'update', before, data);
      return input.id;
    }
    if (await tx.loan.findUnique({ where: { assetId: asset.id } })) throw new UserError('이 자산에는 이미 대출 조건이 있습니다.');
    const loan = await tx.loan.create({ data: { ...data, userId, assetId: asset.id, rates: { create: { from: dbDate(input.startDate), rate: rate.toFixed(8) } } } });
    await audit(tx, userId, 'loan', loan.id, 'create', undefined, data);
    return loan.id;
  });
}

/** A rate reset or 금리인하요구 from `from` on. */
export async function addLoanRate(userId: string, loanId: string, from: string, ratePct: string) {
  const loan = await prisma.loan.findFirst({ where: { id: loanId, userId } });
  if (!loan) throw new UserError('대출을 찾을 수 없습니다.');
  if (!isDay(from) || from < day(loan.startDate)) throw new UserError('적용일은 대출 시작일 이후여야 합니다.');
  const rate = num(ratePct) / 100;
  if (!Number.isFinite(rate) || rate < 0 || rate > 0.3) throw new UserError('금리를 확인하세요 (연 0~30%).');
  await prisma.loanRate.upsert({
    where: { loanId_from: { loanId, from: dbDate(from) } },
    create: { loanId, from: dbDate(from), rate: rate.toFixed(8) },
    update: { rate: rate.toFixed(8) },
  });
  await audit(prisma, userId, 'loan', loanId, 'rate', undefined, { from, rate });
}

/** Removes the terms only; the liability asset and its ledger stay. */
export async function deleteLoan(userId: string, id: string) {
  const loan = await prisma.loan.findFirst({ where: { id, userId } });
  if (!loan) throw new UserError('대출을 찾을 수 없습니다.');
  await prisma.loan.delete({ where: { id } });
  await audit(prisma, userId, 'loan', id, 'delete', loan);
}

/**
 * Stores a payment against the loan's terms.
 * TODO(NW-03): also write the REPAY ledger row (price = balanceAfter, cashDelta or flow per payFrom),
 * the interest/fee FEE row when paid from a portfolio, link them via Transaction.loanPaymentId,
 * update Asset.manualPrice and call rebuildSnapshots from the earliest date. That lives in trading.ts.
 */
export async function recordLoanPayment(
  userId: string,
  loanId: string,
  p: { dueDate: string | null; paidAt: string; principal: number; interest: number; fee?: number; prepayment?: boolean; memo?: string },
) {
  const loan = await prisma.loan.findFirst({ where: { id: loanId, userId }, include: { payments: { orderBy: { paidAt: 'desc' }, take: 1 } } });
  if (!loan) throw new UserError('대출을 찾을 수 없습니다.');
  if (!isDay(p.paidAt)) throw new UserError('납입일을 확인하세요.');
  if (!Number.isFinite(p.principal) || !Number.isFinite(p.interest) || p.interest < 0) throw new UserError('금액을 확인하세요.');
  const before = loan.payments[0] ? Number(loan.payments[0].balanceAfter) : Number(loan.principal);
  const balanceAfter = Math.max(0, before - p.principal);
  const row = await prisma.loanPayment.create({
    data: {
      loanId,
      dueDate: p.dueDate ? dbDate(p.dueDate) : null,
      paidAt: new Date(p.paidAt + 'T09:00:00+09:00'),
      principal: p.principal.toFixed(2),
      interest: p.interest.toFixed(2),
      fee: (p.fee ?? 0).toFixed(2),
      balanceAfter: balanceAfter.toFixed(2),
      prepayment: p.prepayment ?? false,
      memo: p.memo?.slice(0, 200) || null,
    },
  });
  await audit(prisma, userId, 'loanPayment', row.id, 'create', undefined, { loanId, ...p, balanceAfter });
  return row.id;
}

/** Assets the loan form can attach terms to (liabilities, or ALTERNATIVE for money lent) and collaterals. */
export async function loanCandidates(userId: string) {
  const assets = await prisma.asset.findMany({
    where: { userId, type: { in: ['LIABILITY', 'ALTERNATIVE', 'REAL_ESTATE'] } },
    select: { id: true, name: true, type: true, kind: true, loan: { select: { id: true } } },
    orderBy: { name: 'asc' },
  });
  return {
    targets: assets.filter((a) => a.type !== 'REAL_ESTATE' && !a.loan).map((a) => ({ id: a.id, name: a.name, type: a.type, kind: a.kind })),
    collaterals: assets.filter((a) => a.type === 'REAL_ESTATE').map((a) => ({ id: a.id, name: a.name })),
  };
}

// ---------------------------------------------------------------- financial profile

export async function getFinancialProfile(userId: string) {
  return prisma.financialProfile.findUnique({ where: { userId } });
}

export interface ProfileInput {
  annualIncome: string;
  birthYear: string;
  retireAge: string;
  region: string;
  emergencyMonths: string;
  shareWithAi: boolean;
}

export async function saveFinancialProfile(userId: string, input: ProfileInput) {
  const opt = (v: string, min: number, max: number, label: string) => {
    if (!v.trim()) return null;
    const x = Math.trunc(num(v));
    if (!Number.isFinite(x) || x < min || x > max) throw new UserError(`${label}을(를) 확인하세요.`);
    return x;
  };
  const income = input.annualIncome.trim() ? num(input.annualIncome) : null;
  if (income !== null && (!Number.isFinite(income) || income < 0)) throw new UserError('연소득을 확인하세요.');
  const data = {
    annualIncome: income === null ? null : income.toFixed(2),
    birthYear: opt(input.birthYear, 1900, 2100, '출생연도'),
    retireAge: opt(input.retireAge, 30, 100, '은퇴 나이'),
    region: input.region === 'CAPITAL' || input.region === 'OTHER' ? input.region : null,
    emergencyMonths: opt(input.emergencyMonths, 0, 60, '비상자금 개월 수') ?? 6,
    shareWithAi: input.shareWithAi,
  };
  await prisma.financialProfile.upsert({ where: { userId }, create: { userId, ...data }, update: data });
}
