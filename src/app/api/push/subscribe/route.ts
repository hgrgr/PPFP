import { NextResponse } from 'next/server';
import { z } from 'zod';
import { currentUser } from '@/server/auth';
import { prisma } from '@/server/db';

export const dynamic = 'force-dynamic';

const Sub = z.object({
  endpoint: z.string().url().max(2000).refine((u) => u.startsWith('https://'), 'https only'),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }),
});

/** Save this browser's push subscription (or move it to the signed-in user). */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const parsed = Sub.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: '알림 구독 정보가 올바르지 않습니다.' }, { status: 400 });
  const { endpoint, keys } = parsed.data;
  if ((await prisma.pushSubscription.count({ where: { userId: user.id } })) >= 20) {
    const oldest = await prisma.pushSubscription.findFirst({ where: { userId: user.id }, orderBy: { createdAt: 'asc' } });
    if (oldest && oldest.endpoint !== endpoint) await prisma.pushSubscription.delete({ where: { id: oldest.id } });
  }
  const userAgent = req.headers.get('user-agent')?.slice(0, 200) ?? null;
  await prisma.pushSubscription.upsert({
    where: { endpoint },
    create: { userId: user.id, endpoint, p256dh: keys.p256dh, auth: keys.auth, userAgent },
    update: { userId: user.id, p256dh: keys.p256dh, auth: keys.auth, userAgent, lastError: null },
  });
  return NextResponse.json({ ok: true });
}

/** Forget this browser's subscription. */
export async function DELETE(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const endpoint = (await req.json().catch(() => ({})))?.endpoint;
  if (typeof endpoint === 'string') await prisma.pushSubscription.deleteMany({ where: { userId: user.id, endpoint } });
  return NextResponse.json({ ok: true });
}
