import { NextResponse } from 'next/server';
import { currentUser } from '@/server/auth';
import { listJournals } from '@/server/services/journal';

export const dynamic = 'force-dynamic';

/** Journal summaries, optionally for one asset (?asset=). */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const rows = await listJournals(user.id, { assetId: sp.get('asset') ?? undefined, status: sp.get('status') ?? undefined, q: sp.get('q') ?? undefined });
  return NextResponse.json(rows, { headers: { 'cache-control': 'no-store' } });
}
