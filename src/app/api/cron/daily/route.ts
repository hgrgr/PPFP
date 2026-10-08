import { NextResponse } from 'next/server';
import { cronAuthorized } from '@/server/cron-auth';
import { runDailyForAll } from '@/server/services/jobs';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Daily closes, FX and snapshot rebuild for every user. Call from a scheduler with the CRON_SECRET bearer token. */
export async function POST(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const results = await runDailyForAll();
  return NextResponse.json({ ok: true, results });
}

export const GET = POST;
