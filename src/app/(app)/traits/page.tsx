import { TraitsBoard } from '@/components/traits-board';
import { requireUser } from '@/server/auth';
import { traitOverview } from '@/server/services/traits';

export const metadata = { title: '자산 성질' };
export const dynamic = 'force-dynamic';

export default async function TraitsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const [data, sp] = await Promise.all([traitOverview(user.id), searchParams]);
  return (
    <>
      <header className="page-head">
        <div className="stack" style={{ gap: 6 }}>
          <h1>자산 성질</h1>
          <p className="sub">올웨더 경제 국면, 자산군, 주식 스타일처럼 자산을 성질별로 나눠 지금 비중과 목표를 비교하고, 부족한 성질에 맞는 종목을 찾습니다.</p>
        </div>
        <a className="btn" href="/journal?view=tree">매매일지 트리</a>
      </header>
      <TraitsBoard data={data} initialGroup={sp.g} />
    </>
  );
}
