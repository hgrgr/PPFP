/** Request signing for the crypto exchanges (JWT for Upbit/Bithumb, HMAC for Coinone/Korbit). */
import { createHash, createHmac, randomUUID } from 'node:crypto';

const b64url = (v: Buffer | string) => Buffer.from(v).toString('base64url');

/** Compact JWT signed with HMAC (HS256 or HS512). The secret is used as is, not base64-decoded. */
export function jwt(payload: Record<string, unknown>, secret: string, alg: 'HS256' | 'HS512'): string {
  const head = b64url(JSON.stringify({ alg, typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac(alg === 'HS256' ? 'sha256' : 'sha512', secret).update(`${head}.${body}`).digest();
  return `${head}.${body}.${b64url(sig)}`;
}

export const sha512Hex = (text: string) => createHash('sha512').update(text, 'utf8').digest('hex');
export const hmacHex = (alg: 'sha256' | 'sha512', secret: string, text: string) => createHmac(alg, secret).update(text, 'utf8').digest('hex');
export const nonce = () => randomUUID();

/**
 * Query string as Upbit/Bithumb hash it: not URL-encoded, keys in the order sent,
 * array parameters repeated ("states[]=done&states[]=cancel").
 */
export function rawQuery(params: [string, string][]): string {
  return params.map(([k, v]) => `${k}=${v}`).join('&');
}

export function encodedQuery(params: [string, string][]): string {
  return params.map(([k, v]) => `${encodeURIComponent(k).replace(/%5B%5D/g, '[]')}=${encodeURIComponent(v)}`).join('&');
}
