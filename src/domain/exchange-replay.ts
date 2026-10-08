/**
 * Replaying a crypto exchange account into the ledger. The exchange history
 * only reaches back so far, so what the account held before the first event
 * is worked out backwards from today's balances.
 */
import { Dec } from './decimal';

export interface ExchangeEvent {
  /** Unique within the exchange and kind */
  id: string;
  kind: 'BUY' | 'SELL' | 'DEPOSIT' | 'WITHDRAW';
  /** ISO instant */
  at: string;
  /** "KRW" or a coin ("BTC") */
  currency: string;
  /** Coin quantity for trades and coin transfers; won amount for KRW transfers */
  qty: string;
  /** KRW per coin, trades only */
  price: string | null;
  /** In KRW for trades and KRW transfers; in the coin for coin transfers (or for trades when feeInCoin) */
  fee: string;
  /** The trade's fee was charged in the coin rather than in won */
  feeInCoin?: boolean;
}

export interface ExchangeBalance {
  currency: string;
  /** Total held, including amounts locked in orders or withdrawals */
  qty: string;
  /** Exchange-reported average purchase price in KRW, when known */
  avgPrice: string | null;
}

const ORDER: Record<ExchangeEvent['kind'], number> = { DEPOSIT: 0, BUY: 1, SELL: 2, WITHDRAW: 3 };

/** Oldest first; at the same instant money comes in before it is spent, and sells before withdrawals. */
export function sortEvents(events: ExchangeEvent[]): ExchangeEvent[] {
  return [...events].sort((a, b) => a.at.localeCompare(b.at) || ORDER[a.kind] - ORDER[b.kind] || a.id.localeCompare(b.id));
}

/** Coins actually added to (BUY) or removed from (SELL) the account by a trade. */
export function coinDelta(e: ExchangeEvent): Dec {
  const q = Dec.of(e.qty);
  const coinFee = e.feeInCoin ? Dec.of(e.fee) : Dec.ZERO;
  return e.kind === 'BUY' ? q.sub(coinFee) : q.add(coinFee).neg();
}

/** Won added to (SELL) or taken from (BUY) the account by a trade. */
export function krwDelta(e: ExchangeEvent): Dec {
  const gross = Dec.of(e.qty).mul(e.price ?? '0');
  const krwFee = e.feeInCoin ? Dec.ZERO : Dec.of(e.fee);
  return e.kind === 'BUY' ? gross.add(krwFee).neg() : gross.sub(krwFee);
}

/**
 * What each currency's balance was just before the first event:
 * today's balance with every event since undone.
 */
export function openingBalances(balances: ExchangeBalance[], events: ExchangeEvent[]): Map<string, Dec> {
  const bal = new Map<string, Dec>();
  for (const b of balances) bal.set(b.currency.toUpperCase(), Dec.of(b.qty));
  const add = (c: string, d: Dec) => bal.set(c, (bal.get(c) ?? Dec.ZERO).add(d));
  for (const e of events) {
    const c = e.currency.toUpperCase();
    if (e.kind === 'BUY' || e.kind === 'SELL') {
      add(c, coinDelta(e).neg());
      add('KRW', krwDelta(e).neg());
    } else if (e.kind === 'DEPOSIT') {
      add(c, Dec.of(e.qty).sub(e.fee).neg());
    } else {
      add(c, Dec.of(e.qty).add(e.fee));
    }
  }
  return bal;
}
