import { NextResponse } from 'next/server';
import { cronAuthorized } from '@/server/cron-auth';
import { runAlertChecks } from '@/server/alert-loop';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Price alerts and target-weight checks for every user. The server already runs
 * these on its own timer; call this from a scheduler when that timer is off
 * (ALERTS=off) or the app runs where background timers stop (serverless).
 */
export async function POST(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json({ ok: true, ...(await runAlertChecks({ drift: true })) });
}

export const GET = POST;
