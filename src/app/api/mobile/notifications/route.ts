import { appNotifications } from '@/server/services/mobile';
import { preflight, withUser } from '../cors';

export const dynamic = 'force-dynamic';

/** Notifications newer than ?after= (ISO), newest first, at most 50. */
export function GET(req: Request) {
  return withUser(req, ({ user }) => appNotifications(user.id, new URL(req.url).searchParams.get('after')));
}

export const OPTIONS = preflight;
