import { PROVIDERS, isProvider } from '@/domain/ai-providers';
import { kstDateTime, krw, qty, usd } from '@/lib/format';
import { requireUser } from '@/server/auth';
import { usageReport, type ServiceUsage } from '@/server/services/usage';

export const metadata = { title: '사용량 · 비용' };
export const dynamic = 'force-dynamic';

const GROUP_LABEL = { ai: 'AI', data: '자료 검색', broker: '증권사 · 거래소' } as const;

function Meter({ value, max, label }: { value: number; max: number; label: string }) {
  const r = max > 0 ? Math.min(1, value / max) : 0;
  return (
    <div className="meter" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
      <span className={r >= 1 ? 'over' : r >= 0.8 ? 'warn' : undefined} style={{ width: `${r * 100}%` }} />
    </div>
  );
}

function Windows({ s }: { s: ServiceUsage }) {
  if (!s.windows.length) return <span className="sub">{s.month.calls ? '알려 주지 않음' : '—'}</span>;
  return (
    <div className="stack" style={{ gap: 4 }}>
      {s.windows.map((w) => (
        <div key={w.kind} className="stack" style={{ gap: 2 }}>
          <span className="sub">
            {w.kind} {w.remaining !== null ? qty(w.remaining) : '?'}
            {w.limit !== null ? ` / ${qty(w.limit)}` : ''} 남음{w.reset ? ` · ${kstDateTime(w.reset).slice(11)} 초기화` : ''}
          </span>
          {w.limit !== null && w.remaining !== null && <Meter value={w.limit - w.remaining} max={w.limit} label={`${s.name} ${w.kind} 사용`} />}
        </div>
      ))}
      {s.windowsAt && <span className="sub">{kstDateTime(s.windowsAt).slice(5)} 응답 기준</span>}
    </div>
  );
}

export default async function UsagePage() {
  const user = await requireUser();
  const r = await usageReport(user.id);
  const { ai } = r;
  const won = (v: number) => krw(v * r.fx.rate);
  const maxDay = Math.max(...ai.daily.map((d) => d.cost), 0.0001);

  return (
    <>
      <header className="page-head">
        <div className="stack" style={{ gap: 6 }}>
          <h1>사용량 · 비용</h1>
          <p className="sub">
            AI 어드바이저 비용과 앱이 쓰는 외부 API의 호출 수, 각 서비스가 알려 준 남은 한도를 봅니다. 원화는 USD/KRW {r.fx.rate.toFixed(2)}({r.fx.label})로 바꾼 값입니다.
          </p>
        </div>
        <a className="btn" href="/settings#ai">
          AI 한도 설정
        </a>
      </header>

      <section className="row four" aria-label="AI 비용 요약">
        <div className="card kpi">
          <div className="label">이번 달 AI 비용</div>
          <div className="value money">{usd(ai.spent)}</div>
          <div className="note">약 {won(ai.spent)}</div>
        </div>
        <div className="card kpi">
          <div className="label">월 한도</div>
          <div className="value money">{ai.limit !== null ? usd(ai.limit) : '없음'}</div>
          {ai.limit !== null ? (
            <>
              <Meter value={ai.spent} max={ai.limit} label="월 한도 사용" />
              <div className="note">
                {Math.round((ai.spent / ai.limit) * 100)}% 사용 · 남은 {usd(Math.max(0, ai.limit - ai.spent))}
              </div>
            </>
          ) : (
            <div className="note">
              <a href="/settings#ai">연동 · 설정</a>에서 정하면 넘을 때 질문을 받지 않습니다.
            </div>
          )}
        </div>
        <div className="card kpi">
          <div className="label">이대로면 월말</div>
          <div className={`value money${ai.limit !== null && ai.projected > ai.limit ? ' down' : ''}`}>{usd(ai.projected)}</div>
          <div className="note">{ai.limit !== null && ai.projected > ai.limit ? '한도를 넘을 수 있습니다' : '지금까지 하루 평균으로 계산'}</div>
        </div>
        <div className="card kpi">
          <div className="label">지난달</div>
          <div className="value money">{usd(ai.lastMonth)}</div>
          <div className="note">약 {won(ai.lastMonth)}</div>
        </div>
      </section>

      <section className="card stack" aria-label="일별 AI 비용">
        <div className="spread">
          <h2>최근 30일 AI 비용</h2>
          <span className="sub">하루 최대 {usd(maxDay)}</span>
        </div>
        <div className="day-bars">
          {ai.daily.map((d) => (
            <span key={d.date} title={`${d.date} ${usd(d.cost)}`} style={{ height: `${Math.max(d.cost > 0 ? 4 : 1, (d.cost / maxDay) * 100)}%` }} className={d.cost > 0 ? 'on' : undefined} />
          ))}
        </div>
        <div className="spread sub">
          <span>{ai.daily[0]?.date.slice(5)}</span>
          <span>오늘</span>
        </div>
      </section>

      <section className="row" style={{ alignItems: 'flex-start' }}>
        <div className="card wide stack">
          <h2>모델별 (이번 달)</h2>
          {ai.models.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">모델</th>
                    <th scope="col">답변</th>
                    <th scope="col">입력 토큰</th>
                    <th scope="col">출력 토큰</th>
                    <th scope="col">캐시 읽기</th>
                    <th scope="col">웹 검색</th>
                    <th scope="col">비용</th>
                  </tr>
                </thead>
                <tbody>
                  {ai.models.map((m) => (
                    <tr key={`${m.provider}:${m.model}`}>
                      <td>
                        <span className="strong">{m.model}</span>
                        <span className="sub">
                          {isProvider(m.provider) ? PROVIDERS[m.provider].name : m.provider} · 100만 토큰당 입력 ${m.price.input} · 출력 ${m.price.output}
                          {!m.price.known && ' (단가를 몰라 비싼 쪽으로 추정)'}
                        </span>
                      </td>
                      <td>{m.answers}</td>
                      <td className="money">{qty(m.input + m.cacheWrite)}</td>
                      <td className="money">{qty(m.output)}</td>
                      <td className="money">{qty(m.cacheRead)}</td>
                      <td>{m.searches || '—'}</td>
                      <td className="money strong">{usd(m.cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="empty">이번 달에는 아직 AI를 쓰지 않았습니다.</p>
          )}
          <p className="sub">
            비용은 답변마다 받은 토큰 수에 모델 단가를 곱한 추정치입니다{ai.webSearch ? '(웹 검색은 1회 $0.01)' : ''}. 실제 청구 금액은 각 회사 콘솔에서 확인하세요.
          </p>
        </div>
        <div className="card stack">
          <h2>에이전트별</h2>
          {ai.agents.length ? (
            <ul className="plain-list">
              {ai.agents.map((a) => (
                <li key={a.agent} className="spread">
                  <span>{a.name}</span>
                  <span className="money">{usd(a.cost)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty">—</p>
          )}
          <h2>비용이 큰 대화</h2>
          {ai.conversations.length ? (
            <ul className="plain-list">
              {ai.conversations.map((c) => (
                <li key={c.id} className="spread">
                  <a href={`/ai?c=${c.id}`} title={c.title}>
                    {c.title}
                  </a>
                  <span className="money">{usd(c.cost)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty">—</p>
          )}
        </div>
      </section>

      <section className="card stack" aria-label="외부 API">
        <h2>외부 API</h2>
        {r.services.length ? (
          <div className="table-wrap">
            <table className="usage-services">
              <thead>
                <tr>
                  <th scope="col">서비스</th>
                  <th scope="col" className="l">과금</th>
                  <th scope="col" className="l">한도 정책</th>
                  <th scope="col">오늘 호출</th>
                  <th scope="col">이번 달 호출</th>
                  <th scope="col">오류 · 한도 초과</th>
                  <th scope="col" className="l">남은 한도</th>
                </tr>
              </thead>
              <tbody>
                {r.services.map((s) => (
                  <tr key={s.service}>
                    <td>
                      {s.console ? (
                        <a className="strong" href={s.console} target="_blank" rel="noreferrer">
                          {s.name}
                        </a>
                      ) : (
                        <span className="strong">{s.name}</span>
                      )}
                      <span className="sub">
                        {GROUP_LABEL[s.group]}
                        {s.shared ? ' · 서버 전체' : ''}
                        {s.lastAt ? ` · 마지막 ${kstDateTime(s.lastAt).slice(5)}` : ''}
                      </span>
                    </td>
                    <td className="l sub">{s.billing}</td>
                    <td className="l sub">{s.limit}</td>
                    <td>{qty(s.today.calls)}</td>
                    <td>{qty(s.month.calls)}</td>
                    <td className={s.month.limited ? 'down' : undefined}>
                      {s.month.errors} · {s.month.limited}
                    </td>
                    <td className="l">
                      <Windows s={s} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty">아직 외부 API를 부른 기록이 없습니다.</p>
        )}
        <p className="sub">
          호출 수는 이 앱이 보낸 요청을 센 것입니다. 남은 한도는 서비스가 마지막 응답에 실어 보낸 값이라, 그 뒤의 다른 앱·기기 사용은 반영되지 않습니다. 증권사 시세처럼 특정 사용자와 묶이지 않는 호출은 서버 전체로 셉니다.
        </p>
      </section>
    </>
  );
}
