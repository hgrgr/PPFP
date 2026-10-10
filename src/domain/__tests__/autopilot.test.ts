import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkOrder,
  effectiveLimits,
  krxTick,
  manwon,
  marketOpen,
  paperBook,
  paperValue,
  parsePolicy,
  policyChange,
  policyFromForm,
  policySummary,
  promotionCriteria,
  reviewPromotion,
  simulatePaperFill,
  usageToday,
  verdictOf,
  type CheckContext,
  type OrderIntent,
  type Policy,
} from '../autopilot';

// 2026-10-12 is a Monday; 10:00 KST = 01:00 UTC
const OPEN = new Date('2026-10-12T01:00:00Z');

const policy: Policy = {
  level: 'APPROVE',
  mode: 'PAPER',
  allowedTypes: ['KR_STOCK'],
  allowSymbols: ['005930', '000660'],
  denySymbols: ['123456'],
  maxOrder: 500_000,
  maxDaily: 2_000_000,
  maxDailyOrders: 5,
  dailyLossStop: '0.02',
  maxPriceGap: '0.03',
};

const order: OrderIntent = { symbol: '005930', assetType: 'KR_STOCK', side: 'BUY', qty: 5, limitPrice: 70_000 };

const ctx = (over: Partial<CheckContext> = {}): CheckContext => ({
  now: OPEN,
  quote: { price: 70_100, asOf: new Date(OPEN.getTime() - 10_000), avgTradedValue: 500_000_000_000 },
  usedToday: { amount: 0, orders: 0 },
  cash: 5_000_000,
  heldQty: 0,
  openOnSymbol: 0,
  dayStartValue: 10_000_000,
  currentValue: 9_950_000,
  ...over,
});

const rules = (r: ReturnType<typeof checkOrder>) => r.blocks.map((b) => b.rule).sort();

describe('policy validation', () => {
  it('reads a form with percents, commas and symbol lists', () => {
    const r = parsePolicy(policyFromForm({ name: ' 국내 대형주 ', maxOrder: '500,000', maxDaily: '2,000,000원', dailyLossStop: '2', maxPriceGap: '3', allowSymbols: '005930, 000660 005930', allowedTypes: 'KR_STOCK' }));
    assert.ok(r.ok);
    assert.equal(r.value.name, '국내 대형주');
    assert.equal(r.value.maxDaily, 2_000_000);
    assert.equal(r.value.dailyLossStop, 0.02);
    assert.deepEqual(r.value.allowSymbols, ['005930', '000660']);
    assert.equal(r.value.level, 'SUGGEST');
    assert.equal(r.value.mode, 'PAPER');
  });

  it('refuses inconsistent limits, overlapping lists and AUTO without an allow list', () => {
    const r = parsePolicy({ name: 'x', level: 'AUTO', maxOrder: 3_000_000, maxDaily: 2_000_000, allowSymbols: [], denySymbols: ['005930'] });
    assert.ok(!r.ok);
    assert.ok(r.errors.includes('1회 한도가 하루 한도보다 클 수 없습니다.'));
    assert.ok(r.errors.includes('자동 단계에는 허용 종목이 있어야 합니다.'));
    const both = parsePolicy({ name: 'x', maxOrder: 1, maxDaily: 2, allowSymbols: ['005930'], denySymbols: ['005930'] });
    assert.ok(!both.ok && both.errors[0].includes('005930'));
    assert.ok(!parsePolicy({ name: '', maxOrder: 1, maxDaily: 2 }).ok);
    assert.ok(!parsePolicy({ name: 'x', maxOrder: 1, maxDaily: 2, dailyLossStop: 0.5 }).ok);
  });

  it('asks for a fresh password when raising delegation, going live or loosening limits', () => {
    const base = parsePolicy({ name: 'x', maxOrder: 500_000, maxDaily: 2_000_000, allowSymbols: ['005930'] });
    assert.ok(base.ok);
    const b = base.value;
    assert.deepEqual(policyChange(b, { ...b, level: 'APPROVE' }), { stepUp: true, review: false, bump: true });
    assert.deepEqual(policyChange(b, { ...b, level: 'AUTO' }).review, true);
    assert.deepEqual(policyChange(b, { ...b, mode: 'LIVE' }), { stepUp: true, review: true, bump: true });
    assert.equal(policyChange(b, { ...b, maxOrder: 400_000 }).stepUp, false);
    assert.equal(policyChange(b, { ...b, maxOrder: 600_000 }).stepUp, true);
    assert.equal(policyChange(b, { ...b, allowSymbols: ['005930', '000660'] }).stepUp, true);
    assert.equal(policyChange(b, { ...b }).bump, false);
  });
});

describe('market calendar and tick size', () => {
  it('knows the regular session, weekends, holidays and fails closed on a missing year', () => {
    assert.equal(marketOpen('KRX', OPEN).open, true);
    assert.equal(marketOpen('KRX', new Date('2026-10-12T06:25:00Z')).open, false); // 15:25 KST, closing auction
    assert.equal(marketOpen('KRX', new Date('2026-10-11T01:00:00Z')).open, false); // Sunday
    assert.equal(marketOpen('KRX', new Date('2026-10-09T01:00:00Z')).open, false); // 한글날
    const next = marketOpen('KRX', new Date('2027-01-04T01:00:00Z'));
    assert.equal(next.open, false);
    assert.match(next.message, /2027년 휴장일 표/);
    assert.equal(marketOpen('CRYPTO', new Date('2026-10-11T15:00:00Z')).open, true);
    assert.equal(marketOpen(null, OPEN).open, false);
  });

  it('uses the 2023 KRX tick table', () => {
    assert.equal(krxTick(1_999), 1);
    assert.equal(krxTick(2_000), 5);
    assert.equal(krxTick(19_990), 10);
    assert.equal(krxTick(70_000), 100);
    assert.equal(krxTick(499_500), 500);
    assert.equal(krxTick(1_000_000), 1_000);
  });
});

describe('pre-trade check', () => {
  it('passes a plain order inside every limit, with one line per rule', () => {
    const r = checkOrder(order, policy, ctx());
    assert.equal(r.passed, true, JSON.stringify(r.blocks));
    assert.equal(r.notional.toString(), '350000');
    assert.equal(new Set(r.results.map((x) => x.rule)).size, r.results.length);
    assert.ok(r.results.some((x) => x.rule === 'session' && x.ok));
  });

  it('blocks symbols outside the allow list, on the deny list, and unsupported types', () => {
    assert.deepEqual(rules(checkOrder({ ...order, symbol: '035720' }, policy, ctx())), ['allow']);
    assert.deepEqual(rules(checkOrder({ ...order, symbol: '123456' }, { ...policy, allowSymbols: [...policy.allowSymbols, '123456'] }, ctx())), ['deny']);
    assert.ok(rules(checkOrder({ ...order, assetType: 'LIABILITY' }, policy, ctx())).includes('asset_type'));
    assert.deepEqual(rules(checkOrder(order, { ...policy, allowSymbols: [] }, ctx())), ['allow']);
  });

  it('enforces per-order, daily amount and daily count limits at their edges', () => {
    // 7 × 70,000 = 490,000: inside the order limit but above 80% → warning only
    const big = checkOrder({ ...order, qty: 7 }, policy, ctx());
    assert.equal(big.passed, true);
    assert.equal(big.warnings[0].rule, 'max_order');
    assert.deepEqual(rules(checkOrder({ ...order, qty: 8 }, policy, ctx())), ['max_order']);
    // Exactly at the daily limit passes, one won over blocks
    assert.equal(checkOrder(order, policy, ctx({ usedToday: { amount: 1_650_000, orders: 2 } })).passed, true);
    assert.deepEqual(rules(checkOrder(order, policy, ctx({ usedToday: { amount: 1_650_001, orders: 2 } }))), ['daily_amount']);
    assert.deepEqual(rules(checkOrder(order, policy, ctx({ usedToday: { amount: 0, orders: 5 } }))), ['daily_count']);
  });

  it('blocks outside trading hours, on stale or missing quotes and on price gaps or off-tick prices', () => {
    assert.ok(rules(checkOrder(order, policy, ctx({ now: new Date('2026-10-12T07:00:00Z'), quote: { price: 70_100, asOf: new Date('2026-10-12T06:59:50Z'), avgTradedValue: 1e12 } }))).includes('session'));
    assert.deepEqual(rules(checkOrder(order, policy, ctx({ quote: { price: 70_100, asOf: new Date(OPEN.getTime() - 300_000), avgTradedValue: 1e12 } }))), ['quote']);
    assert.ok(rules(checkOrder(order, policy, ctx({ quote: null }))).includes('quote'));
    assert.deepEqual(rules(checkOrder({ ...order, limitPrice: 73_000 }, policy, ctx({ quote: { price: 70_000, asOf: OPEN, avgTradedValue: 1e12 } }))), ['price_gap']);
    assert.deepEqual(rules(checkOrder({ ...order, limitPrice: 70_050 }, policy, ctx())), ['tick']);
    assert.ok(rules(checkOrder({ ...order, limitPrice: null }, policy, ctx())).includes('order_type'));
    assert.ok(rules(checkOrder({ ...order, orderType: 'MARKET' }, policy, ctx())).includes('order_type'));
  });

  it('stops on the kill switch, a halted policy, the daily loss line and live without permission', () => {
    assert.deepEqual(rules(checkOrder(order, policy, ctx({ globalHaltedAt: OPEN }))), ['halt']);
    assert.deepEqual(rules(checkOrder(order, { ...policy, haltedAt: OPEN, haltReason: '대사 불일치' }, ctx())), ['halt']);
    // 2% exactly trips the stop
    assert.deepEqual(rules(checkOrder(order, policy, ctx({ currentValue: 9_800_000 }))), ['loss_stop']);
    assert.equal(checkOrder(order, policy, ctx({ currentValue: 9_800_001 })).passed, true);
    assert.deepEqual(rules(checkOrder(order, { ...policy, mode: 'LIVE' }, ctx())), ['mode']);
    assert.equal(checkOrder(order, { ...policy, mode: 'LIVE' }, ctx({ liveEnabled: true })).passed, true);
  });

  it('checks cash, holdings (no short), open orders, cooldown, liquidity and the weight band', () => {
    assert.deepEqual(rules(checkOrder(order, policy, ctx({ cash: 350_000 }))), ['funds']); // fee pushes it over
    assert.deepEqual(rules(checkOrder({ ...order, side: 'SELL' }, policy, ctx({ heldQty: 4 }))), ['funds']);
    assert.equal(checkOrder({ ...order, side: 'SELL' }, policy, ctx({ heldQty: 5 })).passed, true);
    assert.deepEqual(rules(checkOrder(order, policy, ctx({ openOnSymbol: 1 }))), ['open_order']);
    assert.deepEqual(rules(checkOrder(order, policy, ctx({ lastOppositeFillAt: new Date(OPEN.getTime() - 10 * 60_000) }))), ['cooldown']);
    assert.deepEqual(rules(checkOrder(order, policy, ctx({ quote: { price: 70_100, asOf: OPEN, avgTradedValue: 300_000_000 } }))), ['liquidity']);
    assert.equal(checkOrder(order, policy, ctx({ quote: { price: 70_100, asOf: OPEN } })).warnings[0].rule, 'liquidity');
    assert.deepEqual(rules(checkOrder({ ...order, qty: 1 }, policy, ctx({ band: { min: 0.1, max: 0.2 }, symbolValue: 1_950_000, currentValue: 10_000_000 }))), ['weight']);
    assert.deepEqual(rules(checkOrder({ ...order, side: 'SELL', qty: 1 }, policy, ctx({ heldQty: 10, band: { min: 0.1, max: 0.2 }, symbolValue: 1_050_000, currentValue: 10_000_000 }))), ['weight']);
  });

  it('turns a report into a verdict by level and taint', () => {
    const ok = checkOrder(order, policy, ctx());
    assert.equal(verdictOf(ok, 'SUGGEST', false).verdict, 'DRAFT');
    assert.equal(verdictOf(ok, 'APPROVE', false).verdict, 'NEEDS_APPROVAL');
    assert.equal(verdictOf(ok, 'AUTO', false).verdict, 'AUTO');
    assert.equal(verdictOf(ok, 'AUTO', true).verdict, 'NEEDS_APPROVAL');
    assert.equal(verdictOf(checkOrder({ ...order, qty: 7 }, policy, ctx()), 'AUTO', false).verdict, 'NEEDS_APPROVAL');
    assert.equal(verdictOf(checkOrder({ ...order, qty: 8 }, policy, ctx()), 'AUTO', false).verdict, 'BLOCKED');
  });
});

describe('usage and paper trading', () => {
  it('counts open orders at their reservation and closed ones at what filled, today only', () => {
    const t = (h: number) => new Date(Date.UTC(2026, 9, 12, h));
    const u = usageToday(
      [
        { status: 'PENDING_APPROVAL', reserved: 300_000, filledQty: 0, avgFillPrice: null, createdAt: t(1) },
        { status: 'FILLED', reserved: 0, filledQty: 2, avgFillPrice: 100_000, createdAt: t(2) },
        { status: 'BLOCKED', reserved: 0, filledQty: 0, avgFillPrice: null, createdAt: t(2) },
        { status: 'FILLED', reserved: 0, filledQty: 9, avgFillPrice: 100_000, createdAt: new Date('2026-10-11T01:00:00Z') },
      ],
      OPEN,
    );
    assert.equal(u.amount.toString(), '500000');
    assert.equal(u.orders, 2);
  });

  it('fills paper limits only when the quote crosses, slipped but never past the limit', () => {
    const buy = { side: 'BUY' as const, assetType: 'KR_STOCK', qty: 10, limitPrice: 70_000 };
    assert.equal(simulatePaperFill(buy, 70_100, { slippageBp: 10, at: OPEN }).filled, false);
    const f = simulatePaperFill(buy, 69_950, { slippageBp: 10, at: OPEN });
    assert.ok(f.filled);
    assert.equal(f.price.toString(), '70000'); // 69,950 × 1.001 = 70,019.95 capped at the limit
    assert.equal(f.fee.toString(), '105');
    assert.equal(f.cashDelta.toString(), '-700105');
    const sell = simulatePaperFill({ ...buy, side: 'SELL', limitPrice: 69_000 }, 70_000, { slippageBp: 10, at: OPEN });
    assert.ok(sell.filled);
    assert.equal(sell.price.toString(), '69930');
    assert.equal(sell.tax.toString(), '1399'); // 0.2% of 699,300
  });

  it('replays paper fills into cash, positions at average cost and value', () => {
    const book = paperBook(1_000_000, [
      { symbol: 'A', side: 'BUY', qty: 10, price: 10_000, fee: 15, tax: 0 },
      { symbol: 'A', side: 'SELL', qty: 4, price: 12_000, fee: 7, tax: 96 },
    ]);
    assert.equal(book.cash.toString(), String(1_000_000 - 100_015 + 48_000 - 103));
    assert.equal(book.positions.get('A')!.qty.toString(), '6');
    assert.equal(book.positions.get('A')!.cost.toString(), '60009');
    assert.equal(paperValue(book, { A: 11_000 }).toString(), String(947_882 + 66_000));
  });
});

describe('promotion and summary', () => {
  it('only lets users make the promotion bar stricter', () => {
    const c = promotionCriteria({ tradingDays: 10, trades: 50, maxDrawdown: 0.5, reconcileErrors: 3 });
    assert.deepEqual(c, { tradingDays: 40, trades: 50, maxDrawdown: 0.1, blockedRate: 0.3, reconcileErrors: 0 });
    const m = { tradingDays: 45, trades: 22, excessReturn: 0.01, maxDrawdown: 0.08, blockedRate: 0.1, reconcileErrors: 0 };
    assert.equal(reviewPromotion(m).passed, true);
    const r = reviewPromotion({ ...m, maxDrawdown: 0.12 });
    assert.equal(r.passed, false);
    assert.deepEqual(r.items.filter((i) => !i.ok).map((i) => i.key), ['maxDrawdown']);
    assert.equal(reviewPromotion(m, c).passed, false);
  });

  it('halves limits right after a promotion', () => {
    const half = effectiveLimits({ maxOrder: 500_000, maxDaily: 2_000_000 }, 3);
    assert.equal(half.maxOrder.toString(), '250000');
    assert.equal(half.maxDaily.toString(), '1000000');
    assert.equal(half.halved, true);
    assert.equal(effectiveLimits({ maxOrder: 500_000, maxDaily: 2_000_000 }, 20).halved, false);
    assert.equal(effectiveLimits({ maxOrder: 500_000, maxDaily: 2_000_000 }, null).maxOrder.toString(), '500000');
  });

  it('says the policy in plain words', () => {
    assert.equal(manwon(500_000), '50만원');
    assert.equal(manwon(120_000_000), '1억 2,000만원');
    assert.equal(manwon(9_500), '9,500원');
    const s = policySummary({ ...policy, paperCash: 10_000_000 });
    assert.match(s[0], /하나씩 승인/);
    assert.match(s[1], /1,000만원/);
    assert.match(s[3], /한 번에 50만원, 하루 200만원·5건/);
  });
});
