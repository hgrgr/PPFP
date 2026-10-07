/**
 * Plumbing shared by the adapters: request spacing, token reuse, and a JSON
 * fetch with a timeout. Tokens matter: KIS sends a KakaoTalk notice for every
 * token it issues and rate-limits issuance, so a token is fetched once and
 * reused (memory first, then the encrypted copy in the database).
 */
import { BrokerApiError, type BrokerId, type StoredToken, type TokenStore } from './types';

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const slots = new Map<string, number>();

/** Space calls sharing `key` at least `intervalMs` apart, in arrival order. */
export async function throttle(key: string, intervalMs: number): Promise<void> {
  const next = Math.max(Date.now(), (slots.get(key) ?? 0) + intervalMs);
  slots.set(key, next);
  const wait = next - Date.now();
  if (wait > 0) await sleep(wait);
}

/** Exponential backoff with jitter for retry `attempt` (0-based). */
export function backoff(attempt: number): number {
  return 400 * 2 ** attempt + Math.random() * 250;
}

const memory = new Map<string, StoredToken>();
const inflight = new Map<string, Promise<StoredToken>>();
const MARGIN_MS = 5 * 60_000;

export class TokenManager {
  constructor(
    private readonly key: string,
    private readonly store: TokenStore,
    private readonly issue: () => Promise<StoredToken>,
  ) {}

  async get(force = false): Promise<string> {
    const fresh = (t: StoredToken | null | undefined): t is StoredToken => !!t && t.expiresAt - MARGIN_MS > Date.now();
    if (!force) {
      const m = memory.get(this.key);
      if (fresh(m)) return m.token;
      const stored = await this.store.load().catch(() => null);
      if (fresh(stored)) {
        memory.set(this.key, stored);
        return stored.token;
      }
    }
    // One issuance per connection at a time, however many requests are waiting.
    let p = inflight.get(this.key);
    if (!p) {
      p = (async () => {
        const t = await this.issue();
        memory.set(this.key, t);
        await this.store.save(t).catch((e) => console.error('[brokers] token save failed', e instanceof Error ? e.message : e));
        return t;
      })().finally(() => inflight.delete(this.key));
      inflight.set(this.key, p);
    }
    return (await p).token;
  }

  forget() {
    memory.delete(this.key);
  }
}

export interface JsonResponse {
  status: number;
  headers: Headers;
  body: Record<string, unknown>;
}

export async function fetchJson(broker: BrokerId, url: string, init: RequestInit): Promise<JsonResponse> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, cache: 'no-store', signal: AbortSignal.timeout(20_000) });
  } catch (e) {
    const timeout = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
    throw new BrokerApiError(timeout ? '증권사 API 응답이 너무 늦습니다.' : '증권사 API 서버에 연결하지 못했습니다.', broker, 0, timeout ? 'timeout' : 'network');
  }
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    const parsed = text ? JSON.parse(text) : {};
    body = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    body = {};
  }
  return { status: res.status, headers: res.headers, body };
}

/** Token responses report lifetime as seconds (`expires_in`/`expire_in`) or a timestamp. */
export function expiryFrom(body: Record<string, unknown>, fallbackSeconds = 12 * 3600): number {
  const secs = Number(body.expires_in ?? body.expire_in);
  return Date.now() + (Number.isFinite(secs) && secs > 0 ? secs : fallbackSeconds) * 1000;
}

export const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v)).trim();

export function rows(v: unknown): Record<string, unknown>[] {
  if (Array.isArray(v)) return v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object');
  if (v && typeof v === 'object') return [v as Record<string, unknown>];
  return [];
}

export function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : Array.isArray(v) && v[0] && typeof v[0] === 'object' ? (v[0] as Record<string, unknown>) : {};
}

/** Today in KST, YYYY-MM-DD. */
export function todayKst(): string {
  return new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
}
