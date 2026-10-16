import { NextResponse } from 'next/server';
import { currentUser } from '@/server/auth';
import { insiderView, isKrQuery, krFilingsView, peersView, stockView } from '@/server/services/stock-analysis';
import { UserError } from '@/server/services/portfolios';

export const dynamic = 'force-dynamic';

/** 종목 분석 views: ?view=stock|peers|insider&t=<ticker> */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const t = sp.get('t') ?? '';
  try {
    const view = sp.get('view');
    const body = view === 'peers' ? await peersView(user.id, t) : view === 'insider' ? (isKrQuery(t) ? await krFilingsView(user.id, t) : await insiderView(user.id, t)) : await stockView(user.id, t);
    return NextResponse.json(body, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    if (e instanceof UserError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error('[stocks]', sp.toString(), e);
    return NextResponse.json({ error: '종목 자료를 불러오지 못했습니다. 잠시 뒤 다시 시도하세요.' }, { status: 502 });
  }
}
