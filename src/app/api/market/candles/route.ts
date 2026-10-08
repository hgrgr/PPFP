import { NextResponse } from 'next/server';
import { CANDLE_UNITS, type CandleUnit } from '@/domain/candles';
import { currentUser } from '@/server/auth';
import { liveCandles } from '@/server/services/market-board';
import { UserError } from '@/server/services/portfolios';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const url = new URL(req.url);
  const unit = url.searchParams.get('unit') as CandleUnit;
  if (!CANDLE_UNITS.includes(unit)) return NextResponse.json({ error: 'bad unit' }, { status: 400 });
  try {
    return NextResponse.json(await liveCandles(user.id, url.searchParams.get('symbol') ?? '', unit), { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    if (e instanceof UserError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
