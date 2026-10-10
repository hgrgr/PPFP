import { addLoanRateAction, deleteLoanAction, saveFinancialProfileAction, saveLoanAction } from '@/app/net-worth-actions';
import { ActionForm, Submit } from '@/components/forms';
import { BalanceSide } from '@/components/net-worth/balance-side';
import { LIABILITY_KINDS, REPAYMENT_LABEL } from '@/domain/net-worth';
import { krw, krwShort } from '@/lib/format';
import { requireUser } from '@/server/auth';
import { kstDate } from '@/server/db';
import { getFinancialProfile, loanCandidates, loanViews, netWorthView } from '@/server/services/net-worth';
import { userGraph } from '@/server/services/portfolios';

export const metadata = { title: '순자산 · 부채' };
export const dynamic = 'force-dynamic';

const pct1 = (v: number | null) => (v === null ? '—' : `${(v * 100).toFixed(1)}%`);
const rate2 = (v: number | null) => (v === null ? '—' : `${(v * 100).toFixed(2)}%`);
const RATE_TYPE: Record<string, string> = { FIXED: '고정', VARIABLE: '변동', MIXED: '혼합' };

export default async function NetWorthPage() {
  const user = await requireUser();
  const today = kstDate();
  const [{ sheet, stale }, debt, candidates, graph, profile] = await Promise.all([
    netWorthView(user.id),
    loanViews(user.id, today),
    loanCandidates(user.id),
    userGraph(user.id),
    getFinancialProfile(user.id),
  ]);
  const assets = sheet.groups.filter((g) => g.side === 'ASSET');
  const liabilities = sheet.groups.filter((g) => g.side === 'LIABILITY');
  const thisMonth = debt.loans.filter((l) => !l.lent).reduce((s, l) => s + (l.status.thisMonth?.payment ?? 0), 0);

  return (
    <>
      <header className="page-head">
        <div className="stack" style={{ gap: 6 }}>
          <h1>순자산 · 부채</h1>
          <p className="sub">모든 포트폴리오의 자산과 현금, 대출과 보증금을 한 장의 재무상태표로 봅니다. 포트폴리오는 한 번씩만 셉니다.</p>
        </div>
      </header>

      <div className="callout" role="note">
        실험 기능 — 아직 메뉴에 없고 동작이 바뀔 수 있습니다.
      </div>

      <section className="row" aria-label="요약">
        <div className="card kpi">
          <div className="label">순자산</div>
          <div className="value money">{krw(sheet.netWorth)}</div>
          <div className="note">총자산 − 총부채{stale ? ' · 일부 시세 지연' : ''}</div>
        </div>
        <div className="card kpi">
          <div className="label">총자산</div>
          <div className="value money">{krw(sheet.assets)}</div>
          <div className="note">현금·예적금·투자·부동산·보증금 등</div>
        </div>
        <div className="card kpi">
          <div className="label">총부채</div>
          <div className="value money">{krw(sheet.liabilities)}</div>
          <div className="note">
            이번 달 상환 예정 <span className="money">{krwShort(thisMonth)}</span>
          </div>
        </div>
        <div className="card kpi">
          <div className="label">부채비율 (부채 / 총자산)</div>
          <div className={`value ${sheet.debtToAssets !== null && sheet.debtToAssets > 0.6 ? 'warn-text' : ''}`}>{pct1(sheet.debtToAssets)}</div>
          <div className="note">
            부채 / 순자산 {pct1(sheet.debtToEquity)} · 가중평균 금리 {rate2(debt.loans.length ? debt.weightedRate : null)}
          </div>
        </div>
      </section>

      <section className="row" aria-label="재무상태표">
        <BalanceSide title="자산" groups={assets} total={sheet.assets} />
        <BalanceSide title="부채" groups={liabilities} total={sheet.liabilities} />
      </section>

      <section className="card stack" aria-label="부채별 상환 일정">
        <div className="spread">
          <h2>부채별 상환 일정</h2>
          <span className="sub">
            12개월 원리금 <span className="money">{krwShort(debt.debtService)}</span>
            {debt.hasIncome ? ` · DSR ${pct1(debt.dsr)}` : ' · 연소득을 넣으면 DSR을 보여 줍니다'}
          </span>
        </div>
        {debt.loans.length === 0 && debt.missing.length === 0 ? (
          <p className="empty">등록된 부채가 없습니다. 보유 자산에서 부채를 추가한 뒤 여기서 대출 조건을 넣으세요.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>부채</th>
                  <th>장부 잔액</th>
                  <th>금리</th>
                  <th>이번 달 상환액</th>
                  <th>다음 납입</th>
                  <th>남은 원금 (추정)</th>
                  <th>낸 이자</th>
                  <th>남은 이자</th>
                  <th>만기</th>
                  <th>진행률</th>
                </tr>
              </thead>
              <tbody>
                {debt.loans.map((l) => (
                  <tr key={l.id}>
                    <td>
                      {l.holdingId ? <a className="strong" href={`/holdings/${l.holdingId}`}>{l.name}</a> : <span className="strong">{l.name}</span>}
                      <span className="sub">
                        {l.lent ? '빌려준 돈 · ' : ''}
                        {l.kindLabel ? `${l.kindLabel} · ` : ''}
                        {REPAYMENT_LABEL[l.method]}
                        {l.graceMonths ? ` · 거치 ${l.graceMonths}개월` : ''}
                        {l.lender ? ` · ${l.lender}` : ''}
                      </span>
                    </td>
                    <td className="money">{l.ledgerBalance === null ? '—' : krwShort(l.ledgerBalance)}</td>
                    <td>
                      {rate2(l.rate)}
                      <span className="sub">{RATE_TYPE[l.rateType] ?? l.rateType}</span>
                    </td>
                    <td className="money">{l.status.thisMonth ? krw(l.status.thisMonth.payment) : '—'}</td>
                    <td>
                      {l.status.next ? l.status.next.dueDate : '—'}
                      {l.status.next && <span className="sub money">{krw(l.status.next.payment)}</span>}
                    </td>
                    <td className="money">{l.schedule.length ? krwShort(l.status.remaining) : '—'}</td>
                    <td className="money">{l.schedule.length ? krwShort(l.status.paidInterest) : '—'}</td>
                    <td className="money">{l.schedule.length ? krwShort(l.status.remainingInterest) : '—'}</td>
                    <td>{l.maturityDate ?? '—'}</td>
                    <td>{l.schedule.length ? pct1(l.status.progress) : '—'}</td>
                  </tr>
                ))}
                {debt.missing.map((m) => (
                  <tr key={m.assetId}>
                    <td>
                      <a className="strong" href={`/holdings/${m.holdingId}`}>{m.name}</a> <span className="badge warn">조건 미입력</span>
                    </td>
                    <td className="money">{krwShort(m.balance)}</td>
                    <td colSpan={8} className="muted l">아래에서 대출 조건을 넣으면 상환 일정과 이자를 계산합니다.</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="sub">
          상환 일정은 원금·금리·만기로 계산한 추정값이라 은행 청구액과 몇 원~몇 백 원 다를 수 있습니다. 마이너스통장과 수기 대출은 일정 없이 잔액만 보여 줍니다. 대출 심사나 투자 자문이 아닙니다.
        </p>
      </section>

      <section className="card stack">
        <details open={debt.missing.length > 0 && debt.loans.length === 0}>
          <summary>대출 조건 넣기</summary>
          {candidates.targets.length === 0 ? (
            <p className="sub">조건을 붙일 부채 자산이 없습니다. 보유 자산 화면에서 유형을 &lsquo;부채&rsquo;로 골라 먼저 추가하세요.</p>
          ) : (
            <ActionForm action={saveLoanAction} className="grid" resetOnSuccess>
              <label className="field">
                부채 자산
                <select name="assetId" required>
                  {candidates.targets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                      {a.type === 'ALTERNATIVE' ? ' (빌려준 돈)' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                종류
                <select name="kind" defaultValue="">
                  <option value="">고르지 않음</option>
                  {Object.entries(LIABILITY_KINDS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                  <option value="RECEIVABLE">빌려준 돈 (받을 돈)</option>
                </select>
              </label>
              <label className="field">
                상환 방식
                <select name="method" defaultValue="AMORTIZING">
                  {Object.entries(REPAYMENT_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                대출 원금 (원)
                <input name="principal" inputMode="numeric" placeholder="300000000" required />
              </label>
              <label className="field">
                금리 (연 %)
                <input name="rate" inputMode="decimal" placeholder="4.2" required />
              </label>
              <label className="field">
                금리 유형
                <select name="rateType" defaultValue="FIXED">
                  {Object.entries(RATE_TYPE).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                대출 시작일
                <input name="startDate" type="date" required />
              </label>
              <label className="field">
                만기일
                <input name="maturityDate" type="date" />
              </label>
              <label className="field">
                거치 기간 (개월)
                <input name="graceMonths" inputMode="numeric" placeholder="0" />
              </label>
              <label className="field">
                납입일 (매월)
                <input name="paymentDay" inputMode="numeric" placeholder="시작일과 같은 날" />
              </label>
              <label className="field">
                금융사
                <input name="lender" maxLength={60} placeholder="○○은행" />
              </label>
              <label className="field">
                납입 포트폴리오
                <select name="payFromId" defaultValue="">
                  <option value="">앱 밖의 돈</option>
                  {graph.portfolios.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                담보
                <select name="collateralId" defaultValue="">
                  <option value="">없음</option>
                  {candidates.collaterals.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </label>
              <div className="full">
                <Submit>대출 조건 저장</Submit>
              </div>
            </ActionForm>
          )}
        </details>

        {debt.loans.length > 0 && (
          <details>
            <summary>금리 바꾸기 · 조건 지우기</summary>
            <div className="stack">
              <ActionForm action={addLoanRateAction} className="grid" resetOnSuccess>
                <label className="field">
                  대출
                  <select name="loanId" required>
                    {debt.loans.map((l) => (
                      <option key={l.id} value={l.id}>{l.name}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  적용일
                  <input name="from" type="date" defaultValue={today} required />
                </label>
                <label className="field">
                  새 금리 (연 %)
                  <input name="rate" inputMode="decimal" required />
                </label>
                <div>
                  <Submit className="btn">금리 반영</Submit>
                </div>
              </ActionForm>
              <ActionForm action={deleteLoanAction} className="grid" confirm="대출 조건을 지울까요? 부채 자산과 거래 내역은 남습니다.">
                <label className="field">
                  조건을 지울 대출
                  <select name="loanId" required>
                    {debt.loans.map((l) => (
                      <option key={l.id} value={l.id}>{l.name}</option>
                    ))}
                  </select>
                </label>
                <div>
                  <Submit className="btn danger">조건 지우기</Submit>
                </div>
              </ActionForm>
            </div>
          </details>
        )}

        <details>
          <summary>재무 프로필 (DSR·비상자금 계산용)</summary>
          <ActionForm action={saveFinancialProfileAction} className="grid">
            <label className="field">
              연소득 (세전, 원)
              <input name="annualIncome" inputMode="numeric" defaultValue={profile?.annualIncome?.toString() ?? ''} />
            </label>
            <label className="field">
              출생연도
              <input name="birthYear" inputMode="numeric" defaultValue={profile?.birthYear ?? ''} />
            </label>
            <label className="field">
              은퇴 나이
              <input name="retireAge" inputMode="numeric" defaultValue={profile?.retireAge ?? ''} />
            </label>
            <label className="field">
              지역
              <select name="region" defaultValue={profile?.region ?? ''}>
                <option value="">입력 안 함</option>
                <option value="CAPITAL">수도권</option>
                <option value="OTHER">그 밖의 지역</option>
              </select>
            </label>
            <label className="field">
              비상자금 목표 (개월)
              <input name="emergencyMonths" inputMode="numeric" defaultValue={profile?.emergencyMonths ?? 6} />
            </label>
            <label className="check" style={{ alignSelf: 'end' }}>
              <input type="checkbox" name="shareWithAi" defaultChecked={profile?.shareWithAi ?? false} /> 소득·대출 조건을 AI 어드바이저와 공유
            </label>
            <div className="full">
              <Submit>프로필 저장</Submit>
            </div>
          </ActionForm>
        </details>
      </section>
    </>
  );
}
