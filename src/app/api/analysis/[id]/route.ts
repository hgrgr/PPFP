import { NextResponse } from 'next/server';
import { readPrefs } from '@/domain/indicators';
import { currentUser } from '@/server/auth';
import { indicatorView } from '@/server/services/indicators';
import { UserError } from '@/server/services/portfolios';

export const dynamic = 'force-dynamic';

/** One 분석 지표 chart for ?region=&income=&years= (the screen's current choice), else the saved one. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;
  const sp = new URL(req.url).searchParams;
  const saved = readPrefs(user.analysisPrefs);
  const prefs = readPrefs({ ...saved, region: sp.get('region') ?? saved.region, incomeBase: sp.get('income') ?? saved.incomeBase, years: sp.has('years') ? Number(sp.get('years')) : saved.years });
  try {
    const view = await indicatorView(user.id, id, { region: prefs.region, incomeBase: prefs.incomeBase }, prefs.years);
    return NextResponse.json(view, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    if (e instanceof UserError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error('[analysis]', id, e);
    return NextResponse.json({ error: '지표를 불러오지 못했습니다.' }, { status: 500 });
  }
}
