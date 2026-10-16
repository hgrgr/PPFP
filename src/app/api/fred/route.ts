import { NextResponse } from 'next/server';
import { z } from 'zod';
import { currentUser } from '@/server/auth';
import { saveSheet, searchSeries } from '@/server/services/fred';
import { UserError } from '@/server/services/portfolios';

export const dynamic = 'force-dynamic';

/** ?q= series search for 내 지표 시트 */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try {
    return NextResponse.json({ results: await searchSeries(user.id, new URL(req.url).searchParams.get('q') ?? '') });
  } catch (e) {
    if (e instanceof UserError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error('[fred] search', e);
    return NextResponse.json({ error: 'FRED 검색에 실패했습니다.' }, { status: 502 });
  }
}

const Body = z.object({ items: z.array(z.object({ id: z.string().max(40), title: z.string().max(300), units: z.string().max(60), frequency: z.string().max(20), transform: z.enum(['level', 'yoy', 'mom', 'diff']) })).max(24) });

/** Save the whole sheet: { items } */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 });
  return NextResponse.json({ items: await saveSheet(user.id, parsed.data.items) });
}
