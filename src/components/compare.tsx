'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { CompareView } from '@/server/services/compare';
import { MetricsTable } from '@/components/metrics';

const COLORS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)', 'var(--series-6)', 'var(--series-7)', 'var(--ink-2)'];
const KIND_BADGE: Record<string, string> = { real: '실제', virtual: '가상', index: '지수' };
const pct = (v: number | null | undefined, d = 1) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${(v * 100).toFixed(d)}%`);
const tone = (v: number | null | undefined) => (v === null || v === undefined ? '' : v >= 0 ? 'up' : 'down');

export function ComparePicker({ view }: { view: CompareView }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const toggle = (key: string) => {
    const next = view.picked.includes(key) ? view.picked.filter((k) => k !== key) : [...view.picked, key].slice(0, 8);
    const q = new URLSearchParams();
    for (const [k, v] of sp.entries()) if (k !== 'p') q.append(k, v);
    q.set('p', next.join(','));
    router.push(`${pathname}?${q.toString()}`, { scroll: false });
  };
  const groups: { kind: string; title: string }[] = [
    { kind: 'real', title: '실제 포트폴리오' },
    { kind: 'virtual', title: '가상 포트폴리오' },
    { kind: 'index', title: '지수 (원화)' },
  ];
  return (
    <section className="card stack" style={{ gap: 10 }} aria-label="비교할 포트폴리오">
      <span className="sub">비교할 것을 고르세요(8개까지). 실제 포트폴리오는 입출금을 뺀 시간가중 수익률, 가상 포트폴리오는 새로 넣은 돈을 뺀 시간가중 수익률, 지수는 원화로 바꾼 값입니다.</span>
      {groups.map((g) => {
        const opts = view.options.filter((o) => o.kind === g.kind);
        if (!opts.length) return null;
        return (
          <div key={g.kind} className="inline" style={{ gap: 6, flexWrap: 'wrap' }}>
            <span className="sub" style={{ minWidth: 110 }}>{g.title}</span>
            {opts.map((o) => {
              const i = view.picked.indexOf(o.key);
              return (
                <button key={o.key} type="button" className="chip-btn" aria-pressed={i >= 0} onClick={() => toggle(o.key)}>
                  {i >= 0 && <span className="dot" style={{ background: COLORS[view.series.findIndex((s) => s.key === o.key) % COLORS.length] ?? 'var(--muted)' }} />}
                  {o.label}
                </button>
              );
            })}
          </div>
        );
      })}
    </section>
  );
}

function BenchmarkPick({ view }: { view: CompareView }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  return (
    <label className="inline" style={{ gap: 6 }}>
      <span className="sub">기준 지수</span>
      <select
        value={view.benchmark.key}
        onChange={(e) => {
          const q = new URLSearchParams(sp.toString());
          q.set('bm', e.target.value);
          router.push(`${pathname}?${q.toString()}`, { scroll: false });
        }}
        aria-label="기준 지수"
        style={{ width: 'auto' }}
      >
        {view.options.filter((o) => o.kind === 'index').map((o) => (
          <option key={o.key} value={o.key}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

export function CompareResults({ view }: { view: CompareView }) {
  if (!view.series.length) return <p className="empty">비교할 자료가 없습니다. 위에서 포트폴리오를 고르거나 기간을 늘려 보세요.</p>;
  const rows = view.dates.map((date, i) => {
    const r: Record<string, number | string> = { date };
    for (const s of view.series) r[s.key] = Number(((s.values[i] - 1) * 100).toFixed(2));
    return r;
  });
  const years = [...new Set(view.series.flatMap((s) => s.yearly.map((y) => y.year)))].sort();
  const yearRows = years.map((y) => {
    const r: Record<string, number | string | null> = { year: y };
    for (const s of view.series) {
      const hit = s.yearly.find((x) => x.year === y);
      r[s.key] = hit ? Number((hit.ret * 100).toFixed(2)) : null;
    }
    return r;
  });
  const color = (k: string) => COLORS[view.series.findIndex((s) => s.key === k) % COLORS.length];
  return (
    <div className="stack" style={{ gap: 16 }}>
      {view.missing.length > 0 && <p className="sub">자료가 없어 빠진 것: {view.missing.join(', ')} (그 기간에 거래나 매수가 없었을 수 있습니다)</p>}
      <section className="card indicator" aria-label="누적 수익률">
        <div className="stack" style={{ gap: 4 }}>
          <h3>누적 수익률</h3>
          <span className="sub">{view.dates[0]} ~ {view.dates.at(-1)}. 가장 늦게 시작한 것의 첫날을 0%로 맞췄습니다.</span>
        </div>
        <ResponsiveContainer width="100%" height={340}>
          <LineChart data={rows} margin={{ left: 0, right: 12, top: 8, bottom: 4 }}>
            <CartesianGrid stroke="var(--line-soft)" />
            <XAxis dataKey="date" tickFormatter={(v: string) => v.slice(2, 7).replace('-', '.')} minTickGap={40} stroke="var(--muted)" fontSize={11} />
            <YAxis tickFormatter={(v: number) => `${v}%`} stroke="var(--muted)" fontSize={11} width={52} />
            <Tooltip formatter={(v, n) => [`${Number(v) > 0 ? '+' : ''}${Number(v).toFixed(2)}%`, view.series.find((s) => s.key === n)?.label ?? String(n)]} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)' }} />
            <Legend formatter={(k: string) => view.series.find((s) => s.key === k)?.label ?? k} />
            <ReferenceLine y={0} stroke="var(--muted)" />
            {view.series.map((s) => (
              <Line key={s.key} dataKey={s.key} stroke={color(s.key)} strokeWidth={s.kind === 'index' ? 1.4 : 2.2} strokeDasharray={s.kind === 'index' ? '5 4' : s.kind === 'virtual' ? '1 0' : undefined} dot={false} animationDuration={1200} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </section>
      <section className="card indicator" aria-label="성과 지표">
        <div className="inline spread" style={{ gap: 8, flexWrap: 'wrap' }}>
          <div className="stack" style={{ gap: 4 }}>
            <h3>성과 지표</h3>
            <span className="sub">같은 기간 하루(또는 주) 수익률로 계산했습니다. 머리글에 마우스를 올리거나 아래 지표 설명을 펼치면 뜻이 나옵니다.</span>
          </div>
          <BenchmarkPick view={view} />
        </div>
        <MetricsTable rows={view.series.map((s) => ({ key: s.key, label: s.label, badge: KIND_BADGE[s.kind], color: color(s.key), metrics: s.metrics }))} benchmark={view.benchmark.label} periodName="거래일" />
      </section>
      <div className="ind-grid">
        <section className="card indicator" aria-label="연도별 수익률">
          <div className="stack" style={{ gap: 4 }}>
            <h3>연도별 수익률</h3>
            <span className="sub">기간의 첫해와 마지막 해는 일부 기간만 들어갑니다.</span>
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={yearRows} margin={{ left: 0, right: 12, top: 8, bottom: 4 }}>
              <CartesianGrid stroke="var(--line-soft)" vertical={false} />
              <XAxis dataKey="year" stroke="var(--muted)" fontSize={11} />
              <YAxis tickFormatter={(v: number) => `${v}%`} stroke="var(--muted)" fontSize={11} width={48} />
              <Tooltip formatter={(v, n) => [`${Number(v) > 0 ? '+' : ''}${Number(v).toFixed(1)}%`, view.series.find((s) => s.key === n)?.label ?? String(n)]} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)' }} />
              <ReferenceLine y={0} stroke="var(--muted)" />
              {view.series.map((s) => (
                <Bar key={s.key} dataKey={s.key} fill={color(s.key)} animationDuration={700} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </section>
        <section className="card indicator" aria-label="상관관계">
          <div className="stack" style={{ gap: 4 }}>
            <h3>상관관계</h3>
            <span className="sub">하루 수익률의 상관계수. 1에 가까우면 같이 움직이고, 0 근처면 따로, 음수면 반대로 움직입니다. 함께 들고 있을 때 분산 효과를 가늠합니다.</span>
          </div>
          <div className="table-wrap">
            <table className="heat" style={{ borderCollapse: 'separate', borderSpacing: 3, width: 'auto' }}>
              <thead>
                <tr>
                  <th />
                  {view.series.map((s) => (
                    <th key={s.key} style={{ fontSize: 11, padding: '0 4px', maxWidth: 80, whiteSpace: 'normal', fontWeight: 500 }}>{s.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {view.series.map((a, i) => (
                  <tr key={a.key}>
                    <th scope="row" className="l" style={{ fontSize: 12, paddingRight: 8, fontWeight: 500, whiteSpace: 'nowrap' }}>{a.label}</th>
                    {view.series.map((b, j) => {
                      const v = view.corr[i][j];
                      return (
                        <td key={b.key} style={{ width: 56, height: 34, textAlign: 'center', borderRadius: 4, fontSize: 12, background: v === null ? 'var(--line-soft)' : `color-mix(in srgb, var(${v >= 0 ? '--up' : '--down'}) ${Math.round(Math.abs(v) * 75)}%, var(--surface))`, color: v !== null && Math.abs(v) > 0.6 ? '#fff' : 'var(--ink)' }}>
                          {v === null ? '—' : v.toFixed(2)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
