/**
 * Account security: sign-up control and invitations, failed sign-in limits, two-step sign-in
 * (TOTP with recovery codes), the signed-in devices, password changes and the identity check
 * that guards sensitive actions. Security events go to the audit log.
 */
import type { Prisma } from '@prisma/client';
import { decryptSecret, encryptSecret, hashPassword, newToken, sha256, verifyPassword } from '../crypto';
import { prisma } from '../db';
import { newRecoveryCodes, newTotpSecret, normalizeRecoveryCode, otpauthUri, verifyTotp } from '../totp';
import { deviceLabel, INVITE_DAYS, sameDevice, signupAllowed, signupModeOf, Throttle, waitLabel, type SignupMode } from '@/domain/security';
import { notify } from './notify';
import { UserError } from './portfolios';

export const MIN_PASSWORD = 10;

async function securityLog(userId: string, action: string, after?: Prisma.InputJsonObject) {
  await prisma.auditLog.create({ data: { userId, entity: 'Security', entityId: userId, action, after: after ?? undefined } }).catch((e) => console.error('[security] audit', e));
}

// ── Sign-up ──────────────────────────────────────────

export const signupMode = (): SignupMode => signupModeOf(process.env.SIGNUP_MODE);

/** The invitation a code belongs to, if it can still be used (by this address). */
async function usableInvite(code: string, email: string) {
  const c = code.trim();
  if (!c) return null;
  const inv = await prisma.invite.findUnique({ where: { id: sha256(c) } });
  if (!inv || inv.usedAt || inv.expiresAt < new Date()) return null;
  if (inv.email && inv.email !== email) return null;
  return inv;
}

/** Makes the account (when sign-up allows it) and uses up the invitation. */
export async function signUp(input: { email: string; password: string; name: string; invite: string }) {
  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new UserError('이메일 형식을 확인하세요.');
  if (input.password.length < MIN_PASSWORD) throw new UserError(`비밀번호는 ${MIN_PASSWORD}자 이상이어야 합니다.`);
  const [users, invite] = await Promise.all([prisma.user.count(), usableInvite(input.invite, email)]);
  const mode = signupMode();
  const allowed = signupAllowed(mode, users, !!invite);
  if (!allowed.ok) throw new UserError(input.invite.trim() && mode === 'invite' ? '초대 코드가 맞지 않거나 이미 쓰였거나 기한이 지났습니다.' : allowed.reason);
  if (await prisma.user.findUnique({ where: { email } })) throw new UserError('이미 가입된 이메일입니다.');
  const passwordHash = await hashPassword(input.password);
  const user = await prisma.$transaction(async (tx) => {
    if (invite && users > 0) {
      // Claimed atomically: two sign-ups racing on one code cannot both pass
      const r = await tx.invite.updateMany({ where: { id: invite.id, usedAt: null }, data: { usedAt: new Date(), usedBy: email } });
      if (!r.count) throw new UserError('초대 코드가 이미 쓰였습니다.');
    }
    return tx.user.create({ data: { email, name: input.name.trim() || null, passwordHash } });
  });
  await securityLog(user.id, 'signup', { invited: !!invite, first: users === 0 });
  if (invite) await securityLog(invite.createdById, 'invite.used', { email });
  return user;
}

export interface InviteView {
  id: string;
  email: string | null;
  note: string | null;
  expiresAt: string;
  usedAt: string | null;
  usedBy: string | null;
}

export async function listInvites(userId: string): Promise<InviteView[]> {
  const rows = await prisma.invite.findMany({ where: { createdById: userId }, orderBy: { createdAt: 'desc' }, take: 20 });
  return rows.map((r) => ({ id: r.id, email: r.email, note: r.note, expiresAt: r.expiresAt.toISOString(), usedAt: r.usedAt?.toISOString() ?? null, usedBy: r.usedBy }));
}

/** A new invitation; the code is returned once and only its hash is kept. */
export async function createInvite(userId: string, input: { email?: string; note?: string }): Promise<{ code: string; expiresAt: Date }> {
  const email = input.email?.trim().toLowerCase() || null;
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new UserError('이메일 형식을 확인하세요.');
  const open = await prisma.invite.count({ where: { createdById: userId, usedAt: null, expiresAt: { gt: new Date() } } });
  if (open >= 10) throw new UserError('쓰지 않은 초대가 10개 있습니다. 필요 없는 것을 지운 뒤 만드세요.');
  const code = newToken().slice(0, 16);
  const expiresAt = new Date(Date.now() + INVITE_DAYS * 86_400_000);
  await prisma.invite.create({ data: { id: sha256(code), createdById: userId, email, note: input.note?.trim().slice(0, 80) || null, expiresAt } });
  await securityLog(userId, 'invite.create', { email });
  return { code, expiresAt };
}

export async function deleteInvite(userId: string, id: string) {
  const r = await prisma.invite.deleteMany({ where: { id, createdById: userId } });
  if (!r.count) throw new UserError('초대를 찾을 수 없습니다.');
}

// ── Sign-in ──────────────────────────────────────────

const g = globalThis as unknown as { ppfpLoginThrottle?: Throttle };
/** Failed passwords and two-step codes, per e-mail and per address; shared across hot reloads */
export const loginThrottle = (g.ppfpLoginThrottle ??= new Throttle());

/** Refuses while the e-mail or the address is waiting after failures. */
export function checkThrottle(keys: string[], now = Date.now()) {
  const wait = Math.max(0, ...keys.map((k) => loginThrottle.wait(k, now)));
  if (wait > 0) throw new UserError(`로그인 실패가 많아 잠시 막았습니다. ${waitLabel(wait)} 뒤에 다시 시도하세요.`);
}

export const throttleKeys = (email: string, ip: string | null) => [`email:${email}`, ...(ip ? [`ip:${ip}`] : [])];

/**
 * Checks the password. Returns the user and whether a two-step code must follow. Failures
 * count against the e-mail and the address.
 */
export async function checkPassword(emailRaw: string, password: string, ip: string | null) {
  const email = emailRaw.trim().toLowerCase();
  const keys = throttleKeys(email, ip);
  checkThrottle(keys);
  const user = await prisma.user.findUnique({ where: { email } });
  const ok = user ? await verifyPassword(password, user.passwordHash) : await hashPassword('timing').then(() => false);
  if (!user || !ok) {
    keys.forEach((k) => loginThrottle.fail(k, Date.now()));
    if (user && loginThrottle.failures(`email:${email}`) === 5) await securityLog(user.id, 'login.throttled', { ip });
    throw new UserError('이메일 또는 비밀번호가 올바르지 않습니다.');
  }
  return { user, twoStep: !!user.totpSecret };
}

/** After a full sign-in: forget the failures, log it, and tell the owner about a new device. */
export async function signedIn(userId: string, sessionId: string, email: string, ip: string | null) {
  throttleKeys(email, ip).forEach((k) => loginThrottle.reset(k));
  const [me, others] = await Promise.all([
    prisma.session.findUnique({ where: { id: sessionId }, select: { userAgent: true } }),
    prisma.session.findMany({ where: { userId, id: { not: sessionId }, pendingMfa: false }, select: { userAgent: true } }),
  ]);
  await securityLog(userId, 'login', { ip, device: deviceLabel(me?.userAgent) });
  if (others.length && !others.some((o) => sameDevice(o.userAgent, me?.userAgent))) {
    await notify(userId, {
      kind: 'SECURITY',
      title: `새 기기에서 로그인: ${deviceLabel(me?.userAgent)}`,
      body: `${ip ? `주소 ${ip}에서 ` : ''}로그인했습니다. 본인이 아니라면 연동 · 설정의 로그인 기기에서 로그아웃시키고 비밀번호를 바꾸세요.`,
      url: '/settings#security',
    }).catch((e) => console.error('[security] notify', e));
  }
}

// ── Two-step sign-in ─────────────────────────────────

/** Accepts an authenticator code or one unused recovery code. Throws when neither matches. */
export async function verifySecondFactor(userId: string, code: string): Promise<'totp' | 'recovery'> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!user.totpSecret) return 'totp';
  const key = `2fa:${userId}`;
  checkThrottle([key]);
  const step = verifyTotp(decryptSecret(user.totpSecret), code, Date.now(), user.totpLastStep);
  if (step !== null) {
    // Only moves forward, so the same code cannot pass twice even from two requests at once
    const r = await prisma.user.updateMany({ where: { id: userId, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] }, data: { totpLastStep: step } });
    if (r.count) {
      loginThrottle.reset(key);
      return 'totp';
    }
  }
  const hash = sha256(normalizeRecoveryCode(code));
  if (code.trim().length >= 8 && user.recoveryCodes.includes(hash)) {
    await prisma.user.update({ where: { id: userId }, data: { recoveryCodes: user.recoveryCodes.filter((h) => h !== hash) } });
    loginThrottle.reset(key);
    await securityLog(userId, '2fa.recovery-used', { left: user.recoveryCodes.length - 1 });
    return 'recovery';
  }
  loginThrottle.fail(key, Date.now());
  throw new UserError('인증 코드가 맞지 않습니다. 앱의 6자리 숫자나 복구 코드를 넣으세요.');
}

/** Begins setup: a new secret to add to the authenticator app. */
export async function startTotpSetup(userId: string): Promise<{ secret: string; uri: string }> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.totpSecret) throw new UserError('2단계 인증이 이미 켜져 있습니다.');
  const secret = newTotpSecret();
  await prisma.user.update({ where: { id: userId }, data: { totpPending: encryptSecret(secret) } });
  return { secret, uri: otpauthUri(secret, user.email) };
}

/** Finishes setup with a code from the app; returns the recovery codes, shown this once. */
export async function confirmTotpSetup(userId: string, code: string): Promise<string[]> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!user.totpPending) throw new UserError('먼저 2단계 인증 설정을 시작하세요.');
  const secret = decryptSecret(user.totpPending);
  const step = verifyTotp(secret, code, Date.now());
  if (step === null) throw new UserError('코드가 맞지 않습니다. 앱에 새로 추가한 PPFP 항목의 6자리 숫자를 넣으세요. 휴대폰 시간이 맞는지도 확인하세요.');
  const codes = newRecoveryCodes();
  await prisma.user.update({
    where: { id: userId },
    data: { totpSecret: user.totpPending, totpPending: null, totpEnabledAt: new Date(), totpLastStep: step, recoveryCodes: codes.map((c) => sha256(normalizeRecoveryCode(c))) },
  });
  await securityLog(userId, '2fa.enable');
  return codes;
}

export async function newRecoveryCodesFor(userId: string, password: string, code: string): Promise<string[]> {
  await verifyIdentity(userId, password, code);
  const codes = newRecoveryCodes();
  await prisma.user.update({ where: { id: userId }, data: { recoveryCodes: codes.map((c) => sha256(normalizeRecoveryCode(c))) } });
  await securityLog(userId, '2fa.recovery-renew');
  return codes;
}

export async function disableTotp(userId: string, password: string, code: string) {
  await verifyIdentity(userId, password, code);
  await prisma.user.update({ where: { id: userId }, data: { totpSecret: null, totpPending: null, totpEnabledAt: null, totpLastStep: null, recoveryCodes: [] } });
  await securityLog(userId, '2fa.disable');
}

/**
 * The check before a sensitive action (key backup, delegating trades, turning two-step off):
 * the password, plus the two-step code when it is on.
 */
export async function verifyIdentity(userId: string, password: string, code?: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const key = `id:${userId}`;
  checkThrottle([key]);
  if (!(await verifyPassword(password, user.passwordHash))) {
    loginThrottle.fail(key, Date.now());
    throw new UserError('로그인 비밀번호가 맞지 않습니다.');
  }
  if (user.totpSecret) {
    if (!code?.trim()) throw new UserError('2단계 인증 코드도 넣으세요.');
    await verifySecondFactor(userId, code);
  }
  loginThrottle.reset(key);
}

// ── Password and devices ─────────────────────────────

/** Changes the password and signs every other device out. */
export async function changePassword(userId: string, sessionId: string | null, input: { current: string; next: string; confirm: string; code?: string }) {
  if (input.next.length < MIN_PASSWORD) throw new UserError(`새 비밀번호는 ${MIN_PASSWORD}자 이상이어야 합니다.`);
  if (input.next !== input.confirm) throw new UserError('새 비밀번호 확인이 다릅니다.');
  if (input.next === input.current) throw new UserError('지금과 다른 비밀번호를 정하세요.');
  await verifyIdentity(userId, input.current, input.code);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(input.next) } });
  const r = await prisma.session.deleteMany({ where: { userId, ...(sessionId ? { id: { not: sessionId } } : {}) } });
  await securityLog(userId, 'password.change', { signedOut: r.count });
  return r.count;
}

export interface DeviceView {
  id: string;
  label: string;
  ip: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  current: boolean;
}

export async function listDevices(userId: string, sessionId: string | null): Promise<DeviceView[]> {
  const rows = await prisma.session.findMany({ where: { userId, pendingMfa: false, expiresAt: { gt: new Date() } }, orderBy: [{ lastSeenAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }] });
  return rows.map((s) => ({
    // The id is the cookie's hash; the list shows a prefix that is enough to pick it again
    id: s.id.slice(0, 16),
    label: deviceLabel(s.userAgent),
    ip: s.ip,
    createdAt: s.createdAt.toISOString(),
    lastSeenAt: s.lastSeenAt?.toISOString() ?? null,
    current: s.id === sessionId,
  }));
}

/** Signs one device out, by the id prefix the list shows. */
export async function signOutDevice(userId: string, sessionId: string | null, idPrefix: string) {
  if (!/^[0-9a-f]{16}$/.test(idPrefix)) throw new UserError('기기를 찾을 수 없습니다.');
  if (sessionId?.startsWith(idPrefix)) throw new UserError('지금 쓰는 기기는 위쪽 메뉴의 로그아웃을 쓰세요.');
  const r = await prisma.session.deleteMany({ where: { userId, id: { startsWith: idPrefix } } });
  if (!r.count) throw new UserError('기기를 찾을 수 없습니다. 이미 로그아웃됐을 수 있습니다.');
  await securityLog(userId, 'device.signout', { count: r.count });
}

export async function signOutOthers(userId: string, sessionId: string | null) {
  const r = await prisma.session.deleteMany({ where: { userId, ...(sessionId ? { id: { not: sessionId } } : {}) } });
  await securityLog(userId, 'device.signout-others', { count: r.count });
  return r.count;
}

export interface SecurityEvent {
  at: string;
  action: string;
  detail: string;
}

const EVENT_LABEL: Record<string, string> = {
  signup: '가입',
  login: '로그인',
  'login.throttled': '로그인 실패 5회 — 잠시 막음',
  '2fa.enable': '2단계 인증 켬',
  '2fa.disable': '2단계 인증 끔',
  '2fa.recovery-used': '복구 코드로 로그인',
  '2fa.recovery-renew': '복구 코드 새로 만듦',
  'password.change': '비밀번호 바꿈',
  'device.signout': '기기 로그아웃',
  'device.signout-others': '다른 기기 모두 로그아웃',
  'invite.create': '초대 만듦',
  'invite.used': '초대로 가입함',
};

/** The latest security events, newest first. */
export async function securityEvents(userId: string, take = 15): Promise<SecurityEvent[]> {
  const rows = await prisma.auditLog.findMany({ where: { userId, entity: 'Security' }, orderBy: { at: 'desc' }, take });
  return rows.map((r) => {
    const a = (r.after ?? {}) as Record<string, unknown>;
    const bits = [a.device, a.ip && `주소 ${a.ip}`, a.email, typeof a.left === 'number' && `남은 복구 코드 ${a.left}개`, typeof a.signedOut === 'number' && a.signedOut > 0 && `다른 기기 ${a.signedOut}곳 로그아웃`].filter(Boolean);
    return { at: r.at.toISOString(), action: EVENT_LABEL[r.action] ?? r.action, detail: bits.join(' · ') };
  });
}
