import { NextResponse } from 'next/server';
import { currentUser } from '@/server/auth';
import { complexDetailView, complexView, favoritesView } from '@/server/services/complex-analysis';
import { buyersView, compareView, corrView, cycleView, oneView } from '@/server/services/region-analysis';
import { UserError } from '@/server/services/portfolios';

export const dynamic = 'force-dynamic';

/**
 * 지역 분석 views: ?view=one&r=&years= · compare&r=&r=&years= · cycle[&r=...]&window=6|12&real=1 ·
 * corr&r=&macro=&years= · complex&r=&years=3|5|10 · complex-detail&r=&lawd=&k=&years= · favorites · buyers&r=&years=
 */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const years = Math.max(0, Math.min(30, Number(sp.get('years') ?? 10) || 0));
  const regions = sp.getAll('r');
  try {
    const view = sp.get('view');
    const body =
      view === 'one'
        ? await oneView(user.id, regions[0] ?? '', years)
        : view === 'compare'
          ? await compareView(user.id, regions, years)
          : view === 'cycle'
            ? await cycleView(user.id, regions, sp.get('window') === '12' ? 12 : 6, sp.get('real') !== '0')
            : view === 'corr'
              ? await corrView(user.id, regions[0] ?? '', sp.get('macro') ?? 'base', years)
              : view === 'complex'
                ? await complexView(user.id, regions[0] ?? '', years)
                : view === 'complex-detail'
                  ? await complexDetailView(user.id, regions[0] ?? '', sp.get('lawd') ?? '', sp.get('k') ?? '', years)
                  : view === 'favorites'
                    ? await favoritesView(user.id)
                    : view === 'buyers'
                      ? await buyersView(user.id, regions[0] ?? '', years)
                      : null;
    if (!body) return NextResponse.json({ error: '없는 화면입니다.' }, { status: 400 });
    return NextResponse.json(body, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    if (e instanceof UserError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error('[regions]', sp.toString(), e);
    return NextResponse.json({ error: '지역 분석을 불러오지 못했습니다.' }, { status: 500 });
  }
}
