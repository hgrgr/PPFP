/**
 * Daily job: store closes and FX, then rebuild recent snapshots.
 * Run after the US close (e.g. 07:10 KST) and after the KR close (16:10 KST).
 */
import { Dec } from '@/domain/decimal';
import { minusMonths } from '@/domain/period';
import { kstDate, prisma } from '../db';
import { backfillCloses, recordTodayFx, storeClose, tossClientFor } from '../market';
import { rebuildSnapshots } from './snapshots';

export async function runDailyForUser(userId: string, opts: { fullRebuild?: boolean } = {}) {
  const today = kstDate();
  const assets = await prisma.asset.findMany({ where: { userId, priceSource: 'TOSS', symbol: { not: null }, holdings: { some: {} } } });
  const first = await prisma.transaction.findFirst({ where: { portfolio: { userId } }, orderBy: { tradeAt: 'asc' }, select: { tradeAt: true } });
  const client = await tossClientFor(userId);
  let closes = 0;
  if (client && assets.length) {
    const since = first ? [kstDate(first.tradeAt), minusMonths(today, 36)].sort().at(-1)! : today;
    closes = await backfillCloses(userId, assets.map((a) => a.symbol!), since);
    try {
      for (const p of await client.prices(assets.map((a) => a.symbol!))) {
        if (p.timestamp) await storeClose(p.symbol.toUpperCase(), kstDate(new Date(p.timestamp)), Dec.of(p.lastPrice), p.currency);
      }
      await recordTodayFx(userId);
    } catch (e) {
      console.error('[jobs] latest prices failed', userId, e instanceof Error ? e.message : e);
    }
  }
  const lastSnap = await prisma.snapshot.findFirst({ where: { portfolio: { userId } }, orderBy: { date: 'desc' }, select: { date: true } });
  const from = opts.fullRebuild || !lastSnap ? undefined : minusMonths(today, 1);
  const snaps = await rebuildSnapshots(userId, from);
  return { closes, ...snaps };
}

export async function runDailyForAll() {
  const users = await prisma.user.findMany({ select: { id: true } });
  const results: Record<string, unknown> = {};
  for (const u of users) {
    try {
      results[u.id] = await runDailyForUser(u.id);
    } catch (e) {
      results[u.id] = { error: e instanceof Error ? e.message : String(e) };
    }
  }
  return results;
}
