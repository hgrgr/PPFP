import { BacktestChart } from '@/components/charts';
import { ScopeSelect } from '@/components/client-bits';
import { GoalsTabs } from '@/components/goals-tabs';
import { RULE_LABEL } from '@/domain/goals';
import { requireUser } from '@/server/auth';
import { backtestReport } from '@/server/services/goals';
import { userGraph } from '@/server/services/portfolios';

export const metadata = { title: '리밸런싱 백테스트' };
export const dynamic = 'force-dynamic';

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const p = (v: number, dp = 1, sign = true) => `${sign && v > 0 ? '+' : ''}${(v * 100).toFixed(dp)}%`;
const COLORS: Record<string, string> = { NONE: 'var(--ink)', MONTHLY: 'var(--series-1)', QUARTERLY: 'var(--series-2)', BAND: 'var(--series-3)' };

export default async function BacktestPage({ searchParams }: { searchParams: SP }) {
  const user = await requireUser();
  const sp = await searchParams;
  const scope = one(sp.p) ?? null;
  const [r, graph] = await Promise.all([backtestReport(user.id, scope), userGraph(user.id)]);
  const best = r ? [...r.results].sort((a, b) => b.cagr - a.cagr)[0].rule : null;

  return (
    <>
      <header className="page-head">
        <div className="stack" style={{ gap: 6 }}>
          <h1>목표</h1>
          <p className="sub">지금 비중으로 지난 1년을 다시 굴려 보고, 리밸런싱 규칙에 따라 결과가 어떻게 달랐을지 봅니다. 지난 결과가 앞으로를 보장하지 않습니다.</p>
        </div>
        <ScopeSelect value={scope ?? ''} options={graph.portfolios.map((x) => ({ id: x.id, label: x.name }))} />
      </header>
      <GoalsTabs current="backtest" />

      {!r ? (
        <section className="card">
          <p className="empty">시세 기록이 있는 상장 종목이 없어 백테스트할 수 없습니다.</p>
        </section>
      ) : (
        <>
          <section className="card stack" id="rules">
            <div className="spread">
              <h2>규칙별 결과</h2>
              <span className="sub">
                {r.start} ~ {r.end} · 거래 비용·세금 제외
              </span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">규칙</th>
                    <th scope="col" className="num">수익률</th>
                    <th scope="col" className="num">연환산</th>
                    <th scope="col" className="num">변동성</th>
                    <th scope="col" className="num">최대 낙폭</th>
                    <th scope="col" className="num">리밸런싱</th>
                    <th scope="col" className="num">회전율</th>
                  </tr>
                </thead>
                <tbody>
                  {r.results.map((x) => (
                    <tr key={x.rule}>
                      <td>
                        <span className="inline" style={{ gap: 6 }}>
                          <span className="legend-line" style={{ background: COLORS[x.rule] }} />
                          <span className="strong">{RULE_LABEL[x.rule]}</span>
                          {x.rule === 'BAND' && <span className="sub">±{(r.band * 100).toFixed(0)}%p</span>}
                          {x.rule === best && <span className="badge ok">가장 높음</span>}
                        </span>
                      </td>
                      <td className={`num ${x.totalReturn >= 0 ? 'up' : 'down'}`}>{p(x.totalReturn)}</td>
                      <td className="num">{p(x.cagr)}</td>
                      <td className="num">{p(x.volatility, 1, false)}</td>
                      <td className="num down">{p(x.maxDrawdown)}</td>
                      <td className="num">{x.rebalances}회</td>
                      <td className="num">{p(x.turnover, 0, false)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <BacktestChart data={r.chart} series={r.results.map((x) => ({ key: x.rule, label: RULE_LABEL[x.rule], color: COLORS[x.rule] }))} />
          </section>

          <section className="card stack" id="parts">
            <h2>시작 비중</h2>
            <ul className="bt-parts">
              {r.parts.map((x) => (
                <li key={x.name}>
                  <span>
                    {x.name} {x.symbol && <span className="sub">{x.symbol}</span>}
                  </span>
                  <span className="num">{(x.weight * 100).toFixed(1)}%</span>
                </li>
              ))}
            </ul>
            <p className="sub">
              지금 보유 비중을 기간 첫날에 그대로 샀다고 봅니다. 해외 종목은 그날 환율로 원화 환산했고, 시세가 없는 자산(예금·현금 등)은 가격 변화 없이 둡니다. 허용 오차 규칙은 한 종목이라도 목표 비중에서 ±{(r.band * 100).toFixed(0)}%p를 벗어나면 전체를 맞춥니다
              {scope ? '(포트폴리오의 허용 오차)' : ''}.
              {r.skipped.length > 0 && ` 시세 기록이 없어 뺀 종목: ${r.skipped.join(', ')}.`}
            </p>
          </section>
        </>
      )}
    </>
  );
}
