import { saveAiSettingsAction } from '@/app/ai-actions';
import { saveBookSearchKeyAction } from '@/app/knowledge-actions';
import { saveRealEstateKeyAction } from '@/app/real-estate-actions';
import { refreshDataAction, removeBrokerAction, saveBrokerAction, testBrokerAction, updatePrefsAction } from '@/app/actions';
import { BrokerConnectForm } from '@/components/broker-connect-form';
import { ActionForm, Submit } from '@/components/forms';
import { kstDateTime } from '@/lib/format';
import { BROKERS, UNSUPPORTED_BROKERS } from '@/lib/brokers';
import { requireUser } from '@/server/auth';
import { mask } from '@/server/crypto';
import { listConnections } from '@/server/services/brokers';
import { aiStatus } from '@/server/services/ai/agent';
import { keyHints } from '@/server/services/api-keys';
import { AskAiButton } from '@/components/ai/launcher';
import { AgentModelFields, AiKeyFields } from '@/components/ai/model-settings';
import { BRIEFING_PROMPT } from '@/domain/ai';

export const metadata = { title: '연동 · 설정' };
export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const user = await requireUser();
  const [connections, ai, hints] = await Promise.all([listConnections(user.id), aiStatus(user.id), keyHints(user.id)]);
  const kakaoHint = hints.get('kakao');
  const kakaoServer = !kakaoHint && !!process.env.KAKAO_REST_API_KEY;
  const molitHint = hints.get('molit');
  const molitServer = !molitHint && !!process.env.DATA_GO_KR_API_KEY;

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
        <h2>연결된 증권사 · 코인 거래소</h2>
        <p className="sub">
          증권사 Open API로 계좌 보유종목, 상장 종목 시세, 환율, 일별 종가를 조회하고, 코인 거래소 API로 코인 잔고·시세와 체결·입출금 내역을 조회합니다. 주문은 내지 않습니다.
          Secret과 접근토큰은 서버에서 암호화해 저장하며 화면이나 내보내기에 다시 표시되지 않습니다. 주식 시세는 토스 → 한국투자 → 키움 → 메리츠 → LS → DB, 코인 시세는 업비트 →
          빗썸 → 코인원 → 코빗 순으로 응답하는 곳에서 받습니다.
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
                    <td>
                      {BROKERS[c.broker].label}
                      {BROKERS[c.broker].kind === 'crypto' && <span className="sub">코인 거래소</span>}
                    </td>
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
          <h2>증권사 · 거래소 추가</h2>
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

      <section className="card" id="ai">
        <h2>AI 어드바이저</h2>
        <p className="sub">
          AI 어드바이저는 Claude(Anthropic), ChatGPT(OpenAI), Gemini(Google), Grok(xAI), DeepSeek 중 키를 넣은 곳의 모델로 답합니다. 질문할 때 필요한 보유 내역·거래·일지·투자 노트가 그
          회사의 API로 전송됩니다. 아래 금액은 토큰 사용량으로 추정한 값이며, 가격을 모르는 모델은 비싼 모델 기준으로 넉넉히 셉니다.
        </p>
        <ActionForm action={saveAiSettingsAction} className="grid">
          <AiKeyFields keys={ai.keys} />
          <AgentModelFields keys={ai.keys} picks={ai.picks} />
          <label className="field">
            월 사용 한도 (USD)
            <input name="monthlyLimit" inputMode="decimal" defaultValue={ai.monthlyLimit ?? ''} placeholder="비우면 한도 없음" />
            <span className="sub">이번 달 약 ${ai.spent.toFixed(2)} 사용 · 한도에 닿으면 다음 달까지 질문을 받지 않습니다.</span>
          </label>
          <label className="check">
            <input type="checkbox" name="webSearch" defaultChecked={ai.webSearch} /> 웹 검색 허용 (Claude 모델, 최신 실적·뉴스 확인, 검색 1회 약 $0.01)
          </label>
          <fieldset className="full ai-schedule">
            <legend className="sub strong">자동으로 받기</legend>
            <label className="check">
              <input type="checkbox" name="briefing" defaultChecked={ai.briefing} /> 아침 브리핑
            </label>
            <label className="check">
              <select name="briefingHour" defaultValue={String(ai.briefingHour)} aria-label="브리핑 시각">
                {[...new Set([5, 6, 7, 8, 9, 10, 11, 12, ai.briefingHour])].sort((a, b) => a - b).map((h) => (
                  <option key={h} value={h}>
                    {h}시
                  </option>
                ))}
              </select>
              이후 첫 확인 때
            </label>
            <label className="check">
              <input type="checkbox" name="briefingWeekdays" defaultChecked={ai.briefingWeekdays} /> 평일만
            </label>
            <label className="check">
              <input type="checkbox" name="alertAnalysis" defaultChecked={ai.alertAnalysis} /> 가격·목표 비중 알림이 오면 AI가 바로 분석
            </label>
            <span className="sub">
              브리핑은 알림함과 푸시로 오고, 누르면 AI 대화로 이어집니다. 한 번에 보통 수십~수백 원이 들며 월 사용 한도에 포함됩니다.{' '}
              <AskAiButton className="btn small" label="지금 브리핑 받아 보기" prompt={BRIEFING_PROMPT} />
            </span>
          </fieldset>
          <div className="full">
            <Submit>저장</Submit>
          </div>
        </ActionForm>
      </section>

      <section className="card" id="books">
        <h2>책 검색</h2>
        <p className="sub">
          독서 노트에서 책 제목으로 저자·출판사·출간 연도를 찾아 채웁니다. 한국 책은 카카오 책 검색으로, 영문 책은 키 없이 Open Library로 찾습니다. 검색할 때 책 제목만 보냅니다.
        </p>
        <ActionForm action={saveBookSearchKeyAction} className="grid">
          <label className="field">
            카카오 REST API 키
            <input name="kakaoKey" type="password" autoComplete="off" placeholder={kakaoHint ? `저장됨 ${kakaoHint}` : kakaoServer ? '서버 기본 키 사용 중' : '32자리 키'} />
            <span className="sub">
              {kakaoHint ? '바꾸려면 새 키를 넣으세요.' : (
                <>
                  <a href="https://developers.kakao.com/console/app" target="_blank" rel="noreferrer">카카오 developers</a>에서 앱을 만들고 앱 키의 REST API 키를 넣으세요. 무료이며 암호화해 저장합니다.
                </>
              )}
            </span>
          </label>
          {kakaoHint && (
            <label className="check">
              <input type="checkbox" name="clearKakao" /> 저장한 키 지우기
            </label>
          )}
          <div className="full">
            <Submit>저장</Submit>
          </div>
        </ActionForm>
      </section>

      <section className="card" id="real-estate">
        <h2>부동산 실거래가</h2>
        <p className="sub">
          부동산 자산에 아파트를 연결하면 국토교통부 아파트 매매 실거래가로 추정 시세와 인근 거래를 보여 줍니다. 아파트를 지도에서 찾을 때는 위 책 검색의 카카오 REST API 키를 같이 씁니다(카카오 앱에서 카카오맵 사용 설정 필요). 매물은 가져오지 않고 네이버 부동산으로 연결합니다.
        </p>
        <ActionForm action={saveRealEstateKeyAction} className="grid">
          <label className="field">
            공공데이터포털 일반 인증키
            <input name="molitKey" type="password" autoComplete="off" placeholder={molitHint ? `저장됨 ${molitHint}` : molitServer ? '서버 기본 키 사용 중' : '인증키 (Decoding 또는 Encoding)'} />
            <span className="sub">
              {molitHint ? '바꾸려면 새 키를 넣으세요.' : (
                <>
                  <a href="https://www.data.go.kr/data/15126468/openapi.do" target="_blank" rel="noreferrer">공공데이터포털 › 국토교통부 아파트 매매 실거래가 상세 자료</a>에서 활용신청(자동 승인, 무료)한 뒤 마이페이지의 일반 인증키를 넣으세요. 암호화해 저장합니다.
                </>
              )}
            </span>
          </label>
          {molitHint && (
            <label className="check">
              <input type="checkbox" name="clearMolit" /> 저장한 키 지우기
            </label>
          )}
          <div className="full">
            <Submit>저장</Submit>
          </div>
        </ActionForm>
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
