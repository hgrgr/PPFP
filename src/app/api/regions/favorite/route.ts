import { NextResponse } from 'next/server';
import { z } from 'zod';
import { currentUser } from '@/server/auth';
import { setFavorite } from '@/server/services/complex-analysis';
import { UserError } from '@/server/services/portfolios';

export const dynamic = 'force-dynamic';

const Body = z.object({ region: z.string().max(60), lawdCd: z.string().regex(/^\d{5}$/), complexKey: z.string().min(1).max(200), name: z.string().max(100), umdNm: z.string().max(50), on: z.boolean() });

/** Star or unstar a complex on 단지 분석 (관심 단지) */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 });
  try {
    await setFavorite(user.id, parsed.data);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof UserError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error('[regions] favorite', e);
    return NextResponse.json({ error: '저장하지 못했습니다.' }, { status: 500 });
  }
}
