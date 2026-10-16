import { Suspense } from 'react';
import { AskAiButton } from '@/components/ai/launcher';
import { ComparePicker, CompareResults } from '@/components/compare';
import { PeriodBar } from '@/components/period-bar';
import { requireUser } from '@/server/auth';
import { compareView } from '@/server/services/compare';

export const metadata = { title: '포트폴리오 비교' };
export const dynamic = 'force-dynamic';

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
/** The picks travel as one comma-separated ?p= so the period bar keeps them */
const many = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []).flatMap((x) => x.split(',')).filter(Boolean);

export default async function ComparePage({ searchParams }: { searchParams: SP }) {
  const user = await requireUser();
  const sp = await searchParams;
  const view = await compareView(user.id, many(sp.p), { period: one(sp.period), from: one(sp.from), to: one(sp.to) });
  const summary = view.series.map((s) => `${s.label}(${s.kind === 'virtual' ? '가상' : s.kind === 'index' ? '지수' : '실제'}): 누적 ${(s.stats.total * 100).toFixed(1)}%, 최대 낙폭 ${(s.stats.maxDrawdown * 100).toFixed(1)}%, 변동성 ${s.stats.vol === null ? '—' : `${(s.stats.vol * 100).toFixed(1)}%`}`).join('; ');
  return (
    <>
      <header className="page-head">
        <div className="stack" style={{ gap: 6 }}>
          <h1>포트폴리오 비교</h1>
          <p className="sub">실제 포트폴리오, 가상 포트폴리오, 지수를 같은 기간으로 나란히 놓고 수익률·변동성·낙폭·상관관계를 비교합니다. 보기만 할 뿐 서로 합치거나 섞지 않습니다.</p>
        </div>
        <div className="inline">
          <a className="btn" href="/performance">‹ 성과 분석</a>
          <AskAiButton label="AI 비교 해석" prompt={`포트폴리오 비교 화면 내용이야(${view.dates[0] ?? ''} ~ ${view.dates.at(-1) ?? ''}): ${summary}. 가상 포트폴리오는 실제 자산이 아니라 연습용이야. 어느 쪽이 위험 대비 성과가 좋았는지, 상관관계로 볼 때 함께 들면 분산 효과가 있는지, 실제 포트폴리오에 무엇을 참고하면 좋을지 알려 줘.`} />
        </div>
      </header>
      <Suspense fallback={null}>
        <ComparePicker view={view} />
      </Suspense>
      <PeriodBar base="/performance/compare" params={{ p: view.picked.join(','), period: one(sp.period), from: one(sp.from), to: one(sp.to) }} range={view.range} />
      <CompareResults view={view} />
    </>
  );
}
