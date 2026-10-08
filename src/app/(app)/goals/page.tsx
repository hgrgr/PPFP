import { AskAiButton } from '@/components/ai/launcher';
import { GoalChart } from '@/components/charts';
import { GoalEdit, GoalForm } from '@/components/goals';
import { GoalsTabs } from '@/components/goals-tabs';
import { krw, krwShort } from '@/lib/format';
import { requireUser } from '@/server/auth';
import { goalForm, goalViews, INFLATION } from '@/server/services/goals';
import { userGraph } from '@/server/services/portfolios';

export const metadata = { title: '목표' };
export const dynamic = 'force-dynamic';

const pct1 = (v: number) => `${(v * 100).toFixed(1)}%`;
const ym = (months: number) => {
  const now = new Date(Date.now() + 9 * 3_600_000);
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + months, 1));
  return `${d.getUTCFullYear()}년 ${d.getUTCMonth() + 1}월`;
};

export default async function GoalsPage() {
  const user = await requireUser();
  const [goals, graph] = await Promise.all([goalViews(user.id), userGraph(user.id)]);
  const portfolios = graph.portfolios.map((p) => ({ id: p.id, name: p.name }));

  return (
    <>
      <header className="page-head">
        <div className="stack" style={{ gap: 6 }}>
          <h1>목표</h1>
          <p className="sub">지금 자산과 월 적립액으로 목표 금액에 닿을 가능성을 2,000가지 시장 경로로 시뮬레이션합니다. 수익률과 변동성은 가정이지 예측이 아닙니다.</p>
        </div>
        {goals.length > 0 && (
          <AskAiButton label="AI 목표 점검" prompt="내 목표들의 달성 가능성을 점검해 줘. 확률이 낮은 목표는 월 적립액, 기간, 자산 구성 중 무엇을 바꾸는 게 현실적인지 숫자로 비교해 줘." />
        )}
      </header>
      <GoalsTabs current="goals" />

      {goals.map((g) => {
        const end = g.sim.years.at(-1)!;
        const prob = Math.round(g.sim.probability * 100);
        const chart = [{ label: '지금', p10: g.start, p50: g.start, p90: g.start, expected: g.start }, ...g.sim.years.map((y, i, all) => ({ label: i === all.length - 1 ? g.targetDate.slice(0, 7).replace('-', '.') : `${y.month / 12}년`, ...y }))];
        return (
          <section key={g.id} className="card stack goal-card">
            <div className="spread">
              <div className="stack" style={{ gap: 2 }}>
                <h2>{g.name}</h2>
                <span className="sub">
                  {g.scope} {krwShort(g.start)}에서 매달 {krwShort(g.monthly)} → {g.targetDate}까지 {krwShort(g.target)}
                  {g.realTerms ? ' (오늘 가치)' : ''}
                </span>
              </div>
              <GoalEdit values={goalForm(g)} portfolios={portfolios} auto={g.auto} />
            </div>
            <div className="row goal-kpis">
              <div className="kpi">
                <div className="label">달성 확률</div>
                <div className={`value ${prob >= 70 ? 'up-ok' : prob < 40 ? 'warn-text' : ''}`}>{prob}%</div>
                <div className="note">{g.sim.medianReachMonth ? `중앙값 경로는 ${ym(g.sim.medianReachMonth)} 도달` : '절반 이상의 경로가 기한 안에 닿지 못함'}</div>
              </div>
              <div className="kpi">
                <div className="label">기한의 예상 자산 (중앙값)</div>
                <div className="value">{krwShort(end.p50)}</div>
                <div className="note">하위 10% {krwShort(end.p10)} · 상위 10% {krwShort(end.p90)}</div>
              </div>
              <div className="kpi">
                <div className="label">변동 없이 닿으려면</div>
                <div className="value">{g.needed > 0 ? `월 ${krwShort(g.needed)}` : '추가 적립 없이 도달'}</div>
                <div className="note">지금 월 {krwShort(g.monthly)} · 총 납입 {krwShort(g.sim.contributed)}</div>
              </div>
            </div>
            <GoalChart data={chart} target={g.target} />
            <p className="sub">
              가정: 연 기대수익률 {pct1(g.ret)}, 변동성 {pct1(g.vol)}
              {g.custom.ret || g.custom.vol ? ' (직접 입력)' : ` (${g.scope}의 자산 구성 기준)`}
              {g.realTerms ? `, 물가 연 ${pct1(INFLATION)}을 빼고 오늘 가치로 표시` : ''}. 파란 띠는 경로의 80%가 들어오는 범위, 점선은 매년 기대수익률대로만 갈 때입니다.
            </p>
          </section>
        );
      })}

      <section className="card stack" id="new-goal">
        <h2>{goals.length ? '목표 추가' : '첫 목표 만들기'}</h2>
        <GoalForm portfolios={portfolios} />
        <p className="sub">
          기대수익률과 변동성을 비우면 자산 유형별 장기 가정(국내 주식 7%·20%, 미국 주식 8%·17%, 채권 3.5%·6%, 예금 3%, 가상자산 12%·65% 등)을 지금 비중으로 섞어 씁니다.
        </p>
      </section>
    </>
  );
}
