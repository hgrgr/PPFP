import { NextResponse } from 'next/server';
import { currentUser } from '@/server/auth';
import { getJournal } from '@/server/services/journal';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const entry = await getJournal(user.id, (await params).id);
  if (!entry) return NextResponse.json({ error: '매매일지를 찾을 수 없습니다.' }, { status: 404 });
  return NextResponse.json(entry, { headers: { 'cache-control': 'no-store' } });
}
