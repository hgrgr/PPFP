'use server';

import type { AssetType, LotMethod, TxnType } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { LOT_METHODS } from '@/domain/lots';
import { kstDate, parseKstLocal, prisma } from '@/server/db';
import { createSession, destroySession, requireUser } from '@/server/auth';
import { hashPassword, verifyPassword } from '@/server/crypto';
import { createManualAsset, ensureListedAsset } from '@/server/services/assets';
import { runDailyForUser } from '@/server/services/jobs';
import {
  createPortfolio,
  deletePortfolio,
  linkPortfolio,
  unlinkPortfolio,
  updatePortfolio,
  UserError,
} from '@/server/services/portfolios';
import { rebuildSnapshots } from '@/server/services/snapshots';
import { importOpeningLots, removeTossCredentials, saveTossCredentials } from '@/server/services/sync';
import { deleteTransaction, recordBuy, recordCash, recordSell, recordSplit, recordValuation } from '@/server/services/trading';

export interface ActionState {
  ok?: string;
  error?: string;
  at?: number;
}

const s = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === 'string' ? v.trim() : '';
};
const pct = (v: string) => (Number(v) / 100).toString(); // "60" -> "0.6"

async function run(fn: () => Promise<string | void>, paths: string[] = ['/', '/dashboard']): Promise<ActionState> {
  try {
    const ok = (await fn()) || '저장했습니다.';
    for (const p of paths) revalidatePath(p, 'layout');
    return { ok, at: Date.now() };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message, at: Date.now() };
    if (e && typeof e === 'object' && 'digest' in e) throw e; // redirect()/notFound()
    console.error('[action]', e);
    return { error: '처리 중 오류가 발생했습니다. 잠시 후 다시 시도하세요.', at: Date.now() };
  }
}

/** Keep snapshots consistent after a back-dated change. */
async function refreshFrom(userId: string, date: Date) {
  const day = kstDate(date);
  if (day < kstDate()) await rebuildSnapshots(userId, day);
}

// ── auth ─────────────────────────────────────────────

export async function signupAction(_: ActionState, f: FormData): Promise<ActionState> {
  const email = s(f, 'email').toLowerCase();
  const password = s(f, 'password');
  const name = s(f, 'name');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: '이메일 형식을 확인하세요.' };
  if (password.length < 10) return { error: '비밀번호는 10자 이상이어야 합니다.' };
  if (await prisma.user.findUnique({ where: { email } })) return { error: '이미 가입된 이메일입니다.' };
  const user = await prisma.user.create({ data: { email, name: name || null, passwordHash: await hashPassword(password) } });
  await createSession(user.id);
  redirect('/portfolios?welcome=1');
}

export async function loginAction(_: ActionState, f: FormData): Promise<ActionState> {
  const email = s(f, 'email').toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });
  const ok = user ? await verifyPassword(s(f, 'password'), user.passwordHash) : await hashPassword('timing').then(() => false);
  if (!user || !ok) return { error: '이메일 또는 비밀번호가 올바르지 않습니다.' };
  await createSession(user.id);
  redirect('/dashboard');
}

export async function logoutAction() {
  await destroySession();
  redirect('/login');
}

// ── portfolios ───────────────────────────────────────

export async function createPortfolioAction(_: ActionState, f: FormData) {
  const user = await requireUser();
  return run(async () => {
    const p = await createPortfolio(user.id, {
      name: s(f, 'name'),
      description: s(f, 'description'),
      color: s(f, 'color') || undefined,
      lotMethod: (s(f, 'lotMethod') || undefined) as LotMethod | undefined,
      parentId: s(f, 'parentId') || undefined,
      allocation: s(f, 'allocation') ? pct(s(f, 'allocation')) : undefined,
    });
    return `'${p.name}' 포트폴리오를 만들었습니다.`;
  });
}

export async function linkPortfolioAction(_: ActionState, f: FormData) {
  const user = await requireUser();
  return run(async () => {
    await linkPortfolio(user.id, s(f, 'parentId'), s(f, 'childId'), pct(s(f, 'allocation') || '100'), s(f, 'update') === '1');
    return '연결을 저장했습니다.';
  });
}

export async function unlinkPortfolioAction(_: ActionState, f: FormData) {
  const user = await requireUser();
  return run(async () => {
    await unlinkPortfolio(user.id, s(f, 'parentId'), s(f, 'childId'));
    return '연결을 해제했습니다.';
  });
}

export async function updatePortfolioAction(_: ActionState, f: FormData) {
  const user = await requireUser();
  const method = s(f, 'lotMethod');
  return run(async () => {
    await updatePortfolio(user.id, s(f, 'id'), {
      name: f.has('name') ? s(f, 'name') : undefined,
      description: f.has('description') ? s(f, 'description') : undefined,
      color: s(f, 'color') || undefined,
      lotMethod: (LOT_METHODS as readonly string[]).includes(method) ? (method as LotMethod) : undefined,
      archived: f.has('archived') ? s(f, 'archived') === '1' : undefined,
    });
  });
}

export async function deletePortfolioAction(_: ActionState, f: FormData) {
  const user = await requireUser();
  const r = await run(() => deletePortfolio(user.id, s(f, 'id')).then(() => '삭제했습니다.'));
  if (r.ok) redirect('/portfolios');
  return r;
}

// ── trading ──────────────────────────────────────────

export async function addAssetAndBuyAction(_: ActionState, f: FormData) {
  const user = await requireUser();
  return run(async () => {
    const kind = s(f, 'kind');
    const asset =
      kind === 'listed'
        ? await ensureListedAsset(user.id, s(f, 'symbol'))
        : await createManualAsset(user.id, { type: s(f, 'type') as AssetType, name: s(f, 'name'), currency: s(f, 'currency') || 'KRW' });
    const tradeAt = parseKstLocal(s(f, 'tradeAt'));
    await recordBuy(user.id, {
      portfolioId: s(f, 'portfolioId'),
      assetId: asset.id,
      tradeAt,
      qty: s(f, 'qty'),
      price: s(f, 'price'),
      fee: s(f, 'fee'),
      tax: s(f, 'tax'),
      fxRate: s(f, 'fxRate'),
      fromCash: s(f, 'fromCash') === '1',
      memo: s(f, 'memo'),
    });
    await refreshFrom(user.id, tradeAt);
    return `${asset.name} 매수를 기록했습니다.`;
  });
}

export async function buyAction(_: ActionState, f: FormData) {
  const user = await requireUser();
  return run(async () => {
    const tradeAt = parseKstLocal(s(f, 'tradeAt'));
    await recordBuy(user.id, {
      portfolioId: s(f, 'portfolioId'),
      assetId: s(f, 'assetId'),
      tradeAt,
      qty: s(f, 'qty'),
      price: s(f, 'price'),
      fee: s(f, 'fee'),
      tax: s(f, 'tax'),
      fxRate: s(f, 'fxRate'),
      fromCash: s(f, 'fromCash') === '1',
      memo: s(f, 'memo'),
    });
    await refreshFrom(user.id, tradeAt);
    return '매수를 기록했습니다. 새 Lot이 생겼습니다.';
  });
}

export async function sellAction(_: ActionState, f: FormData) {
  const user = await requireUser();
  return run(async () => {
    const tradeAt = parseKstLocal(s(f, 'tradeAt'));
    const method = s(f, 'method') as LotMethod;
    if (!(LOT_METHODS as readonly string[]).includes(method)) throw new UserError('Lot 선택 방식을 고르세요.');
    const picks = method === 'SPECIFIC' ? (JSON.parse(s(f, 'picks') || '[]') as { lotId: string; qty: string }[]) : [];
    const { result } = await recordSell(user.id, {
      holdingId: s(f, 'holdingId'),
      tradeAt,
      qty: s(f, 'qty'),
      price: s(f, 'price'),
      fee: s(f, 'fee'),
      tax: s(f, 'tax'),
      fxRate: s(f, 'fxRate'),
      method,
      picks,
      toCash: s(f, 'toCash') === '1',
      memo: s(f, 'memo'),
    });
    await refreshFrom(user.id, tradeAt);
    return `매도를 기록했습니다. 실현손익 ${result.pnl.toFixed(2)} (Lot ${result.pieces.length}개)`;
  });
}

export async function cashAction(_: ActionState, f: FormData) {
  const user = await requireUser();
  return run(async () => {
    const tradeAt = parseKstLocal(s(f, 'tradeAt'));
    await recordCash(user.id, {
      portfolioId: s(f, 'portfolioId'),
      type: s(f, 'type') as TxnType,
      amount: s(f, 'amount'),
      currency: s(f, 'currency') || 'KRW',
      tradeAt,
      holdingId: s(f, 'holdingId') || undefined,
      fxRate: s(f, 'fxRate'),
      memo: s(f, 'memo'),
    });
    await refreshFrom(user.id, tradeAt);
  });
}

export async function valuationAction(_: ActionState, f: FormData) {
  const user = await requireUser();
  return run(async () => {
    const tradeAt = parseKstLocal(s(f, 'tradeAt'));
    await recordValuation(user.id, { holdingId: s(f, 'holdingId'), price: s(f, 'price'), tradeAt, memo: s(f, 'memo') });
    await refreshFrom(user.id, tradeAt);
    return '평가액을 갱신했습니다.';
  });
}

export async function splitAction(_: ActionState, f: FormData) {
  const user = await requireUser();
  return run(async () => {
    const tradeAt = parseKstLocal(s(f, 'tradeAt'));
    await recordSplit(user.id, { holdingId: s(f, 'holdingId'), ratio: s(f, 'ratio'), tradeAt, memo: s(f, 'memo') });
    await refreshFrom(user.id, tradeAt);
    return '모든 Lot의 수량과 단가를 조정했습니다.';
  });
}

export async function deleteTransactionAction(_: ActionState, f: FormData) {
  const user = await requireUser();
  return run(async () => {
    const r = await deleteTransaction(user.id, s(f, 'id'));
    if (r.tradeAt < kstDate()) await rebuildSnapshots(user.id, r.tradeAt);
    return '거래를 삭제했습니다. 감사 로그에는 남아 있습니다.';
  });
}

// ── Toss link & jobs ────────────────────────────────

export async function saveTossAction(_: ActionState, f: FormData) {
  const user = await requireUser();
  return run(async () => {
    const r = await saveTossCredentials(user.id, s(f, 'clientId'), s(f, 'clientSecret'));
    return r.accountSeq === null ? '연결했습니다. 다만 증권 계좌를 찾지 못했습니다.' : '토스증권과 연결했습니다.';
  }, ['/settings']);
}

export async function removeTossAction(_: ActionState) {
  const user = await requireUser();
  return run(async () => {
    await removeTossCredentials(user.id);
    return '연결을 해제했습니다.';
  }, ['/settings']);
}

export async function importLotsAction(_: ActionState, f: FormData) {
  const user = await requireUser();
  return run(async () => {
    const n = await importOpeningLots(user.id, s(f, 'portfolioId'), f.getAll('symbols').map(String));
    return n ? `${n}개 종목의 시작 Lot을 만들었습니다.` : '가져올 차이가 없습니다.';
  }, ['/settings', '/dashboard']);
}

export async function refreshDataAction(_: ActionState) {
  const user = await requireUser();
  return run(async () => {
    const r = await runDailyForUser(user.id, { fullRebuild: true });
    return `시세 ${r.closes}건을 저장하고 ${r.days}일치 스냅샷을 다시 계산했습니다.`;
  });
}

export async function updatePrefsAction(_: ActionState, f: FormData) {
  const user = await requireUser();
  return run(async () => {
    await prisma.user.update({ where: { id: user.id }, data: { name: s(f, 'name') || null, redUp: s(f, 'redUp') !== '0' } });
  }, ['/']);
}
