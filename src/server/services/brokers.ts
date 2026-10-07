/**
 * Brokerage links: storing credentials, verifying them, and building adapters
 * whose access tokens persist (encrypted) across restarts.
 */
import type { BrokerConnection } from '@prisma/client';
import { BROKERS, BROKER_IDS, type BrokerId } from '@/lib/brokers';
import { prisma } from '../db';
import { decryptSecret, encryptSecret, mask } from '../crypto';
import { BrokerApiError, createAdapter, MARKET_DATA_ORDER, memoryTokenStore, type BrokerAdapter, type TokenStore } from '../brokers';
import { audit, UserError } from './portfolios';

/**
 * Identifies an account across reconnects; recorded on imported lots as `importSource`.
 * Brokers that bind the account to the app key (no account number) are told apart by the connection's name.
 */
export function sourceKey(c: { broker: BrokerId; accountNo: string | null; label: string }): string {
  return `${c.broker}:${c.accountNo || c.label}`;
}

function dbTokenStore(connectionId: string): TokenStore {
  return {
    async load() {
      const c = await prisma.brokerConnection.findUnique({ where: { id: connectionId }, select: { tokenEncrypted: true, tokenExpiresAt: true } });
      if (!c?.tokenEncrypted || !c.tokenExpiresAt) return null;
      return { token: decryptSecret(c.tokenEncrypted), expiresAt: c.tokenExpiresAt.getTime() };
    },
    async save(t) {
      await prisma.brokerConnection.update({
        where: { id: connectionId },
        data: { tokenEncrypted: encryptSecret(t.token), tokenExpiresAt: new Date(t.expiresAt) },
      });
    },
  };
}

export function adapterFor(c: BrokerConnection): BrokerAdapter {
  return createAdapter(
    c.broker,
    { id: c.id, appKey: c.appKey, secret: decryptSecret(c.secretEncrypted), accountNo: c.accountNo, paper: c.paper },
    dbTokenStore(c.id),
  );
}

export function listConnections(userId: string) {
  return prisma.brokerConnection.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
}

export interface ConnectionInput {
  broker: string;
  label?: string;
  appKey: string;
  appSecret: string;
  accountNo?: string;
  paper?: boolean;
}

/** Verify the keys against the broker, then store them. Nothing is saved if the broker rejects them. */
export async function saveConnection(userId: string, input: ConnectionInput) {
  const broker = input.broker as BrokerId;
  if (!BROKER_IDS.includes(broker)) throw new UserError('증권사를 선택하세요.');
  const meta = BROKERS[broker];
  const appKey = input.appKey.trim();
  const secret = input.appSecret.trim();
  if (!appKey || !secret) throw new UserError(`${meta.keyLabel}와 ${meta.secretLabel}을 모두 입력하세요.`);
  const accountNo = input.accountNo?.trim() || null;
  if (meta.needsAccount && !accountNo) throw new UserError(`${meta.label}는 계좌번호가 필요합니다.`);
  const paper = meta.paper && !!input.paper;
  const label = (input.label?.trim() || meta.label + (paper ? ' (모의)' : '')).slice(0, 40);

  // Verify with a throwaway token store; keep the token it obtained so the first real call does not issue another.
  const store = memoryTokenStore();
  const adapter = createAdapter(broker, { id: `new:${broker}:${appKey}`, appKey, secret, accountNo, paper }, store);
  let verified: { accountNo?: string | null };
  try {
    verified = await adapter.verify();
  } catch (e) {
    throw new UserError(e instanceof BrokerApiError ? e.message : `${meta.label} 연결을 확인하지 못했습니다.`);
  }
  const finalAccount = verified.accountNo ?? accountNo;
  const existing = await listConnections(userId);
  const key = sourceKey({ broker, accountNo: finalAccount, label });
  if (existing.some((c) => sourceKey(c) === key)) {
    throw new UserError(finalAccount ? '이 계좌는 이미 연결되어 있습니다. 키를 바꾸려면 예전 연결을 먼저 해제하세요.' : `'${label}' 이름의 ${meta.label} 연결이 이미 있습니다. 다른 이름을 쓰거나 예전 연결을 먼저 해제하세요.`);
  }
  const conn = await prisma.brokerConnection.create({
    data: {
      userId,
      broker,
      label,
      appKey,
      secretEncrypted: encryptSecret(secret),
      accountNo: finalAccount,
      paper,
      tokenEncrypted: store.current ? encryptSecret(store.current.token) : null,
      tokenExpiresAt: store.current ? new Date(store.current.expiresAt) : null,
      lastSyncAt: new Date(),
    },
  });
  await audit(prisma, userId, 'broker_connection', conn.id, 'create', undefined, { broker, label, appKey: mask(appKey), accountNo: conn.accountNo, paper });
  return conn;
}

export async function removeConnection(userId: string, id: string) {
  const conn = await prisma.brokerConnection.findFirst({ where: { id, userId } });
  if (!conn) throw new UserError('연결을 찾을 수 없습니다.');
  await prisma.brokerConnection.delete({ where: { id } });
  await audit(prisma, userId, 'broker_connection', id, 'delete', { broker: conn.broker, label: conn.label, appKey: mask(conn.appKey) });
  return conn;
}

export async function markStatus(id: string, error: string | null) {
  await prisma.brokerConnection.update({ where: { id }, data: error ? { lastError: error } : { lastSyncAt: new Date(), lastError: null } }).catch(() => {});
}

export async function testConnection(userId: string, id: string) {
  const conn = await prisma.brokerConnection.findFirst({ where: { id, userId } });
  if (!conn) throw new UserError('연결을 찾을 수 없습니다.');
  try {
    await adapterFor(conn).verify();
    await markStatus(id, null);
    return conn;
  } catch (e) {
    const msg = e instanceof BrokerApiError ? e.message : '연결을 확인하지 못했습니다.';
    await markStatus(id, msg);
    throw new UserError(msg);
  }
}

export interface Provider {
  conn: BrokerConnection;
  adapter: BrokerAdapter;
}

/** Linked brokers in the order to ask for market data. */
export async function marketProviders(userId: string): Promise<Provider[]> {
  const conns = await listConnections(userId);
  return conns
    .sort((a, b) => MARKET_DATA_ORDER.indexOf(a.broker) - MARKET_DATA_ORDER.indexOf(b.broker))
    .map((conn) => ({ conn, adapter: adapterFor(conn) }));
}
