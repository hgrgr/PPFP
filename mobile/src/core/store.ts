/**
 * Changes to the phone's data, checked the way the server checks them. Screens call these;
 * reads go through the live queries in ui/hooks.ts.
 */
import { Dec } from '@/domain/decimal';
import type { LotMethod } from '@/domain/lots';
import type { TxnType } from '@/domain/ledger';
import { replayPortfolio } from './book';
import { db, newId, nowIso, type PpfpDb } from './db';
import type { Asset, AssetType, Goal, Journal, Loan, Note, Portfolio, PriceAlert, Txn } from './types';

export class InputError extends Error {}
const bad = (msg: string): never => {
  throw new InputError(msg);
};

/** "1,234.5" → "1234.5"; throws with the field's name */
export function numText(v: string | null | undefined, label: string, opts: { positive?: boolean; allowZero?: boolean; optional?: boolean } = {}): string | null {
  const t = (v ?? '').replace(/[,\s₩$원]/g, '');
  if (!t) return opts.optional ? null : bad(`${label}을(를) 넣으세요.`);
  if (!/^-?\d+(\.\d+)?$/.test(t)) bad(`${label}은(는) 숫자로 넣으세요.`);
  const d = Dec.of(t);
  if (opts.positive && (opts.allowZero ? d.isNeg() : !d.isPos())) bad(`${label}은(는) ${opts.allowZero ? '0 이상' : '0보다 커야'} 합니다.`);
  return d.toString();
}

// ── Portfolios ───────────────────────────────────────

export async function addPortfolio(name: string, lotMethod: LotMethod = 'FIFO', store: PpfpDb = db): Promise<Portfolio> {
  const n = name.trim().slice(0, 60);
  if (!n) bad('포트폴리오 이름을 넣으세요.');
  if (await store.portfolios.where('name').equals(n).count()) bad('같은 이름의 포트폴리오가 있습니다.');
  const p: Portfolio = { id: newId(), name: n, lotMethod, archived: false, createdAt: nowIso() };
  await store.portfolios.add(p);
  return p;
}

export async function updatePortfolio(id: string, patch: Partial<Pick<Portfolio, 'name' | 'lotMethod' | 'archived'>>, store: PpfpDb = db) {
  if (patch.name !== undefined) {
    patch.name = patch.name.trim().slice(0, 60);
    if (!patch.name) bad('포트폴리오 이름을 넣으세요.');
  }
  await store.portfolios.update(id, patch);
}

/** Removes a portfolio with every trade in it. */
export async function deletePortfolio(id: string, store: PpfpDb = db) {
  await store.transaction('rw', store.portfolios, store.txns, async () => {
    await store.txns.where('portfolioId').equals(id).delete();
    await store.portfolios.delete(id);
  });
}

// ── Assets ───────────────────────────────────────────

export interface AssetInput {
  type: AssetType;
  symbol?: string | null;
  name: string;
  currency: 'KRW' | 'USD';
  kind?: string | null;
}

export function normalizeSymbol(type: AssetType, raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim().toUpperCase();
  if (!s) return null;
  if (type === 'KR_STOCK') return /^\d{1,6}$/.test(s) ? s.padStart(6, '0') : /^[0-9][0-9A-Z]{5}$/.test(s) ? s : bad('국내 종목코드는 005930처럼 6자리로 넣으세요.');
  if (type === 'CRYPTO') return s.startsWith('KRW-') ? s : `KRW-${s}`;
  if (type === 'US_STOCK') return /^[A-Z][A-Z0-9.\-]{0,9}$/.test(s) ? s : bad('미국 종목은 AAPL처럼 티커로 넣으세요.');
  return s;
}

/** The asset with this symbol (or, for one valued by hand, this name), made if new. */
export async function ensureAsset(input: AssetInput, store: PpfpDb = db): Promise<Asset> {
  const symbol = normalizeSymbol(input.type, input.symbol);
  const name = input.name.trim().slice(0, 80) || symbol || '';
  if (!name) bad('자산 이름을 넣으세요.');
  const existing = symbol ? await store.assets.where('symbol').equals(symbol).first() : (await store.assets.toArray()).find((a) => !a.symbol && a.name === name && a.type === input.type);
  if (existing) return existing;
  const currency = input.type === 'US_STOCK' ? 'USD' : input.type === 'KR_STOCK' || input.type === 'CRYPTO' ? 'KRW' : input.currency;
  const a: Asset = { id: newId(), type: input.type, symbol, name, currency, price: null, priceAt: null, priceSource: null, kind: input.kind ?? null, createdAt: nowIso() };
  await store.assets.add(a);
  return a;
}

export async function updateAsset(id: string, patch: Partial<Pick<Asset, 'name' | 'kind' | 'price' | 'priceAt' | 'priceSource'>>, store: PpfpDb = db) {
  await store.assets.update(id, patch);
}

/** Removes an asset nothing refers to any more. */
export async function deleteAssetIfUnused(id: string, store: PpfpDb = db) {
  if (await store.txns.where('assetId').equals(id).count()) bad('이 자산의 거래가 남아 있습니다. 거래를 먼저 지우세요.');
  await store.transaction('rw', [store.assets, store.alerts, store.loans, store.journals], async () => {
    await store.alerts.where('assetId').equals(id).delete();
    await store.loans.where('assetId').equals(id).delete();
    await store.journals.where('assetId').equals(id).modify({ assetId: null });
    await store.assets.delete(id);
  });
}

// ── Trades ───────────────────────────────────────────

export interface TxnInput {
  portfolioId: string;
  type: TxnType;
  assetId?: string | null;
  /** KST "2026-03-02T10:30" from the date-time field */
  localAt: string;
  qty?: string;
  price?: string;
  amount?: string;
  fee?: string;
  tax?: string;
  fxRate?: string;
  currency?: 'KRW' | 'USD';
  useCash?: boolean;
  ratio?: string;
  lotMethod?: LotMethod | null;
  memo?: string;
}

const ASSET_TYPES_NEEDED: TxnType[] = ['BUY', 'SELL', 'SPLIT', 'VALUATION'];

export async function recordTxn(input: TxnInput, store: PpfpDb = db): Promise<Txn> {
  const portfolio = await store.portfolios.get(input.portfolioId);
  if (!portfolio) bad('포트폴리오를 고르세요.');
  const asset = input.assetId ? await store.assets.get(input.assetId) : undefined;
  if (ASSET_TYPES_NEEDED.includes(input.type) && !asset) bad('자산을 고르세요.');
  const m = input.localAt.match(/^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?/);
  if (!m) bad('날짜를 넣으세요.');
  const at = new Date(`${m![1]}T${m![2] ?? '00:00'}:00+09:00`);
  if (Number.isNaN(at.getTime())) bad('날짜를 확인하세요.');
  if (at.getTime() > Date.now() + 86_400_000) bad('미래 날짜의 거래는 넣을 수 없습니다.');
  const currency = asset?.currency ?? input.currency ?? 'KRW';
  const trade = input.type === 'BUY' || input.type === 'SELL';
  const t: Txn = {
    id: newId(),
    portfolioId: input.portfolioId,
    assetId: asset?.id ?? null,
    type: input.type,
    tradeAt: at.toISOString(),
    qty: trade ? numText(input.qty, '수량', { positive: true }) : null,
    price: trade || input.type === 'VALUATION' ? numText(input.price, input.type === 'VALUATION' ? '평가 단가' : '단가', { positive: true, allowZero: true }) : null,
    amount: !trade && input.type !== 'SPLIT' && input.type !== 'VALUATION' ? numText(input.amount, '금액', { positive: true }) : null,
    fee: (trade && numText(input.fee, '수수료', { positive: true, allowZero: true, optional: true })) || '0',
    tax: (trade && numText(input.tax, '세금', { positive: true, allowZero: true, optional: true })) || '0',
    currency,
    fxRate: currency === 'USD' && input.type !== 'SPLIT' ? numText(input.fxRate, '환율', { positive: true }) : null,
    useCash: trade ? input.useCash !== false : true,
    ratio: input.type === 'SPLIT' ? numText(input.ratio, '분할 비율', { positive: true }) : null,
    lotMethod: input.type === 'SELL' ? (input.lotMethod ?? null) : null,
    memo: (input.memo ?? '').trim().slice(0, 500),
    createdAt: nowIso(),
    serverId: null,
  };
  // A sale must fit what is held at that time: replay with it, as the server does
  if (t.type === 'SELL') {
    const all = await store.txns.where('portfolioId').equals(portfolio!.id).toArray();
    const assets = new Map((await store.assets.toArray()).map((a) => [a.id, a]));
    const view = replayPortfolio(portfolio!, [...all, t], assets, Dec.ONE);
    const p = view.problems.find((x) => x.txnId === t.id);
    if (p) bad(p.message);
  }
  await store.txns.add(t);
  return t;
}

/** Removes a trade unless a later sale needs its shares. */
export async function deleteTxn(id: string, store: PpfpDb = db) {
  const t = await store.txns.get(id);
  if (!t) return;
  const portfolio = await store.portfolios.get(t.portfolioId);
  if (portfolio && t.type === 'BUY') {
    const all = (await store.txns.where('portfolioId').equals(t.portfolioId).toArray()).filter((x) => x.id !== id);
    const assets = new Map((await store.assets.toArray()).map((a) => [a.id, a]));
    const view = replayPortfolio(portfolio, all, assets, Dec.ONE);
    if (view.problems.length) bad(`이 매수를 지우면 뒤의 매도가 맞지 않습니다: ${view.problems[0].message}`);
  }
  await store.txns.delete(id);
}

// ── Notes, journals, goals, loans, alerts ────────────

export async function saveNote(input: { id?: string; body: string; pinned?: boolean }, store: PpfpDb = db) {
  const body = input.body.trim().slice(0, 10_000);
  if (!body) bad('메모를 쓰세요.');
  const prev = input.id ? await store.notes.get(input.id) : undefined;
  const n: Note = { id: prev?.id ?? newId(), body, pinned: input.pinned ?? prev?.pinned ?? false, createdAt: prev?.createdAt ?? nowIso() };
  await store.notes.put(n);
  return n;
}

export async function saveJournal(input: Omit<Journal, 'id' | 'createdAt'> & { id?: string }, store: PpfpDb = db) {
  if (!input.title.trim()) bad('제목을 넣으세요.');
  const target = numText(input.targetPrice, '목표 예상 가격', { positive: true })!;
  const prev = input.id ? await store.journals.get(input.id) : undefined;
  const j: Journal = {
    ...input,
    id: prev?.id ?? newId(),
    title: input.title.trim().slice(0, 120),
    targetPrice: target,
    basePrice: numText(input.basePrice, '기준 가격', { positive: true, optional: true }),
    stopPrice: numText(input.stopPrice, '손절가', { positive: true, optional: true }),
    createdAt: prev?.createdAt ?? nowIso(),
  };
  await store.journals.put(j);
  return j;
}

export async function saveGoal(input: { id?: string; name: string; target: string; targetDate: string; monthly: string }, store: PpfpDb = db) {
  if (!input.name.trim()) bad('목표 이름을 넣으세요.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.targetDate)) bad('목표 날짜를 넣으세요.');
  const g: Goal = {
    id: input.id ?? newId(),
    name: input.name.trim().slice(0, 60),
    target: Number(numText(input.target, '목표 금액', { positive: true })),
    targetDate: input.targetDate,
    monthly: Number(numText(input.monthly || '0', '매달 넣을 돈', { positive: true, allowZero: true })),
  };
  await store.goals.put(g);
  return g;
}

export async function saveLoan(input: Omit<Loan, 'id'> & { id?: string }, store: PpfpDb = db) {
  if (!(input.principal > 0)) bad('대출 원금을 넣으세요.');
  if (!(input.annualRate >= 0 && input.annualRate < 1)) bad('금리는 연 0~100% 사이로 넣으세요.');
  if (!(input.months >= 1 && input.months <= 600)) bad('기간은 1~600개월로 넣으세요.');
  if (input.graceMonths < 0 || input.graceMonths >= input.months) bad('거치 기간은 대출 기간보다 짧아야 합니다.');
  const existing = await store.loans.where('assetId').equals(input.assetId).first();
  const l: Loan = { ...input, id: input.id ?? existing?.id ?? newId() };
  await store.loans.put(l);
  return l;
}

export async function addAlert(input: { assetId: string; direction: 'ABOVE' | 'BELOW'; price: string }, store: PpfpDb = db) {
  const a: PriceAlert = { id: newId(), assetId: input.assetId, direction: input.direction, price: numText(input.price, '알림 가격', { positive: true })!, active: true, firedAt: null, createdAt: nowIso() };
  await store.alerts.add(a);
  return a;
}
