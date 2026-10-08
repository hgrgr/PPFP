import { NextResponse } from 'next/server';
import { cronAuthorized } from '@/server/cron-auth';
import { runAlertChecks, runBriefings } from '@/server/alert-loop';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Price alerts, target-weight checks and due AI morning briefings for every user. The server already runs
 * these on its own timer; call this from a scheduler when that timer is off
 * (ALERTS=off) or the app runs where background timers stop (serverless).
 */
export async function POST(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const checks = await runAlertChecks({ drift: true });
  const briefings = await runBriefings().catch((e) => (console.error('[ai] briefing check failed', e), 0));
  return NextResponse.json({ ok: true, ...checks, briefings });
}

export const GET = POST;
