import { appLogout } from '@/server/services/mobile';
import { preflight, withUser } from '../cors';

export const dynamic = 'force-dynamic';

export function POST(req: Request) {
  return withUser(req, async ({ sessionId }) => {
    await appLogout(sessionId);
    return { ok: true };
  });
}

export const OPTIONS = preflight;
