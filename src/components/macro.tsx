'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Bar, CartesianGrid, ComposedChart, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { KEY_HELP } from '@/components/analysis-board';
import { frameLabel, TimelineControl, useTimeline } from '@/components/timeline';
import { TRANSFORM_LABEL, type Transform } from '@/domain/fred';
import { PHASE_ABOUT, quadrantOf, WB_INDICATORS, type CliFrame, type CliPhase, type CotSummary, type Quadrant, type RrgPoint } from '@/domain/macro';

interface CountryRow {
  iso: string;
  label: string;
  cli: { date: string; level: number; change3: number; phase: CliPhase } | null;
  wb: Record<string, { year: string; value: number } | null>;
  index: { symbol: string; label: string; returns: Record<string, number | null> };
  y10: number | null;
}
interface CountriesView {
  rows: CountryRow[];
  frames: CliFrame;
  errors: string[];
}
interface CycleView {
  months: string[];
  rows: { code: string; label: string; group: string; invert: boolean; yoy: boolean; phases: (CliPhase | null)[]; last: { date: string; value: number } | null }[];
  breadth: (number | null)[];
  errors: string[];
}
interface RotationView {
  weeks: string[];
  sectors: { symbol: string; label: string; points: (RrgPoint | null)[] }[];
}
interface CotView {
  contracts: { code: string; label: string; group: string; summary: CotSummary | null; history: { date: string; net: number; netPct: number }[] }[];
  errors: string[];
}
interface GdpView {
  us: { parts: { key: string; label: string }[]; rows: Record<string, number | string | null>[] };
  kr: { parts: { key: string; label: string }[]; rows: Record<string, number | string | null>[] } | null;
  missing: 'ECOS'[];
  errors: string[];
}

const TABS = [
  { key: 'countries', label: '국가 비교' },
  { key: 'cycle', label: '미국 경기 국면' },
  { key: 'rotation', label: '섹터 순환' },
  { key: 'cot', label: '선물 포지션' },
  { key: 'gdp', label: 'GDP 기여도' },
  { key: 'calendar', label: '경제 지표 일정' },
  { key: 'sheet', label: '내 지표 시트' },
] as const;
type Tab = (typeof TABS)[number]['key'];

const COLORS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)', 'var(--series-6)', 'var(--series-7)'];
const PHASE_COLOR: Record<CliPhase, string> = {
  확장: 'var(--up)',
  둔화: 'color-mix(in srgb, var(--up) 45%, var(--surface))',
  수축: 'var(--down)',
  회복: 'color-mix(in srgb, var(--down) 45%, var(--surface))',
};
const QUAD_COLOR: Record<Quadrant, string> = { 주도: 'var(--up)', 약화: 'color-mix(in srgb, var(--up) 50%, var(--surface))', 소외: 'var(--down)', 개선: 'color-mix(in srgb, var(--down) 50%, var(--surface))' };
const pct = (v: number | null | undefined, d = 1) => (v === null || v === undefined ? '—' : `${v > 0 ? '+' : ''}${(v * 100).toFixed(d)}%`);
const num = (v: number | null | undefined, d = 1) => (v === null || v === undefined ? '—' : v.toFixed(d));

function useView<T>(url: string): { data: T | null; error: string | null } {
  const [state, setState] = useState<{ url: string | null; data: T | null; error: string | null }>({ url: null, data: null, error: null });
  useEffect(() => {
    let live = true;
    fetch(url, { cache: 'no-store' })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? '불러오지 못했습니다.');
        if (live) setState({ url, data: j as T, error: null });
      })
      .catch((e) => live && setState({ url, data: null, error: e instanceof Error ? e.message : '불러오지 못했습니다.' }));
    return () => {
      live = false;
    };
  }, [url]);
  return { data: state.url === url ? state.data : null, error: state.url === url ? state.error : null };
}

function Errors({ errors }: { errors: string[] }) {
  return errors.length ? <p className="sub">일부 자료를 새로 받지 못해 저장해 둔 값을 보여 줍니다: {errors.join(' · ')}</p> : null;
}

export function Macro() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const tab = (TABS.some((t) => t.key === sp.get('tab')) ? sp.get('tab') : 'countries') as Tab;
  return (
    <div className="stack" style={{ gap: 16 }}>
      <section className="card stack" style={{ gap: 12 }} aria-label="글로벌 매크로 설정">
        <div className="seg" role="tablist" aria-label="화면">
          {TABS.map((t) => (
            <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} aria-pressed={tab === t.key} onClick={() => router.replace(`${pathname}?tab=${t.key}`, { scroll: false })}>
              {t.label}
            </button>
          ))}
        </div>
      </section>
      {tab === 'countries' ? <CountriesTab /> : tab === 'cycle' ? <CycleTab /> : tab === 'rotation' ? <RotationTab /> : tab === 'cot' ? <CotTab /> : tab === 'calendar' ? <CalendarTab /> : tab === 'sheet' ? <SheetTab /> : <GdpTab />}
    </div>
  );
}

// ------------------------------------------------------------------ countries

function CountriesTab() {
  const { data, error } = useView<CountriesView>('/api/macro?view=countries');
  if (error) return <p className="msg err">{error}</p>;
  if (!data) return <p className="empty">불러오는 중… 처음에는 OECD·세계은행 자료를 받느라 10초쯤 걸립니다.</p>;
  return <CountriesBody d={data} />;
}

function PhaseBadge({ phase }: { phase: CliPhase }) {
  return (
    <span className="badge" style={{ background: PHASE_COLOR[phase], color: phase === '확장' || phase === '수축' ? '#fff' : 'var(--ink)' }} title={PHASE_ABOUT[phase]}>
      {phase}
    </span>
  );
}

const CLOCK_W = 640;
const CLOCK_H = 420;

function CountriesBody({ d }: { d: CountriesView }) {
  const t = useTimeline(d.frames.dates.length);
  const [sort, setSort] = useState<string>('cli');
  const val = (r: CountryRow) => (sort === 'cli' ? (r.cli?.level ?? -1) : sort === 'idx' ? (r.index.returns['1Y'] ?? -9) : (r.wb[sort]?.value ?? -999));
  const rows = [...d.rows].sort((a, b) => val(b) - val(a));
  const frame = d.frames.dates.length ? t.i : -1;
  // Scales: level − 100 across, 3-month change up; fixed over the replay so the dots move, not the axes
  const all = Object.values(d.frames.values).flatMap((v) => v.filter((x): x is [number, number] => !!x));
  const sx = Math.max(1.5, ...all.map((v) => Math.abs(v[0]))) * 1.08;
  const sy = Math.max(0.8, ...all.map((v) => Math.abs(v[1]))) * 1.08;
  const X = (v: number) => CLOCK_W / 2 + (v / sx) * (CLOCK_W / 2 - 24);
  const Y = (v: number) => CLOCK_H / 2 - (v / sy) * (CLOCK_H / 2 - 24);
  const label = (iso: string) => d.rows.find((r) => r.iso === iso)?.label ?? iso;
  return (
    <div className="stack" style={{ gap: 16 }}>
      <Errors errors={d.errors} />
      <section className="card indicator" aria-label="국가 비교 표">
        <div className="inline spread" style={{ gap: 8, flexWrap: 'wrap' }}>
          <div className="stack" style={{ gap: 4 }}>
            <h3>나라별 경기와 시장</h3>
            <span className="sub">OECD 경기선행지수(CLI, 100 = 장기 추세)와 국면, 세계은행 연간 지표(괄호는 해), 대표 주가지수 수익률, 10년 국채 금리. 머리글을 누르면 그 기준으로 정렬합니다.</span>
          </div>
        </div>
        <div className="table-wrap">
          <table className="rank">
            <thead>
              <tr>
                <th className="l">나라</th>
                <th className="num"><button type="button" className="linklike" aria-pressed={sort === 'cli'} onClick={() => setSort('cli')}>선행지수</button></th>
                <th className="num">3개월 변화</th>
                <th className="l">국면</th>
                {WB_INDICATORS.map((i) => (
                  <th key={i.key} className="num"><button type="button" className="linklike" aria-pressed={sort === i.key} onClick={() => setSort(i.key)}>{i.label}</button></th>
                ))}
                <th className="l">주가지수</th>
                <th className="num">1개월</th>
                <th className="num">연초 이후</th>
                <th className="num"><button type="button" className="linklike" aria-pressed={sort === 'idx'} onClick={() => setSort('idx')}>1년</button></th>
                <th className="num">10년 금리</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.iso}>
                  <th scope="row" className="l">{r.label}</th>
                  <td className="num">{r.cli ? r.cli.level.toFixed(2) : '—'}</td>
                  <td className={`num ${(r.cli?.change3 ?? 0) >= 0 ? 'up' : 'down'}`}>{r.cli ? `${r.cli.change3 > 0 ? '+' : ''}${r.cli.change3.toFixed(2)}` : '—'}</td>
                  <td className="l">{r.cli ? <PhaseBadge phase={r.cli.phase} /> : '—'}</td>
                  {WB_INDICATORS.map((i) => (
                    <td key={i.key} className="num">
                      {r.wb[i.key] ? `${r.wb[i.key]!.value.toFixed(1)}%` : '—'}
                      {r.wb[i.key] && <span className="sub" style={{ fontSize: 10 }}> ({r.wb[i.key]!.year.slice(2)})</span>}
                    </td>
                  ))}
                  <td className="l sub">{r.index.label}</td>
                  {(['1M', 'YTD', '1Y'] as const).map((p) => (
                    <td key={p} className={`num ${(r.index.returns[p] ?? 0) >= 0 ? 'up' : 'down'}`}>{pct(r.index.returns[p])}</td>
                  ))}
                  <td className="num">{r.y10 === null ? '—' : `${r.y10.toFixed(2)}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="sub">국면: {(Object.keys(PHASE_ABOUT) as CliPhase[]).map((p) => `${p} = ${PHASE_ABOUT[p]}`).join(' · ')}. 10년 금리는 *시장 개요*에서 받은 다섯 나라만 있습니다.</p>
      </section>
      <section className="card indicator" aria-label="경기 시계">
        <div className="stack" style={{ gap: 4 }}>
          <h3>경기 시계 ({frameLabel(d.frames.dates[frame])})</h3>
          <span className="sub">가로는 선행지수 수준(100에서 얼마나 위·아래), 세로는 3개월 변화. 나라들은 보통 회복(왼쪽 위) → 확장(오른쪽 위) → 둔화(오른쪽 아래) → 수축(왼쪽 아래)으로 시계 방향으로 돕니다. ▶로 최근 5년을 달마다 재생하고, 꼬리는 지난 6개월 궤적입니다.</span>
        </div>
        <TimelineControl t={t} dates={d.frames.dates} label="달" />
        <div className="mo-map-wrap">
          <svg viewBox={`0 0 ${CLOCK_W} ${CLOCK_H}`} className="mo-map" style={{ minWidth: 520 }} role="img" aria-label="나라별 경기 시계">
            <rect x={CLOCK_W / 2} y={0} width={CLOCK_W / 2} height={CLOCK_H / 2} fill={PHASE_COLOR.확장} opacity={0.08} />
            <rect x={CLOCK_W / 2} y={CLOCK_H / 2} width={CLOCK_W / 2} height={CLOCK_H / 2} fill={PHASE_COLOR.둔화} opacity={0.12} />
            <rect x={0} y={CLOCK_H / 2} width={CLOCK_W / 2} height={CLOCK_H / 2} fill={PHASE_COLOR.수축} opacity={0.08} />
            <rect x={0} y={0} width={CLOCK_W / 2} height={CLOCK_H / 2} fill={PHASE_COLOR.회복} opacity={0.12} />
            <line x1={CLOCK_W / 2} x2={CLOCK_W / 2} y1={0} y2={CLOCK_H} stroke="var(--line)" />
            <line x1={0} x2={CLOCK_W} y1={CLOCK_H / 2} y2={CLOCK_H / 2} stroke="var(--line)" />
            {(['회복', '확장', '수축', '둔화'] as CliPhase[]).map((p, k) => (
              <text key={p} x={k % 2 ? CLOCK_W - 10 : 10} y={k < 2 ? 18 : CLOCK_H - 10} textAnchor={k % 2 ? 'end' : 'start'} fontSize={13} fontWeight={600} fill="var(--muted)">{p}</text>
            ))}
            {Object.entries(d.frames.values).map(([iso, v], ci) => {
              const cur = frame >= 0 ? v[frame] : null;
              const tail = v.slice(Math.max(0, frame - 6), frame + 1).filter((x): x is [number, number] => !!x);
              if (!cur) return null;
              const color = COLORS[ci % COLORS.length];
              return (
                <g key={iso}>
                  <polyline points={tail.map((p) => `${X(p[0])},${Y(p[1])}`).join(' ')} fill="none" stroke={color} strokeOpacity={0.45} strokeWidth={1.5} />
                  <g className="rrg-dot" style={{ transform: `translate(${X(cur[0])}px, ${Y(cur[1])}px)` }}>
                    <circle r={6} fill={color} stroke="var(--surface)" strokeWidth={1.5} />
                    <text x={9} y={4} fontSize={12} fontWeight={600} fill="var(--ink)">{label(iso)}</text>
                  </g>
                </g>
              );
            })}
          </svg>
        </div>
      </section>
      <p className="sub">출처: OECD Composite Leading Indicators (진폭 조정), 세계은행 World Development Indicators, Yahoo Finance.</p>
    </div>
  );
}

// ------------------------------------------------------------------ US cycle

const WINDOW = 36;

function CycleTab() {
  const { data, error } = useView<CycleView>('/api/macro?view=cycle');
  if (error) return <p className="msg err">{error}</p>;
  if (!data) return <p className="empty">불러오는 중… 처음에는 FRED에서 지표 18개를 받느라 10초쯤 걸립니다.</p>;
  return <CycleBody d={data} />;
}

function CycleBody({ d }: { d: CycleView }) {
  const t = useTimeline(d.months.length);
  const end = t.i;
  const from = Math.max(0, end - WINDOW + 1);
  const cols = d.months.slice(from, end + 1).map((m, j) => ({ m, j: from + j }));
  const groups = [...new Set(d.rows.map((r) => r.group))];
  const now = d.rows.map((r) => r.phases[end]).filter((p): p is CliPhase => !!p);
  const count = (p: CliPhase) => now.filter((x) => x === p).length;
  return (
    <div className="stack" style={{ gap: 16 }}>
      <Errors errors={d.errors} />
      <section className="card indicator" aria-label="경기 국면 히트맵">
        <div className="inline spread" style={{ gap: 8, flexWrap: 'wrap' }}>
          <div className="stack" style={{ gap: 4 }}>
            <h3>미국 경기 국면 히트맵 ({frameLabel(d.months[end])})</h3>
            <span className="sub">지표마다 그달 값이 12개월 평균보다 위(확장·둔화)인지 아래(수축·회복)인지, 3개월 전보다 좋아졌는지(확장·회복)로 칠했습니다. 실업률·스프레드처럼 낮을수록 좋은 지표는 뒤집었고, 생산·고용 같은 규모 지표는 전년 대비 증가율로 봅니다. ▶로 최근 10년을 재생하면 표가 한 달씩 밀려갑니다.</span>
          </div>
          <div className="inline" style={{ gap: 6 }}>
            {(Object.keys(PHASE_COLOR) as CliPhase[]).map((p) => (
              <span key={p} className="chip-btn" style={{ cursor: 'default' }}>
                <span className="dot" style={{ background: PHASE_COLOR[p] }} />
                {p} {count(p)}
              </span>
            ))}
          </div>
        </div>
        <TimelineControl t={t} dates={d.months} label="달" />
        <div className="table-wrap">
          <table className="heat" style={{ borderCollapse: 'separate', borderSpacing: 2, width: 'auto' }}>
            <thead>
              <tr>
                <th className="l" />
                {cols.map((c) => (
                  <th key={c.m} style={{ padding: 0, fontSize: 10, minWidth: 16, textAlign: 'center', border: 0 }}>{c.m.slice(5, 7) === '01' || c.j === from ? c.m.slice(2, 7).replace('-', '.') : ''}</th>
                ))}
                <th className="l" style={{ fontSize: 11, border: 0 }}>최근 값</th>
              </tr>
            </thead>
            {groups.map((g) => (
              <tbody key={g}>
                <tr>
                  <th colSpan={cols.length + 2} className="l sub" style={{ border: 0, paddingTop: 6, fontSize: 11 }}>{g}</th>
                </tr>
                {d.rows.filter((r) => r.group === g).map((r) => (
                  <tr key={r.code}>
                    <th scope="row" className="l" style={{ padding: '0 8px 0 0', border: 0, fontSize: 12, whiteSpace: 'nowrap', fontWeight: 500 }}>{r.label}</th>
                    {cols.map((c) => {
                      const p = r.phases[c.j];
                      return <td key={c.m} title={`${r.label} ${frameLabel(c.m)}: ${p ?? '—'}`} className="map-shape" style={{ padding: 0, border: 0, width: 16, height: 16, borderRadius: 3, background: p ? PHASE_COLOR[p] : 'var(--line-soft)', outline: c.j === end ? '2px solid var(--ink)' : undefined, outlineOffset: -1 }} />;
                    })}
                    <td className="l sub" style={{ border: 0, fontSize: 11, whiteSpace: 'nowrap', paddingLeft: 8 }}>{r.last ? `${r.last.value.toLocaleString('ko-KR', { maximumFractionDigits: 2 })} (${r.last.date.slice(2, 7).replace('-', '.')})` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            ))}
            <tbody>
              <tr>
                <th scope="row" className="l" style={{ padding: '6px 8px 0 0', border: 0, fontSize: 12, fontWeight: 700 }}>좋아지는 지표 비율</th>
                {cols.map((c) => {
                  const b = d.breadth[c.j];
                  return (
                    <td key={c.m} style={{ padding: '6px 0 0', border: 0, fontSize: 9, textAlign: 'center', color: 'var(--ink-2)' }} title={`${frameLabel(c.m)} 확장+회복 ${b === null ? '—' : Math.round(b * 100)}%`}>
                      {b === null ? '' : Math.round(b * 100)}
                    </td>
                  );
                })}
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      </section>
      <section className="card indicator" aria-label="좋아지는 지표 비율">
        <div className="stack" style={{ gap: 4 }}>
          <h3>좋아지는 지표 비율 (확장 + 회복)</h3>
          <span className="sub">50% 위면 좋아지는 지표가 더 많습니다. 오래 50% 아래에 머물면 경기 둔화 신호로 봅니다.</span>
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={d.months.map((m, k) => ({ m, v: d.breadth[k] }))} margin={{ left: 0, right: 12, top: 8, bottom: 4 }}>
            <CartesianGrid stroke="var(--line-soft)" />
            <XAxis dataKey="m" tickFormatter={(v: string) => v.slice(0, 4)} minTickGap={40} stroke="var(--muted)" fontSize={11} />
            <YAxis domain={[0, 1]} tickFormatter={(v: number) => `${Math.round(v * 100)}%`} stroke="var(--muted)" fontSize={11} width={44} />
            <Tooltip labelFormatter={(v) => frameLabel(String(v))} formatter={(v) => `${Math.round(Number(v) * 100)}%`} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)' }} />
            <ReferenceLine y={0.5} stroke="var(--muted)" strokeDasharray="4 3" />
            <ReferenceLine x={d.months[end]} stroke="var(--ink-2)" />
            <Line dataKey="v" name="비율" stroke="var(--series-1)" dot={false} strokeWidth={2} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </section>
      <p className="sub">출처: FRED (세인트루이스 연은). 지표마다 발표가 늦는 정도가 달라 최근 달은 일부 칸이 비어 있을 수 있습니다.</p>
    </div>
  );
}

// ------------------------------------------------------------------ rotation

function RotationTab() {
  const { data, error } = useView<RotationView>('/api/macro?view=rotation');
  if (error) return <p className="msg err">{error}</p>;
  if (!data) return <p className="empty">불러오는 중…</p>;
  return <RotationBody d={data} />;
}

const RRG = 520;

function RotationBody({ d }: { d: RotationView }) {
  const t = useTimeline(d.weeks.length);
  const [tail, setTail] = useState(8);
  const all = d.sectors.flatMap((s) => s.points.filter((p): p is RrgPoint => !!p));
  // The 95th percentile of distances from 100, so a few spikes do not squeeze everything into the middle
  const dist = all.map((p) => Math.max(Math.abs(p.ratio - 100), Math.abs(p.momentum - 100))).sort((a, b) => a - b);
  const span = Math.max(2, dist[Math.floor(dist.length * 0.95)] ?? 2) * 1.15;
  const clamp = (v: number) => Math.max(8, Math.min(RRG - 8, v));
  const X = (v: number) => clamp(RRG / 2 + ((v - 100) / span) * (RRG / 2 - 20));
  const Y = (v: number) => clamp(RRG / 2 - ((v - 100) / span) * (RRG / 2 - 20));
  const now = d.sectors.map((s, k) => ({ s, k, p: s.points[t.i] })).filter((x) => x.p);
  return (
    <div className="ind-grid">
      <section className="card indicator" aria-label="섹터 순환 그래프">
        <div className="stack" style={{ gap: 4 }}>
          <h3>섹터 순환 그래프 ({d.weeks[t.i]})</h3>
          <span className="sub">미국 섹터 ETF를 S&P 500과 비교했습니다. 가로는 상대강도(100 위면 시장보다 강함), 세로는 그 상대강도의 4주 변화(100 위면 강해지는 중). 섹터는 보통 개선 → 주도 → 약화 → 소외로 시계 방향으로 돕니다. ▶로 최근 2년을 주마다 재생합니다.</span>
        </div>
        <TimelineControl t={t} dates={d.weeks} label="주" />
        <div className="inline" style={{ gap: 6 }}>
          <span className="sub">꼬리</span>
          <div className="seg" role="group" aria-label="꼬리 길이">
            {[4, 8, 13].map((n) => (
              <button key={n} type="button" aria-current={tail === n ? 'true' : undefined} onClick={() => setTail(n)}>{n}주</button>
            ))}
          </div>
        </div>
        <div className="mo-map-wrap">
          <svg viewBox={`0 0 ${RRG} ${RRG}`} className="mo-map" style={{ minWidth: 420, maxWidth: 620, margin: '0 auto' }} role="img" aria-label="섹터 순환 그래프">
            <rect x={RRG / 2} y={0} width={RRG / 2} height={RRG / 2} fill={QUAD_COLOR.주도} opacity={0.08} />
            <rect x={RRG / 2} y={RRG / 2} width={RRG / 2} height={RRG / 2} fill={QUAD_COLOR.약화} opacity={0.12} />
            <rect x={0} y={RRG / 2} width={RRG / 2} height={RRG / 2} fill={QUAD_COLOR.소외} opacity={0.08} />
            <rect x={0} y={0} width={RRG / 2} height={RRG / 2} fill={QUAD_COLOR.개선} opacity={0.12} />
            <line x1={RRG / 2} x2={RRG / 2} y1={0} y2={RRG} stroke="var(--line)" />
            <line x1={0} x2={RRG} y1={RRG / 2} y2={RRG / 2} stroke="var(--line)" />
            {(['개선', '주도', '소외', '약화'] as Quadrant[]).map((q, k) => (
              <text key={q} x={k % 2 ? RRG - 10 : 10} y={k < 2 ? 18 : RRG - 10} textAnchor={k % 2 ? 'end' : 'start'} fontSize={13} fontWeight={600} fill="var(--muted)">{q}</text>
            ))}
            {now.map(({ s, k, p }) => {
              const pts = s.points.slice(Math.max(0, t.i - tail), t.i + 1).filter((x): x is RrgPoint => !!x);
              const color = COLORS[k % COLORS.length];
              return (
                <g key={s.symbol}>
                  <polyline points={pts.map((x) => `${X(x.ratio)},${Y(x.momentum)}`).join(' ')} fill="none" stroke={color} strokeOpacity={0.55} strokeWidth={1.6} />
                  {pts.slice(0, -1).map((x, j) => (
                    <circle key={j} cx={X(x.ratio)} cy={Y(x.momentum)} r={1.8} fill={color} opacity={0.5} />
                  ))}
                  <g className="rrg-dot" style={{ transform: `translate(${X(p!.ratio)}px, ${Y(p!.momentum)}px)` }}>
                    <circle r={6} fill={color} stroke="var(--surface)" strokeWidth={1.5} />
                    <text x={8} y={4} fontSize={11} fontWeight={600} fill="var(--ink)">{s.label}</text>
                  </g>
                </g>
              );
            })}
          </svg>
        </div>
      </section>
      <section className="card indicator" aria-label="섹터 순환 표">
        <div className="stack" style={{ gap: 4 }}>
          <h3>지금 위치</h3>
          <span className="sub">상대강도가 큰 순. 4주 전 사분면과 비교해 옮겨 간 섹터를 표시합니다.</span>
        </div>
        <table className="rank">
          <thead>
            <tr>
              <th className="l">섹터</th>
              <th className="num">상대강도</th>
              <th className="num">모멘텀</th>
              <th className="l">사분면</th>
              <th className="l">4주 전</th>
            </tr>
          </thead>
          <tbody>
            {[...now].sort((a, b) => b.p!.ratio - a.p!.ratio).map(({ s, p }) => {
              const q = quadrantOf(p!);
              const before = s.points[t.i - 4];
              const qb = before ? quadrantOf(before) : null;
              return (
                <tr key={s.symbol}>
                  <th scope="row" className="l">{s.label} <span className="sub">{s.symbol}</span></th>
                  <td className="num">{num(p!.ratio, 2)}</td>
                  <td className="num">{num(p!.momentum, 2)}</td>
                  <td className="l"><span className="badge" style={{ background: QUAD_COLOR[q], color: q === '주도' || q === '소외' ? '#fff' : 'var(--ink)' }}>{q}</span></td>
                  <td className="l sub">{qb ? (qb === q ? qb : `${qb} → ${q}`) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="sub">JdK RS-Ratio를 흉내 낸 근사치입니다: 상대강도(섹터 ÷ S&P 500)를 26주 평균으로 나눈 값과 그 값의 4주 변화. 주간 종가(Yahoo Finance).</p>
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ CFTC

function CotTab() {
  const { data, error } = useView<CotView>('/api/macro?view=cot');
  const [pick, setPick] = useState('13874A');
  if (error) return <p className="msg err">{error}</p>;
  if (!data) return <p className="empty">불러오는 중…</p>;
  const sel = data.contracts.find((c) => c.code === pick) ?? data.contracts[0];
  const groups = [...new Set(data.contracts.map((c) => c.group))];
  return (
    <div className="stack" style={{ gap: 16 }}>
      <Errors errors={data.errors} />
      <div className="ind-grid">
        <section className="card indicator" aria-label="선물 포지션 표">
          <div className="stack" style={{ gap: 4 }}>
            <h3>투기적 순포지션</h3>
            <span className="sub">CFTC 주간 보고서(COT)의 비상업(대형 투기) 계정 매수 − 매도. 3년 위치는 지난 3년 중 어디쯤인지(0% 가장 매도 쪽, 100% 가장 매수 쪽)로, 극단에 가까울수록 쏠림이 큽니다. 줄을 누르면 오른쪽에 추이를 그립니다.</span>
          </div>
          <table className="rank">
            <thead>
              <tr>
                <th className="l">계약</th>
                <th className="num">순포지션 (계약)</th>
                <th className="num">미결제 대비</th>
                <th className="l" style={{ minWidth: 120 }}>3년 위치</th>
                <th className="num">1주 변화</th>
              </tr>
            </thead>
            {groups.map((g) => (
              <tbody key={g}>
                <tr>
                  <th colSpan={5} className="l sub" style={{ background: 'var(--surface-2)', fontWeight: 600 }}>{g}</th>
                </tr>
                {data.contracts.filter((c) => c.group === g).map((c) => (
                  <tr key={c.code} onClick={() => setPick(c.code)} style={{ cursor: 'pointer', background: c.code === sel.code ? 'var(--surface-2)' : undefined }} aria-selected={c.code === sel.code}>
                    <th scope="row" className="l">{c.label}</th>
                    <td className={`num ${(c.summary?.net ?? 0) >= 0 ? 'up' : 'down'}`}>{c.summary ? c.summary.net.toLocaleString('ko-KR') : '—'}</td>
                    <td className="num">{c.summary ? pct(c.summary.netPct) : '—'}</td>
                    <td className="l">
                      {c.summary?.index3y !== null && c.summary?.index3y !== undefined ? (
                        <span className="cot-bar" title={`${Math.round(c.summary.index3y * 100)}%`}>
                          <span style={{ left: `calc(${c.summary.index3y * 100}% - 4px)` }} />
                          <b>{Math.round(c.summary.index3y * 100)}%</b>
                        </span>
                      ) : '—'}
                    </td>
                    <td className="num">{c.summary?.change1w !== null && c.summary?.change1w !== undefined ? `${c.summary.change1w > 0 ? '+' : ''}${c.summary.change1w.toLocaleString('ko-KR')}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
          <p className="sub">{data.contracts[0]?.summary ? `${data.contracts[0].summary.date} 기준 (화요일 포지션, 금요일 발표).` : ''} 출처: CFTC Commitments of Traders, 선물만(legacy).</p>
        </section>
        <section className="card indicator" aria-label="순포지션 추이">
          <div className="stack" style={{ gap: 4 }}>
            <h3>{sel.label} 순포지션 추이</h3>
            <span className="sub">최근 5년, 막대는 순포지션(계약), 선은 미결제약정 대비 비율(오른쪽 축).</span>
          </div>
          <ResponsiveContainer width="100%" height={340}>
            <ComposedChart data={sel.history} margin={{ left: 0, right: 0, top: 8, bottom: 4 }}>
              <CartesianGrid stroke="var(--line-soft)" />
              <XAxis dataKey="date" tickFormatter={(v: string) => v.slice(0, 7).replace('-', '.')} minTickGap={50} stroke="var(--muted)" fontSize={11} />
              <YAxis yAxisId="l" tickFormatter={(v: number) => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} stroke="var(--muted)" fontSize={11} width={48} />
              <YAxis yAxisId="r" orientation="right" tickFormatter={(v: number) => `${Math.round(v * 100)}%`} stroke="var(--muted)" fontSize={11} width={44} />
              <Tooltip formatter={(v, name) => (name === '미결제 대비' ? pct(Number(v)) : Number(v).toLocaleString('ko-KR'))} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)' }} />
              <ReferenceLine yAxisId="l" y={0} stroke="var(--muted)" />
              <Bar yAxisId="l" dataKey="net" name="순포지션" fill="var(--series-1)" opacity={0.7} animationDuration={500} />
              <Line yAxisId="r" dataKey="netPct" name="미결제 대비" stroke="var(--series-4)" dot={false} strokeWidth={1.5} animationDuration={500} />
            </ComposedChart>
          </ResponsiveContainer>
        </section>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ GDP

function GdpChart({ title, about, parts, rows }: { title: string; about: string; parts: { key: string; label: string }[]; rows: Record<string, number | string | null>[] }) {
  return (
    <section className="card indicator" aria-label={title}>
      <div className="stack" style={{ gap: 4 }}>
        <h3>{title}</h3>
        <span className="sub">{about}</span>
      </div>
      <ResponsiveContainer width="100%" height={340}>
        <ComposedChart data={rows} stackOffset="sign" margin={{ left: 0, right: 12, top: 8, bottom: 4 }}>
          <CartesianGrid stroke="var(--line-soft)" vertical={false} />
          <XAxis dataKey="date" tickFormatter={(v: string) => `${v.slice(2, 4)}.${Math.ceil(Number(v.slice(5, 7)) / 3)}Q`} stroke="var(--muted)" fontSize={11} minTickGap={16} />
          <YAxis tickFormatter={(v: number) => `${v}`} stroke="var(--muted)" fontSize={11} width={36} />
          <Tooltip labelFormatter={(v) => `${String(v).slice(0, 4)}년 ${Math.ceil(Number(String(v).slice(5, 7)) / 3)}분기`} formatter={(v, name) => [`${Number(v) > 0 ? '+' : ''}${Number(v).toFixed(2)}%p`, String(name)]} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)' }} />
          <Legend />
          <ReferenceLine y={0} stroke="var(--muted)" />
          {parts.map((p, k) => (
            <Bar key={p.key} dataKey={p.key} name={p.label} stackId="g" fill={COLORS[k % COLORS.length]} animationDuration={700} />
          ))}
          <Line dataKey="total" name="GDP 성장률" stroke="var(--ink)" strokeWidth={2} dot={{ r: 2.5 }} animationDuration={700} />
        </ComposedChart>
      </ResponsiveContainer>
    </section>
  );
}

function GdpTab() {
  const { data, error } = useView<GdpView>('/api/macro?view=gdp');
  if (error) return <p className="msg err">{error}</p>;
  if (!data) return <p className="empty">불러오는 중…</p>;
  return (
    <div className="stack" style={{ gap: 16 }}>
      <Errors errors={data.errors} />
      {data.missing.includes('ECOS') && (
        <p className="callout">
          한국 GDP 기여도는 {KEY_HELP.ECOS.label}가 필요합니다. <a href={KEY_HELP.ECOS.href}>연동 · 설정에서 넣기 ›</a>
        </p>
      )}
      <div className="ind-grid">
        <GdpChart title="미국 GDP 성장 기여도" about="실질 GDP 전기 대비 연율 성장률(선)과 항목별 기여(막대, %p). 최근 6년, 미 경제분석국(BEA) 자료를 FRED에서 받습니다." parts={data.us.parts} rows={data.us.rows} />
        {data.kr && <GdpChart title="한국 GDP 성장 기여도" about="실질 GDP 전기 대비 성장률(계절조정, 선은 항목 기여의 합)과 지출항목별 기여(막대, %p). 한국은행 ECOS 200Y125." parts={data.kr.parts} rows={data.kr.rows} />}
      </div>
      <p className="sub">미국은 연율(분기 변화를 1년으로 환산), 한국은 분기 변화 그대로라 크기를 직접 비교하지 않습니다. 통계상 불일치는 빠져 있어 한국 막대의 합은 발표 성장률과 조금 다를 수 있습니다.</p>
    </div>
  );
}

// ------------------------------------------------------------------ release calendar

interface CalendarRow {
  date: string;
  id: number;
  name: string;
  major: { label: string; about: string; series: string; show: Transform; unit: string; latest: { date: string; value: number; prev: number | null } | null };
}

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];
const fmtHeadline = (m: CalendarRow['major']) => {
  const l = m.latest;
  if (!l) return '—';
  const v = m.show === 'yoy' || m.show === 'mom' ? `${l.value > 0 && m.show === 'mom' ? '+' : ''}${l.value.toFixed(1)}%` : m.show === 'diff' ? `${l.value > 0 ? '+' : ''}${Math.round(l.value).toLocaleString('ko-KR')}${m.unit}` : `${l.value.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}${m.unit && m.unit !== '%' ? ` ${m.unit}` : m.unit}`;
  return `${v} (${l.date.slice(0, 7).replace('-', '.')})`;
};

function CalendarTab() {
  const { data, error } = useView<{ rows: CalendarRow[]; today: string }>('/api/macro?view=calendar');
  if (error) return <p className="msg err">{error}{/FRED API 키/.test(error) && <> <a href="/settings#fred">연동 · 설정에서 넣기 ›</a></>}</p>;
  if (!data) return <p className="empty">불러오는 중…</p>;
  const rows = data.rows;
  const days = [...new Set(rows.map((r) => r.date))];
  return (
    <section className="card indicator" aria-label="경제 지표 일정">
      <div className="inline spread" style={{ gap: 8, flexWrap: 'wrap' }}>
        <div className="stack" style={{ gap: 4 }}>
          <h3>미국 경제 지표 발표 일정</h3>
          <span className="sub">지난 1주와 앞으로 5주. 날짜는 미국 동부 기준(한국은 보통 그날 밤 9시 30분~다음 날 새벽)입니다. 시장이 많이 보는 지표 14개와 FOMC만 골랐고, 직전 발표 값을 함께 보여 줍니다. 예상치(컨센서스)는 없습니다.</span>
        </div>
      </div>
      <div className="stack" style={{ gap: 12 }}>
        {days.map((d) => {
          const past = d < data.today;
          const isToday = d === data.today;
          const w = WEEKDAY[new Date(`${d}T00:00:00Z`).getUTCDay()];
          return (
            <div key={d} className="cal-day" style={{ opacity: past ? 0.6 : 1 }}>
              <div className="cal-date">
                <b>{d.slice(5).replace('-', '.')}</b> <span className="sub">({w}){isToday ? ' · 오늘' : past ? ' · 지남' : ''}</span>
              </div>
              <div className="stack" style={{ gap: 6 }}>
                {rows.filter((r) => r.date === d).map((r) => (
                  <div key={`${r.id}-${d}`} className="cal-item">
                    <b>{r.major.label}</b>
                    <span className="sub">{r.major.about}</span>
                    <span className="cal-last">직전 {fmtHeadline(r.major)}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {!days.length && <p className="empty">이 기간에 발표가 없습니다.</p>}
      <p className="sub">출처: FRED 발표 일정(releases/dates), FOMC는 연준이 공개한 2026년 회의 일정. 직전 값은 FRED 시리즈의 최근 관측치이며, 발표 당일에는 반영까지 몇 시간 걸릴 수 있습니다.</p>
    </section>
  );
}

// ------------------------------------------------------------------ my indicator sheet

interface SheetItem {
  id: string;
  title: string;
  units: string;
  frequency: string;
  transform: Transform;
}
interface SheetData {
  items: (SheetItem & { points: { date: string; value: number }[]; latest: { date: string; value: number; prev: number | null } | null })[];
}

const SUGGESTED: SheetItem[] = [
  { id: 'CPIAUCSL', title: 'Consumer Price Index for All Urban Consumers', units: 'Index', frequency: 'M', transform: 'yoy' },
  { id: 'UNRATE', title: 'Unemployment Rate', units: '%', frequency: 'M', transform: 'level' },
  { id: 'T10Y2Y', title: '10-Year Treasury Minus 2-Year Treasury', units: '%', frequency: 'D', transform: 'level' },
  { id: 'M2SL', title: 'M2', units: 'Bil. of $', frequency: 'M', transform: 'yoy' },
];

function SheetTab() {
  const [bump, setBump] = useState(0);
  const { data, error } = useView<SheetData>(`/api/macro?view=sheet&b=${bump}`);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<(Omit<SheetItem, 'transform'> & { popularity: number })[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const items: SheetItem[] = (data?.items ?? []).map(({ id, title, units, frequency, transform }) => ({ id, title, units, frequency, transform }));
  const save = async (next: SheetItem[]) => {
    const r = await fetch('/api/fred', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items: next }) });
    if (!r.ok) setMsg((await r.json().catch(() => ({}))).error ?? '저장하지 못했습니다.');
    setBump((b) => b + 1);
  };
  const search = async () => {
    setMsg(null);
    const r = await fetch(`/api/fred?q=${encodeURIComponent(q)}`);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      setMsg(j.error ?? '검색하지 못했습니다.');
      setResults(null);
    } else setResults(j.results);
  };
  if (error) return <p className="msg err">{error}</p>;
  if (!data) return <p className="empty">불러오는 중…</p>;
  return (
    <div className="stack" style={{ gap: 16 }}>
      <section className="card indicator" aria-label="지표 추가">
        <div className="stack" style={{ gap: 4 }}>
          <h3>내 지표 시트</h3>
          <span className="sub">FRED의 80만 개 넘는 시리즈 가운데 보고 싶은 것을 골라 한 화면에 모읍니다(24개까지). 영어로 검색하세요(예: inflation, housing, oil, Korea). 카드마다 값 그대로·1년 전 대비·직전 대비로 바꿔 볼 수 있습니다.</span>
        </div>
        <form className="inline" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); if (q.trim()) search(); }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="FRED 검색어" aria-label="FRED 검색어" style={{ maxWidth: 320 }} />
          <button type="submit" className="btn">검색</button>
          {!items.length && <button type="button" className="btn small" onClick={() => save(SUGGESTED)}>추천 4개로 시작</button>}
        </form>
        {msg && <p className="msg err">{msg}{/FRED API 키/.test(msg) && <> <a href="/settings#fred">연동 · 설정에서 넣기 ›</a></>}</p>}
        {results && (
          <div className="table-wrap">
            <table className="rank">
              <thead>
                <tr>
                  <th className="l">시리즈</th>
                  <th className="l">단위</th>
                  <th className="l">주기</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.id}>
                    <th scope="row" className="l" style={{ whiteSpace: 'normal' }}>{r.title}<span className="sub" style={{ display: 'block' }}>{r.id}</span></th>
                    <td className="l sub">{r.units}</td>
                    <td className="l sub">{r.frequency}</td>
                    <td className="num">
                      {items.some((i) => i.id === r.id) ? <span className="sub">담김</span> : <button type="button" className="btn small" disabled={items.length >= 24} onClick={() => save([...items, { id: r.id, title: r.title, units: r.units, frequency: r.frequency, transform: 'level' }])}>담기</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!results.length && <p className="empty">검색 결과가 없습니다.</p>}
          </div>
        )}
      </section>
      {data.items.length ? (
        <div className="ind-grid">
          {data.items.map((it, k) => (
            <section key={it.id} className="card indicator" aria-label={it.title}>
              <div className="inline spread" style={{ gap: 8, alignItems: 'flex-start' }}>
                <div className="stack" style={{ gap: 2, minWidth: 0 }}>
                  <h3 style={{ fontSize: 15 }}>{it.title}</h3>
                  <span className="sub">{it.id} · {it.units} · {it.frequency}{it.latest ? ` · 최근 ${it.latest.value.toLocaleString('ko-KR', { maximumFractionDigits: 3 })}${it.transform === 'level' ? '' : '%'} (${it.latest.date})` : ''}</span>
                </div>
                <button type="button" className="linklike" aria-label={`${it.title} 빼기`} onClick={() => save(items.filter((i) => i.id !== it.id))}>×</button>
              </div>
              <div className="seg" role="group" aria-label="보기">
                {(Object.keys(TRANSFORM_LABEL) as Transform[]).map((t) => (
                  <button key={t} type="button" aria-current={it.transform === t ? 'true' : undefined} onClick={() => save(items.map((i) => (i.id === it.id ? { ...i, transform: t } : i)))}>{TRANSFORM_LABEL[t]}</button>
                ))}
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={it.points} margin={{ left: 0, right: 8, top: 8, bottom: 4 }}>
                  <CartesianGrid stroke="var(--line-soft)" />
                  <XAxis dataKey="date" tickFormatter={(v: string) => v.slice(0, 4)} minTickGap={40} stroke="var(--muted)" fontSize={11} />
                  <YAxis domain={['auto', 'auto']} tickFormatter={(v: number) => Math.abs(v) >= 1e4 ? `${Math.round(v / 1e3).toLocaleString('ko-KR')}k` : String(Math.round(v * 100) / 100)} stroke="var(--muted)" fontSize={11} width={52} />
                  <Tooltip formatter={(v) => Number(v).toLocaleString('ko-KR', { maximumFractionDigits: 3 })} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)' }} />
                  {it.transform !== 'level' && <ReferenceLine y={0} stroke="var(--muted)" />}
                  <Line dataKey="value" name={it.id} stroke={COLORS[k % COLORS.length]} dot={false} strokeWidth={1.8} animationDuration={900} />
                </LineChart>
              </ResponsiveContainer>
            </section>
          ))}
        </div>
      ) : (
        <p className="empty">아직 담은 지표가 없습니다. 검색해서 담거나 추천 4개로 시작하세요.</p>
      )}
    </div>
  );
}
