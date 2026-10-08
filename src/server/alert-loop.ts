/**
 * Background checks, started once per server process from instrumentation.ts:
 * price alerts every ALERT_POLL_SECONDS (default 60), target-weight drift every
 * DRIFT_POLL_SECONDS (default 600), AI morning briefings every 5 minutes. Set ALERTS=off to disable and use
 * POST /api/cron/alerts from a scheduler instead.
 */
import { checkDrift, checkPriceAlerts } from './services/alerts';

let running = false;
let lastDrift = 0;
let lastBriefing = 0;
const BRIEFING_EVERY = 5 * 60_000;

/** Morning briefings that are due, run one at a time. Returns how many were sent. */
export async function runBriefings(): Promise<number> {
  lastBriefing = Date.now();
  const { checkBriefings } = await import('./services/ai/background');
  return checkBriefings();
}

export async function runAlertChecks(opts: { drift: boolean }): Promise<{ price: number; drift: number | null; skipped?: boolean }> {
  if (running) return { price: 0, drift: null, skipped: true };
  running = true;
  try {
    const price = await checkPriceAlerts().catch((e) => (console.error('[alerts] price check failed', e), 0));
    const drift = opts.drift ? await checkDrift().catch((e) => (console.error('[alerts] drift check failed', e), 0)) : null;
    if (opts.drift) lastDrift = Date.now();
    return { price, drift };
  } finally {
    running = false;
  }
}

const g = globalThis as unknown as { ppfpAlertTimer?: NodeJS.Timeout };

export function startAlertLoop() {
  if (g.ppfpAlertTimer) return;
  const every = Math.max(15, Number(process.env.ALERT_POLL_SECONDS) || 60) * 1000;
  const driftEvery = Math.max(60, Number(process.env.DRIFT_POLL_SECONDS) || 600) * 1000;
  const tick = () => {
    void runAlertChecks({ drift: Date.now() - lastDrift >= driftEvery });
    if (Date.now() - lastBriefing >= BRIEFING_EVERY) void runBriefings().catch((e) => console.error('[ai] briefing check failed', e));
  };
  g.ppfpAlertTimer = setInterval(tick, every);
  g.ppfpAlertTimer.unref?.();
  // First run shortly after start, once the server is serving
  setTimeout(tick, 20_000).unref?.();
  console.log(`[alerts] checking prices every ${every / 1000}s, target weights every ${driftEvery / 1000}s`);
}
