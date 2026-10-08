import { NextResponse } from 'next/server';
import { isKType } from '@/domain/knowledge';
import { currentUser } from '@/server/auth';
import { relatedView } from '@/server/services/knowledge';

export const dynamic = 'force-dynamic';

/** Notes, books, investors, keywords, traits and stocks related to one item (?type=&id=). */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const type = sp.get('type');
  const id = sp.get('id');
  if (!isKType(type) || !id) return NextResponse.json({ error: 'bad request' }, { status: 400 });
  return NextResponse.json(await relatedView(user.id, { type, id }), { headers: { 'cache-control': 'no-store' } });
}
