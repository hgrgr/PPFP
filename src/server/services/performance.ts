/** The portfolio against benchmarks over a period, and each position's contribution. */
import type { AssetType } from '@prisma/client';
import { benchmarkReturns, contributions, type Close, type ContributionInput } from '@/domain/benchmark';
import { downsample } from '@/domain/performance';
import { dbDate, dec, kstDate, prisma } from '../db';
import { backfillCloses } from '../market';
import { currentState, dashboard, scopeWeights } from './analytics';
import { ASSET_TYPE_LABEL } from './assets';
import { userGraph } from './portfolios';

/** ETFs standing in for the indexes (their prices include no dividends). */
export const BENCHMARKS = [
  { symbol: '069500', label: '코스피 200', sub: 'KODEX 200', currency: 'KRW' },
  { symbol: 'VOO', label: 'S&P 500', sub: 'Vanguard S&P 500 ETF', currency: 'USD' },
  { symbol: 'QQQ', label: '나스닥 100', sub: 'Invesco QQQ', currency: 'USD' },
] as const;

export async function performanceReport(userId: string, scopeId: string | null, params: { period?: string; from?: string; to?: string }, krw = true) {
  const d = await dashboard(userId, scopeId, params);
  const dates = d.twrDaily.map((p) => p.date);
  const start = d.range.start;

  // Benchmarks: make sure their closes are stored, then read them back with the FX history
  const known = await prisma.asset.findMany({ where: { userId, symbol: { in: BENCHMARKS.map((b) => b.symbol) } }, select: { symbol: true, market: true } });
  await backfillCloses(userId, BENCHMARKS.map((b) => ({ symbol: b.symbol, market: known.find((k) => k.symbol === b.symbol)?.market ?? null, currency: b.currency })), start).catch(() => 0);
  const lookback = dbDate(kstDate(new Date(Date.parse(`${start}T00:00:00+09:00`) - 14 * 86_400_000)));
  const [closes, fxRows] = await Promise.all([
    prisma.priceDaily.findMany({ where: { symbol: { in: BENCHMARKS.map((b) => b.symbol) }, date: { gte: lookback } }, orderBy: { date: 'asc' } }),
    prisma.fxDaily.findMany({ where: { pair: 'USDKRW', date: { gte: lookback } }, orderBy: { date: 'asc' } }),
  ]);
  const fx: Close[] = fxRows.map((r) => ({ date: kstDate(r.date), close: Number(r.rate) }));
  if (!fx.length) fx.push({ date: start, close: d.usdkrw.toNumber() });
  const benches = BENCHMARKS.map((b) => {
    const list: Close[] = closes.filter((c) => c.symbol === b.symbol).map((c) => ({ date: kstDate(c.date), close: Number(c.close) }));
    const ret = benchmarkReturns(dates, list, b.currency !== 'KRW' && krw ? fx : undefined);
    return { ...b, returns: ret, total: ret.at(-1) ?? null, available: list.length > 0 };
  });
  const mine = d.twrDaily.at(-1)?.twr ?? null;
  const chart = downsample(
    d.twrDaily.map((p, i) => {
      const row: Record<string, number | string | null> = { date: p.date, mine: p.twr * 100 };
      for (const b of benches) row[b.symbol] = b.returns[i] === null ? null : b.returns[i]! * 100;
      return row;
    }),
    160,
  );

  // Contributions over the same period
  const { portfolios, edges } = await userGraph(userId);
  const weights = scopeWeights(portfolios.map((p) => p.id), edges, d.scope.id);
  const w = (pid: string) => weights.get(pid)?.toNumber() ?? 0;
  const ids = [...weights.keys()].filter((id) => w(id) > 0);
  const startSnaps = await Promise.all(ids.map((id) => prisma.snapshot.findFirst({ where: { portfolioId: id, date: { lte: dbDate(start) } }, orderBy: { date: 'desc' } })));
  const holdings = await prisma.holding.findMany({ where: { portfolioId: { in: ids } }, include: { asset: { select: { name: true, type: true, currency: true } } } });
  const meta = new Map(holdings.map((h) => [h.id, { pid: h.portfolioId, assetId: h.assetId, name: h.asset.name, type: h.asset.type as AssetType }]));
  const byAsset = new Map<string, ContributionInput>();
  const row = (holdingId: string) => {
    const m = meta.get(holdingId);
    if (!m || m.type === 'LIABILITY') return null;
    const r = byAsset.get(m.assetId) ?? { key: m.assetId, label: m.name, group: ASSET_TYPE_LABEL[m.type], startKrw: 0, endKrw: 0, cashKrw: 0 };
    byAsset.set(m.assetId, r);
    return { r, k: w(m.pid) };
  };
  let startTotal = 0;
  for (const s of startSnaps) {
    if (!s) continue;
    startTotal += Number(s.value) * w(s.portfolioId);
    for (const [hid, v] of Object.entries((s.holdings ?? {}) as Record<string, string>)) {
      const x = row(hid);
      if (x) x.r.startKrw += Number(v) * x.k;
    }
  }
  const state = await currentState(userId);
  for (const h of state.holdings) {
    const x = row(h.holdingId);
    if (x) x.r.endKrw += h.valueFull.toNumber() * x.k;
  }
  const txns = await prisma.transaction.findMany({
    where: { holdingId: { in: [...meta.keys()] }, type: { in: ['BUY', 'SELL', 'DIVIDEND'] }, tradeAt: { gt: new Date(Date.parse(`${start}T23:59:59.999+09:00`)) } },
  });
  for (const t of txns) {
    const x = row(t.holdingId!);
    if (!x) continue;
    const fxr = dec(t.fxRate, dec(1)).toNumber();
    const gross = Number(t.qty ?? 0) * Number(t.price ?? 0);
    const costs = Number(t.fee) + Number(t.tax);
    const cash = t.type === 'BUY' ? -(gross + costs) : t.type === 'SELL' ? gross - costs : Number(t.cashDelta);
    x.r.cashKrw += cash * fxr * x.k;
  }
  return {
    scope: d.scope,
    range: d.range,
    mine,
    benches: benches.map(({ returns: _r, ...b }) => b),
    chart,
    contributions: contributions([...byAsset.values()], startTotal),
    /** asset id → trading currency, to show foreign assets in their own currency */
    currencies: Object.fromEntries(holdings.map((h) => [h.assetId, h.asset.currency])) as Record<string, string>,
    usdkrw: d.usdkrw.toNumber(),
    startTotal,
    krw,
  };
}

export type PerformanceReport = Awaited<ReturnType<typeof performanceReport>>;
