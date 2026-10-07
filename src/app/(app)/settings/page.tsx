import { refreshDataAction, removeBrokerAction, saveBrokerAction, testBrokerAction, updatePrefsAction } from '@/app/actions';
import { BrokerConnectForm } from '@/components/broker-connect-form';
import { ActionForm, Submit } from '@/components/forms';
import { kstDateTime } from '@/lib/format';
import { BROKERS, UNSUPPORTED_BROKERS } from '@/lib/brokers';
import { requireUser } from '@/server/auth';
import { mask } from '@/server/crypto';
import { listConnections } from '@/server/services/brokers';

export const metadata = { title: '연동 · 설정' };
export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const user = await requireUser();
  const connections = await listConnections(user.id);

  return (
    <>
      <header className="page-head">
        <h1>연동 · 설정</h1>
        {connections.length > 0 && (
          <a className="btn primary" href="/import">
            보유종목 가져오기
          </a>
        )}
      </header>

      <section className="card">
        <h2>연결된 증권사</h2>
        <p className="sub">
          증권사 Open API로 계좌 보유종목, 상장 종목 시세, 환율, 일별 종가를 조회합니다. 주문은 내지 않습니다. Secret과 접근토큰은 서버에서 암호화해 저장하며 화면이나 내보내기에
          다시 표시되지 않습니다. 시세는 연결된 증권사 중 토스 → 한국투자 → 키움 → 메리츠 → LS → DB 순으로 응답하는 곳에서 받습니다.
        </p>
        {connections.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">이름</th>
                  <th scope="col">증권사</th>
                  <th scope="col">앱키 · 계좌</th>
                  <th scope="col">상태</th>
                  <th scope="col">
                    <span className="sr-only">작업</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {connections.map((c) => (
                  <tr key={c.id}>
                    <td className="strong">
                      {c.label} {c.paper && <span className="badge">모의</span>}
                    </td>
                    <td>{BROKERS[c.broker].label}</td>
                    <td className="muted">
                      {mask(c.appKey)}
                      {c.accountNo ? ` · ${c.broker === 'TOSS' ? '#' : ''}${c.accountNo}` : ''}
                    </td>
                    <td>
                      {c.lastError ? (
                        <span className="down">오류: {c.lastError}</span>
                      ) : (
                        <span className="muted">정상{c.lastSyncAt ? ` · ${kstDateTime(c.lastSyncAt)}` : ''}</span>
                      )}
                    </td>
                    <td>
                      <div className="inline" style={{ justifyContent: 'flex-end' }}>
                        <ActionForm action={testBrokerAction}>
                          <input type="hidden" name="id" value={c.id} />
                          <Submit className="btn small" pendingText="확인 중…">
                            연결 확인
                          </Submit>
                        </ActionForm>
                        <ActionForm action={removeBrokerAction} confirm={`${c.label} 연결을 해제할까요? 저장된 키와 토큰이 삭제됩니다. 이미 가져온 Lot은 그대로 남습니다.`}>
                          <input type="hidden" name="id" value={c.id} />
                          <Submit className="btn small danger" pendingText="…">
                            해제
                          </Submit>
                        </ActionForm>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty">아직 연결된 증권사가 없습니다. 아래에서 추가하세요.</p>
        )}
      </section>

      <section className="row">
        <div className="card wide">
          <h2>증권사 추가</h2>
          <BrokerConnectForm action={saveBrokerAction} />
          <p className="sub">키를 바꾸려면 새로 추가한 뒤 예전 연결을 해제하세요. 같은 계좌로 가져온 Lot 기록은 이어집니다.</p>
        </div>
        <div className="card">
          <h2>API가 없는 증권사</h2>
          <p className="sub">아래 증권사는 웹 서버에서 호출할 수 있는 Open API가 없습니다. 앱의 잔고 화면을 복사해 붙여넣거나 잔고 파일(CSV·엑셀)을 올려 가져오세요.</p>
          <ul className="stack" style={{ paddingLeft: 18, margin: 0, gap: 6 }}>
            {UNSUPPORTED_BROKERS.map((b) => (
              <li key={b.label} className="sub">
                <span className="strong">{b.label}</span> — {b.reason}
              </li>
            ))}
          </ul>
          <div>
            <a className="btn" href="/import#paste">
              잔고 붙여넣기로 가져오기
            </a>
          </div>
        </div>
      </section>

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
            <div className="full">
              <Submit>저장</Submit>
            </div>
          </ActionForm>
        </div>
        <div className="card">
          <h2>데이터 다시 계산</h2>
          <p className="sub">과거 종가를 다시 받고 첫 거래일부터 일별 기록을 새로 계산합니다. 오래된 거래를 많이 고쳤을 때 쓰세요.</p>
          <ActionForm action={refreshDataAction}>
            <Submit className="btn" pendingText="계산 중… (몇 분 걸릴 수 있음)">
              전체 다시 계산
            </Submit>
          </ActionForm>
        </div>
      </section>
    </>
  );
}
