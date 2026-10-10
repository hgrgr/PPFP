/**
 * Autopilot: the trading policy (a short IPS) an advisor works inside, and the deterministic
 * checks every order intent passes before anything is sent. Model instructions are not a
 * safety layer; these rules are. Everything fails closed: missing quotes, an expired holiday
 * table or an unknown market block the order rather than letting it through.
 *
 * Pure: the service loads state and persists results, a router sends (paper only for now).
 */
import { z } from 'zod';
import { Dec, type DecInput } from './decimal';

// ── Delegation and modes ─────────────────────────────────────────

export const DELEGATION_LEVELS = ['SUGGEST', 'APPROVE', 'AUTO'] as const;
export type DelegationLevel = (typeof DELEGATION_LEVELS)[number];
/** Prisma enums have no ordering; compare levels by this rank. */
export const LEVEL_RANK: Record<DelegationLevel, number> = { SUGGEST: 0, APPROVE: 1, AUTO: 2 };
export const LEVEL_LABEL: Record<DelegationLevel, string> = { SUGGEST: '초안만', APPROVE: '건별 승인', AUTO: '한도 내 자동' };

export const TRADE_MODES = ['PAPER', 'LIVE'] as const;
export type TradeMode = (typeof TRADE_MODES)[number];
export const MODE_LABEL: Record<TradeMode, string> = { PAPER: '페이퍼(가상 계좌)', LIVE: '실전' };

export type OrderSide = 'BUY' | 'SELL';

/** Asset types an advisor may ever trade. Liabilities, real estate, cash and the like never. */
export const TRADABLE_TYPES = ['KR_STOCK', 'FUND', 'US_STOCK', 'CRYPTO'] as const;
export type TradableType = (typeof TRADABLE_TYPES)[number];
export const TYPE_LABEL: Record<TradableType, string> = { KR_STOCK: '국내 주식', FUND: '펀드·ETF', US_STOCK: '해외 주식', CRYPTO: '가상자산' };

/** Rules no policy can turn off. */
export const FIXED_RULES = {
  orderTypes: ['LIMIT'] as readonly string[],
  /** 20-day average traded value floor for listed stocks (KRW) */
  minTradedValue: 1_000_000_000,
  /** A quote older than this blocks the order */
  maxQuoteAgeSec: 120,
  /** No order on a symbol within this many minutes of a fill on the other side */
  cooldownMinutes: 30,
  /** Orders above this share of the per-order limit are flagged */
  largeOrderShare: 0.8,
};

/** Conservative defaults shown on a new policy. */
export const DEFAULT_POLICY = {
  maxOrder: 500_000,
  maxDaily: 2_000_000,
  maxDailyOrders: 5,
  dailyLossStop: 0.02,
  maxPriceGap: 0.03,
  paperCash: 10_000_000,
  slippageBp: 10,
};

// ── Policy validation ────────────────────────────────────────────

const cleanNum = (v: unknown) => (typeof v === 'string' ? (v.trim() === '' ? undefined : Number(v.replace(/[,\s원₩%]/g, ''))) : v);
const symbolList = z
  .preprocess(
    (v) => (typeof v === 'string' ? v.split(/[\s,]+/).filter(Boolean) : v),
    z.array(z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9.\-]{0,19}$/, '종목 코드 형식을 확인하세요.')).max(100, '종목은 100개까지 넣을 수 있습니다.'),
  )
  .transform((list) => [...new Set(list)]);

export const PolicySchema = z
  .object({
    name: z.string().trim().min(1, '정책 이름을 넣으세요.').max(40, '정책 이름은 40자까지입니다.'),
    level: z.enum(DELEGATION_LEVELS).default('SUGGEST'),
    mode: z.enum(TRADE_MODES).default('PAPER'),
    objective: z.string().trim().max(500, '운용 목표는 500자까지입니다.').default(''),
    allowedTypes: z.array(z.enum(TRADABLE_TYPES)).min(1, '거래할 자산 유형을 하나 이상 고르세요.').default(['KR_STOCK']),
    allowSymbols: symbolList.default([]),
    denySymbols: symbolList.default([]),
    maxOrder: z.preprocess(cleanNum, z.number('1회 한도를 확인하세요.').positive('1회 한도를 확인하세요.').max(10_000_000_000)),
    maxDaily: z.preprocess(cleanNum, z.number('하루 한도를 확인하세요.').positive('하루 한도를 확인하세요.').max(100_000_000_000)),
    maxDailyOrders: z.preprocess(cleanNum, z.number().int().min(1, '하루 건수는 1건 이상입니다.').max(50, '하루 건수는 50건까지입니다.')).default(DEFAULT_POLICY.maxDailyOrders),
    dailyLossStop: z.preprocess(cleanNum, z.number().min(0.001, '일손실 정지선은 0.1% 이상입니다.').max(0.2, '일손실 정지선은 20%까지입니다.')).default(DEFAULT_POLICY.dailyLossStop),
    maxPriceGap: z.preprocess(cleanNum, z.number().min(0.001, '가격 괴리 상한은 0.1% 이상입니다.').max(0.1, '가격 괴리 상한은 10%까지입니다.')).default(DEFAULT_POLICY.maxPriceGap),
    paperCash: z.preprocess(cleanNum, z.number().positive('페이퍼 시작 현금을 확인하세요.').max(100_000_000_000)).default(DEFAULT_POLICY.paperCash),
    slippageBp: z.preprocess(cleanNum, z.number().int().min(0).max(500, '슬리피지는 500bp(5%)까지입니다.')).default(DEFAULT_POLICY.slippageBp),
  })
  .superRefine((p, ctx) => {
    if (p.maxOrder > p.maxDaily) ctx.addIssue({ code: 'custom', path: ['maxOrder'], message: '1회 한도가 하루 한도보다 클 수 없습니다.' });
    const both = p.allowSymbols.filter((s) => p.denySymbols.includes(s));
    if (both.length) ctx.addIssue({ code: 'custom', path: ['denySymbols'], message: `허용과 금지 목록에 같은 종목이 있습니다: ${both.join(', ')}` });
    if (p.level === 'AUTO' && !p.allowSymbols.length) ctx.addIssue({ code: 'custom', path: ['allowSymbols'], message: '자동 단계에는 허용 종목이 있어야 합니다.' });
  });

export type PolicyInput = z.infer<typeof PolicySchema>;

/** Validate raw input (a form's strings or JSON). Percent fields from a form are converted by the caller. */
export function parsePolicy(raw: unknown): { ok: true; value: PolicyInput } | { ok: false; errors: string[] } {
  const r = PolicySchema.safeParse(raw);
  if (r.success) return { ok: true, value: r.data };
  return { ok: false, errors: [...new Set(r.error.issues.map((i) => i.message))] };
}

/** Form fields hold percents (2 → 0.02); everything else passes through. */
export function policyFromForm(form: Record<string, string | string[] | undefined>): unknown {
  const pct = (v: string | string[] | undefined) => {
    const n = cleanNum(typeof v === 'string' ? v : undefined);
    return typeof n === 'number' ? n / 100 : undefined;
  };
  const str = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);
  const list = (v: string | string[] | undefined) => (Array.isArray(v) ? v : typeof v === 'string' && v ? [v] : undefined);
  return {
    name: str(form.name),
    level: str(form.level) || undefined,
    mode: str(form.mode) || undefined,
    objective: str(form.objective),
    allowedTypes: list(form.allowedTypes),
    allowSymbols: str(form.allowSymbols),
    denySymbols: str(form.denySymbols),
    maxOrder: str(form.maxOrder),
    maxDaily: str(form.maxDaily),
    maxDailyOrders: str(form.maxDailyOrders),
    dailyLossStop: pct(form.dailyLossStop),
    maxPriceGap: pct(form.maxPriceGap),
    paperCash: str(form.paperCash),
    slippageBp: str(form.slippageBp),
  };
}

/** The policy as checkOrder reads it (DB rows pass straight in: Prisma Decimals are DecInput-like via toString). */
export interface Policy {
  level: DelegationLevel;
  mode: TradeMode;
  allowedTypes: readonly string[];
  allowSymbols: readonly string[];
  denySymbols: readonly string[];
  maxOrder: DecInput;
  maxDaily: DecInput;
  maxDailyOrders: number;
  dailyLossStop: DecInput;
  maxPriceGap: DecInput;
  haltedAt?: Date | null;
  haltReason?: string | null;
}

// ── Changing a policy ────────────────────────────────────────────

export interface PolicyChange {
  /** Raising delegation or going live: needs a fresh password (step-up) */
  stepUp: boolean;
  /** Going to AUTO or LIVE: needs a passed promotion review */
  review: boolean;
  /** Anything that changes what may be traded or how much: bumps the version */
  bump: boolean;
}

export function policyChange(before: PolicyInput | null, after: PolicyInput): PolicyChange {
  if (!before) return { stepUp: LEVEL_RANK[after.level] > LEVEL_RANK.SUGGEST || after.mode === 'LIVE', review: after.level === 'AUTO' || after.mode === 'LIVE', bump: false };
  const raised = LEVEL_RANK[after.level] > LEVEL_RANK[before.level];
  const live = before.mode === 'PAPER' && after.mode === 'LIVE';
  const looser =
    after.maxOrder > before.maxOrder ||
    after.maxDaily > before.maxDaily ||
    after.maxDailyOrders > before.maxDailyOrders ||
    after.dailyLossStop > before.dailyLossStop ||
    after.maxPriceGap > before.maxPriceGap ||
    after.allowedTypes.some((t) => !before.allowedTypes.includes(t)) ||
    after.allowSymbols.some((s) => !before.allowSymbols.includes(s)) ||
    before.denySymbols.some((s) => !after.denySymbols.includes(s));
  const bump = JSON.stringify(before) !== JSON.stringify(after);
  return { stepUp: raised || live || looser, review: (raised && after.level === 'AUTO') || live, bump };
}

// ── Market calendar and tick size ────────────────────────────────

const KST_MS = 9 * 3_600_000;

export function kstParts(now: Date) {
  const k = new Date(now.getTime() + KST_MS);
  return { date: k.toISOString().slice(0, 10), year: k.getUTCFullYear(), weekday: k.getUTCDay(), minutes: k.getUTCHours() * 60 + k.getUTCMinutes() };
}

/**
 * KRX closed weekdays. Re-check against KRX's yearly notice; a year missing here blocks every
 * KRX order (fail closed) until it is added.
 */
export const KRX_HOLIDAYS: Record<number, readonly string[]> = {
  2026: [
    '2026-01-01', '2026-02-16', '2026-02-17', '2026-02-18', '2026-03-02', '2026-05-01', '2026-05-05', '2026-05-25',
    '2026-06-03', '2026-08-17', '2026-09-24', '2026-09-25', '2026-10-05', '2026-10-09', '2026-12-25', '2026-12-31',
  ],
};

/** Continuous regular session only; auctions (08:30–09:00, 15:20–15:30) and after-hours are out of scope. */
export const KRX_SESSION = { open: 9 * 60, close: 15 * 60 + 20 };

export type Venue = 'KRX' | 'CRYPTO';

export function venueOf(assetType: string): Venue | null {
  if (assetType === 'KR_STOCK' || assetType === 'FUND') return 'KRX';
  if (assetType === 'CRYPTO') return 'CRYPTO';
  return null;
}

export function marketOpen(venue: Venue | null, now: Date, holidays: Record<number, readonly string[]> = KRX_HOLIDAYS): { open: boolean; message: string } {
  if (venue === 'CRYPTO') return { open: true, message: '24시간 시장' };
  if (venue !== 'KRX') return { open: false, message: '거래 시간을 확인할 수 없는 시장입니다.' };
  const k = kstParts(now);
  const table = holidays[k.year];
  if (!table) return { open: false, message: `${k.year}년 휴장일 표가 없어 거래를 막습니다.` };
  if (k.weekday === 0 || k.weekday === 6) return { open: false, message: '주말입니다.' };
  if (table.includes(k.date)) return { open: false, message: `${k.date}은 휴장일입니다.` };
  if (k.minutes < KRX_SESSION.open || k.minutes >= KRX_SESSION.close) return { open: false, message: '정규장(09:00~15:20) 시간이 아닙니다.' };
  return { open: true, message: '정규장' };
}

/** KRX tick size (2023 unified table for stocks). ETFs use 5 won and are not modelled yet. */
export function krxTick(price: DecInput): number {
  const p = Dec.of(price);
  if (p.lt(2_000)) return 1;
  if (p.lt(5_000)) return 5;
  if (p.lt(20_000)) return 10;
  if (p.lt(50_000)) return 50;
  if (p.lt(200_000)) return 100;
  if (p.lt(500_000)) return 500;
  return 1_000;
}

const onTick = (price: Dec, tick: number) => price.div(tick).truncate(0).mul(tick).eq(price);

// ── Costs ────────────────────────────────────────────────────────

/** Estimates for paper fills and limit checks; dated like domain/tax.ts. Verify each year. */
export const COSTS = {
  stockFeeRate: 0.00015,
  cryptoFeeRate: 0.0005,
  /** 증권거래세 incl. 농특세 on KRX sales, by year */
  sellTaxByYear: { 2025: 0.0015, 2026: 0.002 } as Record<number, number>,
};

export function estimateCosts(side: OrderSide, assetType: string, notional: DecInput, year: number): { fee: Dec; tax: Dec } {
  const n = Dec.of(notional);
  const crypto = assetType === 'CRYPTO';
  const fee = n.mul(crypto ? COSTS.cryptoFeeRate : COSTS.stockFeeRate).round(0);
  let tax = Dec.ZERO;
  if (side === 'SELL' && (assetType === 'KR_STOCK')) {
    const years = Object.keys(COSTS.sellTaxByYear).map(Number).sort((a, b) => a - b);
    const y = years.filter((x) => x <= year).at(-1) ?? years[0];
    tax = n.mul(COSTS.sellTaxByYear[y]).round(0);
  }
  return { fee, tax };
}

// ── Pre-trade check ──────────────────────────────────────────────

export interface OrderIntent {
  symbol: string;
  assetType: string;
  side: OrderSide;
  qty: DecInput;
  limitPrice: DecInput | null;
  /** LIMIT only; anything else is refused */
  orderType?: string;
}

export interface QuoteSnap {
  price: DecInput;
  /** When the quote was taken; null blocks (the service fills in fetch time when the broker omits it) */
  asOf: Date | null;
  /** 20-day average traded value in KRW, when known */
  avgTradedValue?: DecInput | null;
}

export interface CheckContext {
  now: Date;
  /** Global kill switch (AiSettings.tradingHaltedAt) */
  globalHaltedAt?: Date | null;
  /** Server env, user allow-list and the connection's trade switch all agree */
  liveEnabled?: boolean;
  quote: QuoteSnap | null;
  /** Today's filled amount plus amounts reserved by open orders, and how many orders */
  usedToday: { amount: DecInput; orders: number };
  /** Cash a buy can draw on and quantity a sell can draw on */
  cash: DecInput;
  heldQty: DecInput;
  /** Open, SUBMITTING or UNKNOWN orders on the same symbol */
  openOnSymbol: number;
  lastOppositeFillAt?: Date | null;
  /** Policy portfolio value at the previous close and now, for the daily loss stop */
  dayStartValue?: DecInput | null;
  currentValue?: DecInput | null;
  /** Target weight band for the symbol (fractions) and what it is worth now */
  band?: { min: number; max: number } | null;
  symbolValue?: DecInput;
  holidays?: Record<number, readonly string[]>;
}

export const CHECK_RULES = [
  'halt', 'mode', 'order_type', 'asset_type', 'deny', 'allow', 'qty', 'session', 'quote', 'price_gap', 'tick',
  'liquidity', 'max_order', 'daily_amount', 'daily_count', 'funds', 'open_order', 'cooldown', 'loss_stop', 'weight',
] as const;
export type CheckRule = (typeof CHECK_RULES)[number];

export const RULE_LABEL: Record<CheckRule, string> = {
  halt: '정지 상태', mode: '실전 허용', order_type: '주문 방식', asset_type: '자산 유형', deny: '금지 종목', allow: '허용 종목',
  qty: '수량·가격', session: '거래 시간', quote: '시세', price_gap: '현재가 괴리', tick: '호가 단위', liquidity: '거래대금',
  max_order: '1회 한도', daily_amount: '하루 금액', daily_count: '하루 건수', funds: '현금·보유', open_order: '미확정 주문',
  cooldown: '반대 매매 간격', loss_stop: '일손실 정지', weight: '목표 비중',
};

export type CheckLevel = 'block' | 'warn' | 'info';
export interface CheckResult {
  rule: CheckRule;
  ok: boolean;
  level: CheckLevel;
  message: string;
}

export interface PreTradeReport {
  passed: boolean;
  results: CheckResult[];
  blocks: CheckResult[];
  warnings: CheckResult[];
  /** qty × limit price: held against the daily limit while the order is open */
  notional: Dec;
}

const pctText = (v: Dec | number, dp = 1) => `${((typeof v === 'number' ? v : v.toNumber()) * 100).toFixed(dp)}%`;
const wonText = (v: Dec) => `${Number(v.round(0).toString()).toLocaleString('ko-KR')}원`;

/** Every rule adds exactly one line, so the order screen can show the full checklist. */
export function checkOrder(order: OrderIntent, policy: Policy, ctx: CheckContext): PreTradeReport {
  const results: CheckResult[] = [];
  const pass = (rule: CheckRule, message: string) => results.push({ rule, ok: true, level: 'info', message });
  const block = (rule: CheckRule, message: string) => results.push({ rule, ok: false, level: 'block', message });
  const warn = (rule: CheckRule, message: string) => results.push({ rule, ok: false, level: 'warn', message });

  const symbol = order.symbol.trim().toUpperCase();
  const qty = Dec.of(order.qty);
  const limit = order.limitPrice === null ? null : Dec.of(order.limitPrice);
  const notional = limit && qty.isPos() ? qty.mul(limit) : Dec.ZERO;

  if (ctx.globalHaltedAt) block('halt', '전체 정지(킬스위치)가 켜져 있습니다.');
  else if (policy.haltedAt) block('halt', `정책이 정지되어 있습니다${policy.haltReason ? `: ${policy.haltReason}` : '.'}`);
  else pass('halt', '정지 상태가 아닙니다.');

  if (policy.mode === 'LIVE' && !ctx.liveEnabled) block('mode', '실전 주문이 열려 있지 않습니다.');
  else pass('mode', policy.mode === 'LIVE' ? '실전 주문이 열려 있습니다.' : '페이퍼 계좌로 체결을 흉내 냅니다.');

  if (!FIXED_RULES.orderTypes.includes(order.orderType ?? 'LIMIT') || !limit) block('order_type', '지정가 주문만 낼 수 있습니다(시장가 금지).');
  else pass('order_type', '지정가 주문');

  if (!(TRADABLE_TYPES as readonly string[]).includes(order.assetType)) block('asset_type', '거래할 수 없는 자산 유형입니다.');
  else if (!policy.allowedTypes.includes(order.assetType)) block('asset_type', '정책이 허용하지 않은 자산 유형입니다.');
  else pass('asset_type', TYPE_LABEL[order.assetType as TradableType]);

  if (policy.denySymbols.includes(symbol)) block('deny', `${symbol}은 금지 종목입니다.`);
  else pass('deny', '금지 종목이 아닙니다.');

  if (!policy.allowSymbols.includes(symbol)) block('allow', policy.allowSymbols.length ? `${symbol}은 허용 목록에 없습니다.` : '허용 종목이 비어 있습니다. 정책에 종목을 먼저 넣으세요.');
  else pass('allow', '허용 목록에 있습니다.');

  const venue = venueOf(order.assetType);
  if (!qty.isPos()) block('qty', '수량은 0보다 커야 합니다.');
  else if (venue === 'KRX' && !qty.truncate(0).eq(qty)) block('qty', '국내 주식은 1주 단위로만 주문합니다.');
  else if (limit && !limit.isPos()) block('qty', '지정가는 0보다 커야 합니다.');
  else pass('qty', `${qty.toString()} × ${limit ? limit.toString() : '-'}`);

  const session = marketOpen(venue, ctx.now, ctx.holidays);
  if (session.open) pass('session', session.message);
  else block('session', session.message);

  const q = ctx.quote;
  const price = q ? Dec.of(q.price) : null;
  if (!q || !price || !price.isPos()) block('quote', '현재 시세가 없습니다.');
  else if (!q.asOf) block('quote', '시세 시각을 알 수 없습니다.');
  else {
    const age = (ctx.now.getTime() - q.asOf.getTime()) / 1000;
    if (age > FIXED_RULES.maxQuoteAgeSec) block('quote', `시세가 ${Math.round(age / 60)}분 지났습니다.`);
    else pass('quote', `현재가 ${price.toString()}`);
  }

  if (price && price.isPos() && limit && limit.isPos()) {
    const gap = limit.sub(price).abs().div(price);
    if (gap.gt(policy.maxPriceGap)) block('price_gap', `지정가가 현재가에서 ${pctText(gap)} 벗어나 상한 ${pctText(Dec.of(policy.maxPriceGap))}을 넘습니다.`);
    else pass('price_gap', `현재가와 ${pctText(gap, 2)} 차이`);
  }

  if (venue === 'KRX' && order.assetType === 'KR_STOCK' && limit && limit.isPos()) {
    const tick = krxTick(limit);
    if (!onTick(limit, tick)) block('tick', `호가 단위(${tick}원)에 맞지 않는 가격입니다.`);
    else pass('tick', `호가 단위 ${tick}원`);
  }

  if (order.assetType === 'KR_STOCK') {
    const tv = q?.avgTradedValue === null || q?.avgTradedValue === undefined ? null : Dec.of(q.avgTradedValue);
    if (!tv) warn('liquidity', '거래대금을 알 수 없습니다.');
    else if (tv.lt(FIXED_RULES.minTradedValue)) block('liquidity', `20일 평균 거래대금 ${wonText(tv)}이 하한 ${wonText(Dec.of(FIXED_RULES.minTradedValue))}보다 적습니다.`);
    else pass('liquidity', `20일 평균 거래대금 ${wonText(tv)}`);
  }

  const maxOrder = Dec.of(policy.maxOrder);
  if (notional.gt(maxOrder)) block('max_order', `주문 금액 ${wonText(notional)}이 1회 한도 ${wonText(maxOrder)}를 넘습니다.`);
  else if (notional.gt(maxOrder.mul(FIXED_RULES.largeOrderShare))) warn('max_order', `주문 금액 ${wonText(notional)}이 1회 한도의 ${pctText(FIXED_RULES.largeOrderShare, 0)}를 넘습니다.`);
  else pass('max_order', `${wonText(notional)} / ${wonText(maxOrder)}`);

  const used = Dec.of(ctx.usedToday.amount);
  const maxDaily = Dec.of(policy.maxDaily);
  if (used.add(notional).gt(maxDaily)) block('daily_amount', `오늘 ${wonText(used)}을 쓰고 있어 하루 한도 ${wonText(maxDaily)}를 넘습니다.`);
  else pass('daily_amount', `주문 뒤 ${wonText(used.add(notional))} / ${wonText(maxDaily)}`);

  if (ctx.usedToday.orders + 1 > policy.maxDailyOrders) block('daily_count', `오늘 ${ctx.usedToday.orders}건을 내서 하루 ${policy.maxDailyOrders}건 한도에 닿았습니다.`);
  else pass('daily_count', `주문 뒤 ${ctx.usedToday.orders + 1}건 / ${policy.maxDailyOrders}건`);

  const k = kstParts(ctx.now);
  if (order.side === 'BUY') {
    const need = notional.add(estimateCosts('BUY', order.assetType, notional, k.year).fee);
    const cash = Dec.of(ctx.cash);
    if (need.gt(cash)) block('funds', `필요 ${wonText(need)}, 쓸 수 있는 현금 ${wonText(cash)}`);
    else pass('funds', `쓸 수 있는 현금 ${wonText(cash)}`);
  } else {
    const held = Dec.of(ctx.heldQty);
    if (qty.gt(held)) block('funds', `보유 ${held.toString()}보다 많이 팔 수 없습니다(공매도 금지).`);
    else pass('funds', `보유 ${held.toString()}`);
  }

  if (ctx.openOnSymbol > 0) block('open_order', `${symbol}에 아직 끝나지 않았거나 결과를 모르는 주문이 ${ctx.openOnSymbol}건 있습니다.`);
  else pass('open_order', '같은 종목의 미확정 주문이 없습니다.');

  const since = ctx.lastOppositeFillAt ? (ctx.now.getTime() - ctx.lastOppositeFillAt.getTime()) / 60_000 : Infinity;
  if (since < FIXED_RULES.cooldownMinutes) block('cooldown', `반대 방향 체결 뒤 ${FIXED_RULES.cooldownMinutes}분이 지나지 않았습니다.`);
  else pass('cooldown', '반대 방향 체결과 충분히 떨어져 있습니다.');

  const loss = dailyLoss(ctx.dayStartValue, ctx.currentValue);
  if (loss === null) warn('loss_stop', '기준 평가액이 없어 일손실을 확인하지 못했습니다.');
  else if (loss.gte(policy.dailyLossStop)) block('loss_stop', `오늘 평가손실 ${pctText(loss, 2)}이 정지선 ${pctText(Dec.of(policy.dailyLossStop))}에 닿았습니다.`);
  else pass('loss_stop', `오늘 평가손익 ${pctText(loss.neg(), 2)}`);

  if (ctx.band && ctx.currentValue !== undefined && ctx.currentValue !== null && Dec.of(ctx.currentValue).isPos()) {
    const total = Dec.of(ctx.currentValue);
    const after = Dec.of(ctx.symbolValue ?? 0).add(order.side === 'BUY' ? notional : notional.neg());
    const w = after.div(total);
    if (order.side === 'BUY' && w.gt(ctx.band.max)) block('weight', `주문 뒤 비중 ${pctText(w)}이 상한 ${pctText(ctx.band.max)}을 넘습니다.`);
    else if (order.side === 'SELL' && w.lt(ctx.band.min)) block('weight', `주문 뒤 비중 ${pctText(w)}이 하한 ${pctText(ctx.band.min)}보다 낮습니다.`);
    else pass('weight', `주문 뒤 비중 ${pctText(w)} (범위 ${pctText(ctx.band.min)}~${pctText(ctx.band.max)})`);
  }

  const blocks = results.filter((r) => r.level === 'block');
  const warnings = results.filter((r) => r.level === 'warn');
  return { passed: blocks.length === 0, results, blocks, warnings, notional };
}

/** Loss since the previous close as a positive fraction (negative = gain); null without a baseline. */
export function dailyLoss(start: DecInput | null | undefined, current: DecInput | null | undefined): Dec | null {
  if (start === null || start === undefined || current === null || current === undefined) return null;
  const s = Dec.of(start);
  if (!s.isPos()) return null;
  return s.sub(current).div(s);
}

export type Verdict = 'BLOCKED' | 'DRAFT' | 'NEEDS_APPROVAL' | 'AUTO';

/**
 * What happens to a checked order. Tainted conversations (they read web pages, books or
 * imported skills) always wait for a person, whatever the level; so do flagged orders under AUTO.
 */
export function verdictOf(report: PreTradeReport, level: DelegationLevel, tainted: boolean): { verdict: Verdict; reason: string } {
  if (!report.passed) return { verdict: 'BLOCKED', reason: report.blocks.map((b) => b.message).join(' / ') };
  if (level === 'SUGGEST') return { verdict: 'DRAFT', reason: '초안 단계라 실행하지 않습니다.' };
  if (level === 'APPROVE') return { verdict: 'NEEDS_APPROVAL', reason: '건별 승인 단계입니다.' };
  if (tainted) return { verdict: 'NEEDS_APPROVAL', reason: '외부 글을 읽은 대화의 주문은 사람이 승인합니다.' };
  if (report.warnings.length) return { verdict: 'NEEDS_APPROVAL', reason: report.warnings.map((w) => w.message).join(' / ') };
  return { verdict: 'AUTO', reason: '한도 안의 주문입니다.' };
}

// ── Usage against the daily limits ───────────────────────────────

export const OPEN_STATUSES = ['PENDING_APPROVAL', 'SUBMITTING', 'SUBMITTED', 'PARTIAL', 'UNKNOWN'] as const;
const NOT_COUNTED = new Set(['BLOCKED', 'DISMISSED', 'EXPIRED', 'REJECTED']);

export interface OrderUsageRow {
  status: string;
  reserved: DecInput;
  filledQty: DecInput;
  avgFillPrice: DecInput | null;
  createdAt: Date;
}

/** Today's (KST) amount and count: open orders count at their reservation, closed ones at what filled. */
export function usageToday(orders: OrderUsageRow[], now: Date): { amount: Dec; orders: number } {
  const today = kstParts(now).date;
  let amount = Dec.ZERO;
  let count = 0;
  for (const o of orders) {
    if (kstParts(o.createdAt).date !== today || NOT_COUNTED.has(o.status)) continue;
    count++;
    if ((OPEN_STATUSES as readonly string[]).includes(o.status)) amount = amount.add(o.reserved);
    else amount = amount.add(Dec.of(o.filledQty).mul(Dec.maybe(o.avgFillPrice)));
  }
  return { amount, orders: count };
}

// ── Paper fills ──────────────────────────────────────────────────

export type PaperFillResult =
  | { filled: false; reason: string }
  | { filled: true; qty: Dec; price: Dec; fee: Dec; tax: Dec; cashDelta: Dec };

const ceil0 = (v: Dec) => {
  const t = v.truncate(0);
  return t.lt(v) ? t.add(1) : t;
};

/**
 * Fill a paper limit order at once when the quote crosses the limit, slipped against us but never
 * past the limit. Optimistic: ignores depth and queue priority, which the screen says.
 */
export function simulatePaperFill(
  order: { side: OrderSide; assetType: string; qty: DecInput; limitPrice: DecInput },
  quotePrice: DecInput,
  opts: { slippageBp: number; at: Date },
): PaperFillResult {
  const qty = Dec.of(order.qty);
  const limit = Dec.of(order.limitPrice);
  const px = Dec.of(quotePrice);
  if (!px.isPos() || !qty.isPos()) return { filled: false, reason: '시세나 수량이 없습니다.' };
  const slip = Dec.of(opts.slippageBp).div(10_000);
  const crypto = order.assetType === 'CRYPTO';
  let price: Dec;
  if (order.side === 'BUY') {
    if (px.gt(limit)) return { filled: false, reason: '현재가가 지정가보다 높습니다.' };
    const slipped = px.mul(Dec.ONE.add(slip));
    price = Dec.min(limit, crypto ? slipped.round(8) : ceil0(slipped));
  } else {
    if (px.lt(limit)) return { filled: false, reason: '현재가가 지정가보다 낮습니다.' };
    const slipped = px.mul(Dec.ONE.sub(slip));
    price = Dec.max(limit, crypto ? slipped.round(8) : slipped.truncate(0));
  }
  const gross = qty.mul(price);
  const { fee, tax } = estimateCosts(order.side, order.assetType, gross, kstParts(opts.at).year);
  const cashDelta = order.side === 'BUY' ? gross.add(fee).add(tax).neg() : gross.sub(fee).sub(tax);
  return { filled: true, qty, price, fee, tax, cashDelta };
}

export interface PaperFillRow {
  symbol: string;
  side: OrderSide;
  qty: DecInput;
  price: DecInput;
  fee: DecInput;
  tax: DecInput;
}

/** Paper cash and positions (average cost) replayed from fills; nothing is stored besides the fills. */
export function paperBook(startCash: DecInput, fills: PaperFillRow[]) {
  let cash = Dec.of(startCash);
  const positions = new Map<string, { qty: Dec; cost: Dec }>();
  for (const f of fills) {
    const qty = Dec.of(f.qty);
    const gross = qty.mul(f.price);
    const costs = Dec.of(f.fee).add(f.tax);
    const p = positions.get(f.symbol) ?? { qty: Dec.ZERO, cost: Dec.ZERO };
    if (f.side === 'BUY') {
      cash = cash.sub(gross).sub(costs);
      positions.set(f.symbol, { qty: p.qty.add(qty), cost: p.cost.add(gross).add(costs) });
    } else {
      cash = cash.add(gross).sub(costs);
      const left = p.qty.sub(qty);
      const cost = p.qty.isPos() ? p.cost.mul(left).div(p.qty) : Dec.ZERO;
      if (left.isPos()) positions.set(f.symbol, { qty: left, cost });
      else positions.delete(f.symbol);
    }
  }
  return { cash, positions };
}

export function paperValue(book: ReturnType<typeof paperBook>, prices: Record<string, DecInput | undefined>): Dec {
  let v = book.cash;
  for (const [symbol, p] of book.positions) {
    const px = prices[symbol];
    // Without a price, carry the position at cost
    v = v.add(px === undefined ? p.cost : p.qty.mul(px));
  }
  return v;
}

// ── Promotion review (APPROVE → AUTO, PAPER → LIVE) ──────────────

export interface PromotionMetrics {
  tradingDays: number;
  trades: number;
  /** Return over the benchmark for the same period (fraction) */
  excessReturn: number;
  /** Maximum drawdown as a positive fraction */
  maxDrawdown: number;
  /** Share of proposals the pre-trade check blocked */
  blockedRate: number;
  reconcileErrors: number;
}

/** App floor; a user may only make these stricter. */
export const PROMOTION_FLOOR = { tradingDays: 40, trades: 20, maxDrawdown: 0.1, blockedRate: 0.3, reconcileErrors: 0 };
export type PromotionCriteria = typeof PROMOTION_FLOOR;
/** Limits start at half for this many trading days after a promotion */
export const PROMOTION_HALF_DAYS = 20;

export function promotionCriteria(user: Partial<PromotionCriteria> = {}): PromotionCriteria {
  const f = PROMOTION_FLOOR;
  return {
    tradingDays: Math.max(f.tradingDays, user.tradingDays ?? 0),
    trades: Math.max(f.trades, user.trades ?? 0),
    maxDrawdown: Math.min(f.maxDrawdown, user.maxDrawdown ?? Infinity),
    blockedRate: Math.min(f.blockedRate, user.blockedRate ?? Infinity),
    reconcileErrors: Math.min(f.reconcileErrors, user.reconcileErrors ?? Infinity),
  };
}

export function reviewPromotion(m: PromotionMetrics, criteria: PromotionCriteria = PROMOTION_FLOOR) {
  const items = [
    { key: 'tradingDays', label: '운영 영업일', value: m.tradingDays, need: `${criteria.tradingDays}일 이상`, ok: m.tradingDays >= criteria.tradingDays },
    { key: 'trades', label: '체결 건수', value: m.trades, need: `${criteria.trades}건 이상`, ok: m.trades >= criteria.trades },
    { key: 'maxDrawdown', label: '최대 낙폭', value: m.maxDrawdown, need: `${pctText(criteria.maxDrawdown, 0)} 이하`, ok: m.maxDrawdown <= criteria.maxDrawdown },
    { key: 'blockedRate', label: '사전검증 차단 비율', value: m.blockedRate, need: `${pctText(criteria.blockedRate, 0)} 이하`, ok: m.blockedRate <= criteria.blockedRate },
    { key: 'reconcileErrors', label: '대사 불일치', value: m.reconcileErrors, need: `${criteria.reconcileErrors}건 이하`, ok: m.reconcileErrors <= criteria.reconcileErrors },
  ];
  return { passed: items.every((i) => i.ok), items, excessReturn: m.excessReturn };
}

/** Limits after a promotion: half until PROMOTION_HALF_DAYS trading days have passed. */
export function effectiveLimits(p: { maxOrder: DecInput; maxDaily: DecInput }, tradingDaysSincePromotion: number | null) {
  const half = tradingDaysSincePromotion !== null && tradingDaysSincePromotion < PROMOTION_HALF_DAYS;
  const k = half ? Dec.of('0.5') : Dec.ONE;
  return { maxOrder: Dec.of(p.maxOrder).mul(k).round(0), maxDaily: Dec.of(p.maxDaily).mul(k).round(0), halved: half };
}

// ── Plain-language summary ───────────────────────────────────────

/** 500000 → "50만원", 120000000 → "1억 2,000만원" */
export function manwon(v: DecInput): string {
  const n = Math.round(Dec.of(v).toNumber());
  const eok = Math.floor(n / 100_000_000);
  const man = Math.floor((n % 100_000_000) / 10_000);
  const won = n % 10_000;
  if (!eok && !man) return `${won.toLocaleString('ko-KR')}원`;
  const parts = [eok ? `${eok.toLocaleString('ko-KR')}억` : '', man ? `${man.toLocaleString('ko-KR')}만` : '', won ? won.toLocaleString('ko-KR') : ''].filter(Boolean);
  return `${parts.join(' ')}원`;
}

export function policySummary(p: Policy & { paperCash?: DecInput; slippageBp?: number }): string[] {
  const lines: string[] = [];
  lines.push(
    p.level === 'SUGGEST'
      ? 'AI는 주문 초안만 만들고, 실행 버튼은 없습니다.'
      : p.level === 'APPROVE'
        ? 'AI가 제안한 주문은 내가 하나씩 승인해야 나갑니다.'
        : '한도 안의 주문은 승인 없이 나갑니다. 외부 글을 읽은 대화나 경고가 붙은 주문은 승인을 기다립니다.',
  );
  lines.push(
    p.mode === 'PAPER'
      ? `가상 계좌${p.paperCash !== undefined ? `(시작 현금 ${manwon(p.paperCash)})` : ''}에서 체결을 흉내 내며, 실제 돈은 움직이지 않습니다.`
      : '연결한 실제 계좌로 주문합니다.',
  );
  const types = p.allowedTypes.map((t) => TYPE_LABEL[t as TradableType] ?? t).join('·');
  const allow = p.allowSymbols.length ? `허용 종목 ${p.allowSymbols.length}개(${p.allowSymbols.slice(0, 5).join(', ')}${p.allowSymbols.length > 5 ? ' …' : ''})` : '허용 종목이 아직 없어 어떤 주문도 통과하지 않습니다';
  lines.push(`${types}만, ${allow}${p.denySymbols.length ? `, 금지 ${p.denySymbols.length}개` : ''}.`);
  lines.push(`한 번에 ${manwon(p.maxOrder)}, 하루 ${manwon(p.maxDaily)}·${p.maxDailyOrders}건까지.`);
  lines.push(`오늘 평가손실이 ${pctText(Dec.of(p.dailyLossStop))}에 닿으면 멈추고, 지정가는 현재가에서 ${pctText(Dec.of(p.maxPriceGap))} 넘게 벗어날 수 없습니다.`);
  lines.push('시장가·신용·미수·공매도는 쓰지 않습니다(바꿀 수 없는 규칙).');
  return lines;
}
