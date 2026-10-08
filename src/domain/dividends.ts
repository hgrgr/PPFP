/**
 * Dividend cash flow: what came in over the last 12 months and what the current holdings
 * should pay over the next 12, judged from each stock's own payment history (no outside
 * calendar). Dates are KST yyyy-mm-dd.
 */

export interface Payment {
  assetId: string;
  date: string;
  /** In the asset's currency */
  amount: number;
  /** Shares held that day; per-share amount = amount / qty */
  qty: number;
  krw: number;
}

export interface HeldAsset {
  assetId: string;
  name: string;
  symbol: string | null;
  currency: string;
  qty: number;
  /** KRW per unit of currency today */
  fx: number;
  valueKrw: number;
}

const DAY = 86_400_000;
const t = (d: string) => Date.parse(`${d}T00:00:00Z`);
const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const monthOf = (d: string) => d.slice(0, 7);

/** Months from `from` (yyyy-mm) for `n` months. */
export function months(from: string, n: number): string[] {
  const [y, m] = from.split('-').map(Number);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 + i, 1));
    return d.toISOString().slice(0, 7);
  });
}

export const FREQ_LABEL: Record<number, string> = { 12: '월배당', 4: '분기 배당', 2: '반기 배당', 1: '연 배당' };

/** Payments per year from the gaps between recent payments. */
export function frequency(dates: string[]): number {
  if (dates.length < 2) return 1;
  const sorted = [...dates].sort();
  const gaps = sorted.slice(1).map((d, i) => (t(d) - t(sorted[i])) / DAY);
  const g = gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
  if (g < 45) return 12;
  if (g < 135) return 4;
  if (g < 270) return 2;
  return 1;
}

export interface Projected {
  assetId: string;
  name: string;
  date: string;
  perShare: number;
  qty: number;
  currency: string;
  amount: number;
  krw: number;
  freq: number;
}

/**
 * Next payments for 12 months from `today`: each held stock that paid in the last ~13 months
 * repeats its latest per-share amount at its usual interval from its latest payment.
 */
export function forecast(today: string, held: HeldAsset[], history: Payment[]) {
  const since = t(today) - 400 * DAY;
  const until = t(today) + 365 * DAY;
  const out: Projected[] = [];
  for (const a of held) {
    if (a.qty <= 0) continue;
    const pays = history.filter((p) => p.assetId === a.assetId && t(p.date) >= since && p.qty > 0).sort((x, y) => x.date.localeCompare(y.date));
    if (!pays.length) continue;
    const last = pays[pays.length - 1];
    const freq = frequency(pays.map((p) => p.date));
    const step = 365.25 / freq;
    const perShare = last.amount / last.qty;
    for (let k = 1; ; k++) {
      const ms = t(last.date) + Math.round(step * k) * DAY;
      if (ms > until) break;
      if (ms <= t(today)) continue;
      const amount = perShare * a.qty;
      out.push({ assetId: a.assetId, name: a.name, date: ymd(ms), perShare, qty: a.qty, currency: a.currency, amount, krw: amount * a.fx, freq });
    }
  }
  return out.sort((x, y) => x.date.localeCompare(y.date) || y.krw - x.krw);
}

/** Received (past 12 months) and expected (next 12) per month, in KRW. */
export function cashflow(today: string, history: Payment[], projected: Projected[]) {
  const now = monthOf(today);
  const [y, m] = now.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1 - 11, 1)).toISOString().slice(0, 7);
  return months(start, 24).map((month) => {
    const received = history.filter((p) => monthOf(p.date) === month && p.date <= today).reduce((s, p) => s + p.krw, 0);
    const expected = projected.filter((p) => monthOf(p.date) === month).reduce((s, p) => s + p.krw, 0);
    return { month, received: Math.round(received), expected: Math.round(expected), current: month === now };
  });
}

/** Summary per held stock: frequency, trailing-12-month and next-12-month income, yield on today's value. */
export function byAsset(today: string, held: HeldAsset[], history: Payment[], projected: Projected[]) {
  const yearAgo = t(today) - 365 * DAY;
  return held
    .map((a) => {
      const past = history.filter((p) => p.assetId === a.assetId && t(p.date) > yearAgo && p.date <= today);
      const next = projected.filter((p) => p.assetId === a.assetId);
      const nextKrw = next.reduce((s, p) => s + p.krw, 0);
      return {
        ...a,
        freq: next[0]?.freq ?? null,
        trailingKrw: Math.round(past.reduce((s, p) => s + p.krw, 0)),
        nextKrw: Math.round(nextKrw),
        nextDate: next[0]?.date ?? null,
        yieldPct: a.valueKrw > 0 ? Math.round((nextKrw / a.valueKrw) * 1000) / 10 : null,
      };
    })
    .filter((r) => r.trailingKrw > 0 || r.nextKrw > 0)
    .sort((x, y) => y.nextKrw - x.nextKrw);
}
