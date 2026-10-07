/** Period presets for the global period selector. Dates are YYYY-MM-DD. */

export const PERIODS = ['1D', '1W', '1M', '3M', '6M', 'YTD', '1Y', '3Y', 'ALL'] as const;
export type PeriodKey = (typeof PERIODS)[number];

export const PERIOD_LABEL: Record<PeriodKey, string> = {
  '1D': '1D',
  '1W': '1W',
  '1M': '1M',
  '3M': '3M',
  '6M': '6M',
  YTD: 'YTD',
  '1Y': '1Y',
  '3Y': '3Y',
  ALL: '전체',
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDate(s: unknown): s is string {
  return typeof s === 'string' && DATE_RE.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
}

function addDays(date: string, n: number): string {
  return new Date(Date.parse(date + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);
}

/** Same day `n` months earlier, clamped to the month's last day (Mar 31 − 1M = Feb 28/29). */
export function minusMonths(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const total = y * 12 + (m - 1) - n;
  const ny = Math.floor(total / 12), nm = total % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${ny}-${String(nm + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

/**
 * Start date of a period ending on `today`. The start is the comparison
 * point: performance is measured from the close of the start date.
 */
export function periodStart(period: PeriodKey, today: string, firstDate: string): string {
  switch (period) {
    case '1D':
      return addDays(today, -1);
    case '1W':
      return addDays(today, -7);
    case '1M':
      return minusMonths(today, 1);
    case '3M':
      return minusMonths(today, 3);
    case '6M':
      return minusMonths(today, 6);
    case 'YTD':
      return `${Number(today.slice(0, 4)) - 1}-12-31`;
    case '1Y':
      return minusMonths(today, 12);
    case '3Y':
      return minusMonths(today, 36);
    case 'ALL':
      return firstDate < today ? addDays(firstDate, -1) : addDays(today, -1);
  }
}

export interface ResolvedRange {
  start: string;
  end: string;
  key: PeriodKey | 'CUSTOM';
}

/** Read `period`, `from`, `to` search params into a range. Invalid input falls back to 1Y. */
export function resolveRange(
  params: { period?: string; from?: string; to?: string },
  today: string,
  firstDate: string,
): ResolvedRange {
  if (isDate(params.from) && isDate(params.to) && params.from < params.to) {
    return { start: params.from, end: params.to > today ? today : params.to, key: 'CUSTOM' };
  }
  const key = (PERIODS as readonly string[]).includes(params.period ?? '') ? (params.period as PeriodKey) : '1Y';
  return { start: periodStart(key, today, firstDate), end: today, key };
}
