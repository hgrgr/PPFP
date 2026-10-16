import { saveAiSettingsAction } from '@/app/ai-actions';
import { saveBookSearchKeyAction } from '@/app/knowledge-actions';
import { saveRealEstateKeyAction } from '@/app/real-estate-actions';
import { saveVworldKeyAction } from '@/app/alert-actions';
import { propertyKindShort, rtmsPortalUrl, TRADE_KINDS } from '@/domain/real-estate';
import { FunToggle } from '@/components/fun';
import { saveDartKeyAction, saveFredKeyAction, saveKosisKeyAction, saveRoneKeyAction } from '@/app/analysis-actions';
import { saveEcosKeyAction } from '@/app/benchmark-actions';
import { refreshDataAction, removeBrokerAction, saveBrokerAction, saveMenuAction, testBrokerAction, updatePrefsAction } from '@/app/actions';
import { NAV_ITEMS } from '@/domain/nav';
import { BrokerConnectForm } from '@/components/broker-connect-form';
import { KeyBackup } from '@/components/key-backup';
import { Devices, Invites, PasswordChange, TwoStep } from '@/components/account-security';
import { ActionForm, Submit } from '@/components/forms';
import { kstDateTime } from '@/lib/format';
import { BROKERS, UNSUPPORTED_BROKERS } from '@/lib/brokers';
import { currentSessionId, requireUser } from '@/server/auth';
import { mask } from '@/server/crypto';
import { listConnections } from '@/server/services/brokers';
import { aiStatus } from '@/server/services/ai/agent';
import { keyHints } from '@/server/services/api-keys';
import { listDevices, listInvites, securityEvents, signupMode } from '@/server/services/security';
import { prisma } from '@/server/db';
import { SIGNUP_MODE_LABEL } from '@/domain/security';
import { AskAiButton } from '@/components/ai/launcher';
import { AgentModelFields, AiKeyFields } from '@/components/ai/model-settings';
import { BRIEFING_PROMPT } from '@/domain/ai';

export const metadata = { title: '연동 · 설정' };
export const dynamic = 'force-dynamic';

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ recovery?: string }> }) {
  const user = await requireUser();
  const sid = await currentSessionId();
  const [connections, ai, hints, devices, invites, events, sec, { recovery }] = await Promise.all([
    listConnections(user.id),
    aiStatus(user.id),
    keyHints(user.id),
    listDevices(user.id, sid),
    listInvites(user.id),
    securityEvents(user.id),
    prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { totpEnabledAt: true, recoveryCodes: true } }),
    searchParams,
  ]);
  const mode = signupMode();
  const kakaoHint = hints.get('kakao');
  const kakaoServer = !kakaoHint && !!process.env.KAKAO_REST_API_KEY;
  const molitHint = hints.get('molit');
  const molitServer = !molitHint && !!process.env.DATA_GO_KR_API_KEY;
  const vworldHint = hints.get('vworld');
  const vworldServer = !vworldHint && !!process.env.VWORLD_API_KEY;
  const ecosHint = hints.get('ecos');
  const ecosServer = !ecosHint && !!process.env.ECOS_API_KEY;
  const kosisHint = hints.get('kosis');
  const kosisServer = !kosisHint && !!process.env.KOSIS_API_KEY;
  const roneHint = hints.get('rone');
  const roneServer = !roneHint && !!process.env.RONE_API_KEY;
  const dartHint = hints.get('dart');
  const dartServer = !dartHint && !!process.env.DART_API_KEY;
  const fredHint = hints.get('fred');
  const fredServer = !fredHint && !!process.env.FRED_API_KEY;

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
          부동산 자산을 실거래가에 연결하면 국토교통부 매매 실거래가로 시세와 인근 거래를 보여 줍니다. 아파트·빌라·오피스텔은 그 건물의 거래로 추정 시세를, 단독·토지·상가는 지번이 가려져 나와 같은 동 거래의 ㎡당 가격으로 참고 시세를 냅니다. 지도에서 찾을 때는 위 책 검색의 카카오 REST API 키를 같이 씁니다(카카오 앱에서 카카오맵 사용 설정 필요). 매물은 가져오지 않고 네이버 부동산으로 연결합니다.
        </p>
        <p className="sub">
          공공데이터포털에서 쓰려는 종류마다 따로 활용신청해야 합니다(자동 승인, 무료, 같은 인증키):{' '}
          {TRADE_KINDS.map((k, i) => (
            <span key={k}>
              {i > 0 && ' · '}
              <a href={rtmsPortalUrl(k)} target="_blank" rel="noreferrer">{propertyKindShort(k)}</a>
            </span>
          ))}
        </p>
        <ActionForm action={saveRealEstateKeyAction} className="grid">
          <label className="field">
            공공데이터포털 일반 인증키
            <input name="molitKey" type="password" autoComplete="off" placeholder={molitHint ? `저장됨 ${molitHint}` : molitServer ? '서버 기본 키 사용 중' : '인증키 (Decoding 또는 Encoding)'} />
            <span className="sub">
              {molitHint ? '바꾸려면 새 키를 넣으세요.' : (
                <>
                  위 종류 가운데 쓸 것을 활용신청한 뒤 공공데이터포털 마이페이지의 일반 인증키를 넣으세요. 암호화해 저장합니다.
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
        <ActionForm action={saveVworldKeyAction} className="grid">
          <label className="field">
            브이월드 인증키 (토지거래허가구역 알림)
            <input name="vworldKey" type="password" autoComplete="off" placeholder={vworldHint ? `저장됨 ${vworldHint}` : vworldServer ? '서버 기본 키 사용 중' : '인증키'} />
            <span className="sub">
              {vworldHint ? '바꾸려면 새 키를 넣으세요.' : (
                <>
                  <a href="https://www.vworld.kr/dev/v4dv_2ddataguide_s001.do" target="_blank" rel="noreferrer">공간정보 오픈플랫폼(브이월드)</a>에서 인증키를 발급받아 넣으세요(무료). <a href="/alerts#real-estate">부동산 알림</a>의 토지거래허가구역 지정·해제에만 씁니다.
                </>
              )}
            </span>
          </label>
          {vworldHint && (
            <label className="check">
              <input type="checkbox" name="clearVworld" /> 저장한 키 지우기
            </label>
          )}
          <div className="full">
            <Submit>저장</Submit>
          </div>
        </ActionForm>
        <ActionForm action={saveEcosKeyAction} className="grid" aria-label="한국은행 ECOS 인증키">
          <label className="field" id="ecos">
            한국은행 ECOS 인증키 (성과 분석·분석 지표의 한국 통계)
            <input name="ecosKey" type="password" autoComplete="off" placeholder={ecosHint ? `저장됨 ${ecosHint}` : ecosServer ? '서버 기본 키 사용 중' : '인증키'} />
            <span className="sub">
              {ecosHint ? '바꾸려면 새 키를 넣으세요.' : (
                <>
                  <a href="https://ecos.bok.or.kr/api/#/AuthKeyApply" target="_blank" rel="noreferrer">한국은행 경제통계시스템(ECOS) Open API</a>에서 인증키를 신청해 넣으세요(무료). <a href="/performance#benchmarks">성과 분석</a>의 한국 소비자물가·M2 통화량·아파트 가격지수 벤치마크와 <a href="/analysis">분석 지표</a>의 한국 금리·가계부채·PIR·공급 지표에 씁니다.
                </>
              )}
            </span>
          </label>
          {ecosHint && (
            <label className="check">
              <input type="checkbox" name="clearEcos" /> 저장한 키 지우기
            </label>
          )}
          <div className="full">
            <Submit>저장</Submit>
          </div>
        </ActionForm>
        <ActionForm action={saveKosisKeyAction} className="grid" aria-label="통계청 KOSIS 인증키">
          <label className="field" id="kosis">
            통계청 KOSIS 인증키 (분석 지표의 지역 인구)
            <input name="kosisKey" type="password" autoComplete="off" placeholder={kosisHint ? `저장됨 ${kosisHint}` : kosisServer ? '서버 기본 키 사용 중' : '인증키'} />
            <span className="sub">
              {kosisHint ? '바꾸려면 새 키를 넣으세요.' : (
                <>
                  <a href="https://kosis.kr/openapi/index/index.jsp" target="_blank" rel="noreferrer">KOSIS 공유서비스(Open API)</a>에서 회원가입 후 인증키를 발급받아 넣으세요(무료). <a href="/analysis">분석 지표</a>의 지역·연령별 인구에 씁니다.
                </>
              )}
            </span>
          </label>
          {kosisHint && (
            <label className="check">
              <input type="checkbox" name="clearKosis" /> 저장한 키 지우기
            </label>
          )}
          <div className="full">
            <Submit>저장</Submit>
          </div>
        </ActionForm>
        <ActionForm action={saveRoneKeyAction} className="grid" aria-label="한국부동산원 R-ONE 인증키">
          <label className="field" id="rone">
            한국부동산원 R-ONE 인증키 (분석 지표의 수급동향·전세가율·거래량)
            <input name="roneKey" type="password" autoComplete="off" placeholder={roneHint ? `저장됨 ${roneHint}` : roneServer ? '서버 기본 키 사용 중' : '인증키'} />
            <span className="sub">
              {roneHint ? '바꾸려면 새 키를 넣으세요.' : (
                <>
                  <a href="https://www.reb.or.kr/r-one/portal/openapi/openApiIntroPage.do" target="_blank" rel="noreferrer">한국부동산원 부동산통계정보시스템(R-ONE) Open API</a>에서 인증키를 신청해 넣으세요(무료). <a href="/analysis">분석 지표</a>의 매매·전세 수급동향, 전세가율, 아파트 거래량에 씁니다.
                </>
              )}
            </span>
          </label>
          {roneHint && (
            <label className="check">
              <input type="checkbox" name="clearRone" /> 저장한 키 지우기
            </label>
          )}
          <div className="full">
            <Submit>저장</Submit>
          </div>
        </ActionForm>

        <ActionForm action={saveDartKeyAction} className="grid" aria-label="OpenDART 인증키">
          <label className="field" id="dart">
            금융감독원 OpenDART 인증키 (종목 분석의 한국 종목)
            <input name="dartKey" type="password" autoComplete="off" placeholder={dartHint ? `저장됨 ${dartHint}` : dartServer ? '서버 기본 키 사용 중' : '인증키 40자'} />
            <span className="sub">
              {dartHint ? '바꾸려면 새 키를 넣으세요.' : (
                <>
                  <a href="https://opendart.fss.or.kr" target="_blank" rel="noreferrer">OpenDART</a>의 인증키 신청에서 발급받아 넣으세요(무료). <a href="/stocks">종목 분석</a>에서 한국 종목의 재무제표·공시·임원 소유 변동을 봅니다.
                </>
              )}
            </span>
          </label>
          {dartHint && (
            <label className="check">
              <input type="checkbox" name="clearDart" /> 저장한 키 지우기
            </label>
          )}
          <div className="full">
            <Submit>저장</Submit>
          </div>
        </ActionForm>
        <ActionForm action={saveFredKeyAction} className="grid" aria-label="FRED API 키">
          <label className="field" id="fred">
            FRED API 키 (경제 지표 일정 · 내 지표 시트)
            <input name="fredKey" type="password" autoComplete="off" placeholder={fredHint ? `저장됨 ${fredHint}` : fredServer ? '서버 기본 키 사용 중' : 'API 키 32자'} />
            <span className="sub">
              {fredHint ? '바꾸려면 새 키를 넣으세요.' : (
                <>
                  <a href="https://fredaccount.stlouisfed.org/apikeys" target="_blank" rel="noreferrer">FRED API Keys</a>에서 발급받아 넣으세요(무료). <a href="/macro?tab=calendar">글로벌 매크로</a>의 경제 지표 일정과 내 지표 시트에 씁니다.
                </>
              )}
            </span>
          </label>
          {fredHint && (
            <label className="check">
              <input type="checkbox" name="clearFred" /> 저장한 키 지우기
            </label>
          )}
          <div className="full">
            <Submit>저장</Submit>
          </div>
        </ActionForm>
      </section>

      <section className="card" id="key-backup">
        <div className="stack" style={{ gap: 4 }}>
          <h2>API 키 백업 · 복원</h2>
          <p className="sub">
            위에 저장한 증권사·거래소 키와 AI·카카오·공공데이터포털 키를 백업 암호로 잠근 파일 하나로 내려받습니다. 새 서버나 초기화한 DB, 다른 계정에서 이 파일과 백업 암호로 한 번에 되살립니다. 파일은 암호 없이는 열 수 없으므로 구글 드라이브 같은 곳에 두어도 됩니다. 접근 토큰은 넣지 않고 다시 발급받습니다.
          </p>
        </div>
        <KeyBackup twoStep={user.twoStep} />
      </section>

      <section className="card" id="security">
        <div className="stack" style={{ gap: 4 }}>
          <h2>계정 보안</h2>
          <p className="sub">2단계 인증, 비밀번호, 로그인한 기기, 가입 초대를 관리합니다. 서버를 인터넷에 열어 쓴다면 2단계 인증을 켜 두세요.</p>
        </div>
        {recovery && <p className="msg err">복구 코드로 로그인했습니다. 휴대폰을 잃어버렸다면 2단계 인증을 끄고 새 휴대폰으로 다시 켜거나, 복구 코드를 새로 만드세요.</p>}
        <div className="security-grid">
          <div className="stack">
            <h3>2단계 인증</h3>
            <TwoStep enabledAt={sec.totpEnabledAt?.toISOString() ?? null} recoveryLeft={sec.recoveryCodes.length} />
          </div>
          <div className="stack">
            <h3>비밀번호 바꾸기</h3>
            <PasswordChange twoStep={user.twoStep} />
          </div>
          <div className="stack full">
            <h3>로그인한 기기</h3>
            <Devices devices={devices} />
          </div>
          <div className="stack">
            <h3>가입 초대</h3>
            <p className="sub">
              이 서버의 가입 방식: <span className="strong">{SIGNUP_MODE_LABEL[mode]}</span> (서버의 <code>SIGNUP_MODE</code>로 정합니다). 가족처럼 같이 쓸 사람에게 초대 코드를 보내면 7일 안에 한 번 가입할 수 있습니다.
            </p>
            <Invites invites={invites} mode={mode} />
          </div>
          <div className="stack">
            <h3>최근 보안 기록</h3>
            {events.length ? (
              <ul className="security-log">
                {events.map((e, i) => (
                  <li key={i}>
                    <span className="sub">{kstDateTime(e.at)}</span> <span className="strong">{e.action}</span>
                    {e.detail && <span className="sub"> · {e.detail}</span>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="sub">아직 기록이 없습니다. 로그인, 2단계 인증 변경, 비밀번호 변경이 여기 남습니다.</p>
            )}
          </div>
        </div>
      </section>

      <section className="card" id="fun" aria-label="놀이 모드">
        <div className="stack" style={{ gap: 4 }}>
          <h2>놀이 모드 🎈</h2>
          <p className="sub">재미 기능을 켭니다: 종목을 끌어다 포트폴리오 바구니에 담는 <a href="/portfolios/basket">바구니 담기</a>, 대시보드 평가액이 기간 최고일 때 꽃가루. 이 브라우저(기기)에만 저장되고 서버 데이터는 바꾸지 않습니다.</p>
        </div>
        <FunToggle label="놀이 모드 켜기" />
      </section>

      <section className="card" id="menu">
        <div className="stack" style={{ gap: 4 }}>
          <h2>메뉴</h2>
          <p className="sub">왼쪽 메뉴에 보일 화면을 고릅니다. 끈 화면은 메뉴 맨 아래 숨긴 메뉴에 모여 있고, 주소로도 그대로 열립니다. 대시보드와 연동 · 설정은 숨길 수 없습니다.</p>
        </div>
        <ActionForm action={saveMenuAction} className="stack">
          <div className="menu-picks" role="group" aria-label="보일 메뉴">
            {NAV_ITEMS.map((item) => (
              <label key={item.href}>
                <input type="checkbox" name="show" value={item.href} defaultChecked={item.locked || !user.hiddenNav.includes(item.href)} disabled={item.locked} />
                {item.label}
              </label>
            ))}
          </div>
          <div>
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
