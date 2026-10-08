/**
 * Candle intervals and roll-ups. Brokers that do not publish an interval
 * directly get it built from a finer one (1m -> 5m/15m/1h, 1h -> 4h, 1d -> 1w).
 */
import { Dec } from './decimal';
import { zonedDate, type MarketZone } from './broker-format';

export type CandleUnit = '1m' | '5m' | '15m' | '60m' | '240m' | '1d' | '1w';
export const CANDLE_UNITS: readonly CandleUnit[] = ['1m', '5m', '15m', '60m', '240m', '1d', '1w'];
export const CANDLE_LABEL: Record<CandleUnit, string> = { '1m': '1분', '5m': '5분', '15m': '15분', '60m': '1시간', '240m': '4시간', '1d': '일', '1w': '주' };
export const UNIT_MINUTES: Partial<Record<CandleUnit, number>> = { '1m': 1, '5m': 5, '15m': 15, '60m': 60, '240m': 240 };

export interface Candle {
  /** Start of the bar as an ISO instant (00:00 exchange-local for daily/weekly bars) */
  time: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string | null;
}

/** The finer unit a missing interval can be built from. */
export const BUILD_FROM: Partial<Record<CandleUnit, CandleUnit>> = { '5m': '1m', '15m': '1m', '60m': '1m', '240m': '60m', '1w': '1d' };

/** Local date and minutes since local midnight of an instant. */
function localParts(iso: string, zone: MarketZone) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(Date.parse(iso)));
  const hh = Number(parts.find((p) => p.type === 'hour')?.value);
  const mm = Number(parts.find((p) => p.type === 'minute')?.value);
  return { date: zonedDate(iso, zone), minutes: hh * 60 + mm };
}

/** Monday of the week containing `date` (YYYY-MM-DD). */
function weekStart(date: string): string {
  const t = Date.parse(date + 'T00:00:00Z');
  const dow = new Date(t).getUTCDay(); // 0 = Sunday
  return new Date(t - ((dow + 6) % 7) * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Combine candles (any order) into `target` buckets, oldest first.
 * Minute buckets align to the clock in the market's zone; weeks start on Monday.
 */
export function rollUp(candles: Candle[], target: CandleUnit, zone: MarketZone): Candle[] {
  const sorted = [...candles].sort((a, b) => a.time.localeCompare(b.time));
  const span = UNIT_MINUTES[target];
  const buckets = new Map<string, Candle[]>();
  const firstTime = new Map<string, string>();
  for (const c of sorted) {
    let key: string;
    if (target === '1w') key = weekStart(zonedDate(c.time, zone));
    else if (target === '1d') key = zonedDate(c.time, zone);
    else {
      const { date, minutes } = localParts(c.time, zone);
      key = `${date}#${Math.floor(minutes / span!)}`;
    }
    const list = buckets.get(key);
    if (list) list.push(c);
    else {
      buckets.set(key, [c]);
      firstTime.set(key, c.time);
    }
  }
  const out: Candle[] = [];
  for (const [key, list] of buckets) {
    let start = firstTime.get(key)!;
    if (span) {
      // Bucket start: the clock-aligned boundary at or before the first bar
      const { minutes } = localParts(start, zone);
      start = new Date(Date.parse(start) - ((minutes % span) * 60_000) - (Date.parse(start) % 60_000)).toISOString();
    }
    let high = Dec.of(list[0].high);
    let low = Dec.of(list[0].low);
    let volume: Dec | null = Dec.ZERO;
    for (const c of list) {
      if (Dec.of(c.high).gt(high)) high = Dec.of(c.high);
      if (Dec.of(c.low).lt(low)) low = Dec.of(c.low);
      volume = volume !== null && c.volume !== null ? volume.add(c.volume) : null;
    }
    out.push({ time: start, open: list[0].open, high: high.toString(), low: low.toString(), close: list[list.length - 1].close, volume: volume?.toString() ?? null });
  }
  return out.sort((a, b) => a.time.localeCompare(b.time));
}
