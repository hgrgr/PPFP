/** Runs once when the Next.js server starts. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.ALERTS === 'off') return;
  const { startAlertLoop } = await import('./server/alert-loop');
  startAlertLoop();
}
