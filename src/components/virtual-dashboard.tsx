import { Donut, ValueChart } from '@/components/charts';
import { PeriodBar } from '@/components/period-bar';
import { krw, krwShort, pct, signedKrwShort, tone } from '@/lib/format';
import type { ResolvedRange } from '@/domain/period';
import type { DetailView } from '@/server/services/virtual';

const KIND_COLOR: Record<string, string> = {
  STOCK: 'var(--series-1)',
  FUND: 'var(--series-2)',
  BOND: 'var(--series-3)',
  COMMODITY: 'var(--series-4)',
  CRYPTO: 'var(--series-5)',
  REAL_ESTATE: 'var(--series-6)',
  FIXED: 'var(--series-7)',
  CASH: 'var(--muted)',
};

/**
 * The dashboard for a 가상 포트폴리오: the same cards as a real portfolio, from the paper
 * positions only. It never adds into 순자산 전체 and has no transactions, income or export.
 */
export function VirtualDashboard({ d, range, linkParams, scope }: { d: DetailView; range: ResolvedRange; linkParams: Record<string, string | undefined>; scope: React.ReactNode }) {
  const t = d.period;
  const live = d.positions.filter((p) => !p.problem && (p.value ?? 0) > 0);
  const slices = d.byKind.map((k) => ({ key: k.kind, label: k.label, color: KIND_COLOR[k.kind] ?? 'var(--muted)', value: k.value, share: k.weight }));
  const byPosition = live.map((p, i) => ({ key: p.id, label: p.name, color: `var(--series-${(i % 7) + 1})`, value: p.value ?? 0, share: p.weight ?? 0 }));
  const chart = d.path.dates.map((date, i) => ({ date, value: d.path.value[i], invested: d.path.invested[i] }));
  return (
    <>
      <header className="page-head">
        <div className="stack" style={{ gap: 6 }}>
          <nav className="crumbs" aria-label="경로">
            <a href="/portfolios/virtual">가상 포트폴리오</a>
          </nav>
          <h1>
            <span className="badge" style={{ marginRight: 8, verticalAlign: 'middle' }}>가상</span>
            {d.portfolio.name}
          </h1>
          <p className="sub">갖고 있지 않은 자산을 과거 날짜에 담아 본 연습용 포트폴리오입니다. 순자산·세금·배당·성과 분석에는 들어가지 않습니다. 금액은 원화 환산, 가격만으로 계산합니다.</p>
        </div>
        <div className="inline">
          {scope}
          <a className="btn" href={`/performance/compare?p=all,v:${d.portfolio.id},b:^KS11`}>다른 포트폴리오와 비교</a>
          <a className="btn primary" href={`/portfolios/virtual?id=${d.portfolio.id}`}>종목 담기 · 편집</a>
        </div>
      </header>

      <PeriodBar base="/dashboard" params={linkParams} range={range} />

      <section className="row" aria-label="요약">
        <div className="card kpi">
          <div className="label">총평가액</div>
          <div className="value money">{krw(t.endValue)}</div>
          <div className="note">
            넣은 돈 <span className="money">{krwShort(d.totals.invested)}</span> · 전체 손익 <span className={`money ${tone(d.totals.gain)}`}>{signedKrwShort(d.totals.gain)}</span>
          </div>
        </div>
        <div className="card kpi">
          <div className="label">기간 손익 (새로 넣은 돈 제외)</div>
          <div className={`value money ${tone(t.pnl)}`}>{signedKrwShort(t.pnl)}</div>
          <div className="note">
            기간 중 새로 넣은 돈 <span className="money">{krwShort(t.flows)}</span>
          </div>
        </div>
        <div className="card kpi">
          <div className="label">수익률 (시간가중, TWR)</div>
          <div className={`value ${tone(t.twr ?? 0)}`}>{t.twr === null ? '—' : pct(t.twr)}</div>
          <div className="note">최대낙폭 {t.maxDrawdown === null ? '—' : pct(t.maxDrawdown)}</div>
        </div>
        <div className="card kpi">
          <div className="label">같은 돈을 {d.portfolio.benchmarkName}에</div>
          <div className={`value ${tone(d.totals.bench ?? 0)}`}>{d.totals.bench === null ? '—' : pct(d.totals.bench)}</div>
          <div className="note">처음부터 지금까지, 같은 날 같은 금액</div>
        </div>
      </section>

      <section className="row">
        <div className="card wide">
          <div className="spread">
            <h2>평가액 추이</h2>
            <div className="inline sub">
              <span className="inline" style={{ gap: 6 }}><span style={{ width: 16, height: 2, background: 'var(--ink)', display: 'inline-block' }} />평가액</span>
              <span className="inline" style={{ gap: 6 }}><span style={{ width: 16, borderTop: '2px dashed var(--muted)', display: 'inline-block' }} />넣은 돈</span>
            </div>
          </div>
          <ValueChart data={chart} />
        </div>
        <div className="card">
          <h2>자산 배분</h2>
          <Donut slices={slices.length ? slices : byPosition} centerLabel="총자산" centerValue={krwShort(t.endValue)} />
          <p className="sub">자산 종류별 비중(지금 기준)입니다. 종목별 비중은 아래 표에 있습니다.</p>
        </div>
      </section>

      <section className="card">
        <div className="spread">
          <h2>담은 종목</h2>
          <a className="sub" href={`/portfolios/virtual?id=${d.portfolio.id}`}>편집 ›</a>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">종목</th>
                <th scope="col">매수일</th>
                <th scope="col">매수 금액</th>
                <th scope="col">평가액</th>
                <th scope="col">손익</th>
                <th scope="col">수익률</th>
                <th scope="col">비중</th>
              </tr>
            </thead>
            <tbody>
              {d.positions.map((p) => (
                <tr key={p.id}>
                  <td>
                    <span className="strong">{p.name}</span>
                    <div className="sub">{p.kindLabel}{p.sellDate ? ` · ${p.sellDate} 매도` : ''}{p.problem ? ` · ${p.problem}` : ''}</div>
                  </td>
                  <td className="muted">{p.buyDate}</td>
                  <td className="money">{krwShort(p.cost ?? 0)}</td>
                  <td className="money strong">{p.value === null ? '—' : krwShort(p.value)}</td>
                  <td className={`money ${tone(p.gain ?? 0)}`}>{p.gain === null ? '—' : signedKrwShort(p.gain)}</td>
                  <td className={tone(p.ret ?? 0)}>{p.ret === null ? '—' : pct(p.ret)}</td>
                  <td className="muted">{p.weight === null ? '—' : pct(p.weight, 1, false)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
