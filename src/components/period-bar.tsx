import { PERIOD_LABEL, PERIODS } from '@/domain/period';
import type { ResolvedRange } from '@/domain/period';

/** Global period selector rendered as links so every widget follows the URL. */
export function PeriodBar({ base, params, range }: { base: string; params: Record<string, string | undefined>; range: ResolvedRange }) {
  const href = (extra: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...params, ...extra })) if (v) q.set(k, v);
    return `${base}?${q.toString()}`;
  };
  return (
    <div className="inline" role="group" aria-label="기간 선택">
      {PERIODS.map((p) => (
        <a key={p} className="pill" href={href({ period: p, from: undefined, to: undefined })} aria-current={range.key === p ? 'true' : undefined}>
          {PERIOD_LABEL[p]}
        </a>
      ))}
      <details>
        <summary className="pill" aria-current={range.key === 'CUSTOM' ? 'true' : undefined}>
          사용자 지정
        </summary>
        <form method="get" action={base} className="inline" style={{ marginTop: 8 }}>
          {params.p && <input type="hidden" name="p" value={params.p} />}
          <label className="field">
            시작
            <input type="date" name="from" defaultValue={range.start} required />
          </label>
          <label className="field">
            종료
            <input type="date" name="to" defaultValue={range.end} required />
          </label>
          <button className="btn" type="submit">
            적용
          </button>
        </form>
      </details>
      <span className="sub">
        {range.start} ~ {range.end}
      </span>
    </div>
  );
}
