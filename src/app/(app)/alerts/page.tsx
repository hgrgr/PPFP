import { AlertForm, AlertRowActions, MarkReadButton, PushSettings } from '@/components/alerts';
import { kstDateTime, money, pct } from '@/lib/format';
import { requireUser } from '@/server/auth';
import { dec, prisma } from '@/server/db';
import { listAlerts } from '@/server/services/alerts';
import { apartmentAssets, listReAlerts } from '@/server/services/real-estate-alerts';
import { ReAlertForm, ReAlertList } from '@/components/real-estate-alerts';
import { journalAssets } from '@/server/services/journal';
import { AskAiButton } from '@/components/ai/launcher';
import { alertAgent, alertPrompt } from '@/domain/ai';

const KIND_LABEL: Record<string, string> = { PRICE: '가격', DRIFT: '목표 비중', BRIEFING: 'AI 브리핑', REALESTATE: '부동산', TEST: '테스트' };

export const metadata = { title: '알림' };
export const dynamic = 'force-dynamic';

const SOURCE_LABEL = { MANUAL: '직접', JOURNAL_TARGET: '일지 목표가', JOURNAL_STOP: '일지 손절가' } as const;

export default async function AlertsPage({ searchParams }: { searchParams: Promise<{ asset?: string }> }) {
  const user = await requireUser();
  const { asset: initialAsset } = await searchParams;
  const [alerts, inbox, assets, devices, portfolios, reAlerts, apartments] = await Promise.all([
    listAlerts(user.id),
    prisma.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 50 }),
    journalAssets(user.id),
    prisma.pushSubscription.count({ where: { userId: user.id } }),
    prisma.portfolio.findMany({ where: { userId: user.id, archived: false }, include: { _count: { select: { targets: true } } }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
    listReAlerts(user.id),
    apartmentAssets(user.id),
  ]);
  const unread = inbox.filter((n) => !n.readAt).length;
  const prices = Object.fromEntries(alerts.map((a) => [a.assetId, a.currentPrice]));
  const active = alerts.filter((a) => a.active);
  const done = alerts.filter((a) => !a.active);

  return (
    <>
      <header className="page-head">
        <div className="stack" style={{ gap: 6 }}>
          <h1>알림</h1>
          <p className="sub">가격 도달, 포트폴리오 목표 비중 이탈, 부동산 실거래, AI 아침 브리핑을 알려 줍니다. 알림은 여기 알림함에 쌓이고, 켜 둔 기기로 푸시도 보냅니다.</p>
        </div>
      </header>

      <section className="card">
        <div className="spread">
          <h2>알림함 {unread > 0 && <span className="badge warn">새 알림 {unread}</span>}</h2>
          {unread > 0 && <MarkReadButton />}
        </div>
        {inbox.length ? (
          <ul className="inbox">
            {inbox.map((n) => (
              <li key={n.id} className={n.readAt ? '' : 'unread'}>
                <span className="sub">{kstDateTime(n.createdAt)} · {KIND_LABEL[n.kind] ?? n.kind}</span>
                {n.url ? <a className="strong" href={n.url}>{n.title}</a> : <span className="strong">{n.title}</span>}
                <span style={{ whiteSpace: 'pre-line', fontSize: 13.5, color: 'var(--ink-2)' }}>{n.body}</span>
                {n.kind === 'BRIEFING' && n.aiConversationId ? (
                  <a className="btn small ai-inbox-btn" href={`/ai?c=${n.aiConversationId}`}>✦ 브리핑 전체 보기</a>
                ) : n.aiConversationId ? (
                  <a className="btn small ai-inbox-btn" href={`/ai?c=${n.aiConversationId}`}>✦ AI 분석 보기</a>
                ) : n.kind === 'PRICE' || n.kind === 'DRIFT' ? (
                  <AskAiButton className="btn small ai-inbox-btn" label="AI로 분석" agent={alertAgent(n.url)} prompt={alertPrompt(n)} />
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty">아직 받은 알림이 없습니다.</p>
        )}
      </section>

      <section className="card">
        <div className="stack" style={{ gap: 4 }}>
          <h2>가격 알림</h2>
          <p className="sub">정한 가격에 닿으면 한 번 알립니다. 매매일지의 목표 예상 가격과 손절가는 자동으로 알림이 됩니다(일지에서 끌 수 있음). 시세는 약 1분마다 확인합니다.</p>
        </div>
        <AlertForm assets={assets.map((a) => ({ id: a.id, name: a.name, symbol: a.symbol, currency: a.currency }))} prices={prices} />
        {alerts.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">종목</th>
                  <th scope="col">조건</th>
                  <th scope="col">현재가</th>
                  <th scope="col">남은 거리</th>
                  <th scope="col" className="l">출처 · 메모</th>
                  <th scope="col">상태</th>
                  <th scope="col"><span className="sr-only">작업</span></th>
                </tr>
              </thead>
              <tbody>
                {[...active, ...done].map((a) => {
                  const gap = a.currentPrice ? Number(a.price) / Number(a.currentPrice) - 1 : null;
                  return (
                    <tr key={a.id} className={a.active ? undefined : 'muted-row'}>
                      <td>
                        <span className="strong">{a.assetName}</span>
                        <span className="sub">{a.symbol}</span>
                      </td>
                      <td className="money">
                        {money(a.price, a.currency)} {a.direction === 'ABOVE' ? '이상' : '이하'}
                      </td>
                      <td className="money">{a.currentPrice ? money(a.currentPrice, a.currency) : '—'}</td>
                      <td className="muted">{gap === null || !a.active ? '—' : pct(gap, 1)}</td>
                      <td className="l" style={{ whiteSpace: 'normal', maxWidth: 260 }}>
                        <span className="badge">{SOURCE_LABEL[a.source]}</span>{' '}
                        {a.journalId ? <a href={`/journal/${a.journalId}`}>{a.journalTitle}</a> : <span className="muted">{a.note}</span>}
                      </td>
                      <td>
                        {a.active ? (
                          <span className="badge ok">대기 중</span>
                        ) : a.triggeredAt ? (
                          <span className="sub">
                            {kstDateTime(a.triggeredAt)} 도달
                            <br />@ {money(a.triggeredPrice, a.currency)}
                          </span>
                        ) : (
                          <span className="sub">꺼짐 (일지 종료)</span>
                        )}
                      </td>
                      <td>{a.source === 'MANUAL' || !a.active ? <AlertRowActions id={a.id} active={a.active} /> : <a className="sub" href={`/journal/${a.journalId}`}>일지에서 설정</a>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty">아직 가격 알림이 없습니다.</p>
        )}
      </section>

      <section className="card re-alerts" id="real-estate">
        <div className="stack" style={{ gap: 4 }}>
          <h2>부동산 알림</h2>
          <p className="sub">
            아파트를 연결한 부동산 자산의 국토교통부 실거래가를 몇 시간마다 확인해, 새 거래 신고·등기 완료·거래 해제와 토지거래허가구역 지정·해제를 알립니다. 처음 만들 때 지금 있는 거래를 기준으로 삼으므로, 그 뒤에 생긴 일만 알립니다.
          </p>
        </div>
        <ReAlertForm assets={apartments} initialAsset={initialAsset} />
        <ReAlertList alerts={reAlerts} />
      </section>

      <section className="card">
        <div className="stack" style={{ gap: 4 }}>
          <h2>목표 비중 알림</h2>
          <p className="sub">포트폴리오마다 목표 비중과 허용 오차를 정하면, 벗어날 때 알립니다. 설정은 각 포트폴리오 화면의 ‘목표 비중’에서 합니다.</p>
        </div>
        {portfolios.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th scope="col">포트폴리오</th><th scope="col">목표 항목</th><th scope="col">허용 오차</th><th scope="col">알림</th><th scope="col">지금 벗어난 항목</th></tr>
              </thead>
              <tbody>
                {portfolios.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <a className="inline strong" href={`/portfolios/${p.id}#targets`} style={{ flexWrap: 'nowrap' }}>
                        <span className="dot" style={{ background: p.color }} />
                        {p.name}
                      </a>
                    </td>
                    <td className="muted">{p._count.targets ? `${p._count.targets}개` : '없음'}</td>
                    <td>±{pct(dec(p.driftTolerance).toNumber(), 1, false)}p</td>
                    <td>{p.driftAlert ? <span className="badge ok">켜짐</span> : <span className="muted">꺼짐</span>}</td>
                    <td>{p.driftAlert ? (p.driftBreaches.length ? <span className="badge warn">{p.driftBreaches.length}개</span> : <span className="muted">없음</span>) : <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty">포트폴리오가 없습니다.</p>
        )}
      </section>

      <section className="card">
        <div className="stack" style={{ gap: 4 }}>
          <h2>푸시 알림 받을 기기</h2>
          <p className="sub">휴대폰·PC 브라우저에서 앱을 닫아 두어도 알림을 받습니다. 기기마다 한 번씩 켜세요.</p>
        </div>
        <PushSettings devices={devices} />
      </section>
    </>
  );
}
