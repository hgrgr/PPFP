import { logoutAction } from '@/app/actions';
import { NavLink } from '@/components/client-bits';
import { prisma } from '@/server/db';
import { requireUser } from '@/server/auth';
import { kstDateTime } from '@/lib/format';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const toss = await prisma.tossCredential.findUnique({ where: { userId: user.id }, select: { lastSyncAt: true, lastError: true } });
  return (
    <div className="shell">
      <nav className="sidebar" aria-label="주 메뉴">
        <div className="brand">
          <svg width="28" height="28" viewBox="0 0 64 64" aria-hidden="true">
            <rect width="64" height="64" rx="14" fill="currentColor" />
            <path d="M18 44V30M32 44V20M46 44V34" stroke="var(--surface)" strokeWidth="5" strokeLinecap="round" fill="none" />
          </svg>
          PPFP
        </div>
        <NavLink href="/dashboard">대시보드</NavLink>
        <NavLink href="/portfolios">포트폴리오</NavLink>
        <NavLink href="/transactions">거래 내역</NavLink>
        <NavLink href="/export">Export</NavLink>
        <NavLink href="/settings">연동 · 설정</NavLink>
        <div className="side-foot">
          <div>
            <div className="strong" style={{ color: 'var(--ink)' }}>토스증권</div>
            {toss ? (
              toss.lastError ? (
                <span className="down">오류: {toss.lastError}</span>
              ) : (
                <span>연결됨{toss.lastSyncAt ? ` · 확인 ${kstDateTime(toss.lastSyncAt).slice(5)}` : ''}</span>
              )
            ) : (
              <a href="/settings">연결 안 됨 — 설정하기</a>
            )}
          </div>
          <div>{user.email}</div>
          <form action={logoutAction}>
            <button className="btn small" type="submit">
              로그아웃
            </button>
          </form>
        </div>
      </nav>
      <main className="main">{children}</main>
    </div>
  );
}
