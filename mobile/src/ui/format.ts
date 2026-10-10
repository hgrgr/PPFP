import { Dec } from '@/domain/decimal';

const nf0 = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 });

const num = (v: Dec | number | string | null | undefined) => (v === null || v === undefined ? NaN : v instanceof Dec ? v.toNumber() : Number(v));

/** ₩1,234,567 */
export const won = (v: Dec | number | string | null | undefined) => {
  const n = num(v);
  return Number.isFinite(n) ? `₩${nf0.format(Math.round(n))}` : '—';
};

/** 12.3억, 4,560만, 7,800원 — for tight spaces */
export function shortWon(v: Dec | number | null | undefined): string {
  const n = num(v);
  if (!Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  const s = n < 0 ? '-' : '';
  if (a >= 1e8) return `${s}${nf2.format(a / 1e8)}억`;
  if (a >= 1e4) return `${s}${nf0.format(a / 1e4)}만`;
  return `${s}${nf0.format(a)}원`;
}

/** A price in its currency: 81,200원 · $231.5 */
export function price(v: Dec | string | number | null | undefined, currency: string) {
  const n = num(v);
  if (!Number.isFinite(n)) return '—';
  return currency === 'USD' ? `$${nf2.format(n)}` : `${nf0.format(n)}원`;
}

export const qty = (v: Dec | string | number) => new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 8 }).format(num(v));

export function pct(v: number | null | undefined, signed = true) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const t = `${(v * 100).toFixed(2)}%`;
  return signed && v > 0 ? `+${t}` : t;
}

/** "up" / "down" / "" for 손익 color (상승 빨강, 하락 파랑 as in Korea) */
export const tone = (v: Dec | number | null | undefined) => {
  const n = num(v);
  return !Number.isFinite(n) || n === 0 ? '' : n > 0 ? 'up' : 'down';
};

export const kstDate = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
export const kstDateTime = (iso: string) => {
  const d = new Date(new Date(iso).getTime() + 9 * 3_600_000).toISOString();
  return `${d.slice(0, 10)} ${d.slice(11, 16)}`;
};
/** Value for <input type="datetime-local"> now, Korean time */
export const nowLocal = () => new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 16);

export function ago(iso: string | null | undefined) {
  if (!iso) return '아직 없음';
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (m < 1) return '방금';
  if (m < 60) return `${m}분 전`;
  if (m < 48 * 60) return `${Math.round(m / 60)}시간 전`;
  return `${Math.round(m / 1440)}일 전`;
}
