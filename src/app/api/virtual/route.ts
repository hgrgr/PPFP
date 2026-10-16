import { NextResponse } from 'next/server';
import { z } from 'zod';
import { currentUser } from '@/server/auth';
import { addPosition, createPortfolio, deletePortfolio, deletePosition, detailView, listView, resolveSymbol, updatePortfolio, updatePosition } from '@/server/services/virtual';
import { KINDS, type VKind } from '@/domain/virtual';
import { UserError } from '@/server/services/portfolios';

export const dynamic = 'force-dynamic';

const fail = (e: unknown, what: string) => {
  if (e instanceof UserError) return NextResponse.json({ error: e.message }, { status: 400 });
  console.error('[virtual]', what, e);
  return NextResponse.json({ error: '처리하지 못했습니다. 잠시 뒤 다시 시도하세요.' }, { status: 500 });
};

/** 가상 포트폴리오: list · ?id= one portfolio · ?resolve=&kind= check a symbol */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  try {
    if (sp.has('resolve')) return NextResponse.json(await resolveSymbol(user.id, (KINDS.includes(sp.get('kind') as VKind) ? sp.get('kind') : 'STOCK') as VKind, sp.get('resolve') ?? ''));
    const id = sp.get('id');
    return NextResponse.json(id ? await detailView(user.id, id) : await listView(user.id), { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    return fail(e, 'view');
  }
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), name: z.string().max(60), note: z.string().max(500).optional(), benchmark: z.string().max(20).optional() }),
  z.object({ action: z.literal('update'), id: z.string(), name: z.string().max(60).optional(), note: z.string().max(500).optional(), benchmark: z.string().max(20).optional() }),
  z.object({ action: z.literal('delete'), id: z.string() }),
  z.object({
    action: z.literal('add'),
    id: z.string(),
    kind: z.enum(KINDS as [VKind, ...VKind[]]),
    query: z.string().max(100).optional(),
    name: z.string().max(100).optional(),
    buyDate: date,
    sellDate: date.nullable().optional(),
    mode: z.enum(['AMOUNT', 'QTY']),
    amount: z.number().positive().max(1e15).nullable().optional(),
    qty: z.number().positive().max(1e12).nullable().optional(),
    rate: z.number().min(-0.5).max(1).nullable().optional(),
    note: z.string().max(300).optional(),
  }),
  z.object({ action: z.literal('updatePosition'), positionId: z.string(), sellDate: date.nullable().optional(), note: z.string().max(300).optional() }),
  z.object({ action: z.literal('deletePosition'), positionId: z.string() }),
]);

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 });
  const b = parsed.data;
  try {
    if (b.action === 'create') return NextResponse.json({ id: (await createPortfolio(user.id, b)).id });
    if (b.action === 'update') return NextResponse.json({ id: (await updatePortfolio(user.id, b.id, b)).id });
    if (b.action === 'delete') {
      await deletePortfolio(user.id, b.id);
      return NextResponse.json({ ok: true });
    }
    if (b.action === 'add') return NextResponse.json({ id: (await addPosition(user.id, b.id, b)).id });
    if (b.action === 'updatePosition') return NextResponse.json({ id: (await updatePosition(user.id, b.positionId, b)).id });
    await deletePosition(user.id, b.positionId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e, b.action);
  }
}
