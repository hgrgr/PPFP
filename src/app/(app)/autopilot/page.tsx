import { KillSwitch, OrderButtons, PolicyForm, PolicyHaltButton, StepUpForm } from '@/components/autopilot/controls';
import { RULE_LABEL } from '@/domain/autopilot';
import { kstDateTime, krwShort, money, qty } from '@/lib/format';
import { requireUser } from '@/server/auth';
import { autopilotOverview } from '@/server/services/autopilot';

export const metadata = { title: 'AI 운용' };
export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<string, string> = {
  PENDING_APPROVAL: '승인 대기',
  BLOCKED: '막힘',
  DISMISSED: '거절',
  EXPIRED: '만료',
  SUBMITTING: '전송 중',
  SUBMITTED: '미체결',
  PARTIAL: '부분 체결',
  FILLED: '체결',
  CANCELLED: '취소',
  REJECTED: '증권사 거부',
  UNKNOWN: '결과 확인 중',
};
const STATUS_TONE: Record<string, string> = { PENDING_APPROVAL: 'warn', BLOCKED: 'warn', FILLED: 'ok', UNKNOWN: 'warn', REJECTED: 'warn' };

export default async function AutopilotPage() {
  const user = await requireUser();
  const o = await autopilotOverview(user.id);
  const levelOf = new Map(o.policies.map((p) => [p.name, p.level]));

  return (
    <>
      <p className="callout">실험 기능 — 아직 메뉴에 없고 동작이 바뀔 수 있습니다. 지금은 페이퍼(가상 계좌) 운용만 되고, 실제 증권사로 주문을 보내지 않습니다.</p>

      <header className="page-head">
        <div className="stack" style={{ gap: 6 }}>
          <h1>
            AI 운용{' '}
            {o.haltedAt ? <span className="badge warn">정지됨</span> : o.policies.length ? <span className="badge ok">운용 중</span> : null}{' '}
            {o.pendingCount > 0 && <span className="badge warn">승인 대기 {o.pendingCount}</span>}
          </h1>
          <p className="sub">AI에게 맡길 범위를 정책으로 정합니다. 모든 주문은 보내기 전에 허용 종목, 한도, 거래 시간, 손실 정지선 검사를 통과해야 하고, 하나라도 걸리면 막힙니다.</p>
        </div>
        <KillSwitch halted={!!o.haltedAt} />
      </header>

      {o.haltedAt && (
        <p className="msg err">
          {kstDateTime(o.haltedAt)}부터 전체 정지 중입니다{o.haltReason ? ` (${o.haltReason})` : ''}. 새 주문은 모두 막힙니다. 정지를 풀려면 아래에서 비밀번호를 다시 확인하세요.
        </p>
      )}

      {o.policies.length ? (
        <div className="row">
          {o.policies.map((p) => (
            <section key={p.id} className="card stack">
              <div className="spread">
                <div className="stack" style={{ gap: 2 }}>
                  <h2>
                    {p.name} {p.haltedAt && <span className="badge warn">정지</span>}
                  </h2>
                  <span className="sub">
                    {p.portfolioName} · {p.connection ?? '계좌 연결 없음'} · 버전 {p.version}
                  </span>
                </div>
                <PolicyHaltButton policyId={p.id} halted={!!p.haltedAt} />
              </div>
              <div className="row">
                <div className="kpi">
                  <div className="label">위임 단계</div>
                  <div className="value">{p.levelLabel}</div>
                  <div className="note">{p.modeLabel}</div>
                </div>
                <div className="kpi">
                  <div className="label">오늘 한도 사용</div>
                  <div className="value">{krwShort(p.usedAmount)}</div>
                  <div className="note">
                    하루 {krwShort(p.maxDaily)} 중 · {p.usedOrders}/{p.maxDailyOrders}건 (승인 대기 포함)
                  </div>
                </div>
              </div>
              {p.haltReason && <p className="msg err">정지 사유: {p.haltReason}</p>}
              <ul className="plain-list sub">
                {p.summary.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <section className="card">
          <p className="empty">아직 운용 정책이 없습니다. 아래에서 페이퍼 정책을 만들면 AI가 그 안에서만 주문을 제안합니다.</p>
        </section>
      )}

      <section className="card stack">
        <h2>최근 주문 의도</h2>
        {o.orders.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col" className="l">시각 · 정책</th>
                  <th scope="col" className="l">종목</th>
                  <th scope="col">수량 × 지정가</th>
                  <th scope="col">상태</th>
                  <th scope="col" className="l">사전검증</th>
                  <th scope="col"><span className="sr-only">작업</span></th>
                </tr>
              </thead>
              <tbody>
                {o.orders.map((r) => {
                  const failed = r.checks.filter((c) => !c.ok);
                  return (
                    <tr key={r.id}>
                      <td className="l">
                        <span className="sub">{kstDateTime(r.createdAt)}</span>
                        <br />
                        {r.policyName} <span className="badge muted">{r.mode === 'PAPER' ? '페이퍼' : '실전'}</span>
                      </td>
                      <td className="l">
                        <span className={r.side === 'BUY' ? 'up' : 'down'}>{r.side === 'BUY' ? '매수' : '매도'}</span> <span className="mono">{r.symbol}</span>
                      </td>
                      <td>
                        {qty(r.qty)} × {r.limitPrice ? money(r.limitPrice, 'KRW') : '-'}
                        {r.avgFillPrice && <div className="sub">체결 {qty(r.filledQty)} @ {money(r.avgFillPrice, 'KRW')}</div>}
                      </td>
                      <td>
                        <span className={`badge ${STATUS_TONE[r.status] ?? ''}`}>{STATUS_LABEL[r.status] ?? r.status}</span>
                      </td>
                      <td className="l">
                        {r.checks.length === 0 ? (
                          <span className="sub">검사 기록 없음</span>
                        ) : failed.length === 0 ? (
                          <span className="sub">{r.checks.length}개 항목 모두 통과</span>
                        ) : (
                          <ul className="plain-list">
                            {failed.map((c) => (
                              <li key={c.rule} className={c.level === 'block' ? undefined : 'sub'} style={c.level === 'block' ? { color: 'var(--danger)', fontSize: 13 } : undefined}>
                                {c.level === 'block' ? '✕' : '!'} {RULE_LABEL[c.rule] ?? c.rule}: {c.message}
                              </li>
                            ))}
                          </ul>
                        )}
                        {r.error && failed.length === 0 && <div className="sub">{r.error}</div>}
                      </td>
                      <td>{r.status === 'PENDING_APPROVAL' && <OrderButtons orderId={r.id} executable={levelOf.get(r.policyName) !== 'SUGGEST'} />}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty">아직 주문 의도가 없습니다. AI가 정책 안에서 주문을 제안하면 검사 결과와 함께 여기에 쌓입니다.</p>
        )}
      </section>

      <section className="card stack">
        <div className="stack" style={{ gap: 4 }}>
          <h2>비밀번호 다시 확인</h2>
          <p className="sub">주문 실행, 단계 올리기, 정지 풀기는 비밀번호를 다시 넣은 뒤 10분 동안만 할 수 있습니다. 멈추기와 단계 내리기는 언제든 바로 됩니다.</p>
        </div>
        <StepUpForm />
      </section>

      <section className="card stack" id="new-policy">
        <h2>{o.policies.length ? '정책 추가' : '첫 정책 만들기'}</h2>
        <PolicyForm portfolios={o.freePortfolios} />
        <p className="sub">
          새 정책은 모두 페이퍼로 시작합니다. 시장가, 신용·미수, 공매도, 허용 목록 밖 종목, 거래대금이 적은 종목은 정책과 상관없이 막힙니다. 페이퍼 체결은 현재가에 슬리피지만 더한 낙관적 추정이며, AI 판단은 손실을 낼 수 있고 책임은 사용자에게 있습니다.
        </p>
      </section>
    </>
  );
}
