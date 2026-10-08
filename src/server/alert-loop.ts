/**
 * Background checks, started once per server process from instrumentation.ts:
 * price alerts every ALERT_POLL_SECONDS (default 60), target-weight drift every
 * DRIFT_POLL_SECONDS (default 600). Set ALERTS=off to disable and use
 * POST /api/cron/alerts from a scheduler instead.
 */
import { checkDrift, checkPriceAlerts } from './services/alerts';

let running = false;
let lastDrift = 0;

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
  const tick = () => void runAlertChecks({ drift: Date.now() - lastDrift >= driftEvery });
  g.ppfpAlertTimer = setInterval(tick, every);
  g.ppfpAlertTimer.unref?.();
  // First run shortly after start, once the server is serving
  setTimeout(tick, 20_000).unref?.();
  console.log(`[alerts] checking prices every ${every / 1000}s, target weights every ${driftEvery / 1000}s`);
}
