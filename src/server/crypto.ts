/**
 * Crypto helpers built only on node:crypto.
 * - passwords: scrypt with per-user salt
 * - session tokens: random 32 bytes, stored as SHA-256 hash
 * - Toss client secrets: AES-256-GCM with APP_ENCRYPTION_KEY
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const SCRYPT_N = 16384;
const SCRYPT_KEYLEN = 64;

function scryptAsync(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt);
  return `scrypt$${SCRYPT_N}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, , saltB64, keyB64] = stored.split('$');
  if (alg !== 'scrypt' || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scryptAsync(password, Buffer.from(saltB64, 'base64'));
  return key.length === expected.length && timingSafeEqual(key, expected);
}

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function encryptionKey(keyB64 = process.env.APP_ENCRYPTION_KEY): Buffer {
  const key = Buffer.from(keyB64 ?? '', 'base64');
  if (key.length !== 32) {
    throw new Error('APP_ENCRYPTION_KEY must be 32 bytes, base64 encoded');
  }
  return key;
}

/** Returns "v1.<iv>.<tag>.<ciphertext>" (base64url parts). */
export function encryptSecret(plain: string, keyB64?: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(keyB64), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), ct.toString('base64url')].join('.');
}

export function decryptSecret(blob: string, keyB64?: string): string {
  const [v, ivB, tagB, ctB] = blob.split('.');
  if (v !== 'v1' || !ivB || !tagB || ctB === undefined) throw new Error('Unsupported secret format');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(keyB64), Buffer.from(ivB, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ctB, 'base64url')), decipher.final()]).toString('utf8');
}

/** Show only the last 4 characters of an identifier. */
export function mask(text: string): string {
  return text.length <= 4 ? '••••' : '•'.repeat(Math.min(8, text.length - 4)) + text.slice(-4);
}
