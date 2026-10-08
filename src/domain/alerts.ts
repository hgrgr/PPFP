/**
 * Price alerts and target-weight drift: when to fire, and the numbers the
 * messages and the rebalancing table show. Pure; the alert service feeds it.
 */

export type Direction = 'ABOVE' | 'BELOW';

/** An alert set at `price` waits for a rise when the price is above the reference (current or base) price, else a fall. */
export function directionFor(price: number, reference: number | null): Direction {
  return reference === null || price >= reference ? 'ABOVE' : 'BELOW';
}

export function isCrossed(direction: Direction, price: number, current: number): boolean {
  return direction === 'ABOVE' ? current >= price : current <= price;
}

/**
 * Journal alerts: the target waits in the direction from the base (or current)
 * price to the target; the stop waits the other way.
 */
export function journalDirections(target: number, reference: number | null): { target: Direction; stop: Direction } {
  const t = directionFor(target, reference);
  return { target: t, stop: t === 'ABOVE' ? 'BELOW' : 'ABOVE' };
}

// ── target weights ──────────────────────────────────

export interface DriftPart {
  key: string;
  label: string;
  /** KRW */
  value: number;
}

export interface DriftRow extends DriftPart {
  share: number;
  /** 0..1, null when no target */
  target: number | null;
  /** share − target */
  diff: number | null;
  breach: boolean;
  /** KRW to buy (positive) or sell (negative) to reach the target */
  trade: number | null;
}

export interface DriftReport {
  total: number;
  rows: DriftRow[];
  /** Keys out of band */
  breaches: string[];
  /** Targets add up to this (0..1) */
  targetSum: number;
}

/**
 * Compare a portfolio's parts with their target weights. A part with a target
 * but nothing held still counts (share 0); a part without a target never breaches.
 */
export function driftReport(parts: DriftPart[], targets: Record<string, number>, tolerance: number): DriftReport {
  const byKey = new Map(parts.map((p) => [p.key, { ...p, value: Math.max(0, p.value) }]));
  for (const key of Object.keys(targets)) if (!byKey.has(key)) byKey.set(key, { key, label: key, value: 0 });
  const all = [...byKey.values()];
  const total = all.reduce((a, b) => a + b.value, 0);
  const rows = all.map((p) => {
    const share = total > 0 ? p.value / total : 0;
    const target = targets[p.key] ?? null;
    const diff = target === null ? null : share - target;
    return {
      ...p,
      share,
      target,
      diff,
      breach: diff !== null && total > 0 && Math.abs(diff) > tolerance + 1e-12,
      trade: target === null ? null : target * total - p.value,
    };
  });
  rows.sort((a, b) => (b.target ?? -1) - (a.target ?? -1) || b.value - a.value);
  return { total, rows, breaches: rows.filter((r) => r.breach).map((r) => r.key), targetSum: Object.values(targets).reduce((a, b) => a + b, 0) };
}

/** Breaches not already reported at the last check. */
export function newlyBreached(previous: readonly string[], now: readonly string[]): string[] {
  const before = new Set(previous);
  return now.filter((k) => !before.has(k));
}

export function targetsOk(weights: number[]): boolean {
  const sum = weights.reduce((a, b) => a + b, 0);
  return weights.every((w) => w >= 0 && w <= 1) && sum <= 1 + 1e-9;
}
