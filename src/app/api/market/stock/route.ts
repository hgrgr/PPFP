import { NextResponse } from 'next/server';
import { currentUser } from '@/server/auth';
import { stockDetail } from '@/server/services/market-board';
import { UserError } from '@/server/services/portfolios';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try {
    const detail = await stockDetail(user.id, new URL(req.url).searchParams.get('symbol') ?? '');
    return NextResponse.json(detail, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    if (e instanceof UserError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
