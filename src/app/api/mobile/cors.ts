import { NextResponse } from 'next/server';
import { UserError } from '@/server/services/portfolios';
import { bearerUser } from '@/server/services/mobile';

/**
 * The app's API answers any origin: it is called with a bearer token, never with cookies,
 * so a page elsewhere gains nothing. (On the phone requests are native and need no CORS;
 * this is for running the app in a browser while developing.)
 */
export const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-max-age': '600',
};

export const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: CORS });
export const preflight = () => new NextResponse(null, { status: 204, headers: CORS });

export const ipOf = (req: Request) => req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || null;

/** Runs `fn` for the token's user; 401 without one, messages for UserError. */
export async function withUser(req: Request, fn: (u: NonNullable<Awaited<ReturnType<typeof bearerUser>>>) => Promise<unknown>) {
  const u = await bearerUser(req);
  if (!u) return json({ error: '앱 연결이 끊겼습니다. 앱의 서버 연동에서 다시 로그인하세요.' }, 401);
  try {
    return json(await fn(u));
  } catch (e) {
    if (e instanceof UserError) return json({ error: e.message }, 400);
    console.error('[mobile]', e);
    return json({ error: '서버에서 처리하지 못했습니다.' }, 500);
  }
}
