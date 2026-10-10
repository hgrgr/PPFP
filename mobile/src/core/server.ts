/**
 * Talking to a PPFP server (the web app, e.g. on an Oracle VM reached through Tailscale) once
 * the user links one. The app signs in with its own token (a server session, listed and
 * revocable under 계정 보안 › 로그인한 기기) and then can:
 * - send the phone's data to the server, or take the server's data onto the phone (as the
 *   import sheets, so nothing is lost either way)
 * - fetch the server's notifications (price alerts every minute, 부동산 알림, AI briefings)
 * - open the full web app already signed in, for what only the server does
 */
import type { Sheets } from './sheets';

export interface ServerLink {
  url: string;
  token: string;
  email: string;
  linkedAt: string;
}

export interface ServerInfo {
  user: { email: string; name: string | null; twoStep: boolean };
  server: { version: string; features: string[] };
}

export interface ServerNotice {
  id: string;
  kind: string;
  title: string;
  body: string;
  url: string | null;
  createdAt: string;
}

export interface ImportSheetReport {
  key: string;
  name: string;
  rows: number;
  added: number;
  skipped: number;
  errors: { line: number; message: string }[];
}

export class ServerError extends Error {
  constructor(
    message: string,
    readonly status = 0,
  ) {
    super(message);
  }
}

/** "ppfp.tail1234.ts.net" → "https://ppfp.tail1234.ts.net"; trailing slashes dropped */
export function normalizeUrl(input: string): string {
  let u = input.trim();
  if (!u) throw new ServerError('서버 주소를 넣으세요.');
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  let parsed: URL;
  try {
    parsed = new URL(u);
  } catch {
    throw new ServerError('서버 주소를 https://ppfp.example.ts.net 처럼 넣으세요.');
  }
  // Plain http only on a private network or this phone (Tailscale addresses are encrypted anyway)
  const host = parsed.hostname;
  const privateHost = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(host) || host.endsWith('.ts.net') || host.endsWith('.local');
  if (parsed.protocol === 'http:' && !privateHost) throw new ServerError('인터넷의 서버는 https 주소로 연결하세요. 비밀번호가 그대로 오갑니다.');
  return `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/+$/, '')}`;
}

async function call<T>(base: string, path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}), ...((init.headers as Record<string, string>) ?? {}) };
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  let res: Response;
  try {
    res = await fetch(base + path, { ...init, headers, signal: init.signal ?? AbortSignal.timeout(30_000) });
  } catch {
    throw new ServerError('서버에 연결하지 못했습니다. 주소와 Tailscale 연결(휴대폰의 Tailscale 앱이 켜져 있는지)을 확인하세요.');
  }
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new ServerError(res.status === 404 ? '이 주소에 PPFP 서버가 없거나, 앱 연동을 지원하지 않는 옛 버전입니다.' : `서버가 이상한 답을 했습니다 (${res.status}).`, res.status);
  }
  if (!res.ok) throw new ServerError(typeof body.error === 'string' ? body.error : `서버 오류 (${res.status})`, res.status);
  return body as T;
}

export type LoginResult = { ok: true; link: ServerLink } | { ok: false; needCode: true };

export async function login(urlInput: string, email: string, password: string, code: string, device: string): Promise<LoginResult> {
  const url = normalizeUrl(urlInput);
  const r = await call<{ token?: string; needCode?: boolean; email?: string }>(url, '/api/mobile/login', {
    method: 'POST',
    body: JSON.stringify({ email, password, code: code || undefined, device }),
  });
  if (r.needCode) return { ok: false, needCode: true };
  if (!r.token) throw new ServerError('서버가 토큰을 주지 않았습니다.');
  return { ok: true, link: { url, token: r.token, email: r.email ?? email, linkedAt: new Date().toISOString() } };
}

export const me = (l: ServerLink) => call<ServerInfo>(l.url, '/api/mobile/me', { token: l.token });

export async function logout(l: ServerLink) {
  await call(l.url, '/api/mobile/logout', { method: 'POST', token: l.token }).catch(() => {});
}

export const notifications = (l: ServerLink, after: string | null) =>
  call<{ notifications: ServerNotice[]; unread: number }>(l.url, `/api/mobile/notifications${after ? `?after=${encodeURIComponent(after)}` : ''}`, { token: l.token });

export const exportFromServer = (l: ServerLink) => call<{ sheets: Sheets; exportedAt: string }>(l.url, '/api/mobile/export', { token: l.token });

export const importToServer = (l: ServerLink, sheets: Sheets, commit: boolean) =>
  call<{ report: { committed: boolean; transactions: number; sheets: ImportSheetReport[] } }>(l.url, '/api/mobile/import', { method: 'POST', token: l.token, body: JSON.stringify({ sheets, commit }) });

/** A one-minute link that opens the web app signed in as this account. */
export async function webLink(l: ServerLink, path = '/dashboard'): Promise<string> {
  const r = await call<{ code: string }>(l.url, '/api/mobile/handoff', { method: 'POST', token: l.token });
  return `${l.url}/api/mobile/open?code=${encodeURIComponent(r.code)}&to=${encodeURIComponent(path)}`;
}
