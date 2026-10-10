/**
 * Everything the user holds, one row per asset: where it sits, what it is worth and how it
 * is classified. Values are plain numbers (KRW) so the page can sort and filter on the client.
 */
import type { AssetType } from '@prisma/client';
import { Dec } from '@/domain/decimal';
import { prisma } from '../db';
import { currentState } from './analytics';
import { userGraph } from './portfolios';
import { assetTraitMap, traitGroups } from './traits';

export interface Position {
  holdingId: string;
  portfolioId: string;
  portfolioName: string;
  color: string;
  qty: string;
  value: number;
  cost: number;
  lots: number;
  txns: number;
  /** Has broker-synced transactions (a later sync looks for them in this portfolio) */
  synced: boolean;
}

export interface BookAsset {
  assetId: string;
  name: string;
  symbol: string | null;
  market: string | null;
  type: AssetType;
  currency: string;
  price: string | null;
  stale: boolean;
  qty: string;
  value: number;
  cost: number;
  /** Share of everything held (liabilities excluded), 0–1 */
  weight: number;
  positions: Position[];
  traitIds: string[];
  journals: number;
}

export interface AssetBook {
  assets: BookAsset[];
  portfolios: { id: string; name: string; color: string; archived: boolean }[];
  groups: { id: string; name: string; traits: { id: string; name: string; color: string }[] }[];
  total: number;
  usdkrw: string;
}

export async function assetBook(userId: string): Promise<AssetBook> {
  const [state, graph, groups, tags] = await Promise.all([currentState(userId), userGraph(userId), traitGroups(userId), assetTraitMap(userId)]);
  const holdingIds = state.holdings.map((h) => h.holdingId);
  const assetIds = [...new Set(state.holdings.map((h) => h.assetId))];
  const [txnCounts, syncedRows, journalCounts] = await Promise.all([
    prisma.transaction.groupBy({ by: ['holdingId'], where: { holdingId: { in: holdingIds } }, _count: { _all: true } }),
    prisma.transaction.groupBy({ by: ['holdingId'], where: { holdingId: { in: holdingIds }, externalRef: { not: null } }, _count: { _all: true } }),
    prisma.journalEntry.groupBy({ by: ['assetId'], where: { userId, assetId: { in: assetIds } }, _count: { _all: true } }),
  ]);
  const txns = new Map(txnCounts.map((g) => [g.holdingId, g._count._all]));
  const synced = new Set(syncedRows.map((g) => g.holdingId));
  const journals = new Map(journalCounts.map((g) => [g.assetId, g._count._all]));
  const portfolios = new Map(graph.portfolios.map((p) => [p.id, p]));

  const byAsset = new Map<string, BookAsset & { qtyDec: Dec }>();
  for (const h of state.holdings) {
    const p = portfolios.get(h.portfolioId);
    let a = byAsset.get(h.assetId);
    if (!a) {
      a = {
        assetId: h.assetId,
        name: h.name,
        symbol: h.symbol,
        market: null,
        type: h.type,
        currency: h.currency,
        price: h.price?.toString() ?? null,
        stale: h.stale,
        qty: '0',
        qtyDec: Dec.ZERO,
        value: 0,
        cost: 0,
        weight: 0,
        positions: [],
        traitIds: tags.get(h.assetId) ?? [],
        journals: journals.get(h.assetId) ?? 0,
      };
      byAsset.set(h.assetId, a);
    }
    a.qtyDec = a.qtyDec.add(h.qty);
    a.value += h.valueFull.toNumber();
    a.cost += h.costFull.toNumber();
    a.positions.push({
      holdingId: h.holdingId,
      portfolioId: h.portfolioId,
      portfolioName: p?.name ?? '',
      color: p?.color ?? 'var(--muted)',
      qty: h.qty.toString(),
      value: h.valueFull.toNumber(),
      cost: h.costFull.toNumber(),
      lots: h.lots,
      txns: txns.get(h.holdingId) ?? 0,
      synced: synced.has(h.holdingId),
    });
  }
  const markets = new Map((await prisma.asset.findMany({ where: { id: { in: assetIds } }, select: { id: true, market: true } })).map((m) => [m.id, m.market]));
  const total = [...byAsset.values()].reduce((s, a) => s + (a.type === 'LIABILITY' ? 0 : Math.max(0, a.value)), 0);
  const assets: BookAsset[] = [...byAsset.values()]
    .map(({ qtyDec, ...a }) => ({
      ...a,
      qty: qtyDec.toString(),
      market: markets.get(a.assetId) ?? null,
      weight: total > 0 && a.type !== 'LIABILITY' ? Math.max(0, a.value) / total : 0,
      positions: a.positions.sort((x, y) => y.value - x.value),
    }))
    .sort((x, y) => y.value - x.value || x.name.localeCompare(y.name));

  return {
    assets,
    portfolios: graph.portfolios.map((p) => ({ id: p.id, name: p.name, color: p.color, archived: p.archived })),
    groups: groups.map((g) => ({ id: g.id, name: g.name, traits: g.traits.map((t) => ({ id: t.id, name: t.name, color: t.color })) })),
    total,
    usdkrw: state.usdkrw.toFixed(2),
  };
}
