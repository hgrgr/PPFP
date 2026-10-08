import type { AssetType } from '@prisma/client';
import { buildJournalTree, type TreeNode } from '@/domain/journal-tree';
import { TXN_LABEL } from '@/domain/ledger';
import { money, qty } from '@/lib/format';
import { dec, kstDate, prisma } from '../db';
import { TYPE_COLOR } from './analytics';
import { ASSET_TYPE_LABEL } from './assets';
import { assetTraitMap, holdingValues, traitGroups } from './traits';

export interface Grouping {
  key: string;
  label: string;
}

/**
 * The journal tree for one way of grouping assets: 'type' (asset type) or a
 * trait group id. Assets are the ones held now plus any with a journal.
 */
export async function journalTree(userId: string, grouping: string): Promise<{ tree: TreeNode; groupings: Grouping[]; current: string }> {
  const [groups, tags, values, journals] = await Promise.all([
    traitGroups(userId),
    assetTraitMap(userId),
    holdingValues(userId),
    prisma.journalEntry.findMany({ where: { userId }, include: { txns: { select: { transactionId: true } } } }),
  ]);
  const groupings: Grouping[] = [{ key: 'type', label: '자산 유형' }, ...groups.map((g) => ({ key: g.id, label: g.name }))];
  const current = groupings.some((g) => g.key === grouping) ? grouping : 'type';
  const group = groups.find((g) => g.id === current);

  const ids = new Set([...values.byAsset.keys(), ...journals.map((j) => j.assetId)]);
  const [assets, trades] = await Promise.all([
    prisma.asset.findMany({ where: { userId, id: { in: [...ids] }, type: { not: 'LIABILITY' } } }),
    prisma.transaction.findMany({
      where: { type: { in: ['BUY', 'SELL'] }, portfolio: { userId }, holding: { assetId: { in: [...ids] } } },
      include: { holding: { select: { assetId: true } } },
      orderBy: { tradeAt: 'desc' },
    }),
  ]);

  const types = [...new Set(assets.map((a) => a.type))] as AssetType[];
  const categories = group
    ? group.traits.map((t) => ({ key: t.id, label: t.name, color: t.color }))
    : (Object.keys(ASSET_TYPE_LABEL) as AssetType[]).filter((t) => types.includes(t)).map((t) => ({ key: t, label: ASSET_TYPE_LABEL[t], color: TYPE_COLOR[t] }));

  const tree = buildJournalTree({
    rootLabel: '순자산',
    categories,
    assets: assets.map((a) => ({ id: a.id, name: a.name, symbol: a.symbol, value: values.byAsset.get(a.id) ?? 0, categories: group ? tags.get(a.id) ?? [] : [a.type] })),
    journals: journals.map((j) => ({ id: j.id, assetId: j.assetId, title: j.title, date: j.entryDate.toISOString().slice(0, 10), status: j.status, txnIds: j.txns.map((t) => t.transactionId) })),
    trades: trades.map((t) => ({
      id: t.id,
      assetId: t.holding!.assetId,
      type: t.type,
      date: kstDate(t.tradeAt),
      label: `${TXN_LABEL[t.type]} ${t.qty ? qty(dec(t.qty).toString()) : ''}${t.price ? ` @ ${money(dec(t.price).toString(), t.currency)}` : ''}`,
    })),
  });
  return { tree, groupings, current };
}
