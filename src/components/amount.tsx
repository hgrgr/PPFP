import { krw, krwShort, money, signedKrwShort, signedMoney } from '@/lib/format';

/**
 * A won amount of one asset. With `local` on, a foreign asset shows it in its own currency
 * (won ÷ the latest published rate) with the won amount underneath.
 */
export function FxAmount({ value, currency, usdkrw, local, signed = false, short = true }: { value: number; currency: string; usdkrw: number; local: boolean; signed?: boolean; short?: boolean }) {
  const won = signed ? signedKrwShort(value) : short ? krwShort(value) : krw(value);
  if (!local || currency === 'KRW' || !(usdkrw > 0)) return <>{won}</>;
  const x = value / usdkrw;
  return (
    <>
      {signed ? signedMoney(x, currency) : money(x, currency)}
      <span className="sub">{won}</span>
    </>
  );
}
