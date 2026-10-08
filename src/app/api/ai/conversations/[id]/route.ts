import { NextResponse } from 'next/server';
import { currentUser } from '@/server/auth';
import { conversationView } from '@/server/services/ai/actions';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const view = await conversationView(user.id, (await params).id);
  if (!view) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(view, { headers: { 'cache-control': 'no-store' } });
}
