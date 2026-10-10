import { appLogin } from '@/server/services/mobile';
import { UserError } from '@/server/services/portfolios';
import { ipOf, json, preflight } from '../cors';

export const dynamic = 'force-dynamic';

/** { email, password, code?, device? } → { token, email } or { needCode: true } */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, string | undefined>;
    return json(await appLogin(body, ipOf(req)));
  } catch (e) {
    if (e instanceof UserError) return json({ error: e.message }, 400);
    console.error('[mobile] login', e);
    return json({ error: '로그인하지 못했습니다.' }, 500);
  }
}

export const OPTIONS = preflight;
