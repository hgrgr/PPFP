import { NextResponse } from 'next/server';
import { currentUser } from '@/server/auth';
import { prisma } from '@/server/db';

export const dynamic = 'force-dynamic';

/** Latest notes, for the quick memo panel. */
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const notes = await prisma.note.findMany({ where: { userId: user.id }, orderBy: { updatedAt: 'desc' }, take: 5, select: { id: true, body: true, updatedAt: true } });
  return NextResponse.json(notes, { headers: { 'cache-control': 'no-store' } });
}
