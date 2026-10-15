'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { RiskStats } from '@/domain/risk';

interface RiskView {
  period: 1 | 3 | 5;
  covered: number;
  excluded: { name: string; reason: string }[];
  dates: { from: string; to: string } | null;
  stats: RiskStats | null;
  bench: { kospi: RiskStats | null; spy: RiskStats | null };
  holdings: { key: string; name: string; symbol: string; weight: number; contribution: number; vol: number; betaKospi: number | null; betaSpy: number | null }[];
  corr: { keys: string[]; labels: string[]; matrix: number[][] };
  factors: { key: string; label: string; beta: number; about: string }[];
  r2: number | null;
  rolling: { date: string; kospi: number | null; spy: number | null }[];
  growth: { date: string; mine: number; kospi: number | null; spy: number | null; drawdown: number }[];
}

const pct = (v: number | null | undefined, d = 1) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(d)}%`);
const signed = (v: number | null | undefined, d = 1) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${(v * 100).toFixed(d)}%`);
const tip = { background: 'var(--surface)', border: '1px solid var(--line)' };

export function Risk() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const years = [1, 3, 5].includes(Number(sp.get('y'))) ? Number(sp.get('y')) : 3;
  const url = `/api/risk?years=${years}`;
  const [state, setState] = useState<{ url: string; data: RiskView | null; error: string | null }>({ url: '', data: null, error: null });
  useEffect(() => {
    let live = true;
    fetch(url, { cache: 'no-store' })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? '불러오지 못했습니다.');
        if (live) setState({ url, data: j, error: null });
      })
      .catch((e) => live && setState({ url, data: null, error: e instanceof Error ? e.message : '불러오지 못했습니다.' }));
    return () => {
      live = false;
    };
  }, [url]);
  const d = state.url === url ? state.data : null;
  const error = state.url === url ? state.error : null;
  return (
    <div className="stack" style={{ gap: 16 }}>
      <section className="card stack" style={{ gap: 8 }} aria-label="리스크 분석 설정">
        <div className="inline spread" style={{ gap: 12, flexWrap: 'wrap' }}>
          <div className="seg" role="group" aria-label="기간">
            {[1, 3, 5].map((y) => (
              <button key={y} type="button" aria-current={years === y ? 'true' : undefined} onClick={() => router.replace(`${pathname}?y=${y}`, { scroll: false })}>
                최근 {y}년
              </button>
            ))}
          </div>
          {d?.dates && <span className="sub">{d.dates.from} ~ {d.dates.to} · 상장 자산의 {pct(d.covered, 0)}를 분석</span>}
        </div>
        <p className="sub" style={{ margin: 0 }}>지금 들고 있는 상장 종목을 오늘 비중 그대로 기간 내내 들고 있었다고 가정해 원화로 계산한 값입니다(실제 계좌 수익률과는 다름). 계좌 포트폴리오만 셉니다.</p>
      </section>
      {error ? (
        <p className="msg err">{error}</p>
      ) : !d ? (
        <p className="empty">불러오는 중… 보유 종목과 비교 지수의 일별 시세를 받느라 처음에는 10초쯤 걸립니다.</p>
      ) : !d.stats ? (
        <p className="empty">분석할 상장 종목이 없습니다. {d.excluded.length ? `빠진 자산: ${d.excluded.map((e) => `${e.name}(${e.reason})`).join(', ')}` : ''}</p>
      ) : (
        <Body d={d} />
      )}
    </div>
  );
}

function Body({ d }: { d: RiskView }) {
  const s = d.stats!;
  const rows: [string, (x: RiskStats) => string][] = [
    ['연 변동성', (x) => pct(x.vol)],
    ['연 수익률', (x) => signed(x.cagr)],
    ['최대 낙폭', (x) => pct(x.maxDrawdown)],
    ['하루 VaR 95%', (x) => pct(x.var95, 2)],
    ['하루 CVaR 95%', (x) => pct(x.cvar95, 2)],
    ['샤프 지수', (x) => (x.sharpe === null ? '—' : x.sharpe.toFixed(2))],
  ];
  const contrib = d.holdings.slice(0, 15).map((h) => ({ name: h.name.length > 12 ? `${h.name.slice(0, 12)}…` : h.name, 비중: h.weight, '위험 기여': h.contribution }));
  return (
    <>
      <section className="card indicator" aria-label="리스크 요약">
        <div className="stack" style={{ gap: 4 }}>
          <h3>얼마나 흔들리나</h3>
          <span className="sub">
            최대 낙폭은 {s.drawdownFrom} ~ {s.drawdownTo}. 가장 크게 빠진 날은 {s.worstDay?.date} ({pct(s.worstDay?.ret, 2)}). VaR 95%는 스무 날에 하루쯤 이보다 더 잃는다는 뜻이고, CVaR는 그런 날의 평균 손실입니다.
          </span>
        </div>
        <div className="table-wrap">
          <table className="rank">
            <thead>
              <tr>
                <th className="l" />
                {rows.map(([l]) => (
                  <th key={l} className="num">{l}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ['내 포트폴리오', s],
                  ['코스피', d.bench.kospi],
                  ['S&P 500 (원화)', d.bench.spy],
                ] as const
              ).map(([label, x]) => (
                <tr key={label} style={label === '내 포트폴리오' ? { fontWeight: 700 } : undefined}>
                  <th scope="row" className="l">{label}</th>
                  {rows.map(([l, f]) => (
                    <td key={l} className="num">{x ? f(x) : '—'}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <div className="ind-grid">
        <section className="card indicator" aria-label="가치 변화">
          <div className="stack" style={{ gap: 4 }}>
            <h3>1이 어떻게 변했나</h3>
            <span className="sub">기간 처음 1원을 넣었다면. 코스피·S&P 500(원화 환산)과 비교합니다.</span>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={d.growth} margin={{ left: 0, right: 12, top: 8, bottom: 4 }}>
              <CartesianGrid stroke="var(--line-soft)" />
              <XAxis dataKey="date" tickFormatter={(v: string) => v.slice(2, 7).replace('-', '.')} minTickGap={40} stroke="var(--muted)" fontSize={11} />
              <YAxis domain={['auto', 'auto']} tickFormatter={(v: number) => v.toFixed(2)} stroke="var(--muted)" fontSize={11} width={40} />
              <Tooltip formatter={(v, n) => [Number(v).toFixed(3), String(n)]} contentStyle={tip} />
              <Legend />
              <ReferenceLine y={1} stroke="var(--muted)" />
              <Line dataKey="mine" name="내 포트폴리오" stroke="var(--series-1)" strokeWidth={2.2} dot={false} animationDuration={1200} />
              <Line dataKey="kospi" name="코스피" stroke="var(--series-3)" dot={false} animationDuration={1200} />
              <Line dataKey="spy" name="S&P 500 (원화)" stroke="var(--series-4)" dot={false} animationDuration={1200} />
            </LineChart>
          </ResponsiveContainer>
        </section>
        <section className="card indicator" aria-label="낙폭">
          <div className="stack" style={{ gap: 4 }}>
            <h3>고점 대비 낙폭</h3>
            <span className="sub">그때까지의 최고점에서 얼마나 내려와 있었는지. 깊이와 회복에 걸린 시간을 봅니다.</span>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={d.growth} margin={{ left: 0, right: 12, top: 8, bottom: 4 }}>
              <CartesianGrid stroke="var(--line-soft)" />
              <XAxis dataKey="date" tickFormatter={(v: string) => v.slice(2, 7).replace('-', '.')} minTickGap={40} stroke="var(--muted)" fontSize={11} />
              <YAxis tickFormatter={(v: number) => `${Math.round(v * 100)}%`} stroke="var(--muted)" fontSize={11} width={44} />
              <Tooltip formatter={(v) => pct(Number(v))} contentStyle={tip} />
              <Area dataKey="drawdown" name="낙폭" stroke="var(--down)" fill="var(--down)" fillOpacity={0.25} animationDuration={1200} />
            </AreaChart>
          </ResponsiveContainer>
        </section>
        <section className="card indicator" aria-label="위험 기여">
          <div className="stack" style={{ gap: 4 }}>
            <h3>비중 vs 위험 기여</h3>
            <span className="sub">위험 기여는 포트폴리오 변동(분산) 가운데 그 종목 몫입니다. 비중보다 기여가 훨씬 크면 그 종목이 흔들림을 주도합니다(상위 15개).</span>
          </div>
          <ResponsiveContainer width="100%" height={Math.max(220, contrib.length * 30)}>
            <BarChart data={contrib} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
              <CartesianGrid horizontal={false} stroke="var(--line-soft)" />
              <XAxis type="number" tickFormatter={(v: number) => `${Math.round(v * 100)}%`} stroke="var(--muted)" fontSize={11} />
              <YAxis type="category" dataKey="name" width={110} stroke="var(--muted)" fontSize={11} interval={0} />
              <Tooltip formatter={(v) => pct(Number(v))} contentStyle={tip} />
              <Legend />
              <Bar dataKey="비중" fill="color-mix(in srgb, var(--series-1) 40%, var(--surface))" animationDuration={600} />
              <Bar dataKey="위험 기여" fill="var(--series-1)" animationDuration={600} />
            </BarChart>
          </ResponsiveContainer>
        </section>
        <section className="card indicator" aria-label="요인 노출">
          <div className="stack" style={{ gap: 4 }}>
            <h3>요인 노출</h3>
            <span className="sub">포트폴리오 하루 수익률을 요인 대리 지표로 회귀한 계수. 1이면 그 요인과 같은 크기로, 음수면 반대로 움직입니다. 설명력 R² {d.r2 === null ? '—' : pct(d.r2, 0)}.</span>
          </div>
          <ResponsiveContainer width="100%" height={Math.max(220, d.factors.length * 30)}>
            <BarChart data={d.factors} layout="vertical" margin={{ left: 8, right: 40, top: 4, bottom: 4 }}>
              <CartesianGrid horizontal={false} stroke="var(--line-soft)" />
              <XAxis type="number" stroke="var(--muted)" fontSize={11} />
              <YAxis type="category" dataKey="label" width={110} stroke="var(--muted)" fontSize={11} interval={0} />
              <Tooltip formatter={(v) => Number(v).toFixed(2)} labelFormatter={(l) => `${l} — ${d.factors.find((f) => f.label === l)?.about ?? ''}`} contentStyle={tip} />
              <ReferenceLine x={0} stroke="var(--muted)" />
              <Bar dataKey="beta" name="계수" animationDuration={600} label={{ position: 'right', fontSize: 11, fill: 'var(--ink-2)', formatter: (v: unknown) => Number(v).toFixed(2) }}>
                {d.factors.map((f) => (
                  <Cell key={f.key} fill={f.beta >= 0 ? 'var(--up)' : 'var(--down)'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <p className="sub">스타일 요인은 미국 ETF 차이(소형 IWM−SPY, 가치 IWD−IWF, 모멘텀 MTUM−SPY, 저변동 USMV−SPY)로 만든 대리 지표라 한국 종목에는 근사입니다.</p>
        </section>
        <section className="card indicator" aria-label="베타 변화">
          <div className="stack" style={{ gap: 4 }}>
            <h3>시장 민감도(베타) 변화</h3>
            <span className="sub">최근 6개월(126거래일) 창으로 잰 베타가 시간에 따라 어떻게 움직였는지. 1보다 크면 시장보다 더 크게 흔들립니다.</span>
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={d.rolling} margin={{ left: 0, right: 12, top: 8, bottom: 4 }}>
              <CartesianGrid stroke="var(--line-soft)" />
              <XAxis dataKey="date" tickFormatter={(v: string) => v.slice(2, 7).replace('-', '.')} minTickGap={40} stroke="var(--muted)" fontSize={11} />
              <YAxis domain={['auto', 'auto']} stroke="var(--muted)" fontSize={11} width={36} />
              <Tooltip formatter={(v, n) => [Number(v).toFixed(2), String(n)]} contentStyle={tip} />
              <Legend />
              <ReferenceLine y={1} stroke="var(--muted)" strokeDasharray="4 3" />
              <Line dataKey="kospi" name="코스피 베타" stroke="var(--series-3)" dot={false} strokeWidth={2} animationDuration={1200} />
              <Line dataKey="spy" name="S&P 500 베타" stroke="var(--series-4)" dot={false} strokeWidth={2} animationDuration={1200} />
            </LineChart>
          </ResponsiveContainer>
        </section>
        <section className="card indicator" aria-label="상관관계">
          <div className="stack" style={{ gap: 4 }}>
            <h3>종목 간 상관관계</h3>
            <span className="sub">비중이 큰 12종목의 하루 수익률 상관계수. 1에 가까운(진한 빨강) 종목끼리는 같이 움직여 분산 효과가 작습니다.</span>
          </div>
          <div className="table-wrap">
            <table className="heat" style={{ borderCollapse: 'separate', borderSpacing: 2, width: 'auto' }}>
              <thead>
                <tr>
                  <th />
                  {d.corr.labels.map((l, i) => (
                    <th key={i} style={{ fontSize: 10, writingMode: 'vertical-rl', transform: 'rotate(180deg)', padding: 2, border: 0, maxHeight: 90, whiteSpace: 'nowrap', overflow: 'hidden' }}>{l.slice(0, 10)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {d.corr.matrix.map((row, i) => (
                  <tr key={i}>
                    <th scope="row" className="l" style={{ fontSize: 11, paddingRight: 6, border: 0, whiteSpace: 'nowrap', fontWeight: 500 }}>{d.corr.labels[i].slice(0, 12)}</th>
                    {row.map((v, j) => (
                      <td key={j} title={`${d.corr.labels[i]} · ${d.corr.labels[j]}: ${v.toFixed(2)}`} style={{ width: 30, height: 26, padding: 0, border: 0, borderRadius: 3, textAlign: 'center', fontSize: 10, background: `color-mix(in srgb, var(${v >= 0 ? '--up' : '--down'}) ${Math.round(Math.abs(v) * 80)}%, var(--surface))`, color: Math.abs(v) > 0.6 ? '#fff' : 'var(--ink)' }}>
                        {i === j ? '' : v.toFixed(1)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
      <section className="card indicator" aria-label="종목별 위험">
        <div className="stack" style={{ gap: 4 }}>
          <h3>종목별</h3>
          <span className="sub">연 변동성과 코스피·S&P 500(달러) 대비 베타.</span>
        </div>
        <div className="table-wrap">
          <table className="rank">
            <thead>
              <tr>
                <th className="l">종목</th>
                <th className="num">비중</th>
                <th className="num">위험 기여</th>
                <th className="num">연 변동성</th>
                <th className="num">코스피 베타</th>
                <th className="num">S&P 500 베타</th>
              </tr>
            </thead>
            <tbody>
              {d.holdings.map((h) => (
                <tr key={h.key}>
                  <th scope="row" className="l">
                    {h.name}
                    <span className="sub" style={{ display: 'block' }}>{h.symbol}</span>
                  </th>
                  <td className="num">{pct(h.weight)}</td>
                  <td className="num strong" style={{ color: h.contribution > h.weight * 1.5 ? 'var(--up)' : undefined }}>{pct(h.contribution)}</td>
                  <td className="num">{pct(h.vol, 0)}</td>
                  <td className="num">{h.betaKospi?.toFixed(2) ?? '—'}</td>
                  <td className="num">{h.betaSpy?.toFixed(2) ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {d.excluded.length > 0 && <p className="sub">빠진 자산: {d.excluded.map((e) => `${e.name}(${e.reason})`).join(' · ')}</p>}
      </section>
    </>
  );
}
