import 'server-only';
import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { prisma } from './db';
import { newToken, sha256 } from './crypto';

const COOKIE = 'ppfp_session';
const TTL_DAYS = 30;
/** Time to type the two-step code after the password */
const PENDING_MINUTES = 10;
const SEEN_EVERY_MS = 5 * 60_000;

const cookieOptions = (expires: Date) => ({
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.COOKIE_SECURE === 'true',
  path: '/',
  expires,
});

/** The browser and address of the request, for the device list. */
export async function requestMeta(): Promise<{ userAgent: string | null; ip: string | null }> {
  const h = await headers();
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || null;
  return { userAgent: h.get('user-agent')?.slice(0, 300) ?? null, ip: ip?.slice(0, 64) ?? null };
}

/**
 * Signs the browser in. With `pendingMfa` the session only lets the two-step page finish
 * signing in, and lapses after a few minutes.
 */
export async function createSession(userId: string, opts: { pendingMfa?: boolean } = {}): Promise<string> {
  const token = newToken();
  const expiresAt = new Date(Date.now() + (opts.pendingMfa ? PENDING_MINUTES * 60_000 : TTL_DAYS * 86_400_000));
  const meta = await requestMeta();
  const id = sha256(token);
  await prisma.session.create({ data: { id, userId, expiresAt, pendingMfa: !!opts.pendingMfa, ...meta, lastSeenAt: new Date() } });
  (await cookies()).set(COOKIE, token, cookieOptions(expiresAt));
  return id;
}

/** The two-step code was right: the pending session becomes a full one. */
export async function completePendingSession(sessionId: string): Promise<void> {
  const expiresAt = new Date(Date.now() + TTL_DAYS * 86_400_000);
  await prisma.session.update({ where: { id: sessionId }, data: { pendingMfa: false, expiresAt, lastSeenAt: new Date() } });
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) jar.set(COOKIE, token, cookieOptions(expiresAt));
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await prisma.session.deleteMany({ where: { id: sha256(token) } });
  jar.delete(COOKIE);
}

/** The id (hash) of this browser's session, whether or not it is still valid. */
export async function currentSessionId(): Promise<string | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  return token ? sha256(token) : null;
}

/** A session waiting for its two-step code, with its user. */
export async function pendingSession() {
  const id = await currentSessionId();
  if (!id) return null;
  const s = await prisma.session.findUnique({ where: { id }, include: { user: { select: { id: true, email: true } } } });
  if (!s || !s.pendingMfa || s.expiresAt < new Date()) return null;
  return s;
}

export const currentUser = cache(async () => {
  const id = await currentSessionId();
  if (!id) return null;
  const session = await prisma.session.findUnique({ where: { id }, include: { user: true } });
  if (!session || session.pendingMfa || session.expiresAt < new Date()) return null;
  if (!session.lastSeenAt || Date.now() - session.lastSeenAt.getTime() > SEEN_EVERY_MS) {
    void prisma.session.update({ where: { id }, data: { lastSeenAt: new Date() } }).catch(() => {});
  }
  const { passwordHash: _omit, totpSecret: _secret, totpPending: _pending, recoveryCodes: _codes, ...user } = session.user;
  return { ...user, twoStep: !!session.user.totpSecret };
});

export type CurrentUser = NonNullable<Awaited<ReturnType<typeof currentUser>>>;

export async function requireUser(): Promise<CurrentUser> {
  const user = await currentUser();
  if (!user) redirect('/login');
  return user;
}
