import { preflight, withUser } from '../cors';

export const dynamic = 'force-dynamic';

/** Who the token belongs to, and what this server does for the app. */
export function GET(req: Request) {
  return withUser(req, async ({ user }) => ({
    user: { email: user.email, name: user.name, twoStep: !!user.totpSecret },
    server: {
      version: process.env.npm_package_version ?? '0',
      // What linking a server brings back to the app (shown on its 서버 연동 screen)
      features: ['alerts', 'realestate-alerts', 'push', 'ai-briefing', 'broker-sync', 'backup', 'web'],
    },
  }));
}

export const OPTIONS = preflight;
