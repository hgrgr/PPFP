import { NextResponse } from 'next/server';
import { currentUser } from '@/server/auth';
import { liveCommodities } from '@/server/services/market-board';

export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json(await liveCommodities(user.id), { headers: { 'cache-control': 'no-store' } });
}
