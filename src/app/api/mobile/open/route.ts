import { NextResponse } from 'next/server';
import { createSession } from '@/server/auth';
import { safePath, takeHandoff } from '@/server/services/mobile';

export const dynamic = 'force-dynamic';

/** Signs this browser in from the app's handoff code, then goes to ?to= (a path in this app). */
export async function GET(req: Request) {
  const url = new URL(req.url);
  // Behind a proxy (Tailscale serve, Caddy) req.url names the inner address: go back to the one the phone used
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? url.host;
  const proto = req.headers.get('x-forwarded-proto') ?? url.protocol.replace(':', '');
  const here = (path: string) => new URL(path, `${proto}://${host}`);
  const userId = takeHandoff(url.searchParams.get('code') ?? '');
  if (!userId) return NextResponse.redirect(here('/login'));
  await createSession(userId);
  return NextResponse.redirect(here(safePath(url.searchParams.get('to'))));
}
