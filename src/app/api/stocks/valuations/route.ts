import { NextResponse } from 'next/server';
import { z } from 'zod';
import { currentUser } from '@/server/auth';
import { deleteValuation, saveValuation } from '@/server/services/stock-analysis';
import { UserError } from '@/server/services/portfolios';

export const dynamic = 'force-dynamic';

const Body = z.object({
  symbol: z.string().min(1).max(12),
  method: z.enum(['DCF', 'REVERSE_DCF', 'DDM', 'RIM']),
  inputs: z.record(z.string(), z.number()),
  value: z.number().finite(),
  price: z.number().finite().nullable(),
  note: z.string().max(300).optional(),
});

/** Save a fair-value estimate: { symbol, method, inputs, value, price, note } */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 });
  try {
    const v = await saveValuation(user.id, parsed.data);
    return NextResponse.json({ id: v.id });
  } catch (e) {
    if (e instanceof UserError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error('[valuations]', e);
    return NextResponse.json({ error: '저장하지 못했습니다.' }, { status: 500 });
  }
}

/** ?id= */
export async function DELETE(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  await deleteValuation(user.id, new URL(req.url).searchParams.get('id') ?? '');
  return NextResponse.json({ ok: true });
}
