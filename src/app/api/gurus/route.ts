import { NextResponse } from 'next/server';
import { currentUser } from '@/server/auth';
import { guruView, gurusView } from '@/server/services/gurus';
import { UserError } from '@/server/services/portfolios';

export const dynamic = 'force-dynamic';

/** 거장 포트폴리오: ?view=list · guru&g=<key> */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  try {
    const body = sp.get('view') === 'guru' ? await guruView(user.id, sp.get('g') ?? '') : await gurusView(user.id);
    return NextResponse.json(body, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    if (e instanceof UserError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error('[gurus]', sp.toString(), e);
    return NextResponse.json({ error: '거장 포트폴리오를 불러오지 못했습니다. 잠시 뒤 다시 시도하세요.' }, { status: 502 });
  }
}
