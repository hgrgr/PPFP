/**
 * Account security rules that need no database: who may sign up, how long a key (an e-mail
 * or an address) waits after failed sign-ins, and a readable name for a signed-in device.
 */

// ── Sign-up ──────────────────────────────────────────

export const SIGNUP_MODES = ['open', 'invite', 'closed'] as const;
export type SignupMode = (typeof SIGNUP_MODES)[number];
export const SIGNUP_MODE_LABEL: Record<SignupMode, string> = {
  open: '누구나 가입',
  invite: '초대 코드가 있어야 가입',
  closed: '가입 막음',
};

/** SIGNUP_MODE from the environment; invitations by default. */
export function signupModeOf(v: string | undefined): SignupMode {
  const m = v?.trim().toLowerCase();
  return (SIGNUP_MODES as readonly string[]).includes(m ?? '') ? (m as SignupMode) : 'invite';
}

/**
 * Whether a new account may be made. The very first account always may, so a fresh server
 * can be set up; after that the mode decides.
 */
export function signupAllowed(mode: SignupMode, users: number, inviteValid: boolean): { ok: true } | { ok: false; reason: string } {
  if (users === 0) return { ok: true };
  if (mode === 'open') return { ok: true };
  if (mode === 'invite' && inviteValid) return { ok: true };
  if (mode === 'invite') return { ok: false, reason: '가입하려면 이 서버의 사용자에게 받은 초대 코드가 필요합니다.' };
  return { ok: false, reason: '이 서버는 새 가입을 받지 않습니다.' };
}

export const INVITE_DAYS = 7;

// ── Failed sign-ins ──────────────────────────────────

/** Failures allowed before waiting starts */
export const FREE_FAILURES = 5;
const FIRST_WAIT_MS = 30_000;
const MAX_WAIT_MS = 15 * 60_000;
/** A key with no failure for this long starts over */
const FORGET_MS = 24 * 3_600_000;

export interface ThrottleEntry {
  failures: number;
  lastAt: number;
}

/** How long a key must wait after `failures` failures: 30 s after the fifth, doubling, at most 15 min. */
export function waitAfter(failures: number): number {
  if (failures < FREE_FAILURES) return 0;
  return Math.min(MAX_WAIT_MS, FIRST_WAIT_MS * 2 ** (failures - FREE_FAILURES));
}

/**
 * Failed sign-ins per key, in memory: the app runs as one process, and a restart forgetting
 * them is acceptable (it still slows guessing to a crawl). Time is passed in for tests.
 */
export class Throttle {
  private entries = new Map<string, ThrottleEntry>();

  /** Milliseconds the key must still wait, 0 when it may try. */
  wait(key: string, now: number): number {
    const e = this.entries.get(key);
    if (!e) return 0;
    if (now - e.lastAt > FORGET_MS) {
      this.entries.delete(key);
      return 0;
    }
    return Math.max(0, e.lastAt + waitAfter(e.failures) - now);
  }

  fail(key: string, now: number): void {
    const e = this.entries.get(key);
    const failures = e && now - e.lastAt <= FORGET_MS ? e.failures + 1 : 1;
    this.entries.set(key, { failures, lastAt: now });
    if (this.entries.size > 10_000) this.prune(now);
  }

  reset(key: string): void {
    this.entries.delete(key);
  }

  failures(key: string): number {
    return this.entries.get(key)?.failures ?? 0;
  }

  private prune(now: number) {
    for (const [k, e] of this.entries) if (now - e.lastAt > FORGET_MS) this.entries.delete(k);
  }
}

/** "30초", "2분", "15분" */
export function waitLabel(ms: number): string {
  const s = Math.ceil(ms / 1000);
  return s < 60 ? `${s}초` : `${Math.ceil(s / 60)}분`;
}

// ── Devices ──────────────────────────────────────────

/** "Chrome · macOS", "PPFP 앱 · Android", or "알 수 없는 기기" */
export function deviceLabel(ua: string | null | undefined): string {
  if (!ua) return '알 수 없는 기기';
  const os = /Android/i.test(ua)
    ? 'Android'
    : /iPhone|iPad|iPod/i.test(ua)
      ? 'iOS'
      : /Mac OS X|Macintosh/i.test(ua)
        ? 'macOS'
        : /Windows/i.test(ua)
          ? 'Windows'
          : /Linux/i.test(ua)
            ? 'Linux'
            : null;
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /SamsungBrowser/.test(ua)
      ? '삼성 인터넷'
      : /Whale\//.test(ua)
        ? '웨일'
        : /Firefox\//.test(ua)
          ? 'Firefox'
          : /Chrome\//.test(ua)
            ? 'Chrome'
            : /Safari\//.test(ua)
              ? 'Safari'
              : /curl|node|undici|python/i.test(ua)
                ? '스크립트'
                : null;
  if (!os && !browser) return '알 수 없는 기기';
  return [browser, os].filter(Boolean).join(' · ');
}

/** The same browser on the same system counts as a known device. */
export const sameDevice = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && deviceLabel(a) === deviceLabel(b) && deviceLabel(a) !== '알 수 없는 기기';
