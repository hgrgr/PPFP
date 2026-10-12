import { removeBenchmarkAction, saveBenchmarksAction } from '@/app/benchmark-actions';
import { AskAiButton } from '@/components/ai/launcher';
import { ActionForm, Submit } from '@/components/forms';
import { BENCHMARK_CATALOG } from '@/domain/benchmark';
import { ReturnChart } from '@/components/charts';
import { CurrencyToggle, ScopeSelect } from '@/components/client-bits';
import { PeriodBar } from '@/components/period-bar';
import { krwShort, signedKrwShort, signedMoney } from '@/lib/format';
import { requireUser } from '@/server/auth';
import { performanceReport } from '@/server/services/performance';
import { userGraph } from '@/server/services/portfolios';

export const metadata = { title: '성과 분석' };
export const dynamic = 'force-dynamic';

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const signed = (v: number | null, dp = 2) => (v === null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(dp)}%`);
const tone = (v: number | null) => (v === null ? '' : v > 0 ? 'up' : v < 0 ? 'down' : '');
const COLORS = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => `var(--series-${i})`);
const GROUPS = ['주가지수', '원자재', '물가', '통화량', '부동산'] as const;

function Bars({ rows, compact }: { compact?: boolean; rows: { key: string; label: string; sub?: string; pnlKrw: number; contributionPct: number | null; local?: string }[] }) {
  const max = Math.max(...rows.map((r) => Math.abs(r.contributionPct ?? 0)), 0.0001);
  return (
    <ul className={`contrib${compact ? ' compact' : ''}`}>
      {rows.map((r) => {
        const v = r.contributionPct ?? 0;
        const w = `${(Math.abs(v) / max) * 50}%`;
        return (
          <li key={r.key}>
            <span className="name">
              {r.label}
              {r.sub && <span className="sub"> {r.sub}</span>}
            </span>
            <span className="track" aria-hidden="true">
              <span className={`bar ${v >= 0 ? 'pos' : 'neg'}`} style={v >= 0 ? { left: '50%', width: w } : { right: '50%', width: w }} />
            </span>
            <span className={`num ${tone(v)}`}>{signed(r.contributionPct)}</span>
            {!compact && (
              <span className="num sub" title={r.local ? signedKrwShort(r.pnlKrw) : undefined}>
                {r.local ?? signedKrwShort(r.pnlKrw)}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export default async function PerformancePage({ searchParams }: { searchParams: SP }) {
  const user = await requireUser();
  const sp = await searchParams;
  const params = { p: one(sp.p), period: one(sp.period), from: one(sp.from), to: one(sp.to) };
  // ?fx= from an old link wins; otherwise the saved 원화 / 현지 통화 choice
  const local = one(sp.fx) ? one(sp.fx) === 'local' : user.localCurrency;
  const [r, graph] = await Promise.all([performanceReport(user.id, params.p ?? null, params, !local), userGraph(user.id)]);
  const mine = r.mine === null ? null : r.mine * 100;
  const series = [{ key: 'mine', label: r.scope.name, color: 'var(--ink)', width: 2.5 }, ...r.benches.map((b, i) => ({ key: b.symbol, label: b.label, color: COLORS[i % COLORS.length], show: b.available })).filter((x) => x.show)];
  const picked = new Set(r.benches.map((b) => b.key));
  const benchNames = r.benches.map((b) => b.label).join(', ');
  const c = r.contributions;

  return (
    <>
      <header className="page-head">
        <div className="stack" style={{ gap: 6 }}>
          <h1>성과 분석</h1>
          <p className="sub">
            {r.scope.name}의 시간가중수익률을 지수와 같은 기간으로 비교하고, 수익이 어디서 났는지 나눠 봅니다. {r.range.start} ~ {r.range.end}
          </p>
        </div>
        <div className="inline">
          <ScopeSelect value={params.p ?? ''} options={graph.portfolios.map((p) => ({ id: p.id, label: p.name }))} />
          <CurrencyToggle on={local} />
          <AskAiButton label="AI 성과 해석" prompt={`${r.scope.name}의 ${r.range.start}~${r.range.end} 성과를 ${benchNames}과(와) 비교해서 해석해 줘. 수익에 가장 크게 기여한 종목과 깎아 먹은 종목, 앞으로 고려할 점을 알려 줘.`} />
        </div>
      </header>

      <PeriodBar base="/performance" params={params} range={r.range} />

      <section className="row" aria-label="요약">
        <div className="card kpi">
          <div className="label">내 수익률 (시간가중)</div>
          <div className={`value ${tone(mine)}`}>{signed(mine)}</div>
          <div className="note">입출금의 영향을 뺀 수익률</div>
        </div>
        {r.benches.map((b) => {
          const v = b.total === null ? null : b.total * 100;
          const diff = mine !== null && v !== null ? mine - v : null;
          return (
            <div key={b.key} className="card kpi">
              <div className="label spread">
                <span>{b.label}</span>
                <ActionForm action={removeBenchmarkAction} className="bench-remove">
                  <input type="hidden" name="key" value={b.key} />
                  <Submit className="linkish sub" pendingText="…" aria-label={`${b.label} 빼기`}>✕</Submit>
                </ActionForm>
              </div>
              <div className={`value ${tone(v)}`}>{b.available ? signed(v) : '—'}</div>
              <div className="note">
                {b.available ? (
                  diff === null ? b.sub : <>내 수익률이 <span className={tone(diff)}>{signed(diff)}p</span> {diff >= 0 ? '앞섬' : '뒤처짐'}</>
                ) : b.problem === 'ECOS' ? (
                  <>
                    <a href="/settings#ecos">한국은행 ECOS 인증키</a>를 넣으면 보입니다
                  </>
                ) : (
                  (b.problem ?? '시세를 받지 못했습니다')
                )}
              </div>
            </div>
          );
        })}
      </section>

      <section className="card stack" id="vs">
        <div className="spread">
          <h2>누적 수익률 비교</h2>
          <div className="inline" style={{ gap: 12 }}>
            <span className="inline sub" style={{ gap: 12 }}>
              {series.map((s) => (
                <span key={s.key} className="inline" style={{ gap: 6 }}>
                  <span className="legend-line" style={{ background: s.color }} /> {s.label}
                </span>
              ))}
            </span>
          </div>
        </div>
        <ReturnChart data={r.chart} series={series} />
        <p className="sub">
          {r.benches.some((b) => b.source === 'BROKER') && 'ETF로 고른 지수는 같은 지수를 따르는 ETF의 종가라 배당이 빠져 지수의 총수익률보다 조금 낮습니다. '}
          {r.benches.some((b) => b.currency === 'USD') &&
            (local
              ? '현지 통화로 보는 중이라 미국 지수·금은 달러 기준 수익률입니다(위쪽 ₩ 원화로 바꾸면 그날 환율로 바꾼 원화 수익률). '
              : '원화로 보는 중이라 미국 지수·금은 그날의 원/달러 환율로 바꾼 수익률입니다(위쪽 $ 현지 통화로 바꾸면 달러 기준). ')}
          {r.benches.some((b) => b.monthly) && '물가·통화량·부동산 지수는 월 단위라 계단처럼 오르내리고, 발표가 1~2달 늦어 최근 달은 비어 있을 수 있습니다.'}
        </p>
      </section>

      <section className="card stack" id="benchmarks">
        <details>
          <summary className="strong">벤치마크 고르기 · {r.benches.length}개 비교 중</summary>
          <ActionForm action={saveBenchmarksAction} className="stack bench-form">
            {GROUPS.map((g) => (
              <fieldset key={g} className="bench-group">
                <legend className="sub strong">{g}</legend>
                {(['KR', 'US'] as const).map((region) => {
                  const list = BENCHMARK_CATALOG.filter((b) => b.group === g && b.region === region);
                  if (!list.length) return null;
                  return (
                    <div key={region} className="inline" style={{ gap: 14 }}>
                      <span className="sub" style={{ width: 28 }}>{region === 'KR' ? '한국' : '미국'}</span>
                      {list.map((b) => (
                        <label key={b.key} className="check" title={b.sub}>
                          <input type="checkbox" name="b" value={b.key} defaultChecked={picked.has(b.key)} /> {b.label}
                        </label>
                      ))}
                    </div>
                  );
                })}
              </fieldset>
            ))}
            <p className="sub">
              8개까지 고를 수 있습니다. 주가지수·금은 증권사(ETF)나 Yahoo Finance, 미국 물가·통화량·주택가격은 미국 연준 FRED, 한국 물가·통화량·주택가격은 한국은행 ECOS에서
              받습니다. 한국 지표는 <a href="/settings#ecos">연동 · 설정</a>에 ECOS 인증키(무료)를 넣어야 보입니다.
            </p>
            <div>
              <Submit>저장</Submit>
            </div>
          </ActionForm>
        </details>
      </section>

      <section className="row" style={{ alignItems: 'flex-start' }}>
        <div className="card stack wide" id="contrib">
          <div className="spread">
            <h2>종목별 기여도</h2>
            <span className="sub">기간 손익 {signedKrwShort(c.totalPnlKrw)} · 시작 평가액 {krwShort(r.startTotal)}</span>
          </div>
          {c.rows.length ? (
            <Bars
              rows={c.rows.map((x) => {
                const ccy = r.currencies[x.key];
                return { ...x, sub: x.group, local: local && ccy && ccy !== 'KRW' ? signedMoney(x.pnlKrw / r.usdkrw, ccy) : undefined };
              })}
            />
          ) : (
            <p className="empty">이 기간에 손익이 난 종목이 없습니다.</p>
          )}
          <p className="sub">기여도 = 종목의 기간 손익(지금 평가액 − 시작 평가액 + 매도·배당으로 받은 돈 − 매수에 쓴 돈) ÷ 기간 시작 평가액. 합치면 단순 수익률이 되어 위의 시간가중수익률과는 다를 수 있습니다.</p>
        </div>
        <div className="card stack" id="contrib-group">
          <h2>자산 유형별</h2>
          {c.byGroup.length ? <Bars compact rows={c.byGroup.map((g) => ({ key: g.label, ...g, label: `${g.label} ${signedKrwShort(g.pnlKrw)}` }))} /> : <p className="empty">—</p>}
        </div>
      </section>
    </>
  );
}
