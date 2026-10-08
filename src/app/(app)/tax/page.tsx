import { AskAiButton } from '@/components/ai/launcher';
import { TAX_RULES } from '@/domain/tax';
import { krw, krwShort, signedKrwShort } from '@/lib/format';
import { requireUser } from '@/server/auth';
import { taxReport, taxYears } from '@/server/services/tax';

export const metadata = { title: '세금' };
export const dynamic = 'force-dynamic';

type SP = Promise<Record<string, string | string[] | undefined>>;

const pct = (v: number) => `${Math.round(v * 100)}%`;
const tone = (v: number) => (v > 0 ? 'up' : v < 0 ? 'down' : '');

export default async function TaxPage({ searchParams }: { searchParams: SP }) {
  const user = await requireUser();
  const sp = await searchParams;
  const years = await taxYears(user.id);
  const asked = Number(Array.isArray(sp.year) ? sp.year[0] : sp.year);
  const year = years.includes(asked) ? asked : years[0];
  const t = await taxReport(user.id, year);
  const R = TAX_RULES;
  const o = t.overseas;
  const h = t.harvest;
  const overseasSales = t.realized.filter((r) => r.bucket === 'OVERSEAS');
  const fin = t.financial;

  return (
    <>
      <header className="page-head">
        <div className="stack" style={{ gap: 6 }}>
          <h1>세금</h1>
          <p className="sub">거래 기록으로 계산한 {year}년 예상치입니다. 실제 신고는 증권사 양도소득 자료와 국세청 안내를 따르세요.</p>
        </div>
        <div className="inline">
          <nav className="seg" aria-label="연도">
            {years.slice(0, 5).map((y) => (
              <a key={y} href={`/tax?year=${y}`} aria-current={y === year ? 'true' : undefined}>
                {y}
              </a>
            ))}
          </nav>
          <AskAiButton
            label="AI 절세 점검"
            prompt={`${year}년 세금을 점검해 줘. 해외주식 양도소득세 예상액과 연말 전에 할 수 있는 절세(손실 상계, 기본공제 활용), 금융소득 종합과세 해당 여부를 내 보유 종목 기준으로 알려 줘.`}
          />
        </div>
      </header>

      <section className="row" aria-label="요약">
        <div className="card kpi">
          <div className="label">해외주식 양도소득세 (예상)</div>
          <div className="value">{krw(o.taxKrw)}</div>
          <div className="note">
            과세표준 {krwShort(o.taxableKrw)} × {pct(R.overseasRate)} · {year + 1}년 {R.filingMonth}월 신고
          </div>
        </div>
        <div className="card kpi">
          <div className="label">해외주식 순양도차익</div>
          <div className={`value ${tone(o.netKrw)}`}>{signedKrwShort(o.netKrw)}</div>
          <div className="note">
            이익 {krwShort(o.gainKrw)} · 손실 {krwShort(o.lossKrw)} · 매도 {o.sells}건
          </div>
        </div>
        <div className="card kpi">
          <div className="label">금융소득 (배당 + 이자)</div>
          <div className="value">{krwShort(fin.totalKrw)}</div>
          <div className="note">{fin.overThreshold ? <span className="badge warn">2,000만 원 초과 · 종합과세 대상</span> : `종합과세 기준 2,000만 원까지 ${krwShort(fin.thresholdKrw - fin.totalKrw)} 남음`}</div>
        </div>
        <div className="card kpi">
          <div className="label">국내주식 · 코인 실현손익</div>
          <div className="value">{signedKrwShort(t.domestic.netKrw + t.crypto.netKrw)}</div>
          <div className="note">국내 {signedKrwShort(t.domestic.netKrw)} · 코인 {signedKrwShort(t.crypto.netKrw)} · {t.crypto.taxed ? `코인 예상 세금 ${krwShort(t.crypto.taxKrw)}` : '현재 과세 없음'}</div>
        </div>
      </section>

      <section className="row" style={{ alignItems: 'flex-start' }}>
        <div className="card stack" id="overseas">
          <h2>해외주식 양도소득</h2>
          <table className="tax-calc">
            <tbody>
              <tr><th scope="row">양도차익 (이익 난 매도)</th><td className="num">{krw(o.gainKrw)}</td></tr>
              <tr><th scope="row">양도차손 (손실 난 매도)</th><td className="num">{krw(o.lossKrw)}</td></tr>
              <tr><th scope="row">순양도차익</th><td className="num strong">{krw(o.netKrw)}</td></tr>
              <tr><th scope="row">기본공제</th><td className="num">−{krw(o.deductionKrw)}</td></tr>
              <tr><th scope="row">과세표준</th><td className="num strong">{krw(o.taxableKrw)}</td></tr>
              <tr><th scope="row">세율 (지방소득세 포함)</th><td className="num">{pct(R.overseasRate)}</td></tr>
              <tr className="total"><th scope="row">예상 세액</th><td className="num">{krw(o.taxKrw)}</td></tr>
            </tbody>
          </table>
          <p className="sub">
            1월 1일부터 12월 31일까지 판 해외주식의 이익과 손실을 합친 뒤 연 {krwShort(R.overseasDeduction)} 원을 빼고 {pct(R.overseasRate)}를 매깁니다. 손실은 같은 해 안에서만 상계되고 다음 해로 넘어가지 않습니다. 손익은 Lot 취득 환율과 매도 환율로 원화 환산한 값입니다.
          </p>
          {overseasSales.length > 0 && (
            <details>
              <summary>매도 {overseasSales.length}건 보기</summary>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th scope="col">매도일</th><th scope="col">종목</th><th scope="col" className="num">실현손익</th></tr>
                  </thead>
                  <tbody>
                    {overseasSales.map((r, i) => (
                      <tr key={i}>
                        <td>{r.date}</td>
                        <td>{r.asset}</td>
                        <td className={`num ${tone(r.pnlKrw)}`}>{signedKrwShort(r.pnlKrw)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </div>

        {h && (
          <div className="card stack" id="harvest">
            <h2>연말 전 절세</h2>
            <div className="stack" style={{ gap: 6 }}>
              <h3 className="strong" style={{ fontSize: 14.5 }}>손실 상계</h3>
              {o.taxableKrw <= 0 ? (
                <p className="sub">올해 과세표준이 없어 손실을 실현해도 줄어들 세금이 없습니다.</p>
              ) : h.losses.length ? (
                <>
                  <p className="sub">평가손실 중인 해외 종목을 연내에 팔면 올해 차익과 상계됩니다. 같은 종목을 다시 사도 됩니다(국내에는 미국식 워시세일 규정이 없음). 합쳐서 세금이 최대 {krw(h.lossSavingKrw)} 줄어듭니다.</p>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr><th scope="col">종목</th><th scope="col" className="num">평가손실</th><th scope="col" className="num">줄어드는 세금</th></tr>
                      </thead>
                      <tbody>
                        {h.losses.map((l) => (
                          <tr key={l.assetId}>
                            <td>{l.asset}</td>
                            <td className="num down">{signedKrwShort(l.unrealizedKrw)}</td>
                            <td className="num">{l.savesKrw > 0 ? krw(l.savesKrw) : <span className="sub">더 줄지 않음</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <p className="sub">평가손실 중인 해외 종목이 없습니다.</p>
              )}
            </div>
            <div className="stack" style={{ gap: 6 }}>
              <h3 className="strong" style={{ fontSize: 14.5 }}>기본공제 채우기</h3>
              {h.fill.length ? (
                <>
                  <p className="sub">
                    올해 세금 없이 더 실현할 수 있는 이익은 {krw(h.deductionRoomKrw)}입니다(기본공제 {krwShort(R.overseasDeduction)}에서 올해 순양도차익을 뺀 값). 평가이익 중인 종목을 이만큼만 팔고 다시 사면 세금 없이 취득가를 올려 두어, 나중에 낼 세금을 줄일 수 있습니다.
                  </p>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr><th scope="col">종목</th><th scope="col" className="num">평가이익</th><th scope="col" className="num">실현할 이익</th><th scope="col" className="num">보유 수량 중</th></tr>
                      </thead>
                      <tbody>
                        {h.fill.map((f) => (
                          <tr key={f.assetId}>
                            <td>{f.asset}</td>
                            <td className="num up">{signedKrwShort(f.unrealizedKrw)}</td>
                            <td className="num">{krw(f.realizeKrw)}</td>
                            <td className="num">약 {pct(f.shareOfPosition)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <p className="sub">{h.deductionRoomKrw > 0 ? '평가이익 중인 해외 종목이 없습니다.' : '올해 기본공제를 이미 다 썼습니다.'}</p>
              )}
            </div>
            <p className="sub">
              해외주식은 결제일이 속한 해의 소득입니다. 미국 주식은 연말 마지막 거래일 며칠 전까지 팔아야 그해에 결제되니, 증권사가 안내하는 연말 매도 기준일을 확인하세요.
            </p>
          </div>
        )}
      </section>

      <section className="card stack" id="financial">
        <h2>금융소득 (배당 · 이자)</h2>
        <div className="stack" style={{ gap: 6 }}>
          <span className="alloc-bar" aria-hidden="true">
            <span className="fill" style={{ width: `${Math.min(100, (fin.totalKrw / fin.thresholdKrw) * 100)}%`, background: fin.overThreshold ? 'var(--danger)' : 'var(--series-1)' }} />
          </span>
          <span className="sub">
            배당 {krw(fin.dividendsKrw)} + 이자 {krw(fin.interestKrw)} = {krw(fin.totalKrw)} / 종합과세 기준 {krw(fin.thresholdKrw)}
          </span>
        </div>
        <p className="sub">
          배당·이자는 받을 때 15.4%(해외 배당은 현지 세율, 미국 15%)가 떼어집니다. 한 해 금융소득이 2,000만 원을 넘으면 넘은 부분이 다른 소득과 합쳐 종합과세됩니다. 받은 금액을 세후로 기록했다면 실제 금융소득은 이보다 큽니다.
        </p>
      </section>

      <section className="card stack" id="notes">
        <h2>이 계산이 다루지 않는 것</h2>
        <ul className="sub tax-notes">
          <li>국내 상장주식은 대주주가 아니면 양도세가 없고, 증권거래세는 매도 때 이미 냈습니다. 대주주 요건에 해당하면 따로 계산하세요.</li>
          <li>국내 상장 해외 ETF(예: 미국 지수 ETF)의 매매차익은 양도소득이 아니라 배당소득(15.4%)으로 과세됩니다. 여기서는 국내 주식으로 셉니다.</li>
          <li>가상자산은 {R.cryptoFromYear}년 1월 1일 이후 처분분부터 250만 원 공제, 22%로 과세될 예정입니다. 시행을 미루거나 없애는 법안도 국회에 있어 바뀔 수 있습니다.</li>
          <li>해외에서 낸 세금의 외국납부세액공제, 수수료 외 필요경비, 환율 기준일 차이는 반영하지 않습니다.</li>
        </ul>
      </section>
    </>
  );
}
