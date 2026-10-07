import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { runDailyForAll } from '@/server/services/jobs';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const got = Buffer.from(req.headers.get('authorization') ?? '');
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

/** Daily closes, FX and snapshot rebuild for every user. Call from a scheduler with the CRON_SECRET bearer token. */
export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const results = await runDailyForAll();
  return NextResponse.json({ ok: true, results });
}

export const GET = POST;
