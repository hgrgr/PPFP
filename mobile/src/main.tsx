import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { db, getSetting } from './core/db';
import { checkAlerts, refreshPrices } from './core/prices';
import { pollServer } from './core/poll';
import { App } from './ui/App';
import './ui/app.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

const PRICE_EVERY_MS = 5 * 60_000;
const SERVER_EVERY_MS = 3 * 60_000;

/** On open and on coming back: fresh prices (when stale), price alerts, the server's notifications. */
async function wake() {
  try {
    const last = await getSetting<string | null>('pricesAt', null);
    const hasListed = (await db.assets.filter((a) => !!a.symbol).count()) > 0;
    if (hasListed && (!last || Date.now() - Date.parse(last) > PRICE_EVERY_MS)) await refreshPrices();
    else await checkAlerts();
  } catch (e) {
    console.warn('[wake] prices', e);
  }
  await pollServer().catch(() => {});
}

void wake();
setInterval(() => {
  if (document.visibilityState === 'visible') void wake();
}, SERVER_EVERY_MS);
if (Capacitor.isNativePlatform()) {
  void CapApp.addListener('resume', () => void wake());
  // The hardware back button goes back in the app before leaving it
  void CapApp.addListener('backButton', ({ canGoBack }) => (canGoBack ? window.history.back() : CapApp.exitApp()));
}
