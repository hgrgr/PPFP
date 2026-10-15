import { NextResponse } from 'next/server';
import { currentUser } from '@/server/auth';
import { mapView, rankView, sectorsView, watchView, yieldsView } from '@/server/services/market-overview';
import { UserError } from '@/server/services/portfolios';

export const dynamic = 'force-dynamic';

/** 시장 개요 views: ?view=sectors · map · yields · watch · rank */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const view = new URL(req.url).searchParams.get('view');
  try {
    const body =
      view === 'sectors'
        ? await sectorsView(user.id)
        : view === 'map'
          ? await mapView(user.id)
          : view === 'yields'
            ? await yieldsView(user.id)
            : view === 'watch'
              ? await watchView(user.id)
              : view === 'rank'
                ? await rankView(user.id)
                : null;
    if (!body) return NextResponse.json({ error: '없는 화면입니다.' }, { status: 400 });
    return NextResponse.json(body);
  } catch (e) {
    if (e instanceof UserError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error('[markets]', e);
    return NextResponse.json({ error: '시장 자료를 불러오지 못했습니다. 잠시 뒤 다시 시도하세요.' }, { status: 502 });
  }
}
