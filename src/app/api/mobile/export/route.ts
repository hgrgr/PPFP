import { appExport } from '@/server/services/mobile';
import { preflight, withUser } from '../cors';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** Portfolios, trades, notes and trade journals as the import sheets' rows. */
export function GET(req: Request) {
  return withUser(req, async ({ user }) => ({ sheets: await appExport(user.id), exportedAt: new Date().toISOString() }));
}

export const OPTIONS = preflight;
