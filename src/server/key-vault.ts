/**
 * Key backup files: a user's API keys sealed with a passphrase only they know, so the
 * keys can move to another server, a fresh database or (later) an app, and the file can
 * sit anywhere (Google Drive, a USB stick) without exposing them.
 *
 * Format (JSON, version 1):
 *   { format: "ppfp-keys", version: 1,
 *     kdf: { name: "scrypt", N, r, p, salt },   // salt: base64
 *     cipher: "aes-256-gcm", iv, tag, data,     // base64
 *     createdAt }
 * The key is scrypt(passphrase, salt) → 32 bytes. The header (format, version, kdf, cipher)
 * is bound as additional authenticated data, so changing it breaks decryption. Nothing
 * here depends on APP_ENCRYPTION_KEY: any PPFP server, or any client with scrypt and
 * AES-GCM, can open the file with the passphrase.
 */
import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'node:crypto';

export const VAULT_FORMAT = 'ppfp-keys' as const;
export const MIN_PASSPHRASE = 12;

interface Kdf {
  name: 'scrypt';
  N: number;
  r: number;
  p: number;
  salt: string;
}

export interface VaultFile {
  format: typeof VAULT_FORMAT;
  version: 1;
  kdf: Kdf;
  cipher: 'aes-256-gcm';
  iv: string;
  tag: string;
  data: string;
  createdAt: string;
}

export class VaultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VaultError';
  }
}

/** 2^17: about a third of a second and 128 MB per try, so guessing passphrases is slow. */
const DEFAULT_N = 1 << 17;

function deriveKey(passphrase: string, kdf: Kdf): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(passphrase.normalize('NFC'), Buffer.from(kdf.salt, 'base64'), 32, { N: kdf.N, r: kdf.r, p: kdf.p, maxmem: 256 * kdf.N * kdf.r + 16 * 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

const aad = (f: Pick<VaultFile, 'format' | 'version' | 'kdf' | 'cipher'>) => Buffer.from(JSON.stringify([f.format, f.version, f.kdf, f.cipher]));

export function checkPassphrase(passphrase: string) {
  if ([...passphrase].length < MIN_PASSPHRASE) throw new VaultError(`백업 암호는 ${MIN_PASSPHRASE}자 이상으로 정하세요.`);
}

export async function sealVault(payload: unknown, passphrase: string, opts: { N?: number } = {}): Promise<VaultFile> {
  checkPassphrase(passphrase);
  const kdf: Kdf = { name: 'scrypt', N: opts.N ?? DEFAULT_N, r: 8, p: 1, salt: randomBytes(16).toString('base64') };
  const head = { format: VAULT_FORMAT, version: 1 as const, kdf, cipher: 'aes-256-gcm' as const };
  const key = await deriveKey(passphrase, kdf);
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(aad(head));
  const data = Buffer.concat([c.update(JSON.stringify(payload), 'utf8'), c.final()]);
  return { ...head, iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64'), createdAt: new Date().toISOString() };
}

/** Reads a backup file's text. Throws VaultError for a file that is not one, or a wrong passphrase. */
export async function openVault(text: string, passphrase: string): Promise<unknown> {
  let f: VaultFile;
  try {
    f = JSON.parse(text);
  } catch {
    throw new VaultError('PPFP 키 백업 파일이 아닙니다.');
  }
  if (!f || f.format !== VAULT_FORMAT) throw new VaultError('PPFP 키 백업 파일이 아닙니다.');
  if (f.version !== 1 || f.cipher !== 'aes-256-gcm' || f.kdf?.name !== 'scrypt') throw new VaultError('이 버전의 앱이 읽지 못하는 백업 형식입니다.');
  const { N, r, p } = f.kdf;
  // Bounds keep a crafted file from asking for unbounded memory or time.
  if (![N, r, p].every(Number.isInteger) || N < 1 << 14 || N > 1 << 20 || (N & (N - 1)) !== 0 || r < 1 || r > 16 || p < 1 || p > 4) throw new VaultError('백업 파일의 암호화 설정이 올바르지 않습니다.');
  const key = await deriveKey(passphrase, f.kdf);
  try {
    const d = createDecipheriv('aes-256-gcm', key, Buffer.from(f.iv, 'base64'));
    d.setAAD(aad(f));
    d.setAuthTag(Buffer.from(f.tag, 'base64'));
    const plain = Buffer.concat([d.update(Buffer.from(f.data, 'base64')), d.final()]).toString('utf8');
    return JSON.parse(plain);
  } catch {
    throw new VaultError('백업 암호가 틀렸거나 파일이 손상되었습니다.');
  }
}
