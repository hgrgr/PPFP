import type { AlertDirection, Prisma } from '@prisma/client';
import { Dec } from '@/domain/decimal';
import { directionFor, driftReport, isCrossed, journalDirections, newlyBreached, targetsOk, type DriftPart, type DriftReport } from '@/domain/alerts';
import { effectiveWeights } from '@/domain/portfolio-graph';
import { money, pct } from '@/lib/format';
import { dec, prisma } from '../db';
import { getQuotes } from '../market';
import { currentState, type CurrentState } from './analytics';
import { notify } from './notify';
import { UserError, userGraph } from './portfolios';

const price = (v: unknown, label: string): string => {
  const s = typeof v === 'string' || typeof v === 'number' ? String(v).replace(/[,\s₩$]/g, '') : '';
  let d: Dec;
  try {
    d = Dec.of(s);
  } catch {
    throw new UserError(`${label}에는 숫자를 입력하세요.`);
  }
  if (!d.isPos()) throw new UserError(`${label}은(는) 0보다 커야 합니다.`);
  return d.toString();
};

// ── price alerts ────────────────────────────────────

export interface AlertView {
  id: string;
  assetId: string;
  assetName: string;
  symbol: string | null;
  source: 'MANUAL' | 'JOURNAL_TARGET' | 'JOURNAL_STOP';
  journalId: string | null;
  journalTitle: string | null;
  direction: AlertDirection;
  price: string;
  currency: string;
  note: string | null;
  active: boolean;
  triggeredAt: string | null;
  triggeredPrice: string | null;
  currentPrice: string | null;
}

export async function listAlerts(userId: string): Promise<AlertView[]> {
  const rows = await prisma.priceAlert.findMany({
    where: { userId },
    include: { asset: true, journal: { select: { title: true } } },
    orderBy: [{ active: 'desc' }, { triggeredAt: 'desc' }, { createdAt: 'desc' }],
  });
  const quotes = rows.length ? await getQuotes(userId, [...new Map(rows.map((r) => [r.assetId, r.asset])).values()]).catch(() => new Map()) : new Map();
  return rows.map((r) => ({
    id: r.id,
    assetId: r.assetId,
    assetName: r.asset.name,
    symbol: r.asset.symbol,
    source: r.source,
    journalId: r.journalEntryId,
    journalTitle: r.journal?.title ?? null,
    direction: r.direction,
    price: dec(r.price).toString(),
    currency: r.currency,
    note: r.note,
    active: r.active,
    triggeredAt: r.triggeredAt?.toISOString() ?? null,
    triggeredPrice: r.triggeredPrice ? dec(r.triggeredPrice).toString() : null,
    currentPrice: quotes.get(r.assetId)?.price.toString() ?? null,
  }));
}

/** A one-off alert on any asset. The direction is from the current price unless given. */
export async function createAlert(userId: string, input: { assetId: string; price: string; direction?: string; note?: string }) {
  const asset = await prisma.asset.findFirst({ where: { id: input.assetId, userId } });
  if (!asset) throw new UserError('종목을 고르세요.');
  const p = price(input.price, '알림 가격');
  let direction: AlertDirection;
  if (input.direction === 'ABOVE' || input.direction === 'BELOW') direction = input.direction;
  else {
    const q = (await getQuotes(userId, [asset]).catch(() => new Map())).get(asset.id);
    direction = directionFor(Number(p), q ? q.price.toNumber() : null);
  }
  if ((await prisma.priceAlert.count({ where: { userId, active: true } })) >= 200) throw new UserError('켜 둔 알림은 200개까지입니다.');
  await prisma.priceAlert.create({ data: { userId, assetId: asset.id, direction, price: p, currency: asset.currency, note: input.note?.trim().slice(0, 200) || null } });
}

export async function rearmAlert(userId: string, id: string) {
  const r = await prisma.priceAlert.updateMany({ where: { id, userId }, data: { active: true, triggeredAt: null, triggeredPrice: null } });
  if (!r.count) throw new UserError('알림을 찾을 수 없습니다.');
}

export async function deleteAlert(userId: string, id: string) {
  const r = await prisma.priceAlert.deleteMany({ where: { id, userId } });
  if (!r.count) throw new UserError('알림을 찾을 수 없습니다.');
}

/**
 * Keep a journal entry's target and stop alerts in line with the entry: one
 * alert per price, re-armed when the price changes, paused while the entry is
 * closed, removed when switched off.
 */
export async function syncJournalAlerts(userId: string, entryId: string, want: { target: boolean; stop: boolean }) {
  const e = await prisma.journalEntry.findFirst({ where: { id: entryId, userId }, include: { asset: true, alerts: true } });
  if (!e) return;
  let reference = e.basePrice ? dec(e.basePrice).toNumber() : null;
  if (reference === null) reference = (await getQuotes(userId, [e.asset]).catch(() => new Map())).get(e.assetId)?.price.toNumber() ?? null;
  const dirs = journalDirections(dec(e.targetPrice).toNumber(), reference);
  const plan = [
    { source: 'JOURNAL_TARGET' as const, on: want.target, price: e.targetPrice, direction: dirs.target },
    { source: 'JOURNAL_STOP' as const, on: want.stop && !!e.stopPrice, price: e.stopPrice, direction: dirs.stop },
  ];
  for (const p of plan) {
    const cur = e.alerts.find((a) => a.source === p.source);
    if (!p.on || !p.price) {
      if (cur) await prisma.priceAlert.delete({ where: { id: cur.id } });
      continue;
    }
    const value = dec(p.price).toString();
    const open = e.status === 'OPEN';
    if (!cur) {
      await prisma.priceAlert.create({ data: { userId, assetId: e.assetId, journalEntryId: e.id, source: p.source, direction: p.direction, price: value, currency: e.currency, active: open } });
    } else if (dec(cur.price).toString() !== value || cur.direction !== p.direction || cur.assetId !== e.assetId) {
      await prisma.priceAlert.update({ where: { id: cur.id }, data: { assetId: e.assetId, price: value, direction: p.direction, currency: e.currency, active: open, triggeredAt: null, triggeredPrice: null } });
    } else if (!open && cur.active) {
      await prisma.priceAlert.update({ where: { id: cur.id }, data: { active: false } });
    } else if (open && !cur.active && !cur.triggeredAt) {
      await prisma.priceAlert.update({ where: { id: cur.id }, data: { active: true } });
    }
  }
}

const DIR_WORD: Record<AlertDirection, string> = { ABOVE: '이상', BELOW: '이하' };

/** Fire every active alert whose price has been reached. Returns how many fired. */
export async function checkPriceAlerts(onlyUserId?: string): Promise<number> {
  const alerts = await prisma.priceAlert.findMany({
    where: { active: true, ...(onlyUserId ? { userId: onlyUserId } : {}) },
    include: { asset: true, journal: { select: { title: true } } },
  });
  const byUser = new Map<string, typeof alerts>();
  for (const a of alerts) byUser.set(a.userId, [...(byUser.get(a.userId) ?? []), a]);
  let fired = 0;
  for (const [userId, list] of byUser) {
    let quotes: Awaited<ReturnType<typeof getQuotes>>;
    try {
      quotes = await getQuotes(userId, [...new Map(list.map((a) => [a.assetId, a.asset])).values()]);
    } catch (e) {
      console.error('[alerts] quotes failed', userId, e instanceof Error ? e.message : e);
      continue;
    }
    for (const a of list) {
      const q = quotes.get(a.assetId);
      // A stale quote is an old close: never fire on it
      if (!q || q.stale) continue;
      const now = q.price.toNumber();
      if (!isCrossed(a.direction, dec(a.price).toNumber(), now)) continue;
      const claimed = await prisma.priceAlert.updateMany({ where: { id: a.id, active: true }, data: { active: false, triggeredAt: new Date(), triggeredPrice: q.price.toString() } });
      if (!claimed.count) continue;
      fired++;
      const what = a.source === 'JOURNAL_TARGET' ? '목표 예상 가격 도달' : a.source === 'JOURNAL_STOP' ? '손절가 도달' : `${money(a.price.toString(), a.currency)} ${DIR_WORD[a.direction]} 도달`;
      await notify(userId, {
        kind: 'PRICE',
        title: `${a.asset.name} ${what}`,
        body: [
          `현재 ${money(now, a.currency)} · 알림 가격 ${money(a.price.toString(), a.currency)} ${DIR_WORD[a.direction]}`,
          a.journal ? `일지: ${a.journal.title}` : a.note ?? '',
        ]
          .filter(Boolean)
          .join('\n'),
        url: a.journalEntryId ? `/journal/${a.journalEntryId}` : a.asset.symbol ? `/market?s=${encodeURIComponent(a.asset.symbol)}` : '/alerts',
      });
    }
  }
  return fired;
}

// ── portfolio target weights ────────────────────────

type Graph = Awaited<ReturnType<typeof userGraph>>;

/** What a portfolio is made of, in KRW: child portfolios (by allocation), assets held directly, and its cash. Liabilities are left out. */
export function portfolioParts(portfolioId: string, state: CurrentState, graph: Graph): DriftPart[] {
  const names = new Map(graph.portfolios.map((p) => [p.id, p.name]));
  const subtree = (id: string) => {
    let v = Dec.ZERO;
    for (const [pid, w] of effectiveWeights(graph.edges, id)) v = v.add((state.direct.get(pid) ?? Dec.ZERO).mul(w));
    return v;
  };
  const parts: DriftPart[] = graph.edges
    .filter((e) => e.parentId === portfolioId)
    .map((e) => ({ key: `P:${e.childId}`, label: names.get(e.childId) ?? '하위 포트폴리오', value: subtree(e.childId).mul(e.allocation).toNumber() }));
  const byAsset = new Map<string, DriftPart>();
  for (const h of state.holdings) {
    if (h.portfolioId !== portfolioId || h.type === 'LIABILITY') continue;
    const cur = byAsset.get(h.assetId);
    if (cur) cur.value += h.valueFull.toNumber();
    else byAsset.set(h.assetId, { key: h.assetId, label: h.name, value: h.valueFull.toNumber() });
  }
  parts.push(...byAsset.values());
  const cash = Dec.sum((state.cashByPortfolio.get(portfolioId) ?? []).map((c) => c.krw)).toNumber();
  if (cash > 0) parts.push({ key: 'CASH', label: '현금', value: cash });
  return parts;
}

export interface TargetsView {
  report: DriftReport;
  tolerance: number;
  alert: boolean;
  /** Labels for target keys no longer held (sold assets) */
  labels: Record<string, string>;
}

export async function portfolioTargets(userId: string, portfolioId: string, state: CurrentState, graph: Graph): Promise<TargetsView> {
  const p = await prisma.portfolio.findFirst({ where: { id: portfolioId, userId }, include: { targets: true } });
  if (!p) throw new UserError('포트폴리오를 찾을 수 없습니다.');
  const targets = Object.fromEntries(p.targets.map((t) => [t.key, dec(t.weight).toNumber()]));
  const tolerance = dec(p.driftTolerance).toNumber();
  const report = driftReport(portfolioParts(portfolioId, state, graph), targets, tolerance);
  const missing = report.rows.filter((r) => r.label === r.key).map((r) => r.key);
  const labels: Record<string, string> = {};
  if (missing.length) {
    const assets = await prisma.asset.findMany({ where: { userId, id: { in: missing } }, select: { id: true, name: true } });
    for (const a of assets) labels[a.id] = a.name;
    const names = new Map(graph.portfolios.map((x) => [`P:${x.id}`, x.name]));
    for (const k of missing) if (names.has(k)) labels[k] = names.get(k)!;
    if (missing.includes('CASH')) labels.CASH = '현금';
  }
  for (const r of report.rows) if (labels[r.key]) r.label = labels[r.key];
  return { report, tolerance, alert: p.driftAlert, labels };
}

/** Save target weights (percent strings, '' = none), the tolerance (%p) and whether to notify. */
export async function savePortfolioTargets(userId: string, portfolioId: string, input: { targets: Record<string, string>; tolerance: string; alert: boolean }) {
  const p = await prisma.portfolio.findFirst({ where: { id: portfolioId, userId } });
  if (!p) throw new UserError('포트폴리오를 찾을 수 없습니다.');
  const graph = await userGraph(userId);
  const children = new Set(graph.edges.filter((e) => e.parentId === portfolioId).map((e) => `P:${e.childId}`));
  const entries = Object.entries(input.targets)
    .map(([k, v]) => [k, v.trim()] as const)
    .filter(([, v]) => v !== '');
  const assetKeys = entries.map(([k]) => k).filter((k) => k !== 'CASH' && !k.startsWith('P:'));
  const owned = new Set((await prisma.asset.findMany({ where: { userId, id: { in: assetKeys } }, select: { id: true } })).map((a) => a.id));
  const rows: Prisma.PortfolioTargetCreateManyInput[] = [];
  for (const [key, v] of entries) {
    if (!(key === 'CASH' || children.has(key) || owned.has(key))) throw new UserError('목표 항목이 바뀌었습니다. 새로고침 후 다시 시도하세요.');
    const w = Number(v.replace('%', '')) / 100;
    if (!Number.isFinite(w)) throw new UserError('목표 비중은 숫자로 입력하세요.');
    rows.push({ portfolioId, key, weight: w.toString() });
  }
  if (!targetsOk(rows.map((r) => Number(r.weight)))) throw new UserError('목표 비중은 0~100%이고 합이 100%를 넘을 수 없습니다.');
  const tol = Number(input.tolerance.replace('%', '')) / 100;
  if (!Number.isFinite(tol) || tol < 0.001 || tol > 0.5) throw new UserError('허용 오차는 0.1%p ~ 50%p 사이로 입력하세요.');
  if (input.alert && !rows.length) throw new UserError('알림을 받으려면 목표 비중을 하나 이상 정하세요.');
  await prisma.$transaction([
    prisma.portfolioTarget.deleteMany({ where: { portfolioId } }),
    prisma.portfolioTarget.createMany({ data: rows }),
    // New targets or band: report whatever is out of band at the next check
    prisma.portfolio.update({ where: { id: portfolioId }, data: { driftTolerance: tol.toString(), driftAlert: input.alert, driftBreaches: [] } }),
  ]);
}

/** Notify portfolios whose parts moved out of their band since the last check. Returns how many notified. */
export async function checkDrift(onlyUserId?: string): Promise<number> {
  const portfolios = await prisma.portfolio.findMany({
    where: { driftAlert: true, archived: false, targets: { some: {} }, ...(onlyUserId ? { userId: onlyUserId } : {}) },
    include: { targets: true },
  });
  const byUser = new Map<string, typeof portfolios>();
  for (const p of portfolios) byUser.set(p.userId, [...(byUser.get(p.userId) ?? []), p]);
  let sent = 0;
  for (const [userId, list] of byUser) {
    let state: CurrentState, graph: Graph;
    try {
      [state, graph] = await Promise.all([currentState(userId), userGraph(userId)]);
    } catch (e) {
      console.error('[alerts] drift state failed', userId, e instanceof Error ? e.message : e);
      continue;
    }
    for (const p of list) {
      const tolerance = dec(p.driftTolerance).toNumber();
      const report = driftReport(portfolioParts(p.id, state, graph), Object.fromEntries(p.targets.map((t) => [t.key, dec(t.weight).toNumber()])), tolerance);
      if (report.total <= 0) continue;
      const fresh = newlyBreached(p.driftBreaches, report.breaches);
      if (report.breaches.join() !== p.driftBreaches.join()) await prisma.portfolio.update({ where: { id: p.id }, data: { driftBreaches: report.breaches } });
      if (!fresh.length) continue;
      sent++;
      const lines = report.rows
        .filter((r) => r.breach)
        .map((r) => `${r.label} ${pct(r.share, 1, false)} (목표 ${pct(r.target!, 1, false)}, ${r.diff! > 0 ? '+' : '−'}${pct(Math.abs(r.diff!), 1, false)}p)`);
      await notify(userId, {
        kind: 'DRIFT',
        title: `${p.name} 목표 비중에서 ${pct(tolerance, 1, false)}p 넘게 벗어남`,
        body: lines.join('\n'),
        url: `/portfolios/${p.id}#targets`,
      });
    }
  }
  return sent;
}
