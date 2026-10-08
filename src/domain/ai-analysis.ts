/** Numbers the research and journal-coach agents ask for, computed here so they are the app's, not the model's. */

export interface Bar {
  t: string;
  c: number;
  h: number;
  l: number;
  v: number | null;
}

const round = (v: number, dp = 1) => Math.round(v * 10 ** dp) / 10 ** dp;
const pctChange = (from: number | undefined, to: number) => (from && from > 0 ? round(((to - from) / from) * 100) : null);

/** Returns, range, moving averages and volatility from daily bars (oldest first). */
export function priceStats(bars: Bar[]) {
  if (!bars.length) return null;
  const last = bars[bars.length - 1];
  const back = (n: number) => bars[bars.length - 1 - n]?.c;
  const ma = (n: number) => (bars.length >= n ? round(bars.slice(-n).reduce((s, b) => s + b.c, 0) / n, 4) : null);
  const year = bars.slice(-250);
  const hi = Math.max(...year.map((b) => b.h));
  const lo = Math.min(...year.map((b) => b.l));
  const rets = bars.slice(-21).map((b, i, a) => (i ? Math.log(b.c / a[i - 1].c) : 0)).slice(1);
  const mean = rets.reduce((s, r) => s + r, 0) / (rets.length || 1);
  const sd = Math.sqrt(rets.reduce((s, r) => s + (r - mean) ** 2, 0) / Math.max(1, rets.length - 1));
  const vols = bars.slice(-20).map((b) => b.v).filter((v): v is number => v !== null);
  return {
    asOf: last.t.slice(0, 10),
    close: last.c,
    returnPct: { '1W': pctChange(back(5), last.c), '1M': pctChange(back(21), last.c), '3M': pctChange(back(63), last.c), '6M': pctChange(back(126), last.c), '1Y': pctChange(back(249), last.c) },
    high52w: hi,
    low52w: lo,
    fromHighPct: pctChange(hi, last.c),
    fromLowPct: pctChange(lo, last.c),
    ma20: ma(20),
    ma60: ma(60),
    ma120: ma(120),
    volatility20dAnnualPct: rets.length > 5 ? round(sd * Math.sqrt(252) * 100) : null,
    avgVolume20d: vols.length ? Math.round(vols.reduce((s, v) => s + v, 0) / vols.length) : null,
    bars: bars.length,
  };
}

export interface SellRow {
  date: string;
  asset: string;
  /** Realized P&L in KRW */
  pnlKrw: number;
  /** Cost of the lots sold, trade currency, and the P&L in the same currency */
  cost: number;
  pnl: number;
  /** Quantity-weighted days the sold lots were held */
  holdingDays: number;
  hasJournal: boolean;
}

/** Win rate, payoff and habits over realized sells. */
export function tradeStats(rows: SellRow[]) {
  const ret = (r: SellRow) => (r.cost > 0 ? (r.pnl / r.cost) * 100 : 0);
  const wins = rows.filter((r) => r.pnlKrw > 0);
  const losses = rows.filter((r) => r.pnlKrw < 0);
  const avg = (xs: number[]) => (xs.length ? round(xs.reduce((s, x) => s + x, 0) / xs.length) : null);
  const grossWin = wins.reduce((s, r) => s + r.pnlKrw, 0);
  const grossLoss = -losses.reduce((s, r) => s + r.pnlKrw, 0);
  const byReturn = [...rows].sort((a, b) => ret(b) - ret(a));
  const brief = (r: SellRow) => ({ date: r.date, asset: r.asset, returnPct: round(ret(r)), pnlKrw: Math.round(r.pnlKrw), holdingDays: r.holdingDays });
  return {
    sells: rows.length,
    wins: wins.length,
    losses: losses.length,
    winRatePct: rows.length ? round((wins.length / rows.length) * 100) : null,
    avgWinPct: avg(wins.map(ret)),
    avgLossPct: avg(losses.map(ret)),
    profitFactor: grossLoss > 0 ? round(grossWin / grossLoss, 2) : null,
    realizedKrw: Math.round(grossWin - grossLoss),
    avgHoldingDaysWins: avg(wins.map((r) => r.holdingDays)),
    avgHoldingDaysLosses: avg(losses.map((r) => r.holdingDays)),
    sellsWithoutJournal: rows.filter((r) => !r.hasJournal).length,
    best: byReturn.slice(0, 3).filter((r) => r.pnlKrw > 0).map(brief),
    worst: byReturn.slice(-3).reverse().filter((r) => r.pnlKrw < 0).map(brief),
  };
}

type Block = { type: string; props?: Record<string, unknown>; content: string };

/** Plain text (with "## " headings and "- " bullets) as editor blocks, under a heading. */
export function textToBlocks(title: string, text: string): Block[] {
  const out: Block[] = [{ type: 'heading', props: { level: 2 }, content: title }];
  for (const raw of text.split('\n')) {
    const line = raw.trim().replace(/\*\*(.+?)\*\*/g, '$1');
    if (!line) continue;
    const h = line.match(/^#{1,3}\s+(.*)$/);
    const li = line.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (h) out.push({ type: 'heading', props: { level: 3 }, content: h[1] });
    else if (li) out.push({ type: line.match(/^\d/) ? 'numberedListItem' : 'bulletListItem', content: li[1] });
    else out.push({ type: 'paragraph', content: line });
  }
  return out;
}
