import { NextResponse } from 'next/server';
import { currentUser } from '@/server/auth';
import { riskView } from '@/server/services/risk';
import { UserError } from '@/server/services/portfolios';

export const dynamic = 'force-dynamic';

/** 리스크 분석: ?years=1|3|5 */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try {
    return NextResponse.json(await riskView(user.id, Number(new URL(req.url).searchParams.get('years') ?? 3)), { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    if (e instanceof UserError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error('[risk]', e);
    return NextResponse.json({ error: '리스크 분석을 불러오지 못했습니다.' }, { status: 502 });
  }
}
