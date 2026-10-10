/**
 * Everything the dashboard and portfolio pages show, for one scope:
 * a single portfolio (with everything under it) or the user's whole net worth.
 */
import type { AssetType } from '@prisma/client';
import { Dec } from '@/domain/decimal';
import { effectiveWeights, type Edge } from '@/domain/portfolio-graph';
import { combineSeries, downsample, indexAtOrBefore, summarize, twrIndex, type SeriesPoint } from '@/domain/performance';
import { resolveRange, type ResolvedRange } from '@/domain/period';
import { dbDate, dec, kstDate, prisma } from '../db';
import { fxRate, getQuotes } from '../market';
import { ASSET_TYPE_LABEL } from './assets';
import { userGraph } from './portfolios';

export const TYPE_COLOR: Record<AssetType | 'CASH_BAL', string> = {
  KR_STOCK: '#2F4FC9',
  US_STOCK: '#8FA8F5',
  CRYPTO: '#E8A200',
  BOND: '#14A38B',
  CASH: '#AEB4BE',
  CASH_BAL: '#C9CED6',
  REAL_ESTATE: '#F08A3E',
  FUND: '#7A5AF8',
  ALTERNATIVE: '#C2410C',
  LIABILITY: '#6B7280',
};

export interface HoldingRow {
  holdingId: string;
  portfolioId: string;
  portfolioName: string;
  assetId: string;
  name: string;
  symbol: string | null;
  type: AssetType;
  currency: string;
  qty: Dec;
  price: Dec | null;
  priceAsOf: string | null;
  stale: boolean;
  /** Scope-weighted value in KRW. */
  value: Dec;
  costBase: Dec;
  unrealized: Dec;
  lots: number;
  weight: number;
}

export interface CurrentState {
  /** Direct value (holdings + cash) per portfolio, KRW. */
  direct: Map<string, Dec>;
  holdings: (Omit<HoldingRow, 'portfolioName' | 'weight' | 'value' | 'costBase' | 'unrealized'> & {
    valueFull: Dec;
    costFull: Dec;
  })[];
  cashByPortfolio: Map<string, { currency: string; amount: Dec; krw: Dec }[]>;
  usdkrw: Dec;
  anyStale: boolean;
}

/** Live valuation of every holding the user has, at current quotes. */
export async function currentState(userId: string): Promise<CurrentState> {
  const holdings = await prisma.holding.findMany({
    where: { portfolio: { userId } },
    include: { asset: true, lots: { where: { qtyRemaining: { gt: 0 } } } },
  });
  const cash = await prisma.cashBalance.findMany({ where: { portfolio: { userId } } });
  const quotes = await getQuotes(userId, [...new Map(holdings.map((h) => [h.assetId, h.asset])).values()]);
  const usdkrw = await fxRate(userId, 'USD');
  const fxOf = (ccy: string) => (ccy === 'KRW' ? Dec.ONE : usdkrw);

  const direct = new Map<string, Dec>();
  const add = (pid: string, v: Dec) => direct.set(pid, (direct.get(pid) ?? Dec.ZERO).add(v));
  let anyStale = false;
  const rows: CurrentState['holdings'] = [];
  for (const h of holdings) {
    const qty = Dec.sum(h.lots.map((l) => dec(l.qtyRemaining)));
    const q = quotes.get(h.assetId);
    const sign = h.asset.type === 'LIABILITY' ? -1 : 1;
    const fx = fxOf(h.asset.currency);
    const valueFull = q ? qty.mul(q.price).mul(fx).mul(sign) : Dec.ZERO;
    const costFull = Dec.sum(h.lots.map((l) => dec(l.qtyRemaining).mul(dec(l.unitCost)).mul(dec(l.fxRate)))).mul(sign);
    if (q?.stale) anyStale = true;
    add(h.portfolioId, valueFull);
    if (qty.isZero()) continue;
    rows.push({
      holdingId: h.id,
      portfolioId: h.portfolioId,
      assetId: h.assetId,
      name: h.asset.name,
      symbol: h.asset.symbol,
      type: h.asset.type,
      currency: h.asset.currency,
      qty,
      price: q?.price ?? null,
      priceAsOf: q?.asOf ?? null,
      stale: q?.stale ?? true,
      lots: h.lots.length,
      valueFull,
      costFull,
    });
  }
  const cashByPortfolio = new Map<string, { currency: string; amount: Dec; krw: Dec }[]>();
  for (const c of cash) {
    const amount = dec(c.amount);
    const krw = amount.mul(fxOf(c.currency));
    add(c.portfolioId, krw);
    const list = cashByPortfolio.get(c.portfolioId) ?? [];
    list.push({ currency: c.currency, amount, krw });
    cashByPortfolio.set(c.portfolioId, list);
  }
  return { direct, holdings: rows, cashByPortfolio, usdkrw, anyStale };
}

/** Portfolio id -> weight in the scope. Null scope = net worth: every portfolio once. */
export function scopeWeights(portfolioIds: string[], edges: Edge[], scopeId: string | null): Map<string, Dec> {
  if (!scopeId) return new Map(portfolioIds.map((id) => [id, Dec.ONE]));
  return effectiveWeights(edges, scopeId);
}

async function scopedSeries(weights: Map<string, Dec>, from: string, to: string): Promise<{
  series: SeriesPoint[];
  rows: { portfolioId: string; date: string; holdings: Record<string, string>; cash: Dec }[];
}> {
  const ids = [...weights.keys()];
  const snaps = await prisma.snapshot.findMany({
    where: { portfolioId: { in: ids }, date: { lte: dbDate(to) } },
    orderBy: { date: 'asc' },
  });
  const byPortfolio = new Map<string, SeriesPoint[]>();
  const rows: { portfolioId: string; date: string; holdings: Record<string, string>; cash: Dec }[] = [];
  for (const s of snaps) {
    const date = kstDate(s.date);
    const list = byPortfolio.get(s.portfolioId) ?? [];
    list.push({ date, value: dec(s.value), flow: dec(s.flow) });
    byPortfolio.set(s.portfolioId, list);
    if (date >= from) rows.push({ portfolioId: s.portfolioId, date, holdings: (s.holdings ?? {}) as Record<string, string>, cash: dec(s.cash) });
  }
  const series = combineSeries([...byPortfolio].map(([id, s]) => ({ weight: weights.get(id) ?? Dec.ZERO, series: s })));
  return { series, rows };
}

/** Flows booked today (not yet in a snapshot), weighted, KRW. */
async function todaysFlow(weights: Map<string, Dec>, today: string, usdkrw: Dec): Promise<Dec> {
  const txns = await prisma.transaction.findMany({
    where: { portfolioId: { in: [...weights.keys()] }, tradeAt: { gte: new Date(Date.parse(today + 'T00:00:00+09:00')) }, flow: { not: 0 } },
    select: { portfolioId: true, flow: true, currency: true },
  });
  return Dec.sum(txns.map((t) => dec(t.flow).mul(t.currency === 'KRW' ? Dec.ONE : usdkrw).mul(weights.get(t.portfolioId) ?? Dec.ZERO)));
}

export interface ChildRow {
  id: string;
  name: string;
  color: string;
  allocation: Dec;
  value: Dec;
  share: number;
  twr: Dec | null;
  pnl: Dec | null;
}

export interface Dashboard {
  scope: { id: string | null; name: string; path: { id: string; name: string }[] };
  range: ResolvedRange;
  today: string;
  total: Dec;
  costBase: Dec;
  unrealized: Dec;
  summary: ReturnType<typeof summarize>;
  realized: Dec;
  income: Dec;
  chart: { date: string; value: number; invested: number }[];
  twrDaily: { date: string; twr: number }[];
  /** byStructure: child portfolios as whole slices plus what the scope holds directly */
  allocation: { byHolding: Slice[]; byType: Slice[]; byCurrency: Slice[]; byStructure: Slice[] };
  weightChange: { keys: { key: string; label: string; color: string }[]; points: Record<string, number | string>[]; start: Record<string, number>; end: Record<string, number> };
  children: ChildRow[];
  holdings: HoldingRow[];
  stale: boolean;
  usdkrw: Dec;
  hasSnapshots: boolean;
}

export interface Slice {
  key: string;
  label: string;
  /** Secondary line in the legend, e.g. the ticker */
  sub?: string;
  color: string;
  value: number;
  share: number;
}

/** Categorical chart slots (CSS tokens in globals.css); a stock past the last slot folds into "기타". */
const SERIES_SLOTS = 8;

export async function dashboard(
  userId: string,
  scopeId: string | null,
  params: { period?: string; from?: string; to?: string },
): Promise<Dashboard> {
  const today = kstDate();
  const { portfolios, edges } = await userGraph(userId);
  const byId = new Map(portfolios.map((p) => [p.id, p]));
  if (scopeId && !byId.has(scopeId)) scopeId = null;
  const weights = scopeWeights(portfolios.map((p) => p.id), edges, scopeId);

  const first = await prisma.transaction.findFirst({
    where: { portfolioId: { in: [...weights.keys()] } },
    orderBy: { tradeAt: 'asc' },
    select: { tradeAt: true },
  });
  const firstDate = first ? kstDate(first.tradeAt) : today;
  const range = resolveRange(params, today, firstDate);

  const state = await currentState(userId);
  const w = (pid: string) => weights.get(pid) ?? Dec.ZERO;

  // Current totals
  let total = Dec.ZERO;
  for (const [pid, v] of state.direct) total = total.add(v.mul(w(pid)));
  const holdings: HoldingRow[] = state.holdings
    .filter((h) => w(h.portfolioId).isPos())
    .map((h) => {
      const k = w(h.portfolioId);
      const value = h.valueFull.mul(k);
      const costBase = h.costFull.mul(k);
      return {
        ...h,
        portfolioName: byId.get(h.portfolioId)?.name ?? '',
        value,
        costBase,
        unrealized: value.sub(costBase),
        weight: total.isZero() ? 0 : value.div(total).toNumber(),
      };
    })
    .sort((a, b) => b.value.cmp(a.value));
  const costBase = Dec.sum(holdings.map((h) => h.costBase));
  const unrealized = Dec.sum(holdings.map((h) => h.unrealized));

  // Allocation now
  const typeTotals = new Map<string, Dec>();
  const ccyTotals = new Map<string, Dec>();
  for (const h of holdings) {
    typeTotals.set(h.type, (typeTotals.get(h.type) ?? Dec.ZERO).add(h.value));
    ccyTotals.set(h.currency, (ccyTotals.get(h.currency) ?? Dec.ZERO).add(h.value));
  }
  for (const [pid, list] of state.cashByPortfolio) {
    for (const c of list) {
      const v = c.krw.mul(w(pid));
      if (v.isZero()) continue;
      typeTotals.set('CASH_BAL', (typeTotals.get('CASH_BAL') ?? Dec.ZERO).add(v));
      ccyTotals.set(c.currency, (ccyTotals.get(c.currency) ?? Dec.ZERO).add(v));
    }
  }
  const gross = Dec.sum([...typeTotals.values()].filter((v) => v.isPos()));
  const slices = (m: Map<string, Dec>, label: (k: string) => string, color: (k: string, i: number) => string): Slice[] =>
    [...m]
      .filter(([, v]) => v.isPos())
      .sort((a, b) => b[1].cmp(a[1]))
      .map(([k, v], i) => ({ key: k, label: label(k), color: color(k, i), value: v.toNumber(), share: gross.isZero() ? 0 : v.div(gross).toNumber() }));
  const typeLabel = (k: string) => (k === 'CASH_BAL' ? '포트폴리오 현금' : ASSET_TYPE_LABEL[k as AssetType]);
  // By stock: one slice per asset across the portfolios in scope; past the palette's slots the tail folds into "기타".
  const assetTotals = new Map<string, { label: string; sub: string; value: Dec }>();
  for (const h of holdings) {
    if (!h.value.isPos()) continue;
    const cur = assetTotals.get(h.assetId);
    if (cur) cur.value = cur.value.add(h.value);
    else assetTotals.set(h.assetId, { label: h.name, sub: h.symbol ?? ASSET_TYPE_LABEL[h.type], value: h.value });
  }
  const shareOf = (v: Dec) => (gross.isZero() ? 0 : v.div(gross).toNumber());
  const ranked = [...assetTotals].sort((a, b) => b[1].value.cmp(a[1].value));
  const shown = ranked.length > SERIES_SLOTS ? ranked.slice(0, SERIES_SLOTS - 1) : ranked;
  const rest = ranked.slice(shown.length);
  const byHolding: Slice[] = shown.map(([id, a], i) => ({ key: id, label: a.label, sub: a.sub, color: `var(--series-${i + 1})`, value: a.value.toNumber(), share: shareOf(a.value) }));
  if (rest.length) {
    const v = Dec.sum(rest.map(([, a]) => a.value));
    byHolding.push({ key: 'OTHER', label: `기타 ${rest.length}종목`, sub: rest.slice(0, 3).map(([, a]) => a.label).join(', ') + (rest.length > 3 ? ' …' : ''), color: 'var(--series-other)', value: v.toNumber(), share: shareOf(v) });
  }
  const cashTotal = typeTotals.get('CASH_BAL') ?? Dec.ZERO;
  if (cashTotal.isPos()) byHolding.push({ key: 'CASH_BAL', label: '포트폴리오 현금', color: 'var(--series-cash)', value: cashTotal.toNumber(), share: shareOf(cashTotal) });

  const allocation: { byHolding: Slice[]; byType: Slice[]; byCurrency: Slice[]; byStructure: Slice[] } = {
    byStructure: [],
    byHolding,
    byType: slices(typeTotals, typeLabel, (k) => TYPE_COLOR[k as AssetType] ?? '#999'),
    byCurrency: slices(ccyTotals, (k) => k, (_k, i) => ['#2F4FC9', '#8FA8F5', '#14A38B'][i] ?? '#999'),
  };

  // History
  const { series: hist, rows } = await scopedSeries(weights, range.start, range.end);
  const series = [...hist];
  if (range.end === today) {
    const flowToday = await todaysFlow(weights, today, state.usdkrw);
    const last = series.at(-1);
    if (last?.date === today) series[series.length - 1] = { ...last, value: total };
    else series.push({ date: today, value: total, flow: flowToday });
  }
  const summary = summarize(series, range.start, range.end);

  // Chart: value and invested capital (start value + cumulative flows) inside the range
  const sIdx = Math.max(0, indexAtOrBefore(series, range.start));
  const eIdx = indexAtOrBefore(series, range.end);
  const inRange = eIdx >= sIdx ? series.slice(sIdx, eIdx + 1) : [];
  let invested = inRange[0] && inRange[0].date <= range.start ? inRange[0].value : Dec.ZERO;
  const chartFull = inRange.map((p, i) => {
    if (i > 0 || p.date > range.start) invested = invested.add(p.flow);
    return { date: p.date, value: p.value.toNumber(), invested: invested.toNumber() };
  });
  const chart = downsample(chartFull, 160);
  // Time-weighted return from the start of the range, day by day (benchmark comparison)
  const idx = twrIndex(inRange);
  const twrDaily = inRange.map((p, i) => ({ date: p.date, twr: idx[i].toNumber() - 1 }));

  // Weight change by asset type (from snapshots) — first and last available days plus samples
  const holdingType = new Map(state.holdings.map((h) => [h.holdingId, h.type as string]));
  const allHoldings = await prisma.holding.findMany({ where: { portfolioId: { in: [...weights.keys()] } }, select: { id: true, asset: { select: { type: true } } } });
  for (const h of allHoldings) holdingType.set(h.id, h.asset.type);
  const perDate = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (r.date > range.end) continue;
    const k = w(r.portfolioId).toNumber();
    const m = perDate.get(r.date) ?? new Map<string, number>();
    for (const [hid, v] of Object.entries(r.holdings)) {
      const t = holdingType.get(hid) ?? 'ALTERNATIVE';
      if (t === 'LIABILITY') continue;
      m.set(t, (m.get(t) ?? 0) + Number(v) * k);
    }
    const cashV = r.cash.toNumber() * k;
    if (cashV > 0) m.set('CASH_BAL', (m.get('CASH_BAL') ?? 0) + cashV);
    perDate.set(r.date, m);
  }
  const keys = new Set<string>();
  for (const m of perDate.values()) for (const [k, v] of m) if (v > 0) keys.add(k);
  const keyList = [...keys].map((k) => ({ key: k, label: typeLabel(k), color: TYPE_COLOR[k as AssetType] ?? '#999' }));
  const points = downsample(
    [...perDate.keys()].sort().map((date) => {
      const m = perDate.get(date)!;
      const sum = [...m.values()].filter((v) => v > 0).reduce((a, b) => a + b, 0);
      const row: Record<string, number | string> = { date };
      for (const k of keys) row[k] = sum > 0 ? Math.max(0, m.get(k) ?? 0) / sum : 0;
      return row;
    }),
    120,
  );
  const pick = (row?: Record<string, number | string>) =>
    Object.fromEntries([...keys].map((k) => [k, Number(row?.[k] ?? 0)]));

  // Realized P&L and income inside the range (weighted)
  const rangeWhere = {
    portfolioId: { in: [...weights.keys()] },
    tradeAt: { gt: new Date(Date.parse(range.start + 'T23:59:59.999+09:00')), lte: new Date(Date.parse(range.end + 'T23:59:59.999+09:00')) },
  };
  const [sells, incomeTx] = await Promise.all([
    prisma.transaction.findMany({ where: { ...rangeWhere, type: 'SELL' }, select: { portfolioId: true, consumptions: { select: { pnlBase: true } } } }),
    prisma.transaction.findMany({ where: { ...rangeWhere, type: { in: ['DIVIDEND', 'INTEREST'] } }, select: { portfolioId: true, cashDelta: true, fxRate: true } }),
  ]);
  const realized = Dec.sum(sells.flatMap((s) => s.consumptions.map((c) => dec(c.pnlBase).mul(w(s.portfolioId)))));
  const income = Dec.sum(incomeTx.map((t) => dec(t.cashDelta).mul(dec(t.fxRate, Dec.ONE)).mul(w(t.portfolioId))));

  // Children (or root portfolios for the net-worth view)
  const childEdges = scopeId
    ? edges.filter((e) => e.parentId === scopeId)
    : portfolios.filter((p) => !edges.some((e) => e.childId === p.id)).map((p) => ({ parentId: '', childId: p.id, allocation: Dec.ONE }));
  const children: ChildRow[] = [];
  for (const e of childEdges) {
    const p = byId.get(e.childId);
    if (!p) continue;
    const cw = effectiveWeights(edges, p.id);
    let value = Dec.ZERO;
    for (const [pid, k] of cw) value = value.add((state.direct.get(pid) ?? Dec.ZERO).mul(k));
    value = value.mul(e.allocation);
    const { series: cs } = await scopedSeries(cw, range.start, range.end);
    if (range.end === today) {
      const full = value.isZero() || e.allocation.isZero() ? Dec.ZERO : value.div(e.allocation);
      const last = cs.at(-1);
      if (last?.date === today) cs[cs.length - 1] = { ...last, value: full };
      else cs.push({ date: today, value: full, flow: await todaysFlow(cw, today, state.usdkrw) });
    }
    const sm = summarize(cs, range.start, range.end);
    children.push({
      id: p.id,
      name: p.name,
      color: p.color,
      allocation: e.allocation,
      value,
      share: total.isZero() ? 0 : value.div(total).toNumber(),
      twr: sm?.twr ?? null,
      pnl: sm ? sm.pnl.mul(e.allocation) : null,
    });
  }

  // What the scope itself owns: each child portfolio as one slice (its whole content), plus the
  // stocks and cash held directly in the scope. Net worth: the top-level portfolios.
  // A net-worth view with a single top portfolio shows that portfolio's own make-up
  const roots = portfolios.filter((p) => !edges.some((e) => e.childId === p.id));
  const ownScope = scopeId ?? (roots.length === 1 ? roots[0].id : null);
  const ownChildren =
    ownScope === scopeId
      ? children
      : edges
          .filter((e) => e.parentId === ownScope)
          .map((e) => {
            let value = Dec.ZERO;
            for (const [pid, k] of effectiveWeights(edges, e.childId)) value = value.add((state.direct.get(pid) ?? Dec.ZERO).mul(k));
            return { id: e.childId, name: byId.get(e.childId)?.name ?? '', value: value.mul(e.allocation) };
          });
  const own: { key: string; label: string; sub?: string; value: Dec }[] = ownChildren.filter((c) => c.value.isPos()).map((c) => ({ key: `P:${c.id}`, label: c.name, sub: '하위 포트폴리오', value: c.value }));
  if (ownScope) {
    const direct = new Map<string, { label: string; sub: string; value: Dec }>();
    for (const h of holdings) {
      if (h.portfolioId !== ownScope || !h.value.isPos()) continue;
      const cur = direct.get(h.assetId);
      if (cur) cur.value = cur.value.add(h.value);
      else direct.set(h.assetId, { label: h.name, sub: h.symbol ?? ASSET_TYPE_LABEL[h.type], value: h.value });
    }
    own.push(...[...direct].map(([key, a]) => ({ key, ...a })));
    const cash = Dec.sum((state.cashByPortfolio.get(ownScope) ?? []).map((c) => c.krw));
    if (cash.isPos()) own.push({ key: 'CASH_BAL', label: '포트폴리오 현금', value: cash });
  }
  const ownGross = Dec.sum(own.map((o) => o.value));
  const ownSorted = own.sort((a, b) => (a.key === 'CASH_BAL' ? 1 : b.key === 'CASH_BAL' ? -1 : b.value.cmp(a.value)));
  allocation.byStructure = ownSorted.map((o, i) => ({
    key: o.key,
    label: o.label,
    sub: o.sub,
    color: o.key === 'CASH_BAL' ? 'var(--series-cash)' : i < SERIES_SLOTS ? `var(--series-${i + 1})` : 'var(--series-other)',
    value: o.value.toNumber(),
    share: ownGross.isZero() ? 0 : o.value.div(ownGross).toNumber(),
  }));

  // Breadcrumb: first parent chain
  const path: { id: string; name: string }[] = [];
  let cur = scopeId;
  const guard = new Set<string>();
  while (cur && !guard.has(cur)) {
    guard.add(cur);
    const p = byId.get(cur);
    if (!p) break;
    path.unshift({ id: p.id, name: p.name });
    cur = edges.find((e) => e.childId === cur)?.parentId ?? null;
  }

  return {
    scope: { id: scopeId, name: scopeId ? byId.get(scopeId)!.name : '순자산 전체', path },
    range,
    today,
    total,
    costBase,
    unrealized,
    summary,
    realized,
    income,
    chart,
    twrDaily,
    allocation,
    weightChange: { keys: keyList, points, start: pick(points[0]), end: pick(points.at(-1)) },
    children: children.sort((a, b) => b.value.cmp(a.value)),
    holdings,
    stale: state.anyStale,
    usdkrw: state.usdkrw,
    hasSnapshots: hist.length > 0,
  };
}
