import { NextResponse } from 'next/server';
import { currentUser } from '@/server/auth';
import { liveRankings } from '@/server/services/market-board';
import type { RankingMarket, RankingType } from '@/server/brokers';

export const dynamic = 'force-dynamic';

const MARKETS: RankingMarket[] = ['KR', 'US'];
const TYPES: RankingType[] = ['AMOUNT', 'VOLUME', 'GAINERS', 'LOSERS'];

export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const url = new URL(req.url);
  const market = url.searchParams.get('market') as RankingMarket;
  const type = url.searchParams.get('type') as RankingType;
  if (!MARKETS.includes(market) || !TYPES.includes(type)) return NextResponse.json({ error: 'bad request' }, { status: 400 });
  return NextResponse.json(await liveRankings(user.id, market, type), { headers: { 'cache-control': 'no-store' } });
}
