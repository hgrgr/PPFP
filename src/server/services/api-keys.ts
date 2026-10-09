/** Users' keys for outside services (book search, AI providers), stored encrypted. */
import { decryptSecret, encryptSecret, mask } from '../crypto';
import { prisma } from '../db';

/** The user's own key, or the server's env key, or null. */
export async function serviceKey(userId: string, service: string, envName: string): Promise<{ key: string; source: 'user' | 'server' } | null> {
  const row = await prisma.apiKey.findUnique({ where: { userId_service: { userId, service } } });
  if (row) return { key: decryptSecret(row.keyEnc), source: 'user' };
  const env = process.env[envName]?.trim();
  return env ? { key: env, source: 'server' } : null;
}

export async function keyHints(userId: string): Promise<Map<string, string>> {
  const rows = await prisma.apiKey.findMany({ where: { userId }, select: { service: true, hint: true } });
  return new Map(rows.map((r) => [r.service, r.hint]));
}

export async function setServiceKey(userId: string, service: string, key: string) {
  const data = { keyEnc: encryptSecret(key), hint: mask(key) };
  await prisma.apiKey.upsert({ where: { userId_service: { userId, service } }, create: { userId, service, ...data }, update: data });
}

export async function clearServiceKey(userId: string, service: string) {
  await prisma.apiKey.deleteMany({ where: { userId, service } });
}
