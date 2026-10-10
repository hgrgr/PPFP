import { createHandoff } from '@/server/services/mobile';
import { preflight, withUser } from '../cors';

export const dynamic = 'force-dynamic';

/** A one-minute, one-use code for /api/mobile/open: the app opens the web app signed in. */
export function POST(req: Request) {
  return withUser(req, async ({ user }) => ({ code: createHandoff(user.id) }));
}

export const OPTIONS = preflight;
