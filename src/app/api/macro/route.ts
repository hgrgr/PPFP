import { NextResponse } from 'next/server';
import { currentUser } from '@/server/auth';
import { cotView, countriesView, cycleView, gdpView, rotationView } from '@/server/services/macro';
import { UserError } from '@/server/services/portfolios';

export const dynamic = 'force-dynamic';

/** 글로벌 매크로 views: ?view=countries · cycle · rotation · cot · gdp */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const view = new URL(req.url).searchParams.get('view');
  try {
    const body =
      view === 'countries'
        ? await countriesView(user.id)
        : view === 'cycle'
          ? await cycleView(user.id)
          : view === 'rotation'
            ? await rotationView(user.id)
            : view === 'cot'
              ? await cotView(user.id)
              : view === 'gdp'
                ? await gdpView(user.id)
                : null;
    if (!body) return NextResponse.json({ error: '없는 화면입니다.' }, { status: 400 });
    return NextResponse.json(body, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    if (e instanceof UserError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error('[macro]', view, e);
    return NextResponse.json({ error: '매크로 자료를 불러오지 못했습니다. 잠시 뒤 다시 시도하세요.' }, { status: 502 });
  }
}
