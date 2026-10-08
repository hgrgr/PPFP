/**
 * Writes to the ledger. Every change runs in one DB transaction:
 * the transaction row, its lot effects, cash balance and an audit entry.
 */
import type { AssetType, LotMethod, Prisma, TxnType } from '@prisma/client';
import { Dec } from '@/domain/decimal';
import { applySplit, lotUnitCost, planSale, QTY_DP, realize, type Lot } from '@/domain/lots';
import { dec, kstIso, out, prisma } from '../db';
import { audit, ownedPortfolio, UserError } from './portfolios';

type Tx = Prisma.TransactionClient;

const signOf = (type: AssetType) => (type === 'LIABILITY' ? -1 : 1);

function positive(v: string | undefined, label: string, allowZero = false): Dec {
  let d: Dec;
  try {
    d = Dec.of(v ?? '');
  } catch {
    throw new UserError(`${label}을(를) 숫자로 입력하세요.`);
  }
  if (allowZero ? d.isNeg() : !d.isPos()) throw new UserError(`${label}은(는) ${allowZero ? '0 이상' : '0보다 커야'} 합니다.`);
  return d;
}

async function addCash(tx: Tx, portfolioId: string, currency: string, delta: Dec) {
  if (delta.isZero()) return;
  await tx.cashBalance.upsert({
    where: { portfolioId_currency: { portfolioId, currency } },
    create: { portfolioId, currency, amount: out(delta) },
    update: { amount: { increment: out(delta) } },
  });
}

async function lockHolding(tx: Tx, holdingId: string) {
  await tx.$queryRaw`SELECT id FROM "Holding" WHERE id = ${holdingId} FOR UPDATE`;
}

export interface BuyInput {
  portfolioId: string;
  assetId: string;
  tradeAt: Date;
  qty: string;
  price: string;
  fee?: string;
  tax?: string;
  fxRate?: string;
  /** true: paid from the portfolio's cash. false: funded from outside (counts as a contribution). */
  fromCash: boolean;
  memo?: string;
  externalRef?: string;
  /** Account or pasted table an opening lot was imported from (see services/imports). */
  importSource?: string;
}

export async function recordBuy(userId: string, input: BuyInput) {
  await ownedPortfolio(userId, input.portfolioId);
  const asset = await prisma.asset.findFirst({ where: { id: input.assetId, userId } });
  if (!asset) throw new UserError('자산을 찾을 수 없습니다.');
  const qty = positive(input.qty, '수량').round(QTY_DP);
  const price = positive(input.price, '단가', true);
  const fee = positive(input.fee || '0', '수수료', true);
  const tax = positive(input.tax || '0', '세금', true);
  const fx = asset.currency === 'KRW' ? Dec.ONE : positive(input.fxRate, '환율');
  const gross = price.mul(qty).add(fee).add(tax);
  const sign = signOf(asset.type);
  const cashDelta = input.fromCash ? gross.mul(-sign) : Dec.ZERO;
  const flow = input.fromCash ? Dec.ZERO : gross.mul(sign);

  return prisma.$transaction(async (tx) => {
    const holding = await tx.holding.upsert({
      where: { portfolioId_assetId: { portfolioId: input.portfolioId, assetId: asset.id } },
      create: { portfolioId: input.portfolioId, assetId: asset.id },
      update: {},
    });
    const txn = await tx.transaction.create({
      data: {
        portfolioId: input.portfolioId,
        holdingId: holding.id,
        type: 'BUY',
        tradeAt: input.tradeAt,
        qty: out(qty),
        price: out(price),
        fee: out(fee),
        tax: out(tax),
        fxRate: out(fx),
        currency: asset.currency,
        cashDelta: out(cashDelta),
        flow: out(flow),
        memo: input.memo?.trim() || null,
        externalRef: input.externalRef || null,
        importSource: input.importSource || null,
      },
    });
    await tx.lot.create({
      data: {
        holdingId: holding.id,
        acquiredAt: input.tradeAt,
        qtyOriginal: out(qty),
        qtyRemaining: out(qty),
        unitCost: out(lotUnitCost(price, qty, fee, tax).round(6)),
        fxRate: out(fx),
        sourceTxnId: txn.id,
      },
    });
    await addCash(tx, input.portfolioId, asset.currency, cashDelta);
    if (asset.priceSource === 'MANUAL') {
      await tx.asset.update({ where: { id: asset.id }, data: { manualPrice: out(price), manualPriceAt: input.tradeAt } });
    }
    await audit(tx, userId, 'transaction', txn.id, 'create', undefined, txn);
    return txn;
  });
}

function toLot(l: { id: string; acquiredAt: Date; qtyRemaining: unknown; unitCost: unknown; fxRate: unknown }): Lot {
  return {
    id: l.id,
    acquiredAt: l.acquiredAt.toISOString(),
    qtyRemaining: dec(l.qtyRemaining as string),
    unitCost: dec(l.unitCost as string),
    fxRate: dec(l.fxRate as string),
  };
}

export async function openLots(userId: string, holdingId: string) {
  const holding = await prisma.holding.findFirst({
    where: { id: holdingId, portfolio: { userId } },
    include: { asset: true, portfolio: true, lots: { where: { qtyRemaining: { gt: 0 } }, orderBy: { acquiredAt: 'asc' } } },
  });
  if (!holding) throw new UserError('보유 종목을 찾을 수 없습니다.');
  return holding;
}

export interface SellInput {
  holdingId: string;
  tradeAt: Date;
  qty: string;
  price: string;
  fee?: string;
  tax?: string;
  fxRate?: string;
  method: LotMethod;
  picks?: { lotId: string; qty: string }[];
  /** true: proceeds go to the portfolio's cash. false: leave the portfolio (counts as a withdrawal). */
  toCash: boolean;
  memo?: string;
  externalRef?: string;
}

/** Same calculation the sell form previews, without writing anything. */
export async function previewSell(userId: string, input: SellInput) {
  const holding = await openLots(userId, input.holdingId);
  const lots = holding.lots.map(toLot);
  const qty = positive(input.qty, '수량').round(QTY_DP);
  const plan = planSale(lots, qty, input.method, input.picks ?? []);
  if (!plan.ok) throw new UserError(plan.message);
  const price = positive(input.price, '단가', true);
  const fees = positive(input.fee || '0', '수수료', true).add(positive(input.tax || '0', '세금', true));
  const fx = holding.asset.currency === 'KRW' ? Dec.ONE : positive(input.fxRate, '환율');
  return { holding, lots, plan, result: realize(lots, plan.picks, { price, fees, fxRate: fx, at: input.tradeAt.toISOString() }), price, fx, qty };
}

export async function recordSell(userId: string, input: SellInput) {
  const first = await openLots(userId, input.holdingId);
  if (first.asset.type === 'LIABILITY') throw new UserError('부채는 매도 대신 평가 갱신으로 잔액을 조정하세요.');

  return prisma.$transaction(async (tx) => {
    await lockHolding(tx, input.holdingId);
    // Re-read lots inside the lock so two concurrent sells can't consume the same quantity.
    const lotsRows = await tx.lot.findMany({ where: { holdingId: input.holdingId, qtyRemaining: { gt: 0 } }, orderBy: { acquiredAt: 'asc' } });
    const lots = lotsRows.map(toLot);
    const qty = positive(input.qty, '수량').round(QTY_DP);
    const plan = planSale(lots, qty, input.method, input.picks ?? []);
    if (!plan.ok) throw new UserError(plan.message);
    const price = positive(input.price, '단가', true);
    const fee = positive(input.fee || '0', '수수료', true);
    const tax = positive(input.tax || '0', '세금', true);
    const fx = first.asset.currency === 'KRW' ? Dec.ONE : positive(input.fxRate, '환율');
    const res = realize(lots, plan.picks, { price, fees: fee.add(tax), fxRate: fx, at: input.tradeAt.toISOString() });
    const cashDelta = input.toCash ? res.proceeds : Dec.ZERO;
    const flow = input.toCash ? Dec.ZERO : res.proceeds.neg();

    const txn = await tx.transaction.create({
      data: {
        portfolioId: first.portfolioId,
        holdingId: input.holdingId,
        type: 'SELL',
        tradeAt: input.tradeAt,
        qty: out(qty),
        price: out(price),
        fee: out(fee),
        tax: out(tax),
        fxRate: out(fx),
        currency: first.asset.currency,
        cashDelta: out(cashDelta),
        flow: out(flow),
        lotMethod: input.method,
        memo: input.memo?.trim() || null,
        externalRef: input.externalRef || null,
      },
    });
    for (const piece of res.pieces) {
      const lot = lotsRows.find((l) => l.id === piece.lotId)!;
      const remaining = dec(lot.qtyRemaining).sub(piece.qty);
      if (remaining.isNeg()) throw new UserError('Lot 수량이 부족합니다. 다시 시도하세요.');
      await tx.lot.update({ where: { id: lot.id }, data: { qtyRemaining: out(remaining) } });
      await tx.lotConsumption.create({
        data: {
          txnId: txn.id,
          lotId: lot.id,
          qty: out(piece.qty),
          cost: out(piece.cost.round(6)),
          proceeds: out(piece.proceeds.round(6)),
          pnl: out(piece.pnl.round(6)),
          pnlBase: out(piece.pnlBase.round(6)),
          holdingDays: piece.holdingDays,
        },
      });
    }
    await addCash(tx, first.portfolioId, first.asset.currency, cashDelta);
    if (first.asset.priceSource === 'MANUAL') {
      await tx.asset.update({ where: { id: first.assetId }, data: { manualPrice: out(price), manualPriceAt: input.tradeAt } });
    }
    await audit(tx, userId, 'transaction', txn.id, 'create', undefined, { ...txn, pieces: res.pieces });
    return { txn, result: res };
  });
}

const CASH_SIGN: Partial<Record<TxnType, 1 | -1>> = { DEPOSIT: 1, WITHDRAW: -1, DIVIDEND: 1, INTEREST: 1, FEE: -1, TAX: -1 };

export async function recordCash(
  userId: string,
  input: {
    portfolioId: string;
    type: TxnType;
    amount: string;
    currency: string;
    tradeAt: Date;
    holdingId?: string;
    fxRate?: string;
    memo?: string;
    externalRef?: string;
    importSource?: string;
  },
) {
  await ownedPortfolio(userId, input.portfolioId);
  const sign = CASH_SIGN[input.type];
  if (!sign) throw new UserError('지원하지 않는 거래 유형입니다.');
  if (!['KRW', 'USD'].includes(input.currency)) throw new UserError('통화는 KRW 또는 USD만 지원합니다.');
  if (input.holdingId) {
    const h = await prisma.holding.findFirst({ where: { id: input.holdingId, portfolioId: input.portfolioId } });
    if (!h) throw new UserError('보유 종목을 찾을 수 없습니다.');
  }
  const amount = positive(input.amount, '금액');
  const delta = amount.mul(sign);
  const flow = input.type === 'DEPOSIT' || input.type === 'WITHDRAW' ? delta : Dec.ZERO;
  const fx = input.currency === 'KRW' ? Dec.ONE : positive(input.fxRate, '환율');
  return prisma.$transaction(async (tx) => {
    const txn = await tx.transaction.create({
      data: {
        portfolioId: input.portfolioId,
        holdingId: input.holdingId || null,
        type: input.type,
        tradeAt: input.tradeAt,
        fxRate: out(fx),
        currency: input.currency,
        cashDelta: out(delta),
        flow: out(flow),
        memo: input.memo?.trim() || null,
        externalRef: input.externalRef || null,
        importSource: input.importSource || null,
      },
    });
    await addCash(tx, input.portfolioId, input.currency, delta);
    await audit(tx, userId, 'transaction', txn.id, 'create', undefined, txn);
    return txn;
  });
}

/** Update the value of a manually priced asset (apartment, bond, loan balance...). */
export async function recordValuation(userId: string, input: { holdingId: string; price: string; tradeAt: Date; memo?: string }) {
  const holding = await openLots(userId, input.holdingId);
  if (holding.asset.priceSource !== 'MANUAL') throw new UserError('시세가 자동으로 들어오는 자산은 평가 갱신이 필요 없습니다.');
  const price = positive(input.price, '평가 단가', true);
  return prisma.$transaction(async (tx) => {
    const txn = await tx.transaction.create({
      data: {
        portfolioId: holding.portfolioId,
        holdingId: holding.id,
        type: 'VALUATION',
        tradeAt: input.tradeAt,
        price: out(price),
        currency: holding.asset.currency,
        memo: input.memo?.trim() || null,
      },
    });
    const latest = await tx.transaction.findFirst({
      where: { holding: { assetId: holding.assetId }, price: { not: null } },
      orderBy: { tradeAt: 'desc' },
    });
    if (latest?.id === txn.id) {
      await tx.asset.update({ where: { id: holding.assetId }, data: { manualPrice: out(price), manualPriceAt: input.tradeAt } });
    }
    await audit(tx, userId, 'transaction', txn.id, 'create', undefined, txn);
    return txn;
  });
}

/** Stock split / reverse split / bonus issue: every open lot's quantity × ratio, unit cost ÷ ratio. */
export async function recordSplit(userId: string, input: { holdingId: string; ratio: string; tradeAt: Date; memo?: string }) {
  const holding = await openLots(userId, input.holdingId);
  const ratio = positive(input.ratio, '분할 비율');
  return prisma.$transaction(async (tx) => {
    await lockHolding(tx, holding.id);
    const rows = await tx.lot.findMany({ where: { holdingId: holding.id, qtyRemaining: { gt: 0 } } });
    const adjusted = applySplit(rows.map(toLot), ratio);
    for (const l of adjusted) {
      const row = rows.find((r) => r.id === l.id)!;
      await tx.lot.update({
        where: { id: l.id },
        data: {
          qtyRemaining: out(l.qtyRemaining),
          qtyOriginal: out(dec(row.qtyOriginal).mul(ratio).round(QTY_DP)),
          unitCost: out(l.unitCost.round(6)),
        },
      });
    }
    const txn = await tx.transaction.create({
      data: {
        portfolioId: holding.portfolioId,
        holdingId: holding.id,
        type: 'SPLIT',
        tradeAt: input.tradeAt,
        splitRatio: out(ratio),
        currency: holding.asset.currency,
        memo: input.memo?.trim() || null,
      },
    });
    await audit(tx, userId, 'transaction', txn.id, 'create', undefined, txn);
    return txn;
  });
}

/**
 * Delete a transaction and undo its effects. The audit log keeps the full row.
 * A buy whose lot has already been (partly) sold can't be deleted: delete the sells first.
 */
export async function deleteTransaction(userId: string, txnId: string) {
  return prisma.$transaction(async (tx) => {
    const txn = await tx.transaction.findFirst({
      where: { id: txnId, portfolio: { userId } },
      include: { createdLot: true, consumptions: true },
    });
    if (!txn) throw new UserError('거래를 찾을 수 없습니다.');
    if (txn.holdingId) await lockHolding(tx, txn.holdingId);

    if (txn.type === 'BUY' && txn.createdLot) {
      if (!dec(txn.createdLot.qtyRemaining).eq(dec(txn.createdLot.qtyOriginal))) {
        throw new UserError('이 매수 Lot에서 이미 매도한 수량이 있습니다. 해당 매도 거래를 먼저 삭제하세요.');
      }
      const laterSplit = await tx.transaction.count({ where: { holdingId: txn.holdingId, type: 'SPLIT', tradeAt: { gt: txn.tradeAt } } });
      if (laterSplit) throw new UserError('이후에 분할·병합이 있어 삭제할 수 없습니다. 분할 거래를 먼저 삭제하세요.');
    }
    if (txn.type === 'SELL') {
      for (const c of txn.consumptions) {
        await tx.lot.update({ where: { id: c.lotId }, data: { qtyRemaining: { increment: dec(c.qty).toString() } } });
      }
    }
    if (txn.type === 'SPLIT' && txn.splitRatio && txn.holdingId) {
      const later = await tx.transaction.count({ where: { holdingId: txn.holdingId, tradeAt: { gt: txn.tradeAt }, type: { in: ['BUY', 'SELL', 'SPLIT'] } } });
      if (later) throw new UserError('분할 이후의 매수·매도가 있어 삭제할 수 없습니다.');
      const inverse = Dec.ONE.div(dec(txn.splitRatio));
      const rows = await tx.lot.findMany({ where: { holdingId: txn.holdingId } });
      for (const r of rows) {
        await tx.lot.update({
          where: { id: r.id },
          data: {
            qtyRemaining: out(dec(r.qtyRemaining).mul(inverse).round(QTY_DP)),
            qtyOriginal: out(dec(r.qtyOriginal).mul(inverse).round(QTY_DP)),
            unitCost: out(dec(r.unitCost).div(inverse).round(6)),
          },
        });
      }
    }
    await addCash(tx, txn.portfolioId, txn.currency, dec(txn.cashDelta).neg());
    await tx.transaction.delete({ where: { id: txn.id } }); // cascades lot + consumptions
    await audit(tx, userId, 'transaction', txn.id, 'delete', txn);
    return { portfolioId: txn.portfolioId, tradeAt: kstIso(txn.tradeAt).slice(0, 10) };
  });
}
