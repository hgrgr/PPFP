/**
 * Korean tax estimates for an individual (소액주주, 거주자) from the app's own records.
 * Rough guides only, never a filing: rules and edge cases (대주주, 국내 상장 해외 ETF,
 * 결제일 기준 귀속, 외국 납부세액 공제) are named in the UI rather than modelled.
 */

export const TAX_RULES = {
  /** 해외주식 양도소득: annual basic deduction and rate incl. local tax */
  overseasDeduction: 2_500_000,
  overseasRate: 0.22,
  /** 금융소득(이자+배당) above this per year is taxed with other income (종합과세) */
  financialThreshold: 20_000_000,
  /** 가상자산: scheduled from this year (bills to delay or drop it are pending) */
  cryptoFromYear: 2027,
  cryptoDeduction: 2_500_000,
  cryptoRate: 0.22,
  /** Filing is May of the next year */
  filingMonth: 5,
};

export type TaxBucket = 'OVERSEAS' | 'DOMESTIC' | 'CRYPTO' | 'OTHER';

/** Which tax a sale falls under. Overseas-listed funds count as overseas stocks. */
export function bucketOf(type: string, currency: string): TaxBucket {
  if (type === 'US_STOCK') return 'OVERSEAS';
  if (type === 'FUND') return currency === 'KRW' ? 'OTHER' : 'OVERSEAS';
  if (type === 'KR_STOCK') return 'DOMESTIC';
  if (type === 'CRYPTO') return 'CRYPTO';
  return 'OTHER';
}

export interface RealizedRow {
  date: string;
  asset: string;
  bucket: TaxBucket;
  pnlKrw: number;
}
export interface IncomeRow {
  date: string;
  asset: string | null;
  kind: 'DIVIDEND' | 'INTEREST';
  amountKrw: number;
}
export interface OpenRow {
  assetId: string;
  asset: string;
  symbol: string | null;
  bucket: TaxBucket;
  valueKrw: number;
  unrealizedKrw: number;
}

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const won = Math.round;

function gains(rows: RealizedRow[], deduction: number, rate: number, taxed: boolean) {
  const gain = sum(rows.filter((r) => r.pnlKrw > 0).map((r) => r.pnlKrw));
  const loss = sum(rows.filter((r) => r.pnlKrw < 0).map((r) => r.pnlKrw));
  const net = gain + loss;
  const base = taxed ? Math.max(0, net - deduction) : 0;
  return { sells: rows.length, gainKrw: won(gain), lossKrw: won(loss), netKrw: won(net), deductionKrw: deduction, taxableKrw: won(base), taxKrw: won(base * rate), taxed };
}

/**
 * The year's picture. For the current year (`open` given) it also suggests sales before
 * year end: losses that offset this year's overseas gains, and gains that fit in the
 * unused deduction (sell and buy back to raise the cost basis tax-free).
 */
export function taxYear(year: number, realized: RealizedRow[], income: IncomeRow[], open: OpenRow[] | null) {
  const R = TAX_RULES;
  const of = (b: TaxBucket) => realized.filter((r) => r.bucket === b);
  const overseas = gains(of('OVERSEAS'), R.overseasDeduction, R.overseasRate, true);
  const crypto = gains(of('CRYPTO'), R.cryptoDeduction, R.cryptoRate, year >= R.cryptoFromYear);
  const domestic = gains(of('DOMESTIC'), 0, 0, false);
  const dividends = won(sum(income.filter((i) => i.kind === 'DIVIDEND').map((i) => i.amountKrw)));
  const interest = won(sum(income.filter((i) => i.kind === 'INTEREST').map((i) => i.amountKrw)));
  const financial = { dividendsKrw: dividends, interestKrw: interest, totalKrw: dividends + interest, thresholdKrw: R.financialThreshold, overThreshold: dividends + interest > R.financialThreshold };

  let harvest = null;
  if (open) {
    const os = open.filter((o) => o.bucket === 'OVERSEAS');
    // Losses: each one sold lowers the taxable base until it reaches zero
    let base = overseas.taxableKrw;
    const losses = os
      .filter((o) => o.unrealizedKrw < 0)
      .sort((a, b) => a.unrealizedKrw - b.unrealizedKrw)
      .map((o) => {
        const used = Math.min(base, -o.unrealizedKrw);
        base -= used;
        return { ...o, savesKrw: won(used * R.overseasRate) };
      });
    // Gains: room left in the deduction this year (a net loss so far offsets more gains first)
    let room = Math.max(0, R.overseasDeduction - overseas.netKrw);
    const roomTotal = room;
    const fill = os
      .filter((o) => o.unrealizedKrw > 0)
      .sort((a, b) => b.unrealizedKrw - a.unrealizedKrw)
      .map((o) => {
        const take = Math.min(room, o.unrealizedKrw);
        room -= take;
        return { ...o, realizeKrw: won(take), shareOfPosition: o.unrealizedKrw > 0 ? take / o.unrealizedKrw : 0 };
      })
      .filter((o) => o.realizeKrw > 0);
    harvest = { losses, lossSavingKrw: won(sum(losses.map((l) => l.savesKrw))), deductionRoomKrw: won(roomTotal), fill };
  }
  return { year, overseas, domestic, crypto, financial, harvest };
}

export type TaxYear = ReturnType<typeof taxYear>;
