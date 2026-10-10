/**
 * Backing up and restoring a user's keys: brokerage and exchange connections (app key,
 * secret, account) and outside-service keys (AI companies, 카카오, 공공데이터포털), sealed
 * with a passphrase (see key-vault). Access tokens are left out; they are issued again.
 */
import { z } from 'zod';
import { PROVIDER_ORDER } from '@/domain/ai-providers';
import { BROKERS, type BrokerId } from '@/lib/brokers';
import { decryptSecret, verifyPassword } from '../crypto';
import { prisma } from '../db';
import { checkPassphrase, openVault, sealVault, VaultError } from '../key-vault';
import { setServiceKey } from './api-keys';
import { listConnections, saveConnection, sourceKey } from './brokers';
import { audit, UserError } from './portfolios';

/** Outside services whose keys are kept in ApiKey */
export const BACKUP_SERVICES = ['kakao', 'molit', ...PROVIDER_ORDER] as const;
const SERVICE_LABEL: Record<string, string> = { kakao: '카카오', molit: '공공데이터포털', anthropic: 'Anthropic', openai: 'OpenAI', gemini: 'Google Gemini', xai: 'xAI', deepseek: 'DeepSeek' };

const Payload = z.object({
  kind: z.literal('ppfp-key-backup'),
  exportedAt: z.string(),
  brokers: z
    .array(z.object({ broker: z.string(), label: z.string().max(40), appKey: z.string().min(1).max(500), secret: z.string().min(1).max(2000), accountNo: z.string().max(40).nullable(), paper: z.boolean() }))
    .max(50),
  services: z.array(z.object({ service: z.string(), key: z.string().min(1).max(2000) })).max(50),
});
export type KeyBackup = z.infer<typeof Payload>;

/** Every key the user has saved, in the clear: only ever handed to sealVault. */
export async function keyPayload(userId: string): Promise<KeyBackup> {
  const [conns, keys] = await Promise.all([
    prisma.brokerConnection.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    prisma.apiKey.findMany({ where: { userId } }),
  ]);
  return {
    kind: 'ppfp-key-backup',
    exportedAt: new Date().toISOString(),
    brokers: conns.map((c) => ({ broker: c.broker, label: c.label, appKey: c.appKey, secret: decryptSecret(c.secretEncrypted), accountNo: c.accountNo, paper: c.paper })),
    services: keys.filter((k) => (BACKUP_SERVICES as readonly string[]).includes(k.service)).map((k) => ({ service: k.service, key: decryptSecret(k.keyEnc) })),
  };
}

/**
 * The backup file's text. Asks for the login password again: the file holds every secret,
 * so an open session alone (a borrowed phone, a stolen cookie) is not enough.
 */
export async function exportKeys(userId: string, input: { password: string; passphrase: string; confirm: string }) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!(await verifyPassword(input.password, user.passwordHash))) throw new UserError('로그인 비밀번호가 맞지 않습니다.');
  if (input.passphrase !== input.confirm) throw new UserError('백업 암호 두 칸이 다릅니다.');
  try {
    checkPassphrase(input.passphrase);
  } catch (e) {
    throw new UserError((e as Error).message);
  }
  if (input.passphrase === input.password) throw new UserError('백업 암호는 로그인 비밀번호와 다르게 정하세요.');
  const payload = await keyPayload(userId);
  if (!payload.brokers.length && !payload.services.length) throw new UserError('백업할 키가 없습니다. 연동 · 설정에서 키를 먼저 저장하세요.');
  const file = await sealVault(payload, input.passphrase);
  await audit(prisma, userId, 'key_backup', userId, 'export', undefined, { brokers: payload.brokers.length, services: payload.services.map((s) => s.service) });
  return { text: JSON.stringify(file, null, 2), brokers: payload.brokers.length, services: payload.services.length };
}

export interface RestoreLine {
  what: string;
  result: 'added' | 'replaced' | 'skipped' | 'failed';
  note?: string;
}

/**
 * Puts the keys from a backup into this account. Connections already here (same broker and
 * account) and keys already saved are left alone unless `overwrite`. With `verify`, each
 * connection is checked against its broker first, as when it is added by hand.
 */
export async function restoreKeys(userId: string, text: string, passphrase: string, opts: { verify: boolean; overwrite: boolean }): Promise<RestoreLine[]> {
  let raw: unknown;
  try {
    raw = await openVault(text, passphrase);
  } catch (e) {
    if (e instanceof VaultError) throw new UserError(e.message);
    throw e;
  }
  const parsed = Payload.safeParse(raw);
  if (!parsed.success) throw new UserError('백업 파일의 내용을 읽지 못했습니다.');
  const backup = parsed.data;
  const out: RestoreLine[] = [];

  const existing = new Set((await listConnections(userId)).map(sourceKey));
  for (const b of backup.brokers) {
    const meta = BROKERS[b.broker as BrokerId];
    const what = `${meta?.label ?? b.broker} · ${b.label}`;
    if (!meta) {
      out.push({ what, result: 'failed', note: '이 버전에서 지원하지 않는 기관입니다.' });
      continue;
    }
    if (existing.has(sourceKey({ broker: b.broker as BrokerId, accountNo: b.accountNo, label: b.label }))) {
      out.push({ what, result: 'skipped', note: '이미 연결되어 있습니다.' });
      continue;
    }
    try {
      await saveConnection(userId, { broker: b.broker, label: b.label, appKey: b.appKey, appSecret: b.secret, accountNo: b.accountNo ?? undefined, paper: b.paper, verify: opts.verify });
      out.push({ what, result: 'added', note: opts.verify ? '연결 확인함' : '확인 없이 저장 (설정에서 연결 확인)' });
    } catch (e) {
      out.push({ what, result: 'failed', note: e instanceof UserError ? e.message : '저장하지 못했습니다.' });
    }
  }

  const have = new Set((await prisma.apiKey.findMany({ where: { userId }, select: { service: true } })).map((k) => k.service));
  for (const s of backup.services) {
    const what = `${SERVICE_LABEL[s.service] ?? s.service} 키`;
    if (!(BACKUP_SERVICES as readonly string[]).includes(s.service)) {
      out.push({ what, result: 'failed', note: '이 버전에서 쓰지 않는 서비스입니다.' });
      continue;
    }
    if (have.has(s.service) && !opts.overwrite) {
      out.push({ what, result: 'skipped', note: '이미 저장된 키가 있습니다.' });
      continue;
    }
    await setServiceKey(userId, s.service, s.key);
    out.push({ what, result: have.has(s.service) ? 'replaced' : 'added' });
  }
  await audit(prisma, userId, 'key_backup', userId, 'restore', undefined, { results: out.map((l) => `${l.what}: ${l.result}`), verify: opts.verify, overwrite: opts.overwrite });
  return out;
}
