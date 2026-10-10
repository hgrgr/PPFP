'use server';

import type { AssetType, LotMethod, TxnType } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { LOT_METHODS } from '@/domain/lots';
import { kstDate, parseKstLocal, prisma } from '@/server/db';
import { money } from '@/lib/format';
import { fxRate as currentFx } from '@/server/market';
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
import { removeConnection, saveConnection, testConnection } from '@/server/services/brokers';
import { addWatch, removeWatch } from '@/server/services/market-board';
import { syncExchangeHistory } from '@/server/services/exchange-sync';
import { importHoldings, readPastedHoldings, uploadedTableText, type ImportSelection, type ImportSource } from '@/server/services/imports';
import { deleteTransaction, moveHolding, recordBuy, removeHolding, recordCash, recordSell, recordSplit, recordValuation } from '@/server/services/trading';

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

export async function removeHoldingAction(_: ActionState, f: FormData) {
  const user = await requireUser();
  const r = await run(async () => {
    const res = await removeHolding(user.id, s(f, 'id'));
    if (res.firstDate && res.firstDate < kstDate()) await rebuildSnapshots(user.id, res.firstDate);
    return `${res.name}을(를) 포트폴리오에서 뺐습니다 (거래 ${res.count}건 삭제). 감사 로그에는 남아 있습니다.`;
  }, ['/']);
  // From the stock's own page there is nothing left to show: back to the portfolio
  if (r.ok && /^\/portfolios\/[\w-]+$/.test(s(f, 'back'))) redirect(s(f, 'back'));
  return r;
}

export async function moveHoldingAction(_: ActionState, f: FormData) {
  const user = await requireUser();
  let dest = '';
  const r = await run(async () => {
    if (!s(f, 'to')) throw new UserError('옮길 포트폴리오를 고르세요.');
    const moved = await moveHolding(user.id, s(f, 'id'), s(f, 'to'), { settle: s(f, 'settle') === '1', usdkrw: (await currentFx(user.id, 'USD')).toString() });
    if (moved.firstDate && moved.firstDate < kstDate()) await rebuildSnapshots(user.id, moved.firstDate);
    dest = moved.holdingId;
    const short = moved.negativeCash.length ? ` ${moved.to}의 현금이 ${moved.negativeCash.map((c) => money(c.amount.toString(), c.currency)).join(', ')}이 되었습니다. 필요하면 입금을 기록하세요.` : '';
    const settled = moved.settled.length ? ` 현금 ${moved.settled.map((c) => money(c.amount.abs().toString(), c.currency)).join(', ')}을(를) ${moved.settled[0].amount.isPos() ? `${moved.from}에서 ${moved.to}(으)로` : `${moved.to}에서 ${moved.from}(으)로`} 보내 두 포트폴리오의 현금은 그대로입니다.` : '';
    return `${moved.name}을(를) ${moved.from}에서 ${moved.to}(으)로 옮겼습니다 (거래 ${moved.count}건${moved.merged ? ', 기존 보유와 합침' : ''}).${settled}${short}`;
  }, ['/']);
  // The stock's page now lives under the new holding
  if (r.ok && dest && s(f, 'back') === 'holding') redirect(`/holdings/${dest}`);
  return r;
}

/** Take an asset out of every portfolio that holds it. */
export async function removeAssetAction(_: ActionState, f: FormData) {
  const user = await requireUser();
  return run(async () => {
    const holdings = await prisma.holding.findMany({ where: { assetId: s(f, 'assetId'), portfolio: { userId: user.id } }, select: { id: true } });
    if (!holdings.length) throw new UserError('보유 중인 포트폴리오가 없습니다.');
    let name = '';
    let count = 0;
    let first: string | null = null;
    for (const h of holdings) {
      const res = await removeHolding(user.id, h.id);
      name = res.name;
      count += res.count;
      if (res.firstDate && (!first || res.firstDate < first)) first = res.firstDate;
    }
    if (first && first < kstDate()) await rebuildSnapshots(user.id, first);
    return `${name}을(를) 포트폴리오 ${holdings.length}곳에서 모두 뺐습니다 (거래 ${count}건 삭제). 감사 로그에는 남아 있습니다.`;
  }, ['/']);
}

// ── Broker links, imports & jobs ────────────────────

export async function saveBrokerAction(_: ActionState, f: FormData) {
  const user = await requireUser();
  return run(async () => {
    const c = await saveConnection(user.id, {
      broker: s(f, 'broker'),
      label: s(f, 'label'),
      appKey: s(f, 'appKey'),
      appSecret: s(f, 'appSecret'),
      accountNo: s(f, 'accountNo'),
      paper: s(f, 'paper') === '1',
    });
    return `${c.label} 연결을 확인하고 저장했습니다.`;
  }, ['/settings', '/import']);
}

export async function removeBrokerAction(_: ActionState, f: FormData) {
  const user = await requireUser();
  return run(async () => {
    const c = await removeConnection(user.id, s(f, 'id'));
    return `${c.label} 연결을 해제했습니다. 저장된 키와 토큰을 지웠습니다.`;
  }, ['/settings', '/import']);
}

export async function testBrokerAction(_: ActionState, f: FormData) {
  const user = await requireUser();
  return run(async () => {
    const c = await testConnection(user.id, s(f, 'id'));
    return `${c.label}: 정상적으로 연결되어 있습니다.`;
  }, ['/settings']);
}

export async function importHoldingsAction(_: ActionState, f: FormData) {
  const user = await requireUser();
  return run(async () => {
    let rows: ImportSelection[];
    try {
      rows = JSON.parse(s(f, 'rows') || '[]') as ImportSelection[];
    } catch {
      throw new UserError('선택한 종목을 읽지 못했습니다. 화면을 새로 고치세요.');
    }
    if (!Array.isArray(rows)) throw new UserError('선택한 종목을 읽지 못했습니다.');
    const tradeAt = parseKstLocal(s(f, 'tradeAt'));
    const n = await importHoldings(user.id, { sourceKey: s(f, 'sourceKey'), sourceLabel: s(f, 'sourceLabel'), tradeAt, rows });
    await refreshFrom(user.id, tradeAt);
    return `${n}개 종목을 가져와 시작 Lot을 만들었습니다.`;
  }, ['/import', '/dashboard', '/portfolios']);
}

export interface PasteState {
  source?: ImportSource;
  errors?: string[];
  error?: string;
  at?: number;
}

export async function readPasteAction(_: PasteState, f: FormData): Promise<PasteState> {
  const user = await requireUser();
  try {
    const file = f.get('file');
    let text = s(f, 'text');
    if (file instanceof File && file.size > 0) {
      if (file.size > 2_000_000) throw new UserError('파일은 2MB까지 올릴 수 있습니다.');
      text = await uploadedTableText(file);
    }
    const { source, errors } = await readPastedHoldings(user.id, s(f, 'label'), text);
    return { source, errors, at: Date.now() };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message, at: Date.now() };
    console.error('[action] paste', e);
    return { error: '붙여넣은 잔고를 읽지 못했습니다.', at: Date.now() };
  }
}

export async function syncExchangeAction(_: ActionState, f: FormData) {
  const user = await requireUser();
  return run(async () => {
    const sinceText = s(f, 'since');
    const since = sinceText ? parseKstLocal(sinceText) : undefined;
    const r = await syncExchangeHistory(user.id, s(f, 'id'), { portfolioId: s(f, 'portfolioId') || undefined, since });
    const parts = [`체결 ${r.trades}건`, `입출금 ${r.transfers}건`];
    if (r.openings) parts.push(`시작 잔고 ${r.openings}건`);
    if (r.skipped) parts.push(`이미 있던 ${r.skipped}건 건너뜀`);
    return `${kstDate(new Date(r.since))}부터 동기화했습니다: ${parts.join(', ')}.`;
  }, ['/import', '/dashboard', '/portfolios', '/market']);
}

// ── Market board watchlist ──────────────────────────

export async function addWatchAction(_: ActionState, f: FormData) {
  const user = await requireUser();
  return run(async () => {
    const w = await addWatch(user.id, s(f, 'symbol'));
    return `${w.name}을(를) 관심종목에 담았습니다.`;
  }, ['/market']);
}

export async function removeWatchAction(_: ActionState, f: FormData) {
  const user = await requireUser();
  return run(async () => {
    await removeWatch(user.id, s(f, 'symbol'));
    return '관심종목에서 뺐습니다.';
  }, ['/market']);
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
