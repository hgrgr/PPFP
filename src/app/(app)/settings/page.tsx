import { importLotsAction, refreshDataAction, removeTossAction, saveTossAction, updatePrefsAction } from '@/app/actions';
import { ActionForm, Submit } from '@/components/forms';
import { kstDateTime, money, qty } from '@/lib/format';
import { requireUser } from '@/server/auth';
import { mask } from '@/server/crypto';
import { prisma } from '@/server/db';
import { UserError } from '@/server/services/portfolios';
import { reconcile, type Reconcile } from '@/server/services/sync';

export const metadata = { title: '연동 · 설정' };
export const dynamic = 'force-dynamic';

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ check?: string }> }) {
  const user = await requireUser();
  const { check } = await searchParams;
  const [cred, portfolios] = await Promise.all([
    prisma.tossCredential.findUnique({ where: { userId: user.id } }),
    prisma.portfolio.findMany({ where: { userId: user.id, archived: false }, orderBy: { createdAt: 'asc' } }),
  ]);
  let rows: Reconcile[] | null = null;
  let reconcileError: string | null = null;
  if (cred && check) {
    try {
      rows = (await reconcile(user.id)).rows;
    } catch (e) {
      reconcileError = e instanceof UserError ? e.message : '보유 종목을 비교하지 못했습니다.';
    }
  }
  const mismatches = rows?.filter((r) => !r.diff.isZero()) ?? [];

  return (
    <>
      <header className="page-head">
        <h1>연동 · 설정</h1>
      </header>

      <section className="card">
        <div className="spread">
          <h2>토스증권 OpenAPI</h2>
          {cred ? <span className="badge">연결됨 · {mask(cred.clientId)}</span> : <span className="badge warn">연결 안 됨</span>}
        </div>
        <p className="sub">
          토스증권 Open API 콘솔에서 발급한 Client ID와 Secret을 입력하세요. Secret은 서버에서 암호화해 저장하며 화면이나 내보내기에 다시 표시되지 않습니다.
          상장 종목 시세, 환율, 계좌 보유 종목 조회에만 사용하고 주문은 내지 않습니다.
        </p>
        <ActionForm action={saveTossAction} className="grid" resetOnSuccess>
          <label className="field">
            Client ID
            <input name="clientId" autoComplete="off" required defaultValue={cred?.clientId} />
          </label>
          <label className="field">
            Client Secret
            <input name="clientSecret" type="password" autoComplete="new-password" required placeholder={cred ? '변경할 때만 입력' : ''} />
          </label>
          <div className="inline full">
            <Submit pendingText="연결 확인 중…">{cred ? '다시 연결' : '연결'}</Submit>
          </div>
        </ActionForm>
        {cred && (
          <div className="inline">
            <span className="sub">
              계좌 {cred.accountSeq ? `#${cred.accountSeq.toString()}` : '없음'}
              {cred.lastSyncAt ? ` · 마지막 확인 ${kstDateTime(cred.lastSyncAt)}` : ''}
              {cred.lastError ? ` · 오류: ${cred.lastError}` : ''}
            </span>
            <ActionForm action={removeTossAction} confirm="토스증권 연결을 해제할까요? 저장된 키가 삭제됩니다.">
              <Submit className="btn small danger" pendingText="…">연결 해제</Submit>
            </ActionForm>
          </div>
        )}
      </section>

      {cred && (
        <section className="card">
          <div className="spread">
            <h2>계좌 잔고와 장부 비교</h2>
            <a className="btn" href="/settings?check=1">지금 비교</a>
          </div>
          <p className="sub">증권사 계좌의 보유 수량과 이 앱의 Lot 합계를 비교합니다. 차이는 자동으로 덮어쓰지 않고, 아래에서 직접 맞춥니다.</p>
          {reconcileError && <p className="msg err">{reconcileError}</p>}
          {rows && (
            <>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th scope="col">종목</th><th scope="col">계좌 수량</th><th scope="col">장부 수량</th><th scope="col">차이</th><th scope="col">증권사 평균단가</th></tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.symbol}>
                        <td><span className="strong">{r.name}</span><span className="sub">{r.symbol}</span></td>
                        <td>{qty(r.tossQty.toString())}</td>
                        <td>{qty(r.appQty.toString())}</td>
                        <td className={r.diff.isZero() ? 'muted' : 'strong'}>{r.diff.isZero() ? '일치' : qty(r.diff.toString())}</td>
                        <td>{r.averagePrice.isZero() ? '—' : money(r.averagePrice.toString(), r.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {mismatches.some((r) => r.diff.isPos()) && portfolios.length > 0 && (
                <ActionForm action={importLotsAction} className="stack">
                  <h3>시작 Lot 가져오기</h3>
                  <p className="sub">계좌에만 있는 수량을 증권사 평균단가로 하나의 Lot으로 만듭니다. 정확한 Lot별 취득일·단가가 필요하면 대신 과거 매수를 직접 기록하세요.</p>
                  <div className="inline">
                    {mismatches.filter((r) => r.diff.isPos()).map((r) => (
                      <label key={r.symbol} className="check">
                        <input type="checkbox" name="symbols" value={r.symbol} defaultChecked /> {r.name} +{qty(r.diff.toString())}
                      </label>
                    ))}
                  </div>
                  <label className="field" style={{ maxWidth: 320 }}>
                    넣을 포트폴리오
                    <select name="portfolioId" required>
                      {portfolios.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </label>
                  <div><Submit>가져오기</Submit></div>
                </ActionForm>
              )}
              {mismatches.some((r) => r.diff.isNeg()) && (
                <p className="callout">장부가 계좌보다 많은 종목은 다른 곳에서 매도했을 수 있습니다. 해당 종목 화면에서 매도를 기록해 맞추세요.</p>
              )}
            </>
          )}
        </section>
      )}

      <section className="row">
        <div className="card">
          <h2>표시</h2>
          <ActionForm action={updatePrefsAction} className="grid">
            <label className="field">
              이름
              <input name="name" defaultValue={user.name ?? ''} maxLength={40} />
            </label>
            <label className="field">
              손익 색상
              <select name="redUp" defaultValue={user.redUp ? '1' : '0'}>
                <option value="1">상승 빨강 · 하락 파랑</option>
                <option value="0">상승 초록 · 하락 빨강</option>
              </select>
            </label>
            <div className="full"><Submit>저장</Submit></div>
          </ActionForm>
        </div>
        <div className="card">
          <h2>데이터 다시 계산</h2>
          <p className="sub">과거 종가를 다시 받고 첫 거래일부터 일별 기록을 새로 계산합니다. 오래된 거래를 많이 고쳤을 때 쓰세요.</p>
          <ActionForm action={refreshDataAction}>
            <Submit className="btn" pendingText="계산 중… (몇 분 걸릴 수 있음)">전체 다시 계산</Submit>
          </ActionForm>
        </div>
      </section>
    </>
  );
}
