import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { currentUser } from '@/server/auth';
import { kstDate, prisma } from '@/server/db';
import { fxRate as currentFx } from '@/server/market';
import { currentState } from '@/server/services/analytics';
import { UserError } from '@/server/services/portfolios';
import { rebuildSnapshots } from '@/server/services/snapshots';
import { moveHolding } from '@/server/services/trading';
import { addPosition } from '@/server/services/virtual';
import type { VKind } from '@/domain/virtual';
import { yahooSymbols } from '@/domain/market-overview';

export const dynamic = 'force-dynamic';

const Body = z.object({ holdingId: z.string().min(1), to: z.string().min(1) });

/** The paper kind a real asset type copies to (real estate and liabilities have no market price to follow) */
const KIND: Record<string, VKind | null> = { KR_STOCK: 'STOCK', US_STOCK: 'STOCK', FUND: 'FUND', BOND: 'BOND', CRYPTO: 'CRYPTO', ALTERNATIVE: 'COMMODITY', CASH: 'CASH', REAL_ESTATE: null, LIABILITY: null };

/**
 * 바구니 담기: drop a holding into a basket. A real portfolio moves it there for good (the same
 * move as 보유 자산 › 옮기기, cash kept); a 가상 포트폴리오 gets a paper copy bought today at its
 * value, leaving the real holding where it was.
 */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 });
  const { holdingId, to } = parsed.data;
  try {
    if (to.startsWith('v:')) {
      const state = await currentState(user.id);
      const h = state.holdings.find((x) => x.holdingId === holdingId);
      if (!h) throw new UserError('보유 종목을 찾을 수 없습니다.');
      const kind = KIND[h.type];
      if (!kind) throw new UserError(`${h.name}은(는) 가상 포트폴리오에 복사할 수 없는 종류입니다(부동산은 가상 포트폴리오 화면에서 지역 지수로 담으세요).`);
      const value = Math.round(h.valueFull.toNumber());
      if (value <= 0) throw new UserError('평가액이 없어 담을 수 없습니다.');
      await addPosition(user.id, to.slice(2), kind === 'CASH' ? { kind, name: h.name, buyDate: kstDate(), mode: 'AMOUNT', amount: value } : { kind, query: h.symbol ? yahooSymbols(h.symbol, null)[0].replace(/\.KS$/, '') : h.name, name: h.name, buyDate: kstDate(), mode: 'AMOUNT', amount: value, note: '바구니에서 복사' });
      const v = await prisma.virtualPortfolio.findFirst({ where: { id: to.slice(2), userId: user.id }, select: { name: true } });
      return NextResponse.json({ ok: true, message: `${h.name}이(가) 꿈 바구니 '${v?.name ?? ''}'에 쏙 들어갔어요! 오늘 가격으로 복사했고, 실제 자산은 그대로예요.` });
    }
    const moved = await moveHolding(user.id, holdingId, to, { settle: true, usdkrw: (await currentFx(user.id, 'USD')).toString() });
    if (moved.firstDate && moved.firstDate < kstDate()) await rebuildSnapshots(user.id, moved.firstDate);
    revalidatePath('/', 'layout');
    return NextResponse.json({ ok: true, message: `${moved.name}이(가) ${moved.from}에서 ${moved.to}(으)로 이사했어요 (거래 ${moved.count}건${moved.merged ? ', 기존 보유와 합침' : ''}).` });
  } catch (e) {
    if (e instanceof UserError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error('[basket]', e);
    return NextResponse.json({ error: '담지 못했습니다. 잠시 뒤 다시 시도하세요.' }, { status: 500 });
  }
}
