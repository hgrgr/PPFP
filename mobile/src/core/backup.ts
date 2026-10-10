/**
 * The whole phone database as one file locked with a passphrase, to keep on Google Drive
 * (or anywhere) and bring back on a new phone. WebCrypto only: PBKDF2-SHA-256 (600,000
 * rounds) derives an AES-256-GCM key; the header is authenticated with the data, so a file
 * edited by hand does not open. Nothing about the passphrase is stored.
 */
export const BACKUP_FORMAT = 'ppfp-mobile-backup' as const;
export const BACKUP_VERSION = 1;
export const MIN_PASSPHRASE = 10;
const ITERATIONS = 600_000;

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: number;
  createdAt: string;
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string };
  cipher: { name: 'AES-GCM'; iv: string };
  data: string;
}

export class BackupError extends Error {}

const b64 = (bytes: Uint8Array) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

const header = (f: Pick<BackupFile, 'format' | 'version' | 'createdAt' | 'kdf' | 'cipher'>) =>
  new TextEncoder().encode(JSON.stringify([f.format, f.version, f.createdAt, f.kdf, f.cipher]));

async function keyFrom(passphrase: string, salt: Uint8Array, iterations: number) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export function checkPassphrase(p: string) {
  if (p.length < MIN_PASSPHRASE) throw new BackupError(`백업 암호는 ${MIN_PASSPHRASE}자 이상으로 정하세요.`);
}

export async function sealBackup(payload: unknown, passphrase: string, opts: { iterations?: number; now?: Date } = {}): Promise<BackupFile> {
  checkPassphrase(passphrase);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const iterations = opts.iterations ?? ITERATIONS;
  const head = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: (opts.now ?? new Date()).toISOString(),
    kdf: { name: 'PBKDF2' as const, hash: 'SHA-256' as const, iterations, salt: b64(salt) },
    cipher: { name: 'AES-GCM' as const, iv: b64(iv) },
  };
  const key = await keyFrom(passphrase, salt, iterations);
  const plain = new TextEncoder().encode(JSON.stringify(payload));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource, additionalData: header(head) as BufferSource }, key, plain));
  return { ...head, data: b64(ct) };
}

export async function openBackup<T = unknown>(text: string, passphrase: string): Promise<{ payload: T; createdAt: string }> {
  let f: BackupFile;
  try {
    f = JSON.parse(text) as BackupFile;
  } catch {
    throw new BackupError('PPFP 백업 파일이 아닙니다.');
  }
  if (f?.format !== BACKUP_FORMAT || typeof f.data !== 'string' || f.kdf?.name !== 'PBKDF2' || f.cipher?.name !== 'AES-GCM') throw new BackupError('PPFP 앱 백업 파일이 아닙니다.');
  if (f.version > BACKUP_VERSION) throw new BackupError('더 새 버전의 앱에서 만든 백업입니다. 앱을 업데이트하세요.');
  if (!(f.kdf.iterations >= 100_000 && f.kdf.iterations <= 5_000_000)) throw new BackupError('백업 파일이 손상됐습니다.');
  const key = await keyFrom(passphrase, unb64(f.kdf.salt), f.kdf.iterations);
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(f.cipher.iv) as BufferSource, additionalData: header(f) as BufferSource }, key, unb64(f.data) as BufferSource);
  } catch {
    throw new BackupError('백업 암호가 맞지 않거나 파일이 손상됐습니다.');
  }
  return { payload: JSON.parse(new TextDecoder().decode(plain)) as T, createdAt: f.createdAt };
}
