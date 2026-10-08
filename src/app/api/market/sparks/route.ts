import { NextResponse } from 'next/server';
import { cleanSymbol } from '@/domain/broker-format';
import { currentUser } from '@/server/auth';
import { prisma } from '@/server/db';
import { sparklines } from '@/server/services/market-board';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const symbols = [...new Set((new URL(req.url).searchParams.get('symbols') ?? '').split(',').map(cleanSymbol).filter((s): s is string => !!s))].slice(0, 120);
  if (!symbols.length) return NextResponse.json({});
  // Known markets help the US lookups go straight to the right exchange.
  const [assets, watch] = await Promise.all([
    prisma.asset.findMany({ where: { userId: user.id, symbol: { in: symbols } }, select: { symbol: true, market: true } }),
    prisma.watchItem.findMany({ where: { userId: user.id, symbol: { in: symbols } }, select: { symbol: true, market: true } }),
  ]);
  const market = new Map([...watch, ...assets].map((a) => [a.symbol!, a.market]));
  return NextResponse.json(await sparklines(user.id, symbols.map((s) => ({ symbol: s, market: market.get(s) ?? null }))), { headers: { 'cache-control': 'no-store' } });
}
