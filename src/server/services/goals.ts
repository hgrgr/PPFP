/** Saved goals with their projection, and rebalancing backtests on stored daily closes. */
import { Dec } from '@/domain/decimal';
import { backtest, mixAssumptions, monthlyNeeded, simulateGoal, type RebalanceRule } from '@/domain/goals';
import { asOf } from '@/domain/benchmark';
import { downsample } from '@/domain/performance';
import { dbDate, kstDate, prisma } from '../db';
import { backfillCloses } from '../market';
import { currentState, scopeWeights } from './analytics';
import { UserError, userGraph } from './portfolios';

export const INFLATION = 0.025;

/** Value now and value per asset type for a scope (null = net worth). */
async function scopeMix(userId: string, portfolioId: string | null) {
  const [state, graph] = await Promise.all([currentState(userId), userGraph(userId)]);
  const weights = scopeWeights(graph.portfolios.map((p) => p.id), graph.edges, portfolioId && graph.portfolios.some((p) => p.id === portfolioId) ? portfolioId : null);
  const w = (pid: string) => weights.get(pid) ?? Dec.ZERO;
  const byType: Record<string, number> = {};
  let total = 0;
  for (const h of state.holdings) {
    const v = h.valueFull.mul(w(h.portfolioId)).toNumber();
    total += v;
    if (h.type !== 'LIABILITY') byType[h.type] = (byType[h.type] ?? 0) + v;
  }
  for (const [pid, list] of state.cashByPortfolio) {
    const v = Dec.sum(list.map((c) => c.krw)).mul(w(pid)).toNumber();
    total += v;
    byType.CASH_BAL = (byType.CASH_BAL ?? 0) + v;
  }
  return { total, byType, state, graph, weights };
}

const monthsUntil = (date: string) => {
  const [y, m] = date.split('-').map(Number);
  const [ny, nm] = kstDate().split('-').map(Number);
  return Math.max(1, (y - ny) * 12 + (m - nm));
};

export async function goalViews(userId: string) {
  const goals = await prisma.goal.findMany({ where: { userId }, orderBy: { targetDate: 'asc' } });
  const graph = await userGraph(userId);
  const out = [];
  for (const g of goals) {
    const mix = await scopeMix(userId, g.portfolioId);
    const auto = mixAssumptions(mix.byType);
    const ret = g.expectedReturn ? Number(g.expectedReturn) : auto.ret;
    const vol = g.volatility ? Number(g.volatility) : auto.vol;
    const targetDate = kstDate(g.targetDate);
    const months = monthsUntil(targetDate);
    const target = Number(g.target);
    const monthly = Number(g.monthly);
    const sim = simulateGoal({ start: mix.total, monthly, months, target, ret, vol, inflation: g.realTerms ? INFLATION : 0, seed: 7 });
    // In today's money the target's real value is fixed, so the saving needed uses the real return
    const realRet = g.realTerms ? (1 + ret) / (1 + INFLATION) - 1 : ret;
    out.push({
      id: g.id,
      name: g.name,
      target,
      targetDate,
      monthly,
      portfolioId: g.portfolioId,
      scope: graph.portfolios.find((p) => p.id === g.portfolioId)?.name ?? '순자산 전체',
      realTerms: g.realTerms,
      start: mix.total,
      months,
      ret,
      vol,
      auto,
      custom: { ret: g.expectedReturn !== null, vol: g.volatility !== null },
      needed: monthlyNeeded(mix.total, target, months, realRet),
      sim,
    });
  }
  return out;
}

export type GoalView = Awaited<ReturnType<typeof goalViews>>[number];

export interface GoalInput {
  id?: string;
  name: string;
  target: string;
  targetDate: string;
  monthly: string;
  portfolioId: string;
  expectedReturn: string;
  volatility: string;
  realTerms: boolean;
}

const num = (v: string) => Number(v.replace(/[,\s원₩%]/g, ''));

export async function saveGoal(userId: string, input: GoalInput): Promise<string> {
  const name = input.name.trim().slice(0, 40);
  if (!name) throw new UserError('목표 이름을 넣으세요.');
  const target = num(input.target);
  if (!Number.isFinite(target) || target <= 0) throw new UserError('목표 금액을 확인하세요.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.targetDate) || input.targetDate <= kstDate()) throw new UserError('목표 날짜는 오늘 이후로 정하세요.');
  const monthly = input.monthly.trim() ? num(input.monthly) : 0;
  if (!Number.isFinite(monthly) || monthly < 0) throw new UserError('월 적립액을 확인하세요.');
  const pct = (v: string, label: string, max: number) => {
    if (!v.trim()) return null;
    const x = num(v) / 100;
    if (!Number.isFinite(x) || x < -0.5 || x > max) throw new UserError(`${label}을 확인하세요.`);
    return x.toFixed(5);
  };
  const portfolioId = input.portfolioId || null;
  if (portfolioId && !(await prisma.portfolio.findFirst({ where: { id: portfolioId, userId } }))) throw new UserError('포트폴리오를 찾을 수 없습니다.');
  const data = {
    name,
    target: target.toFixed(2),
    targetDate: dbDate(input.targetDate),
    monthly: monthly.toFixed(2),
    portfolioId,
    expectedReturn: pct(input.expectedReturn, '기대수익률', 0.5),
    volatility: pct(input.volatility, '변동성', 1.5),
    realTerms: input.realTerms,
  };
  if (input.id) {
    const r = await prisma.goal.updateMany({ where: { id: input.id, userId }, data });
    if (!r.count) throw new UserError('목표를 찾을 수 없습니다.');
    return input.id;
  }
  return (await prisma.goal.create({ data: { ...data, userId } })).id;
}

export async function deleteGoal(userId: string, id: string) {
  const r = await prisma.goal.deleteMany({ where: { id, userId } });
  if (!r.count) throw new UserError('목표를 찾을 수 없습니다.');
}

// ---------------------------------------------------------------- backtest

const RULES: RebalanceRule[] = ['NONE', 'MONTHLY', 'QUARTERLY', 'BAND'];

/**
 * Today's mix of a scope (listed assets + everything else as one flat "기타·현금" part),
 * replayed over the last `days` of stored closes under each rebalancing rule.
 */
export async function backtestReport(userId: string, portfolioId: string | null, days = 365) {
  const mix = await scopeMix(userId, portfolioId);
  const w = (pid: string) => mix.weights.get(pid) ?? Dec.ZERO;
  const listed = new Map<string, { symbol: string; name: string; currency: string; market: string | null; value: number }>();
  let other = 0;
  for (const h of mix.state.holdings) {
    const v = h.valueFull.mul(w(h.portfolioId)).toNumber();
    if (h.type === 'LIABILITY' || v <= 0) continue;
    if (h.symbol && h.type !== 'CASH') {
      const cur = listed.get(h.symbol) ?? { symbol: h.symbol, name: h.name, currency: h.currency, market: null, value: 0 };
      cur.value += v;
      listed.set(h.symbol, cur);
    } else other += v;
  }
  for (const [pid, list] of mix.state.cashByPortfolio) other += Dec.sum(list.map((c) => c.krw)).mul(w(pid)).toNumber();
  const assets = [...listed.values()];
  const total = assets.reduce((s, a) => s + a.value, 0) + Math.max(0, other);
  if (!assets.length || total <= 0) return null;

  const since = kstDate(new Date(Date.now() - days * 86_400_000));
  const markets = await prisma.asset.findMany({ where: { userId, symbol: { in: assets.map((a) => a.symbol) } }, select: { symbol: true, market: true } });
  for (const a of assets) a.market = markets.find((m) => m.symbol === a.symbol)?.market ?? null;
  await backfillCloses(userId, assets, since).catch(() => 0);
  const [rows, fxRows] = await Promise.all([
    prisma.priceDaily.findMany({ where: { symbol: { in: assets.map((a) => a.symbol) }, date: { gte: dbDate(since) } }, orderBy: { date: 'asc' } }),
    prisma.fxDaily.findMany({ where: { pair: 'USDKRW', date: { gte: dbDate(kstDate(new Date(Date.now() - (days + 14) * 86_400_000))) } }, orderBy: { date: 'asc' } }),
  ]);
  const fx = fxRows.map((r) => ({ date: kstDate(r.date), close: Number(r.rate) }));
  const usable = assets.filter((a) => rows.some((r) => r.symbol === a.symbol));
  const firstDates = usable.map((a) => kstDate(rows.find((r) => r.symbol === a.symbol)!.date));
  const start = firstDates.sort().at(-1);
  if (!start) return null;
  const dates = [...new Set(rows.map((r) => kstDate(r.date)))].filter((d) => d >= start).sort();
  const series = usable.map((a) => rows.filter((r) => r.symbol === a.symbol).map((r) => ({ date: kstDate(r.date), close: Number(r.close) })));
  const usd = mix.state.usdkrw.toNumber();
  const priceRows = dates.map((d) => [
    ...usable.map((a, i) => {
      const c = asOf(series[i], d);
      if (!c) return null;
      return a.currency === 'KRW' ? c.close : c.close * (asOf(fx, d)?.close ?? usd);
    }),
    1, // 기타·현금: flat
  ]);
  const left = total - usable.reduce((s, a) => s + a.value, 0);
  const weights = [...usable.map((a) => a.value / total), left / total];
  const p = portfolioId ? await prisma.portfolio.findFirst({ where: { id: portfolioId, userId }, select: { driftTolerance: true } }) : null;
  const band = p ? Number(p.driftTolerance) : 0.05;
  const results = RULES.map((rule) => ({ rule, ...backtest(dates, priceRows, weights, rule, band) }));
  const chart = downsample(
    dates.map((d, i) => Object.fromEntries([['date', d], ...results.map((r) => [r.rule, (r.values[i] - 1) * 100])])),
    160,
  );
  return {
    start,
    end: dates.at(-1)!,
    band,
    parts: [...usable.map((a, i) => ({ name: a.name, symbol: a.symbol, weight: weights[i] })), ...(left > 0 ? [{ name: '기타·현금 (가격 변화 없음)', symbol: null, weight: left / total }] : [])],
    skipped: assets.filter((a) => !usable.includes(a)).map((a) => a.name),
    results: results.map(({ values: _v, ...r }) => r),
    chart,
  };
}

export type BacktestReport = NonNullable<Awaited<ReturnType<typeof backtestReport>>>;

/** Read a goal's numbers back as form strings. */
export const goalForm = (g: GoalView) => ({
  id: g.id,
  name: g.name,
  target: String(Math.round(g.target)),
  targetDate: g.targetDate,
  monthly: String(Math.round(g.monthly)),
  portfolioId: g.portfolioId ?? '',
  expectedReturn: g.custom.ret ? (g.ret * 100).toFixed(1) : '',
  volatility: g.custom.vol ? (g.vol * 100).toFixed(1) : '',
  realTerms: g.realTerms,
});

