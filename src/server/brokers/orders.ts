/**
 * Where approved orders go. Kept apart from the read-only BrokerAdapter on purpose: an order
 * call is sent at most once, never retried on timeouts, 5xx or 401, and a lost answer becomes
 * UNKNOWN instead of a second order.
 *
 * Only the paper router exists. Live routers (KIS order-cash first) are not implemented, and
 * routerFor refuses LIVE until they are, behind AUTOPILOT_LIVE, AUTOPILOT_LIVE_USERS and the
 * connection's tradeEnabled.
 */
import { simulatePaperFill, type OrderSide, type TradeMode } from '@/domain/autopilot';

export interface PlaceOrderRequest {
  /** Ours, unique and never reused; sent as the broker's identifier where supported */
  clientOrderId: string;
  symbol: string;
  assetType: string;
  side: OrderSide;
  qty: string;
  limitPrice: string;
  exchange: string;
}

export interface RoutedFill {
  qty: string;
  price: string;
  fee: string;
  tax: string;
  /** Fee and tax are our estimates, not the broker's figures */
  estimated: boolean;
  filledAt: Date;
}

export type PlaceOrderResult =
  /** Accepted; `fill` when it filled at once (paper) */
  | { status: 'ACCEPTED'; brokerOrderId: string; fill?: RoutedFill }
  /** Definitely not accepted (validation error, insufficient funds); safe to propose again */
  | { status: 'REJECTED'; reason: string }
  /** Sent but the answer was lost; resolve from the broker's order list, never resend */
  | { status: 'UNKNOWN'; reason: string };

export interface OrderStatusReport {
  brokerOrderId: string;
  status: 'OPEN' | 'PARTIAL' | 'FILLED' | 'CANCELLED' | 'REJECTED';
  /** Cumulative; the poller records the increase as one OrderFill */
  filledQty: string;
  avgPrice: string | null;
}

export interface OrderRouter {
  readonly mode: TradeMode;
  orderableCash(): Promise<string>;
  placeOrder(req: PlaceOrderRequest): Promise<PlaceOrderResult>;
  cancelOrder(brokerOrderId: string): Promise<{ ok: boolean; reason?: string }>;
  orderStatus(brokerOrderId: string): Promise<OrderStatusReport | null>;
}

export interface PaperQuote {
  price: string;
  asOf: Date | null;
}

/**
 * Simulated fills against the current quote. Stateless: paper cash and positions are replayed
 * from OrderFill rows by the service, which also re-tries resting orders on each poll.
 */
export class PaperRouter implements OrderRouter {
  readonly mode = 'PAPER' as const;

  constructor(
    private readonly opts: {
      cash: () => Promise<string>;
      quote: (symbol: string, assetType: string) => Promise<PaperQuote | null>;
      slippageBp: number;
      now?: () => Date;
    },
  ) {}

  orderableCash() {
    return this.opts.cash();
  }

  async placeOrder(req: PlaceOrderRequest): Promise<PlaceOrderResult> {
    const brokerOrderId = `paper:${req.clientOrderId}`;
    const fill = await this.tryFill(req);
    return fill ? { status: 'ACCEPTED', brokerOrderId, fill } : { status: 'ACCEPTED', brokerOrderId };
  }

  /** A fill when the quote now crosses the limit, else null (the order rests until it expires). */
  async tryFill(req: Pick<PlaceOrderRequest, 'symbol' | 'assetType' | 'side' | 'qty' | 'limitPrice'>): Promise<RoutedFill | null> {
    const q = await this.opts.quote(req.symbol, req.assetType);
    if (!q) return null;
    const at = this.opts.now?.() ?? new Date();
    const r = simulatePaperFill(req, q.price, { slippageBp: this.opts.slippageBp, at });
    if (!r.filled) return null;
    return { qty: r.qty.toString(), price: r.price.toString(), fee: r.fee.toString(), tax: r.tax.toString(), estimated: true, filledAt: at };
  }

  async cancelOrder() {
    return { ok: true };
  }

  /** Paper orders live only in TradeOrder; there is no broker to ask. */
  async orderStatus() {
    return null;
  }
}

export function routerFor(mode: TradeMode, paper: ConstructorParameters<typeof PaperRouter>[0]): OrderRouter {
  if (mode === 'PAPER') return new PaperRouter(paper);
  // TODO(AP-02): KIS domestic cash orders (order-cash / order-rvsecncl / inquire-daily-ccld) as a
  // single-shot POST with no retry, behind AUTOPILOT_LIVE, AUTOPILOT_LIVE_USERS and tradeEnabled.
  throw new Error('실전 주문 경로는 아직 없습니다.');
}
