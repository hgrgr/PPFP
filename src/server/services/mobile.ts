/**
 * The Android app's way into this server. The app signs in with e-mail, password and the
 * two-step code and gets a bearer token: a Session row like a browser's, so it shows under
 * 계정 보안 › 로그인한 기기 and can be signed out from there. With it the app sends and takes
 * data as the import sheets, reads notifications, and opens the web app signed in.
 */
import { SHEET_KEYS, type Row, type SheetKey } from '@/domain/data-format';
import { newToken, sha256 } from '../crypto';
import { prisma } from '../db';
import { exportSheet, importData } from './data-io';
import { UserError } from './portfolios';
import { checkPassword, signedIn, verifySecondFactor } from './security';

/** App sessions last longer than a browser's: the phone is the user's own and signs in rarely */
const APP_SESSION_DAYS = 180;
const SEEN_EVERY_MS = 5 * 60_000;
/** Sheets the app reads and writes; books, sages and topics stay on the server */
export const APP_SHEETS: SheetKey[] = ['portfolios', 'transactions', 'notes', 'journals'];

export async function appLogin(input: { email?: string; password?: string; code?: string; device?: string }, ip: string | null): Promise<{ needCode: true } | { token: string; email: string }> {
  const { user, twoStep } = await checkPassword(input.email ?? '', input.password ?? '', ip);
  if (twoStep) {
    if (!input.code?.trim()) return { needCode: true };
    await verifySecondFactor(user.id, input.code);
  }
  const token = newToken();
  const id = sha256(token);
  const device = (input.device ?? '').replace(/[^\w .,()-]/g, '').slice(0, 60);
  await prisma.session.create({
    data: { id, userId: user.id, expiresAt: new Date(Date.now() + APP_SESSION_DAYS * 86_400_000), userAgent: `PPFP Android${device ? ` (${device})` : ''}`, ip, lastSeenAt: new Date() },
  });
  await signedIn(user.id, id, user.email, ip);
  return { token, email: user.email };
}

/** The user behind `Authorization: Bearer <token>`, or null. */
export async function bearerUser(req: Request) {
  const m = req.headers.get('authorization')?.match(/^Bearer\s+([\w-]{20,})$/);
  if (!m) return null;
  const id = sha256(m[1]);
  const s = await prisma.session.findUnique({ where: { id }, include: { user: true } });
  if (!s || s.pendingMfa || s.expiresAt < new Date()) return null;
  if (!s.lastSeenAt || Date.now() - s.lastSeenAt.getTime() > SEEN_EVERY_MS) void prisma.session.update({ where: { id }, data: { lastSeenAt: new Date() } }).catch(() => {});
  return { user: s.user, sessionId: id };
}

export async function appLogout(sessionId: string) {
  await prisma.session.deleteMany({ where: { id: sessionId } });
}

export async function appNotifications(userId: string, after: string | null) {
  const since = after && !Number.isNaN(Date.parse(after)) ? new Date(after) : new Date(Date.now() - 7 * 86_400_000);
  const [rows, unread] = await Promise.all([
    prisma.notification.findMany({ where: { userId, createdAt: { gt: since } }, orderBy: { createdAt: 'desc' }, take: 50 }),
    prisma.notification.count({ where: { userId, readAt: null } }),
  ]);
  return { notifications: rows.map((n) => ({ id: n.id, kind: n.kind, title: n.title, body: n.body, url: n.url, createdAt: n.createdAt.toISOString() })), unread };
}

/** Everything the app keeps, as the import sheets' rows (header → text). */
export async function appExport(userId: string): Promise<Partial<Record<SheetKey, Row[]>>> {
  const out: Partial<Record<SheetKey, Row[]>> = {};
  for (const key of APP_SHEETS) {
    const t = await exportSheet(userId, key);
    out[key] = t.rows.map((r) => Object.fromEntries(t.columns.map((c) => [c.header, cellText(c.value(r))])));
  }
  return out;
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

const MAX_APP_ROWS = 20_000;

/** The app's sheets through the same import as a file: checked only, or written with commit. */
export async function appImport(userId: string, body: unknown, commit: boolean) {
  const sheets = (body as { sheets?: Record<string, unknown> } | null)?.sheets;
  if (!sheets || typeof sheets !== 'object') throw new UserError('보낼 데이터가 없습니다.');
  const list = [];
  let total = 0;
  for (const [key, rows] of Object.entries(sheets)) {
    if (!(SHEET_KEYS as readonly string[]).includes(key) || !Array.isArray(rows)) continue;
    const clean: Row[] = rows.map((r) => Object.fromEntries(Object.entries((r ?? {}) as Record<string, unknown>).map(([h, v]) => [String(h), v === null || v === undefined ? '' : String(v)])));
    total += clean.length;
    list.push({ key: key as SheetKey, source: '앱', rows: clean });
  }
  if (total > MAX_APP_ROWS) throw new UserError(`한 번에 ${MAX_APP_ROWS.toLocaleString()}줄까지 보낼 수 있습니다.`);
  return importData(userId, { sheets: list, ignored: [] }, commit);
}

// ── Opening the web app signed in ────────────────────

const g = globalThis as unknown as { ppfpHandoffs?: Map<string, { userId: string; expires: number }> };
const handoffs = (g.ppfpHandoffs ??= new Map());
const HANDOFF_MS = 60_000;

/** A code good for one minute and one use; the app opens /api/mobile/open?code= with it. */
export function createHandoff(userId: string): string {
  const now = Date.now();
  for (const [k, v] of handoffs) if (v.expires < now) handoffs.delete(k);
  const code = newToken();
  handoffs.set(sha256(code), { userId, expires: now + HANDOFF_MS });
  return code;
}

export function takeHandoff(code: string): string | null {
  const key = sha256(code);
  const h = handoffs.get(key);
  handoffs.delete(key);
  return h && h.expires >= Date.now() ? h.userId : null;
}

/** Only paths inside this app: "/alerts" yes, "//evil.example" or "https://…" no */
export const safePath = (to: string | null) => (to && /^\/(?!\/)[\w\-./?=&#%]*$/.test(to) ? to : '/dashboard');
