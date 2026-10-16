import { Suspense } from 'react';
import { VirtualPortfolios } from '@/components/virtual';
import { requireUser } from '@/server/auth';

export const metadata = { title: '가상 포트폴리오' };
export const dynamic = 'force-dynamic';

export default async function VirtualPage() {
  await requireUser();
  return (
    <>
      <header className="page-head">
        <div className="stack" style={{ gap: 6 }}>
          <h1>가상 포트폴리오</h1>
          <p className="sub">갖고 있지 않은 자산을 과거 날짜에 담아 보는 연습용 포트폴리오입니다. 실제 보유 자산·거래 내역과 섞이지 않습니다.</p>
        </div>
        <div className="inline">
          <a className="btn" href="/portfolios">‹ 포트폴리오</a>
        </div>
      </header>
      <Suspense fallback={<p className="empty">불러오는 중…</p>}>
        <VirtualPortfolios />
      </Suspense>
    </>
  );
}
