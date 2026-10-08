import { logoutAction } from '@/app/actions';
import { Suspense } from 'react';
import { NavLink } from '@/components/client-bits';
import { QuickMemo } from '@/components/knowledge/quick-memo';
import { prisma } from '@/server/db';
import { requireUser } from '@/server/auth';
import { kstDateTime } from '@/lib/format';
import { unreadCount } from '@/server/services/notify';
import { AiLauncher } from '@/components/ai/launcher';
import { aiStatus } from '@/server/services/ai/agent';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [links, unread, sages, ai] = await Promise.all([
    prisma.brokerConnection.findMany({ where: { userId: user.id }, select: { label: true, lastSyncAt: true, lastError: true } }),
    unreadCount(user.id),
    prisma.sage.findMany({ where: { userId: user.id }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    aiStatus(user.id),
  ]);
  const failing = links.filter((l) => l.lastError);
  const lastSync = links.map((l) => l.lastSyncAt).filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0];
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
        <NavLink href="/market">실시간 시세</NavLink>
        <NavLink href="/portfolios">포트폴리오</NavLink>
        <NavLink href="/import">보유종목 가져오기</NavLink>
        <NavLink href="/transactions">거래 내역</NavLink>
        <NavLink href="/tax">세금</NavLink>
        <NavLink href="/journal">매매일지</NavLink>
        <NavLink href="/traits">자산 성질</NavLink>
        <NavLink href="/notes">투자 노트</NavLink>
        <NavLink href="/ai">AI 어드바이저</NavLink>
        <NavLink href="/alerts">
          알림
          {unread > 0 && (
            <span className="nav-badge" aria-label={`새 알림 ${unread}개`}>
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </NavLink>
        <NavLink href="/export">Export</NavLink>
        <NavLink href="/settings">연동 · 설정</NavLink>
        <div className="side-foot">
          <div>
            <div className="strong" style={{ color: 'var(--ink)' }}>증권사 연동</div>
            {links.length ? (
              failing.length ? (
                <a className="down" href="/settings">
                  {failing.map((l) => l.label).join(', ')} 오류
                </a>
              ) : (
                <span>
                  {links.length}곳 연결됨{lastSync ? ` · 확인 ${kstDateTime(lastSync).slice(5)}` : ''}
                </span>
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
      <Suspense>
        <QuickMemo />
        <AiLauncher sages={sages} configured={ai.configured} />
      </Suspense>
    </div>
  );
}
