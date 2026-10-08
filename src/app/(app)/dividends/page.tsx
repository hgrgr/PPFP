import { AskAiButton } from '@/components/ai/launcher';
import { DividendChart } from '@/components/charts';
import { FREQ_LABEL, months } from '@/domain/dividends';
import { krw, krwShort, money } from '@/lib/format';
import { requireUser } from '@/server/auth';
import { dividendReport } from '@/server/services/dividends';

export const metadata = { title: '배당' };
export const dynamic = 'force-dynamic';

export default async function DividendsPage() {
  const user = await requireUser();
  const r = await dividendReport(user.id);
  const next12 = months(r.today.slice(0, 7), 12);
  const T = r.totals;

  return (
    <>
      <header className="page-head">
        <div className="stack" style={{ gap: 6 }}>
          <h1>배당</h1>
          <p className="sub">받은 배당과, 지금 보유 수량으로 앞으로 받을 배당입니다. 앞으로의 금액은 종목마다 지난 배당의 주기와 주당 금액이 이어진다고 보고 계산한 추정치입니다.</p>
        </div>
        <AskAiButton
          label="AI로 배당 일정 확인"
          agent="RESEARCH"
          prompt="내 보유 종목 중 배당을 주는 종목들의 다음 배당기준일·지급일과 최근 배당금 변화(증액·감액)를 확인해 줘. 배당 탭의 추정과 다른 점이 있으면 알려 줘."
        />
      </header>

      <section className="row" aria-label="요약">
        <div className="card kpi">
          <div className="label">지난 12개월 받은 배당</div>
          <div className="value">{krw(T.trailingKrw)}</div>
          <div className="note">세후로 기록했다면 받은 금액 그대로</div>
        </div>
        <div className="card kpi">
          <div className="label">앞으로 12개월 예상</div>
          <div className="value">{krw(T.nextKrw)}</div>
          <div className="note">월평균 {krwShort(T.monthlyKrw)}</div>
        </div>
        <div className="card kpi">
          <div className="label">예상 배당수익률</div>
          <div className="value">{T.yieldPct === null ? '—' : `${T.yieldPct.toFixed(2)}%`}</div>
          <div className="note">앞으로 12개월 예상 ÷ 지금 평가액</div>
        </div>
      </section>

      <section className="card stack" id="flow">
        <div className="spread">
          <h2>월별 배당</h2>
          <span className="inline sub" style={{ gap: 12 }}>
            <span className="inline" style={{ gap: 6 }}><span className="legend-swatch solid" /> 받은 배당</span>
            <span className="inline" style={{ gap: 6 }}><span className="legend-swatch dashed" /> 예상 배당</span>
          </span>
        </div>
        <DividendChart data={r.flow} />
      </section>

      <section className="card stack" id="calendar">
        <h2>앞으로 12개월 배당 달력</h2>
        <div className="div-calendar">
          {next12.map((m) => {
            const list = r.projected.filter((p) => p.date.startsWith(m));
            const total = list.reduce((s, p) => s + p.krw, 0);
            return (
              <div key={m} className={`div-month${list.length ? '' : ' empty'}`}>
                <div className="spread">
                  <span className="strong">{Number(m.slice(0, 4)) !== Number(r.today.slice(0, 4)) ? `${m.slice(2, 4)}년 ` : ''}{Number(m.slice(5))}월</span>
                  <span className="sub money">{total ? krwShort(total) : '—'}</span>
                </div>
                <ul>
                  {list.map((p) => (
                    <li key={p.assetId + p.date}>
                      <span>{p.name}</span>
                      <span className="sub money">{p.currency === 'KRW' ? krwShort(p.krw) : money(p.amount.toFixed(2), p.currency)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
        <p className="sub">날짜는 지난 지급일에서 주기만큼 더한 대략의 시점입니다. 실제 배당기준일·지급일과 금액은 회사 공시로 확인하세요. 해외 배당은 오늘 환율로 원화 환산했습니다.</p>
      </section>

      <section className="card stack" id="by-asset">
        <h2>종목별 배당</h2>
        {r.rows.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">종목</th>
                  <th scope="col">주기</th>
                  <th scope="col">다음 예상</th>
                  <th scope="col" className="num">지난 12개월</th>
                  <th scope="col" className="num">앞으로 12개월</th>
                  <th scope="col" className="num">예상 수익률</th>
                </tr>
              </thead>
              <tbody>
                {r.rows.map((a) => (
                  <tr key={a.assetId}>
                    <td>
                      <span className="strong">{a.name}</span>
                      {a.symbol && <div className="sub">{a.symbol}</div>}
                    </td>
                    <td>{a.freq ? (FREQ_LABEL[a.freq] ?? `연 ${a.freq}회`) : '—'}</td>
                    <td>{a.nextDate ?? '—'}</td>
                    <td className="num">{krw(a.trailingKrw)}</td>
                    <td className="num">{krw(a.nextKrw)}</td>
                    <td className="num">{a.yieldPct === null ? '—' : `${a.yieldPct.toFixed(1)}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty">아직 기록한 배당이 없습니다. 포트폴리오 화면의 입출금·배당·이자에서 배당을 기록하면 여기에 모입니다.</p>
        )}
        {r.pastOnly.length > 0 && <p className="sub">지금은 보유하지 않아 예상에서 뺀 종목: {r.pastOnly.join(', ')}</p>}
      </section>
    </>
  );
}
