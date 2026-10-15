/**
 * 종목 분석: fair-value models (two-stage DCF, reverse DCF, dividend discount, residual income),
 * the inputs they start from (trailing figures from the reported financials), multiples for peer
 * comparison and Form 4 insider trades. Pure.
 */

// ------------------------------------------------------------------ models

export interface DcfInput {
  /** free cash flow of the last twelve months, dollars */
  fcf: number;
  /** yearly growth for the first stage, fraction */
  growth: number;
  /** years of the first stage */
  years: number;
  /** growth forever after, fraction */
  terminal: number;
  /** discount rate, fraction */
  discount: number;
  /** cash less debt, dollars */
  netCash: number;
  shares: number;
}

export interface DcfResult {
  perShare: number | null;
  enterprise: number;
  equity: number;
  /** present value of the terminal value as a share of the enterprise value */
  terminalShare: number;
  flows: { year: number; fcf: number; pv: number }[];
}

/** Two-stage discounted cash flow: `years` of growth, then a Gordon terminal value */
export function dcf(i: DcfInput): DcfResult {
  const flows: DcfResult['flows'] = [];
  let f = i.fcf;
  let pv = 0;
  for (let y = 1; y <= i.years; y++) {
    f *= 1 + i.growth;
    const p = f / (1 + i.discount) ** y;
    flows.push({ year: y, fcf: f, pv: p });
    pv += p;
  }
  const tv = i.discount > i.terminal ? (f * (1 + i.terminal)) / (i.discount - i.terminal) : NaN;
  const tvPv = tv / (1 + i.discount) ** i.years;
  const enterprise = pv + tvPv;
  const equity = enterprise + i.netCash;
  return {
    perShare: Number.isFinite(equity) && i.shares > 0 ? equity / i.shares : null,
    enterprise,
    equity,
    terminalShare: enterprise ? tvPv / enterprise : 0,
    flows,
  };
}

/** The first-stage growth that makes the DCF equal today's price (bisection), or null when out of −50%…+100% */
export function reverseDcf(price: number, i: Omit<DcfInput, 'growth'>): number | null {
  const at = (g: number) => dcf({ ...i, growth: g }).perShare ?? NaN;
  let lo = -0.5, hi = 1;
  if (!(at(lo) <= price && at(hi) >= price)) return null;
  for (let k = 0; k < 80; k++) {
    const mid = (lo + hi) / 2;
    if (at(mid) < price) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export interface DdmInput {
  /** dividend per share of the last twelve months */
  dps: number;
  growth: number;
  years: number;
  terminal: number;
  discount: number;
}

/** Two-stage dividend discount model, per share */
export function ddm(i: DdmInput): number | null {
  if (i.dps <= 0 || i.discount <= i.terminal) return null;
  let d = i.dps;
  let pv = 0;
  for (let y = 1; y <= i.years; y++) {
    d *= 1 + i.growth;
    pv += d / (1 + i.discount) ** y;
  }
  return pv + (d * (1 + i.terminal)) / (i.discount - i.terminal) / (1 + i.discount) ** i.years;
}

export interface RimInput {
  /** book value per share now */
  bps: number;
  /** return on equity, fraction */
  roe: number;
  /** share of earnings paid out, fraction */
  payout: number;
  discount: number;
  years: number;
  /** how much of the excess return lasts each year after `years` (0 = stops, 1 = forever) */
  persistence: number;
}

/**
 * Residual income: book value plus the discounted earnings above the cost of equity. Book value
 * grows by retained earnings; after `years`, the excess return fades by `persistence` a year.
 */
export function rim(i: RimInput): { perShare: number; flows: { year: number; bps: number; residual: number; pv: number }[] } | null {
  if (i.bps <= 0 || i.discount <= 0) return null;
  let b = i.bps;
  let pv = 0;
  const flows: { year: number; bps: number; residual: number; pv: number }[] = [];
  let last = 0;
  for (let y = 1; y <= i.years; y++) {
    const earnings = b * i.roe;
    const residual = earnings - b * i.discount;
    const p = residual / (1 + i.discount) ** y;
    flows.push({ year: y, bps: b, residual, pv: p });
    pv += p;
    last = residual;
    b += earnings * (1 - i.payout);
  }
  const fade = Math.min(Math.max(i.persistence, 0), 0.99);
  const terminal = (last * fade) / (1 + i.discount - fade) / (1 + i.discount) ** i.years;
  return { perShare: i.bps + pv + terminal, flows };
}

/** A grid of DCF values per share over discount rates (rows) and growth rates (columns) */
export function sensitivity(i: DcfInput, discounts: number[], growths: number[]): (number | null)[][] {
  return discounts.map((r) => growths.map((g) => dcf({ ...i, discount: r, growth: g }).perShare));
}

// ------------------------------------------------------------------ inputs from the financials

export interface Fundamentals {
  /** trailing twelve months */
  revenue: number | null;
  operatingIncome: number | null;
  netIncome: number | null;
  operatingCashFlow: number | null;
  capex: number | null;
  dividends: number | null;
  /** latest balance sheet */
  cash: number | null;
  debt: number | null;
  equity: number | null;
  shares: number | null;
  /** revenue growth a year, last three years */
  revenueCagr: number | null;
  asOf: string | null;
}

/** Sum of the newest four quarters (null unless all four are there) */
export const ttm = (values: (number | null)[]) => (values.length >= 4 && values.slice(0, 4).every((v) => v !== null) ? values.slice(0, 4).reduce((a, v) => a! + v!, 0)! : null);

export function cagr(newest: number | null, oldest: number | null, years: number): number | null {
  return newest && oldest && newest > 0 && oldest > 0 && years > 0 ? (newest / oldest) ** (1 / years) - 1 : null;
}

export interface Multiples {
  price: number;
  marketCap: number | null;
  pe: number | null;
  ps: number | null;
  pb: number | null;
  evEbit: number | null;
  fcfYield: number | null;
  dividendYield: number | null;
  roe: number | null;
  operatingMargin: number | null;
  revenueCagr: number | null;
}

export function multiples(f: Fundamentals, price: number): Multiples {
  const cap = f.shares ? f.shares * price : null;
  const fcf = f.operatingCashFlow !== null && f.capex !== null ? f.operatingCashFlow - Math.abs(f.capex) : null;
  const ev = cap !== null ? cap + (f.debt ?? 0) - (f.cash ?? 0) : null;
  const pos = (v: number | null) => (v !== null && v > 0 ? v : null);
  return {
    price,
    marketCap: cap,
    pe: cap && pos(f.netIncome) ? cap / f.netIncome! : null,
    ps: cap && pos(f.revenue) ? cap / f.revenue! : null,
    pb: cap && pos(f.equity) ? cap / f.equity! : null,
    evEbit: ev && pos(f.operatingIncome) ? ev / f.operatingIncome! : null,
    fcfYield: cap && fcf !== null ? fcf / cap : null,
    dividendYield: cap && f.dividends ? Math.abs(f.dividends) / cap : null,
    roe: f.netIncome !== null && pos(f.equity) ? f.netIncome / f.equity! : null,
    operatingMargin: f.operatingIncome !== null && pos(f.revenue) ? f.operatingIncome / f.revenue! : null,
    revenueCagr: f.revenueCagr,
  };
}

/** Median of the known values */
export function median(values: (number | null)[]): number | null {
  const v = values.filter((x): x is number => x !== null && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

// ------------------------------------------------------------------ insider trades

export interface InsiderTrade {
  date: string;
  owner: string;
  role: string;
  /** P open-market buy, S open-market sale, A grant, M option exercise, F tax withholding, G gift … */
  code: string;
  shares: number;
  price: number | null;
  /** + acquired, − disposed */
  sign: 1 | -1;
  after: number | null;
}

export const TRADE_CODE: Record<string, string> = { P: '장내 매수', S: '장내 매도', A: '주식 보상', M: '옵션 행사', F: '세금 납부용 처분', G: '증여', D: '회사에 반납', C: '전환', X: '옵션 행사', J: '기타' };

const tag = (b: string, name: string) => /<value>([^<]*)<\/value>/.exec(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(b)?.[1] ?? '')?.[1]?.trim() ?? new RegExp(`<${name}>([^<]*)</${name}>`).exec(b)?.[1]?.trim() ?? '';

/** A Form 4 XML: the reporting owner and each non-derivative transaction */
export function parseForm4(xml: string): InsiderTrade[] {
  const owner = new RegExp('<rptOwnerName>([^<]*)</rptOwnerName>').exec(xml)?.[1]?.trim() ?? '';
  const rel = new RegExp('<reportingOwnerRelationship>([\\s\\S]*?)</reportingOwnerRelationship>').exec(xml)?.[1] ?? '';
  const title = new RegExp('<officerTitle>([^<]*)</officerTitle>').exec(rel)?.[1]?.trim();
  const isTrue = (n: string) => new RegExp(`<${n}>\\s*(1|true)\\s*</${n}>`, 'i').test(rel);
  const role = [title, isTrue('isDirector') ? '이사' : null, isTrue('isTenPercentOwner') ? '10% 주주' : null].filter(Boolean).join(' · ') || (isTrue('isOfficer') ? '임원' : '기타');
  const out: InsiderTrade[] = [];
  for (const m of xml.matchAll(/<nonDerivativeTransaction>([\s\S]*?)<\/nonDerivativeTransaction>/g)) {
    const b = m[1];
    const date = tag(b, 'transactionDate').slice(0, 10);
    const code = new RegExp('<transactionCode>([^<]*)</transactionCode>').exec(b)?.[1]?.trim() ?? '';
    const shares = Number(tag(b, 'transactionShares'));
    const pr = tag(b, 'transactionPricePerShare');
    const price = pr ? Number(pr) : NaN;
    const ad = tag(b, 'transactionAcquiredDisposedCode');
    const af = tag(b, 'sharesOwnedFollowingTransaction');
    const after = af ? Number(af) : NaN;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(shares) || !shares) continue;
    out.push({ date, owner: owner.replace(/&amp;/g, '&'), role, code, shares, price: Number.isFinite(price) && price > 0 ? price : null, sign: ad === 'D' ? -1 : 1, after: Number.isFinite(after) ? after : null });
  }
  return out;
}

/** Open-market buys and sales by month: shares and dollars, newest last */
export function insiderMonths(trades: InsiderTrade[]): { month: string; buy: number; sell: number }[] {
  const m = new Map<string, { buy: number; sell: number }>();
  for (const t of trades) {
    if (t.code !== 'P' && t.code !== 'S') continue;
    const k = t.date.slice(0, 7);
    const e = m.get(k) ?? { buy: 0, sell: 0 };
    const usd = t.shares * (t.price ?? 0);
    if (t.code === 'P') e.buy += usd;
    else e.sell -= usd;
    m.set(k, e);
  }
  return [...m].map(([month, v]) => ({ month, ...v })).sort((a, b) => a.month.localeCompare(b.month));
}
