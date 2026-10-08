import { NextResponse } from 'next/server';
import { currentUser } from '@/server/auth';
import { txnCandidates } from '@/server/services/journal';
import { UserError } from '@/server/services/portfolios';

export const dynamic = 'force-dynamic';

/** Trades of one asset an entry can link to (?asset=), with its current price. */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try {
    return NextResponse.json(await txnCandidates(user.id, new URL(req.url).searchParams.get('asset') ?? ''), { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    if (e instanceof UserError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
