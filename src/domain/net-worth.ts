/**
 * Household balance sheet: loan repayment schedules, deposit maturity amounts and the
 * net worth roll-up by asset/liability group. Amounts are KRW numbers rounded to the won,
 * so schedules are estimates that can differ from the bank's bill by a few won.
 */

// ---------------------------------------------------------------- dates

/** Cut below the won, ignoring float noise (359999.99999 -> 360000). */
const won = (x: number) => Math.floor(x + 1e-6);

const pad = (n: number) => String(n).padStart(2, '0');
const daysIn = (y: number, m0: number) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();

/** `date` moved by `n` months; `day` (default: the same day) is clamped to the month end. */
export function addMonths(date: string, n: number, day?: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const ty = t.getUTCFullYear();
  const tm = t.getUTCMonth();
  return `${ty}-${pad(tm + 1)}-${pad(Math.min(day ?? d, daysIn(ty, tm)))}`;
}

/** Whole calendar months from `a` to `b` (day of month ignored). */
export function monthsBetween(a: string, b: string): number {
  const [ay, am] = a.split('-').map(Number);
  const [by, bm] = b.split('-').map(Number);
  return (by - ay) * 12 + (bm - am);
}

/** Calendar days from `a` to `b`. */
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86_400_000);

// ---------------------------------------------------------------- loans

export type RepaymentMethod = 'AMORTIZING' | 'EQUAL_PRINCIPAL' | 'BULLET' | 'REVOLVING' | 'CUSTOM';

export const REPAYMENT_LABEL: Record<RepaymentMethod, string> = {
  AMORTIZING: '원리금균등',
  EQUAL_PRINCIPAL: '원금균등',
  BULLET: '만기일시',
  REVOLVING: '마이너스통장',
  CUSTOM: '수기 (사인 간 등)',
};

/** Annual rate (0.045 = 4.5%) in force from `from`. */
export interface RatePoint {
  from: string;
  rate: number;
}

export interface LoanTerms {
  principal: number;
  startDate: string;
  /** Null for CUSTOM or open-ended REVOLVING: no schedule */
  maturityDate: string | null;
  method: RepaymentMethod;
  /** Interest-only months before principal starts */
  graceMonths?: number;
  /** Day of month due; past the month end = last day. Default: the start date's day */
  paymentDay?: number;
  rates: RatePoint[];
}

export interface Installment {
  n: number;
  dueDate: string;
  principal: number;
  interest: number;
  payment: number;
  /** Balance after this installment */
  balance: number;
  rate: number;
  grace: boolean;
}

/** Rate in force on `date` (the latest row on or before it; the first row before any). */
export function rateOn(rates: RatePoint[], date: string): number {
  const sorted = [...rates].sort((a, b) => a.from.localeCompare(b.from));
  let r = sorted[0]?.rate ?? 0;
  for (const p of sorted) if (p.from <= date) r = p.rate;
  return r;
}

/** Level payment that clears `balance` over `periods` at monthly rate `r`. */
export function annuityPayment(balance: number, r: number, periods: number): number {
  if (periods <= 0) return balance;
  if (r === 0) return balance / periods;
  return (balance * r) / (1 - Math.pow(1 + r, -periods));
}

/**
 * Monthly schedule from the terms. Interest is the balance × (annual rate / 12) in force at the
 * start of each period, cut below the won (원 미만 절사). Grace months pay interest only. A rate change
 * recomputes the level payment over the periods left. The last installment clears the balance.
 * REVOLVING and CUSTOM loans have no schedule.
 */
export function loanSchedule(t: LoanTerms): Installment[] {
  if (t.method === 'REVOLVING' || t.method === 'CUSTOM' || !t.maturityDate) return [];
  const total = monthsBetween(t.startDate, t.maturityDate);
  if (total <= 0 || t.principal <= 0) return [];
  const grace = Math.min(Math.max(0, t.graceMonths ?? 0), total - 1);
  const day = t.paymentDay ?? Number(t.startDate.slice(8, 10));
  const out: Installment[] = [];
  let balance = t.principal;
  let level = 0;
  let levelRate = NaN;
  let equalPrincipal = 0;
  let prevDue = t.startDate;
  for (let k = 1; k <= total; k++) {
    const dueDate = k === total ? t.maturityDate : addMonths(t.startDate, k, day);
    const rate = rateOn(t.rates, prevDue);
    const r = rate / 12;
    const interest = won(balance * r);
    const inGrace = k <= grace;
    const left = total - k + 1;
    let principal = 0;
    if (inGrace) principal = 0;
    else if (k === total) principal = balance;
    else if (t.method === 'AMORTIZING') {
      if (rate !== levelRate) {
        level = Math.round(annuityPayment(balance, r, left));
        levelRate = rate;
      }
      principal = Math.min(balance, Math.max(0, level - interest));
    } else if (t.method === 'EQUAL_PRINCIPAL') {
      if (!equalPrincipal) equalPrincipal = Math.round(balance / left);
      principal = Math.min(balance, equalPrincipal);
    }
    balance = Math.max(0, balance - principal);
    out.push({ n: k, dueDate, principal, interest, payment: principal + interest, balance, rate, grace: inGrace });
    prevDue = dueDate;
  }
  return out;
}

/** 마이너스통장 interest estimate: drawn balance × rate × days / 365, cut below the won. */
export function revolvingInterest(balance: number, annualRate: number, days: number): number {
  return won((Math.max(0, balance) * annualRate * Math.max(0, days)) / 365);
}

export interface LoanStatus {
  /** Scheduled balance after the last installment due on or before `asOf` */
  remaining: number;
  /** Interest of installments due on or before `asOf` */
  paidInterest: number;
  remainingInterest: number;
  totalInterest: number;
  /** Installment due in the same calendar month as `asOf`, if any */
  thisMonth: Installment | null;
  /** First installment due after `asOf` */
  next: Installment | null;
  /** Share of principal repaid, 0..1 */
  progress: number;
  payoffDate: string | null;
  paidCount: number;
}

/** Where a schedule stands on `asOf` (YYYY-MM-DD). */
export function loanStatus(principal: number, schedule: Installment[], asOf: string): LoanStatus {
  const done = schedule.filter((i) => i.dueDate <= asOf);
  const ahead = schedule.filter((i) => i.dueDate > asOf);
  const sumInterest = (list: Installment[]) => list.reduce((s, i) => s + i.interest, 0);
  const remaining = done.length ? done[done.length - 1].balance : principal;
  return {
    remaining,
    paidInterest: sumInterest(done),
    remainingInterest: sumInterest(ahead),
    totalInterest: sumInterest(schedule),
    thisMonth: schedule.find((i) => i.dueDate.slice(0, 7) === asOf.slice(0, 7)) ?? null,
    next: ahead[0] ?? null,
    progress: principal > 0 ? Math.min(1, Math.max(0, 1 - remaining / principal)) : 0,
    payoffDate: schedule.at(-1)?.dueDate ?? null,
    paidCount: done.length,
  };
}

/** Sum of scheduled payments due in (from, to]. 12 months of it is the DSR numerator. */
export function paymentsBetween(schedule: Installment[], from: string, to: string): number {
  return schedule.filter((i) => i.dueDate > from && i.dueDate <= to).reduce((s, i) => s + i.payment, 0);
}

/** Balance-weighted average rate of several loans (0 when there is no balance). */
export function weightedRate(loans: { balance: number; rate: number }[]): number {
  const total = loans.reduce((s, l) => s + Math.max(0, l.balance), 0);
  return total > 0 ? loans.reduce((s, l) => s + Math.max(0, l.balance) * l.rate, 0) / total : 0;
}

// ---------------------------------------------------------------- deposits

/** Interest tax by deposit tax type. Statutory values to recheck when the law changes. */
export const DEPOSIT_TAX: Record<string, number> = { GENERAL: 0.154, PREFERENTIAL: 0.095, EXEMPT: 0 };
export const DEPOSIT_TAX_AS_OF = '2026-10-10';

export interface DepositInput {
  /** TERM: 정기예금 (lump sum). INSTALLMENT: 정기적금 (same amount each month, first at start) */
  kind: 'TERM' | 'INSTALLMENT';
  /** TERM: the lump sum. INSTALLMENT: the monthly payment */
  amount: number;
  rate: number;
  months: number;
  compounding?: 'SIMPLE' | 'MONTHLY';
  taxRate?: number;
}

export interface DepositResult {
  paidIn: number;
  interest: number;
  tax: number;
  /** What the bank pays at maturity, after tax */
  maturity: number;
}

/**
 * Amount at maturity. Installment savings earn each payment's interest for the months it stays
 * in (n, n−1, … 1), which is why a 5% 적금 yields about half of 5% on the total paid in.
 */
export function depositMaturity(d: DepositInput): DepositResult {
  const r = d.rate / 12;
  const n = Math.max(0, Math.round(d.months));
  const monthly = d.compounding === 'MONTHLY';
  const grow = (p: number, m: number) => (monthly ? p * (Math.pow(1 + r, m) - 1) : p * r * m);
  let paidIn: number;
  let raw: number;
  if (d.kind === 'TERM') {
    paidIn = d.amount;
    raw = grow(d.amount, n);
  } else {
    paidIn = d.amount * n;
    raw = 0;
    for (let k = 0; k < n; k++) raw += grow(d.amount, n - k);
  }
  const interest = won(raw);
  const tax = won(interest * (d.taxRate ?? DEPOSIT_TAX.GENERAL));
  return { paidIn, interest, tax, maturity: paidIn + interest - tax };
}

// ---------------------------------------------------------------- balance sheet

export type Side = 'ASSET' | 'LIABILITY';

export const GROUPS = {
  CASH: { side: 'ASSET', label: '현금성' },
  SAVINGS: { side: 'ASSET', label: '예적금' },
  INVEST: { side: 'ASSET', label: '투자자산' },
  REAL_ESTATE: { side: 'ASSET', label: '부동산' },
  LEASE_DEPOSIT: { side: 'ASSET', label: '임차 보증금' },
  RECEIVABLE: { side: 'ASSET', label: '받을 돈' },
  GOODS: { side: 'ASSET', label: '실물 (차량 등)' },
  OTHER_ASSET: { side: 'ASSET', label: '기타 자산' },
  SECURED: { side: 'LIABILITY', label: '담보대출' },
  JEONSE: { side: 'LIABILITY', label: '전세대출' },
  CREDIT: { side: 'LIABILITY', label: '신용·마이너스통장' },
  INSTALLMENT: { side: 'LIABILITY', label: '할부' },
  PRIVATE: { side: 'LIABILITY', label: '사인 간 차입' },
  DEPOSIT_RECEIVED: { side: 'LIABILITY', label: '받은 보증금' },
  OTHER_DEBT: { side: 'LIABILITY', label: '기타 부채' },
} as const satisfies Record<string, { side: Side; label: string }>;

export type GroupKey = keyof typeof GROUPS;

const KIND_GROUP: Record<string, GroupKey> = {
  TERM_DEPOSIT: 'SAVINGS',
  INSTALLMENT_SAVING: 'SAVINGS',
  FREE_SAVING: 'SAVINGS',
  LEASE_DEPOSIT_PAID: 'LEASE_DEPOSIT',
  RECEIVABLE: 'RECEIVABLE',
  VEHICLE: 'GOODS',
  GOODS: 'GOODS',
  MORTGAGE: 'SECURED',
  JEONSE_LOAN: 'JEONSE',
  CREDIT: 'CREDIT',
  OVERDRAFT: 'CREDIT',
  INSTALLMENT: 'INSTALLMENT',
  PRIVATE: 'PRIVATE',
  LEASE_DEPOSIT_RECEIVED: 'DEPOSIT_RECEIVED',
};

/** Liability sub-kinds offered when registering a loan */
export const LIABILITY_KINDS: Record<string, string> = {
  MORTGAGE: '주택담보대출',
  JEONSE_LOAN: '전세자금대출',
  CREDIT: '신용대출',
  OVERDRAFT: '마이너스통장',
  INSTALLMENT: '할부',
  STUDENT: '학자금대출',
  PRIVATE: '사인 간 차입',
  LEASE_DEPOSIT_RECEIVED: '받은 임대 보증금',
};

/** Group for an asset type (CASH_BAL = portfolio cash) and optional sub-kind. */
export function groupOf(type: string, kind?: string | null): GroupKey {
  const byKind = kind ? KIND_GROUP[kind] : undefined;
  if (type === 'LIABILITY') return byKind && GROUPS[byKind].side === 'LIABILITY' ? byKind : 'OTHER_DEBT';
  if (byKind && GROUPS[byKind].side === 'ASSET') return byKind;
  switch (type) {
    case 'CASH':
    case 'CASH_BAL':
      return 'CASH';
    case 'KR_STOCK':
    case 'US_STOCK':
    case 'CRYPTO':
    case 'BOND':
    case 'FUND':
      return 'INVEST';
    case 'REAL_ESTATE':
      return 'REAL_ESTATE';
    default:
      return 'OTHER_ASSET';
  }
}

export interface BalanceItem {
  id: string;
  name: string;
  type: string;
  kind?: string | null;
  /** Signed value as the ledger carries it (liabilities negative), KRW */
  value: number;
  href?: string;
}

export interface BalanceGroup {
  key: GroupKey;
  side: Side;
  label: string;
  /** Positive amount for both sides */
  total: number;
  items: (BalanceItem & { amount: number })[];
}

export interface BalanceSheet {
  assets: number;
  liabilities: number;
  netWorth: number;
  /** 부채 / 총자산; null without assets */
  debtToAssets: number | null;
  /** 부채 / 순자산 (부채비율); null when net worth is not positive */
  debtToEquity: number | null;
  groups: BalanceGroup[];
}

/** Rolls items into groups and totals. Liabilities count by size whatever sign they carry. */
export function balanceSheet(items: BalanceItem[]): BalanceSheet {
  const groups = new Map<GroupKey, BalanceGroup>();
  let assets = 0;
  let liabilities = 0;
  for (const it of items) {
    const key = groupOf(it.type, it.kind);
    const side = GROUPS[key].side;
    const amount = side === 'LIABILITY' ? Math.abs(it.value) : it.value;
    if (side === 'LIABILITY') liabilities += amount;
    else assets += amount;
    const g = groups.get(key) ?? { key, side, label: GROUPS[key].label, total: 0, items: [] };
    g.total += amount;
    g.items.push({ ...it, amount });
    groups.set(key, g);
  }
  const order = Object.keys(GROUPS) as GroupKey[];
  const list = [...groups.values()].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  for (const g of list) g.items.sort((a, b) => b.amount - a.amount);
  const netWorth = assets - liabilities;
  return {
    assets,
    liabilities,
    netWorth,
    debtToAssets: assets > 0 ? liabilities / assets : null,
    debtToEquity: netWorth > 0 ? liabilities / netWorth : null,
    groups: list,
  };
}

/** Loan balance over collateral value; null without a collateral value. */
export function ltv(balance: number, collateral: number): number | null {
  return collateral > 0 ? balance / collateral : null;
}

/** Yearly debt service over yearly income; null without income. */
export function dsr(yearlyDebtService: number, annualIncome: number | null | undefined): number | null {
  return annualIncome && annualIncome > 0 ? yearlyDebtService / annualIncome : null;
}

