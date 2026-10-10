import { NextResponse } from 'next/server';
import { cronAuthorized } from '@/server/cron-auth';
import { runAlertChecks, runBriefings, runRealEstateChecks } from '@/server/alert-loop';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Price alerts, target-weight checks, 부동산 알림 (with ?realestate=1, as it reads 실거래가 for
 * every watched district: call it every few hours) and due AI morning briefings for every user. The server already runs
 * these on its own timer; call this from a scheduler when that timer is off
 * (ALERTS=off) or the app runs where background timers stop (serverless).
 */
export async function POST(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const checks = await runAlertChecks({ drift: true });
  const briefings = await runBriefings().catch((e) => (console.error('[ai] briefing check failed', e), 0));
  const realEstate = new URL(req.url).searchParams.get('realestate') === '1' ? await runRealEstateChecks().catch((e) => (console.error('[alerts] real estate check failed', e), 0)) : null;
  return NextResponse.json({ ok: true, ...checks, briefings, realEstate });
}

export const GET = POST;
