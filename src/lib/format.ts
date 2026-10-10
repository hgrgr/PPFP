/** Display formatting shared by server and client components. Inputs are numbers or decimal strings. */

type Num = number | string | null | undefined;

const n = (v: Num) => (v === null || v === undefined || v === '' ? NaN : typeof v === 'number' ? v : Number(v));

export function krw(v: Num): string {
  const x = n(v);
  if (!Number.isFinite(x)) return '—';
  return (x < 0 ? '−' : '') + '₩' + Math.round(Math.abs(x)).toLocaleString('ko-KR');
}

/** Compact KRW: 9.82억, 3,450만 */
export function krwShort(v: Num): string {
  const x = n(v);
  if (!Number.isFinite(x)) return '—';
  const a = Math.abs(x), s = x < 0 ? '−' : '';
  if (a >= 1e12) return s + (a / 1e12).toFixed(2) + '조';
  if (a >= 1e8) return s + (a / 1e8).toFixed(2) + '억';
  if (a >= 1e4) return s + Math.round(a / 1e4).toLocaleString('ko-KR') + '만';
  return s + Math.round(a).toLocaleString('ko-KR');
}

export function signedKrwShort(v: Num): string {
  const x = n(v);
  if (!Number.isFinite(x)) return '—';
  return (x > 0 ? '+' : '') + krwShort(x);
}

export function money(v: Num, currency: string): string {
  const x = n(v);
  if (!Number.isFinite(x)) return '—';
  if (currency === 'KRW') return krw(x);
  return (x < 0 ? '−' : '') + '$' + Math.abs(x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Like money(), with a + sign on gains */
export function signedMoney(v: Num, currency: string): string {
  const x = n(v);
  if (!Number.isFinite(x)) return '—';
  return (x > 0 ? '+' : '') + money(x, currency);
}

/** Small dollar amounts (AI costs): cents, or a tenth of a cent below a dollar */
export function usd(v: Num): string {
  const x = n(v);
  if (!Number.isFinite(x)) return '—';
  return '$' + (Math.abs(x) < 1 && x !== 0 ? x.toFixed(3) : x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
}

export function pct(v: Num, dp = 2, signed = true): string {
  const x = n(v);
  if (!Number.isFinite(x)) return '—';
  const s = signed ? (x > 0 ? '+' : x < 0 ? '−' : '') : x < 0 ? '−' : '';
  return s + Math.abs(x * 100).toFixed(dp) + '%';
}

export function qty(v: Num): string {
  const x = n(v);
  if (!Number.isFinite(x)) return '—';
  return x.toLocaleString('ko-KR', { maximumFractionDigits: 8 });
}

/** CSS class for profit/loss colouring (colours come from CSS variables, so the user can flip red/blue). */
export function tone(v: Num): 'up' | 'down' | 'flat' {
  const x = n(v);
  if (!Number.isFinite(x) || Math.abs(x) < 1e-9) return 'flat';
  return x > 0 ? 'up' : 'down';
}

export function shortDate(iso: string): string {
  return iso.slice(2, 10).replace(/-/g, '.');
}

export function kstDateTime(d: Date | string): string {
  const t = typeof d === 'string' ? new Date(d) : d;
  return new Date(t.getTime() + 9 * 3_600_000).toISOString().slice(0, 16).replace('T', ' ');
}
