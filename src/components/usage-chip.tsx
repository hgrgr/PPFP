import { krw, usd } from '@/lib/format';

/** This month's AI spend against the cap, linking to the usage page. */
export function UsageChip({ spent, limit, usdkrw }: { spent: number; limit: number | null; usdkrw: number }) {
  const r = limit ? spent / limit : null;
  return (
    <a href="/usage" className="usage-chip" title="사용량 · 비용 보기">
      <span aria-hidden="true">✦</span>
      <span>
        AI 이번 달 <span className={`money${r !== null && r >= 1 ? ' over-text' : ''}`}>{usd(spent)}</span>
        {limit !== null && <> / {usd(limit)}</>}
      </span>
      {r !== null && (
        <span className="meter" role="meter" aria-label="AI 월 한도 사용" aria-valuemin={0} aria-valuemax={limit!} aria-valuenow={spent}>
          <span className={r >= 1 ? 'over' : r >= 0.8 ? 'warn' : undefined} style={{ width: `${Math.min(1, r) * 100}%` }} />
        </span>
      )}
      <span className="sub">약 {krw(spent * usdkrw)}</span>
    </a>
  );
}
