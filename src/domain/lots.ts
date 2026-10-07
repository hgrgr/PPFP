/**
 * Tax-lot engine.
 *
 * Every buy creates a lot. A sell consumes quantity from one or more lots,
 * chosen either explicitly (SPECIFIC) or by a rule. The result says exactly
 * how much came out of which lot and the realized profit of each piece.
 */
import { Dec, type DecInput } from './decimal';

export const LOT_METHODS = ['SPECIFIC', 'FIFO', 'LIFO', 'HIFO', 'LOFO', 'AVERAGE'] as const;
export type LotMethod = (typeof LOT_METHODS)[number];

export const LOT_METHOD_LABEL: Record<LotMethod, string> = {
  SPECIFIC: '직접 선택',
  FIFO: '선입선출 (FIFO)',
  LIFO: '후입선출 (LIFO)',
  HIFO: '고가 우선 (HIFO)',
  LOFO: '저가 우선 (LOFO)',
  AVERAGE: '이동평균',
};

/** Quantity precision: 8 decimal places (fractional shares, crypto). */
export const QTY_DP = 8;

export interface Lot {
  id: string;
  acquiredAt: string; // ISO date-time
  qtyRemaining: Dec;
  /** Cost per unit in the trade currency, buy fees and taxes included. */
  unitCost: Dec;
  /** Base-currency units per 1 trade-currency unit at acquisition. 1 for base-currency assets. */
  fxRate: Dec;
}

export interface LotPick {
  lotId: string;
  qty: Dec;
}

export type SalePlan =
  | { ok: true; picks: LotPick[] }
  | { ok: false; reason: 'INVALID_QTY' | 'INSUFFICIENT' | 'UNKNOWN_LOT' | 'OVER_LOT' | 'SPECIFIC_MISMATCH'; message: string };

export function totalQty(lots: Lot[]): Dec {
  return Dec.sum(lots.map((l) => l.qtyRemaining));
}

export function averageCost(lots: Lot[]): Dec {
  const q = totalQty(lots);
  if (q.isZero()) return Dec.ZERO;
  return Dec.sum(lots.map((l) => l.qtyRemaining.mul(l.unitCost))).div(q);
}

function byTimeAsc(a: Lot, b: Lot): number {
  return a.acquiredAt < b.acquiredAt ? -1 : a.acquiredAt > b.acquiredAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Lots in the order a rule-based method consumes them. */
export function orderLots(lots: Lot[], method: Exclude<LotMethod, 'SPECIFIC' | 'AVERAGE'>): Lot[] {
  const open = lots.filter((l) => l.qtyRemaining.isPos());
  switch (method) {
    case 'FIFO':
      return open.sort(byTimeAsc);
    case 'LIFO':
      return open.sort((a, b) => -byTimeAsc(a, b));
    case 'HIFO':
      return open.sort((a, b) => b.unitCost.cmp(a.unitCost) || byTimeAsc(a, b));
    case 'LOFO':
      return open.sort((a, b) => a.unitCost.cmp(b.unitCost) || byTimeAsc(a, b));
  }
}

/**
 * Decide which lots a sale of `qty` consumes.
 * For SPECIFIC, `specific` must list the picks and add up to `qty` exactly.
 */
export function planSale(
  lots: Lot[],
  qtyInput: DecInput,
  method: LotMethod,
  specific: { lotId: string; qty: DecInput }[] = [],
): SalePlan {
  const qty = Dec.of(qtyInput);
  if (!qty.isPos()) return { ok: false, reason: 'INVALID_QTY', message: '매도 수량은 0보다 커야 합니다.' };
  const available = totalQty(lots);
  if (qty.gt(available)) {
    return {
      ok: false,
      reason: 'INSUFFICIENT',
      message: `보유 수량(${available.toString()})보다 많이 매도할 수 없습니다.`,
    };
  }

  if (method === 'SPECIFIC') {
    const byId = new Map(lots.map((l) => [l.id, l]));
    const merged = new Map<string, Dec>();
    for (const s of specific) {
      const q = Dec.of(s.qty);
      if (q.isZero()) continue;
      if (q.isNeg()) return { ok: false, reason: 'INVALID_QTY', message: 'Lot별 매도 수량은 음수일 수 없습니다.' };
      if (!byId.has(s.lotId)) return { ok: false, reason: 'UNKNOWN_LOT', message: `알 수 없는 Lot: ${s.lotId}` };
      merged.set(s.lotId, (merged.get(s.lotId) ?? Dec.ZERO).add(q));
    }
    for (const [id, q] of merged) {
      if (q.gt(byId.get(id)!.qtyRemaining)) {
        return { ok: false, reason: 'OVER_LOT', message: 'Lot의 잔여 수량보다 많이 선택했습니다.' };
      }
    }
    const picked = Dec.sum(merged.values());
    if (!picked.eq(qty)) {
      return {
        ok: false,
        reason: 'SPECIFIC_MISMATCH',
        message: `선택한 Lot 수량 합계(${picked.toString()})가 매도 수량(${qty.toString()})과 다릅니다.`,
      };
    }
    const order = lots.filter((l) => merged.has(l.id)).sort(byTimeAsc);
    return { ok: true, picks: order.map((l) => ({ lotId: l.id, qty: merged.get(l.id)! })) };
  }

  if (method === 'AVERAGE') {
    // Pro-rata across open lots; rounding remainder goes to the last lot.
    const open = lots.filter((l) => l.qtyRemaining.isPos()).sort(byTimeAsc);
    const picks: LotPick[] = [];
    let left = qty;
    open.forEach((l, i) => {
      let q =
        i === open.length - 1 ? left : qty.mul(l.qtyRemaining).div(available).truncate(QTY_DP);
      q = Dec.min(q, l.qtyRemaining);
      left = left.sub(q);
      if (q.isPos()) picks.push({ lotId: l.id, qty: q });
    });
    // Any rounding leftover (only when the last lot was capped) is taken in order.
    if (left.isPos()) {
      for (const l of open) {
        const p = picks.find((x) => x.lotId === l.id);
        const room = l.qtyRemaining.sub(p?.qty ?? Dec.ZERO);
        const take = Dec.min(room, left);
        if (!take.isPos()) continue;
        if (p) p.qty = p.qty.add(take);
        else picks.push({ lotId: l.id, qty: take });
        left = left.sub(take);
        if (left.isZero()) break;
      }
    }
    return { ok: true, picks };
  }

  const picks: LotPick[] = [];
  let left = qty;
  for (const l of orderLots(lots, method)) {
    if (left.isZero()) break;
    const take = Dec.min(left, l.qtyRemaining);
    picks.push({ lotId: l.id, qty: take });
    left = left.sub(take);
  }
  return { ok: true, picks };
}

export interface RealizedPiece {
  lotId: string;
  qty: Dec;
  /** Cost of the consumed quantity, trade currency. */
  cost: Dec;
  /** Net proceeds after this piece's share of sale fees and taxes, trade currency. */
  proceeds: Dec;
  /** proceeds - cost, trade currency. */
  pnl: Dec;
  /** Same in base currency, using each lot's fx at purchase and the sale fx. Includes FX effect. */
  pnlBase: Dec;
  holdingDays: number;
}

export interface SaleResult {
  pieces: RealizedPiece[];
  qty: Dec;
  proceeds: Dec;
  cost: Dec;
  pnl: Dec;
  pnlBase: Dec;
}

/**
 * Realized profit of a planned sale.
 * Sale fees/taxes are spread over the pieces in proportion to quantity.
 */
export function realize(
  lots: Lot[],
  picks: LotPick[],
  sale: { price: DecInput; fees?: DecInput; fxRate?: DecInput; at: string },
): SaleResult {
  const price = Dec.of(sale.price);
  const fees = Dec.maybe(sale.fees);
  const fx = Dec.maybe(sale.fxRate, Dec.ONE);
  const byId = new Map(lots.map((l) => [l.id, l]));
  const totalQ = Dec.sum(picks.map((p) => p.qty));
  const saleTime = Date.parse(sale.at);
  let feeLeft = fees;
  const pieces: RealizedPiece[] = picks.map((p, i) => {
    const lot = byId.get(p.lotId);
    if (!lot) throw new Error(`Unknown lot ${p.lotId}`);
    const fee = i === picks.length - 1 ? feeLeft : fees.mul(p.qty).div(totalQ).round(4);
    feeLeft = feeLeft.sub(fee);
    const cost = p.qty.mul(lot.unitCost);
    const proceeds = p.qty.mul(price).sub(fee);
    const pnl = proceeds.sub(cost);
    const pnlBase = proceeds.mul(fx).sub(cost.mul(lot.fxRate));
    const holdingDays = Math.max(0, Math.floor((saleTime - Date.parse(lot.acquiredAt)) / 86_400_000));
    return { lotId: p.lotId, qty: p.qty, cost, proceeds, pnl, pnlBase, holdingDays };
  });
  return {
    pieces,
    qty: totalQ,
    proceeds: Dec.sum(pieces.map((x) => x.proceeds)),
    cost: Dec.sum(pieces.map((x) => x.cost)),
    pnl: Dec.sum(pieces.map((x) => x.pnl)),
    pnlBase: Dec.sum(pieces.map((x) => x.pnlBase)),
  };
}

/** Apply picks to lots, returning new lot objects with reduced remaining quantity. */
export function applyPicks(lots: Lot[], picks: LotPick[]): Lot[] {
  const take = new Map<string, Dec>();
  for (const p of picks) take.set(p.lotId, (take.get(p.lotId) ?? Dec.ZERO).add(p.qty));
  return lots.map((l) => {
    const t = take.get(l.id);
    if (!t) return l;
    const rest = l.qtyRemaining.sub(t);
    if (rest.isNeg()) throw new Error(`Lot ${l.id} would go negative`);
    return { ...l, qtyRemaining: rest };
  });
}

/** Unit cost of a new lot: (price * qty + fees + taxes) / qty. */
export function lotUnitCost(price: DecInput, qty: DecInput, fees: DecInput = 0, taxes: DecInput = 0): Dec {
  const q = Dec.of(qty);
  if (!q.isPos()) throw new RangeError('Quantity must be positive');
  return Dec.of(price).mul(q).add(fees).add(taxes).div(q);
}

/** Adjust lots for a split / reverse split / bonus issue: qty × ratio, unit cost ÷ ratio. */
export function applySplit(lots: Lot[], ratioInput: DecInput): Lot[] {
  const ratio = Dec.of(ratioInput);
  if (!ratio.isPos()) throw new RangeError('Split ratio must be positive');
  return lots.map((l) => ({ ...l, qtyRemaining: l.qtyRemaining.mul(ratio).round(QTY_DP), unitCost: l.unitCost.div(ratio) }));
}
