/**
 * Toss Securities account link: credential storage, account balance
 * comparison and the initial-lot import. API balances are never written over
 * the user's ledger automatically; differences are shown and fixed explicitly.
 */
import { Dec } from '@/domain/decimal';
import { dec, prisma } from '../db';
import { encryptSecret, mask } from '../crypto';
import { fxRate, tossClientFor } from '../market';
import { TossApiError, TossClient } from '../toss/client';
import { ensureListedAsset } from './assets';
import { audit, ownedPortfolio, UserError } from './portfolios';
import { recordBuy } from './trading';

export async function saveTossCredentials(userId: string, clientId: string, clientSecret: string) {
  clientId = clientId.trim();
  clientSecret = clientSecret.trim();
  if (!clientId || !clientSecret) throw new UserError('Client ID와 Client Secret을 모두 입력하세요.');
  const client = new TossClient({ clientId, clientSecret });
  let accountSeq: number | null = null;
  try {
    await client.token(true);
    const accounts = await client.accounts();
    accountSeq = accounts.find((a) => a.accountType === 'BROKERAGE')?.accountSeq ?? accounts[0]?.accountSeq ?? null;
  } catch (e) {
    throw new UserError(e instanceof TossApiError ? e.message : '토스증권 연결을 확인하지 못했습니다.');
  }
  await prisma.tossCredential.upsert({
    where: { userId },
    create: { userId, clientId, secretEncrypted: encryptSecret(clientSecret), accountSeq: accountSeq === null ? null : BigInt(accountSeq) },
    update: { clientId, secretEncrypted: encryptSecret(clientSecret), accountSeq: accountSeq === null ? null : BigInt(accountSeq), lastError: null },
  });
  await audit(prisma, userId, 'toss_credential', userId, 'upsert', undefined, { clientId: mask(clientId), accountSeq });
  return { accountSeq };
}

export async function removeTossCredentials(userId: string) {
  await prisma.tossCredential.deleteMany({ where: { userId } });
  await audit(prisma, userId, 'toss_credential', userId, 'delete');
}

export interface Reconcile {
  symbol: string;
  name: string;
  currency: string;
  tossQty: Dec;
  appQty: Dec;
  diff: Dec;
  averagePrice: Dec;
  lastPrice: Dec;
}

/** Compare the Toss account's holdings with the lots recorded in the app. */
export async function reconcile(userId: string): Promise<{ rows: Reconcile[]; accountSeq: string | null }> {
  const cred = await prisma.tossCredential.findUnique({ where: { userId } });
  const client = await tossClientFor(userId);
  if (!cred || !client) throw new UserError('토스증권 API가 연결되어 있지 않습니다.');
  if (cred.accountSeq === null) throw new UserError('연결된 증권 계좌를 찾지 못했습니다.');
  let items;
  try {
    items = (await client.holdings(cred.accountSeq)).items;
    await prisma.tossCredential.update({ where: { userId }, data: { lastSyncAt: new Date(), lastError: null } });
  } catch (e) {
    const msg = e instanceof TossApiError ? e.message : '보유 종목을 가져오지 못했습니다.';
    await prisma.tossCredential.update({ where: { userId }, data: { lastError: msg } });
    throw new UserError(msg);
  }
  const holdings = await prisma.holding.findMany({
    where: { portfolio: { userId }, asset: { symbol: { not: null } } },
    include: { asset: true, lots: { where: { qtyRemaining: { gt: 0 } } } },
  });
  const appQty = new Map<string, Dec>();
  for (const h of holdings) {
    const s = h.asset.symbol!.toUpperCase();
    appQty.set(s, (appQty.get(s) ?? Dec.ZERO).add(Dec.sum(h.lots.map((l) => dec(l.qtyRemaining)))));
  }
  const rows: Reconcile[] = items.map((i) => {
    const sym = i.symbol.toUpperCase();
    const a = appQty.get(sym) ?? Dec.ZERO;
    const t = Dec.of(i.quantity);
    appQty.delete(sym);
    return { symbol: sym, name: i.name, currency: i.currency, tossQty: t, appQty: a, diff: t.sub(a), averagePrice: Dec.of(i.averagePurchasePrice), lastPrice: Dec.of(i.lastPrice) };
  });
  // In the app but no longer in the account
  for (const [sym, q] of appQty) {
    if (q.isZero()) continue;
    const h = holdings.find((x) => x.asset.symbol?.toUpperCase() === sym)!;
    rows.push({ symbol: sym, name: h.asset.name, currency: h.asset.currency, tossQty: Dec.ZERO, appQty: q, diff: q.neg(), averagePrice: Dec.ZERO, lastPrice: Dec.ZERO });
  }
  return { rows, accountSeq: cred.accountSeq.toString() };
}

/**
 * For each symbol where the account holds more than the app, create one
 * opening lot at the broker's average price, funded from outside the portfolio.
 */
export async function importOpeningLots(userId: string, portfolioId: string, symbols: string[]) {
  await ownedPortfolio(userId, portfolioId);
  const { rows } = await reconcile(userId);
  const wanted = new Set(symbols.map((s) => s.toUpperCase()));
  const usd = await fxRate(userId, 'USD');
  let created = 0;
  for (const r of rows) {
    if (!wanted.has(r.symbol) || !r.diff.isPos()) continue;
    const asset = await ensureListedAsset(userId, r.symbol);
    await recordBuy(userId, {
      portfolioId,
      assetId: asset.id,
      tradeAt: new Date(),
      qty: r.diff.toString(),
      price: r.averagePrice.toString(),
      fxRate: r.currency === 'USD' ? usd.toString() : undefined,
      fromCash: false,
      memo: '토스증권 계좌에서 가져온 시작 Lot (증권사 평균단가)',
    });
    await prisma.holding.update({
      where: { portfolioId_assetId: { portfolioId, assetId: asset.id } },
      data: { qtySource: 'TOSS' },
    });
    created++;
  }
  return created;
}
