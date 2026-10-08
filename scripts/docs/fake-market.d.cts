/** Types for fake-market.cjs (documentation screenshots only). */
interface StockMeta {
  mkt: 'KR' | 'US';
  key: string;
  name: string;
  base: number;
  vol: number;
  excd?: string;
  round: (p: number) => number;
  scale: number;
}
interface DayBar {
  ymd: string;
  t0: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}
declare const fake: {
  KR: Record<string, [name: string, price: number, volume: number]>;
  US: Record<string, [name: string, price: number, volume: number, excd: string]>;
  COINS: Record<string, [name: string, price: number, volume: number]>;
  KIS_ACCOUNT: [symbol: string, qty: number, avgPrice: number][];
  USDKRW: number;
  ANCHOR: number;
  smooth(seed: string, x: number): number;
  stockMeta(symbol: string): StockMeta | null;
  dayBar(meta: StockMeta, ymd: string): DayBar;
  quoteOf(meta: StockMeta): { price: number; prev: number; vol: number; today: string };
  sessionOnOrBefore(mkt: 'KR' | 'US', ymd: string, at?: number): string;
  parts(ms: number, zone: string): { ymd: string; hms: string; dow: string };
};
export = fake;
