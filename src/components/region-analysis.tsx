'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis, LabelList } from 'recharts';
import { IndicatorChart, KEY_HELP } from '@/components/analysis-board';
import { ComplexPanel, FavoritesPanel, type ComplexViewData, type FavoriteData } from '@/components/complex-analysis';
import { RegionMap, type MapViewData } from '@/components/region-map';
import { frameLabel, TimelineControl, useTimeline } from '@/components/timeline';
import { ApplyPanel, type ApplyViewData } from '@/components/subscriptions';
import { LocationPanel, type LocationViewData } from '@/components/location';
import type { ChartData } from '@/domain/indicators';
import type { PathPoint, RegionSummary } from '@/domain/region-analysis';

export interface RegionOption {
  key: string;
  label: string;
  depth: number;
}

type Missing = keyof typeof KEY_HELP;
interface Common {
  missing: Missing[];
  errors: string[];
}
interface OneView extends Common {
  region: { key: string; label: string };
  summary: RegionSummary;
  charts: Record<'price' | 'rtpi' | 'population' | 'supply' | 'afford' | 'ratio' | 'demand' | 'trade' | 'techMain' | 'techOsc', ChartData>;
  quadrant: (PathPoint & { q: { n: number; name: string; about: string } })[];
  honeycomb: (PathPoint & { phase: number })[];
  season: { rows: Record<string, number | string | null>[]; years: string[]; share: { month: number; pct: number }[] };
}
interface CompareView extends Common {
  regions: { key: string; label: string }[];
  summaries: RegionSummary[];
  price: ChartData;
  ratio: ChartData;
  corr: (number | null)[][];
}
interface CycleView extends Common {
  window: number;
  real: boolean;
  rows: { key: string; label: string; date: string | null; x: number | null; y: number | null; phase: number | null; name: string | null; path: PathPoint[] }[];
}
interface RankRow {
  key: string;
  label: string;
  deals: number;
  outside: number | null;
  otherSido: number | null;
  seoul: number | null;
  change: number | null;
  months: { date: string; value: number | null }[];
  date: string | null;
}
interface BuyersView extends Common {
  region: { key: string; label: string };
  residence: ChartData;
  age: ChartData;
  owner: ChartData;
  permit: ChartData;
  size: ChartData;
  ranking: RankRow[];
  rankBy: 'outside' | 'otherSido';
}
interface CorrView extends Common {
  region: { key: string; label: string };
  macro: { key: string; label: string; about: string; unit: string };
  lags: { lag: number; r: number | null; n: number }[];
  best: { lag: number; r: number; n: number } | null;
  now: number | null;
  chart: ChartData;
}

const TABS = [
  { key: 'one', label: '지역 한눈에' },
  { key: 'compare', label: '지역 비교' },
  { key: 'cycle', label: '순환 국면' },
  { key: 'map', label: '지도' },
  { key: 'corr', label: '상관 · 시차' },
  { key: 'buyers', label: '투자자 동향' },
  { key: 'location', label: '입지' },
  { key: 'apply', label: '청약' },
  { key: 'complex', label: '단지 분석' },
  { key: 'fav', label: '관심 단지' },
] as const;
type Tab = (typeof TABS)[number]['key'];

const COLORS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)', 'var(--series-6)', 'var(--series-7)'];
const axis = { fontSize: 11.5, fill: 'var(--muted)' };
const tipStyle = { borderRadius: 10, border: '1px solid var(--line)', background: 'var(--surface)', fontSize: 13 };
const pct = (v: number | null | undefined, digits = 1, sign = true) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${sign && v > 0 ? '+' : ''}${v.toLocaleString('ko-KR', { maximumFractionDigits: digits, minimumFractionDigits: digits })}%`);
/** Axis ticks as %, without floating-point tails (0.30000000000000004) */
const pctTick = (v: number) => `${Number(v).toLocaleString('ko-KR', { maximumFractionDigits: 2 })}%`;

/** An axis range that always shows 0, a little wider than the data */
const withZero: [(min: number) => number, (max: number) => number] = [(min) => niceDown(Math.min(min, 0)), (max) => niceUp(Math.max(max, 0))];
const step = (v: number) => (Math.abs(v) <= 1 ? 0.2 : Math.abs(v) <= 5 ? 1 : Math.abs(v) <= 20 ? 5 : 10);
const niceDown = (v: number) => (v === 0 ? 0 : Math.floor(v / step(v) - 0.25) * step(v));
const niceUp = (v: number) => (v === 0 ? 0 : Math.ceil(v / step(v) + 0.25) * step(v));
const ym = (d: string | null | undefined) => (d ? d.slice(0, 7).replace('-', '.') : '—');

function useView<T>(url: string | null): { data: T | null; error: string | null; loading: boolean } {
  const [state, setState] = useState<{ url: string | null; data: T | null; error: string | null }>({ url: null, data: null, error: null });
  useEffect(() => {
    if (!url) return;
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
  return { data: state.url === url ? state.data : null, error: state.url === url ? state.error : null, loading: !!url && state.url !== url };
}

function Notices({ view }: { view: Common }) {
  return (
    <>
      {view.missing.map((m) => (
        <p key={m} className="callout">
          이 화면은 {KEY_HELP[m].label}가 필요합니다. <a href={KEY_HELP[m].href}>연동 · 설정에서 넣기 ›</a>
        </p>
      ))}
      {view.errors.length > 0 && <p className="sub">일부 자료를 새로 받지 못해 저장해 둔 값을 보여 줍니다: {view.errors.join(' · ')}</p>}
    </>
  );
}

function Card({ title, sub, children, about }: { title: string; sub?: string; children: React.ReactNode; about?: React.ReactNode }) {
  return (
    <section className="card indicator" aria-label={title}>
      <div className="stack" style={{ gap: 4 }}>
        <h3>{title}</h3>
        {sub && <span className="sub">{sub}</span>}
      </div>
      {children}
      {about && (
        <details>
          <summary className="sub">읽는 법</summary>
          {about}
        </details>
      )}
    </section>
  );
}

function ChartCard({ title, data, sub, about }: { title: string; data: ChartData; sub?: string; about?: React.ReactNode }) {
  const empty = !data.rows.some((r) => Object.entries(r).some(([k, v]) => k !== 'date' && v !== null));
  return (
    <Card title={title} sub={sub} about={about}>
      {data.latest.length > 0 && (
        <dl className="ind-latest">
          {data.latest.map((x) => (
            <div key={x.label}>
              <dt>{x.label}</dt>
              <dd className="strong">{x.value}</dd>
              <dd className="sub">{x.date}</dd>
            </div>
          ))}
        </dl>
      )}
      {empty ? <p className="empty">이 지역은 이 자료가 없습니다.</p> : <IndicatorChart data={data} animate={!reducedMotion()} />}
      {data.note && <p className="sub">{data.note}</p>}
    </Card>
  );
}

/** Fixed axis bounds over every point (so a playing path does not rescale), always showing 0 */
function boundsOf(points: { x: number; y: number }[]): { x: [number, number]; y: [number, number] } {
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const b = (v: number[]): [number, number] => (v.length ? [niceDown(Math.min(0, ...v)), niceUp(Math.max(0, ...v))] : [-1, 1]);
  return { x: b(xs), y: b(ys) };
}

/** A path of monthly points on an x/y plane, oldest faint, newest marked; with `animate`, played month by month */
function PathChart({ points, xLabel, yLabel, guides, animate = false }: { points: PathPoint[]; xLabel: string; yLabel: string; guides?: React.ReactNode; animate?: boolean }) {
  const t = useTimeline(points.length);
  const shown = animate ? points.slice(0, t.i + 1) : points;
  const bounds = boundsOf(points);
  // While playing, the last year is drawn strong and the head big; older months fade
  const data = shown.map((p, i) => ({ ...p, i, tag: i === shown.length - 1 || i === 0 ? ym(p.date) : '' }));
  const n = data.length;
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div style={{ width: '100%', height: 300 }}>
        <ResponsiveContainer>
          <ScatterChart margin={{ top: 12, right: 16, bottom: 8, left: 0 }}>
            <CartesianGrid stroke="var(--line-soft)" />
            <XAxis type="number" dataKey="x" name={xLabel} domain={bounds.x} allowDataOverflow tick={axis} tickLine={false} axisLine={false} tickFormatter={pctTick} label={{ value: xLabel, position: 'insideBottomRight', offset: -2, fontSize: 11, fill: 'var(--muted)' }} />
            <YAxis type="number" dataKey="y" name={yLabel} domain={bounds.y} allowDataOverflow tick={axis} tickLine={false} axisLine={false} width={48} tickFormatter={pctTick} label={{ value: yLabel, angle: -90, position: 'insideLeft', fontSize: 11, fill: 'var(--muted)' }} />
            <ZAxis range={[28, 28]} />
            {guides}
            <ReferenceLine x={0} stroke="var(--muted)" strokeDasharray="4 4" />
            <ReferenceLine y={0} stroke="var(--muted)" strokeDasharray="4 4" />
            <Tooltip
              cursor={false}
              contentStyle={tipStyle}
              content={({ payload }) => {
                const p = payload?.[0]?.payload as (PathPoint & { i: number }) | undefined;
                if (!p) return null;
                return (
                  <div style={{ ...tipStyle, padding: '8px 10px' }}>
                    <div className="strong">{ym(p.date)}</div>
                    <div>{xLabel}: {pct(p.x)}</div>
                    <div>{yLabel}: {pct(p.y, 2)}</div>
                    <div className="sub">{p.label}</div>
                  </div>
                );
              }}
            />
            <Scatter data={data} line={{ stroke: 'var(--series-1)', strokeWidth: 1.4, strokeOpacity: 0.6 }} isAnimationActive={false}>
              {data.map((p) => (
                <Cell key={p.date} fill="var(--series-1)" fillOpacity={animate ? (p.i >= n - 12 ? 0.35 + (0.65 * (p.i - (n - 12))) / 12 : 0.12) : 0.25 + (0.75 * (p.i + 1)) / n} r={p.i === n - 1 ? 6 : 3} />
              ))}
              <LabelList dataKey="tag" position="top" style={{ fontSize: 11, fill: 'var(--ink-2)' }} />
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      {animate && <TimelineControl t={t} dates={points.map((p) => p.date)} label="궤적 시점" />}
    </div>
  );
}

const HONEYCOMB_PHASES = [
  { n: 1, name: '회복기', rule: '가격↑ 거래↑' },
  { n: 2, name: '활황기', rule: '가격↑ 거래↓' },
  { n: 3, name: '침체 진입기', rule: '가격→ 거래↓' },
  { n: 4, name: '침체기', rule: '가격↓ 거래↓' },
  { n: 5, name: '불황기', rule: '가격↓ 거래↑' },
  { n: 6, name: '회복 진입기', rule: '가격→ 거래↑' },
];
const flatBand = <ReferenceArea y1={-0.5} y2={0.5} fill="var(--muted)" fillOpacity={0.08} stroke="none" ifOverflow="extendDomain" />;

function HoneycombLegend({ current }: { current?: number | null }) {
  return (
    <div className="inline" style={{ gap: 6, flexWrap: 'wrap' }}>
      {HONEYCOMB_PHASES.map((p) => (
        <span key={p.n} className="chip-btn" aria-pressed={current === p.n} style={{ cursor: 'default' }}>
          {p.n} {p.name} <span className="sub">{p.rule}</span>
        </span>
      ))}
    </div>
  );
}

function SeasonCard({ season }: { season: OneView['season'] }) {
  const peak = [...season.share].sort((a, b) => b.pct - a.pct).slice(0, 3).map((s) => `${s.month}월`);
  return (
    <Card
      title="거래 성수기"
      sub="해마다 월별 아파트 매매거래, 그리고 한 해 거래 중 그 달의 평균 비중"
      about={<p>거래는 이사철(봄·가을)과 학기 시작 전에 몰리고, 연말과 한여름에 줄어드는 경향이 있습니다. 같은 달끼리 비교하면 계절 효과를 빼고 올해 거래가 예년보다 많은지 적은지 볼 수 있습니다. 비중은 12개월이 다 있는 해만 평균했습니다.</p>}
    >
      {season.rows.length && season.years.length ? (
        <>
          <div style={{ width: '100%', height: 240 }}>
            <ResponsiveContainer>
              <LineChart data={season.rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--line-soft)" vertical={false} />
                <XAxis dataKey="month" tick={axis} tickLine={false} axisLine={false} />
                <YAxis tick={axis} tickLine={false} axisLine={false} width={48} tickFormatter={(v) => Number(v).toLocaleString('ko-KR')} />
                <Tooltip contentStyle={tipStyle} formatter={(v, n) => [v === null ? '—' : `${Number(v).toLocaleString('ko-KR')}건`, String(n).slice(1) + '년']} />
                {season.years.map((y, i) => (
                  <Line key={y} dataKey={`y${y}`} stroke={COLORS[i % COLORS.length]} strokeWidth={i === season.years.length - 1 ? 2.2 : 1.3} dot={false} connectNulls={false} isAnimationActive={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="inline" style={{ gap: 6, flexWrap: 'wrap' }}>
            {season.years.map((y, i) => (
              <span key={y} className="chip-btn" style={{ cursor: 'default' }}>
                <span className="dot" style={{ background: COLORS[i % COLORS.length] }} />
                {y}년
              </span>
            ))}
          </div>
          <div style={{ width: '100%', height: 150 }}>
            <ResponsiveContainer>
              <BarChart data={season.share.map((s) => ({ ...s, m: `${s.month}월` }))} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <XAxis dataKey="m" tick={axis} tickLine={false} axisLine={false} />
                <YAxis tick={axis} tickLine={false} axisLine={false} width={48} tickFormatter={pctTick} />
                <ReferenceLine y={100 / 12} stroke="var(--muted)" strokeDasharray="4 4" />
                <Tooltip contentStyle={tipStyle} formatter={(v) => [`${Number(v).toFixed(1)}%`, '한 해 거래 중 비중']} />
                <Bar dataKey="pct" fill="var(--series-1)" fillOpacity={0.6} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          {peak.length > 0 && <p className="sub">거래가 가장 많은 달: {peak.join(' · ')} (점선 = 매달 같을 때 8.3%)</p>}
        </>
      ) : (
        <p className="empty">이 지역은 거래 자료가 없습니다.</p>
      )}
    </Card>
  );
}

function OnePanel({ view }: { view: OneView }) {
  const s = view.summary;
  const q = view.quadrant.at(-1);
  const h = view.honeycomb.at(-1);
  const items = [
    { label: '매매 1개월', value: pct(s.m1, 2) },
    { label: '매매 3개월', value: pct(s.m3, 2) },
    { label: '매매 1년', value: pct(s.y1) },
    { label: '매매 3년', value: pct(s.y3) },
    { label: '전세 1년', value: pct(s.jeonseY1) },
    { label: `고점 대비 (${ym(s.peakDate)})`, value: pct(s.fromPeak) },
    { label: '중위 전세가율', value: s.ratio === null ? '—' : `${s.ratio.toFixed(1)}%` },
    { label: '거래 1년 증감', value: pct(s.tradeY1, 0) },
    { label: '중위 매매가격', value: s.median === null ? '—' : `${s.median.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}억` },
  ];
  return (
    <div className="stack" style={{ gap: 16 }}>
      <Notices view={view} />
      <section className="card stack" style={{ gap: 10 }} aria-label="요약">
        <div className="inline spread" style={{ flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ margin: 0 }}>{view.region.label}</h2>
          <span className="sub">기준 {ym(s.date)} · 한국부동산원</span>
        </div>
        <dl className="ind-latest">
          {items.map((x) => (
            <div key={x.label}>
              <dt>{x.label}</dt>
              <dd className="strong">{x.value}</dd>
            </div>
          ))}
        </dl>
        <div className="inline" style={{ gap: 8, flexWrap: 'wrap' }}>
          {q && <span className="badge">{q.q.name}</span>}
          {h && <span className="badge">벌집 {h.label}</span>}
        </div>
      </section>
      <div className="ind-grid">
        <ChartCard title="매매 · 전세 가격" data={view.charts.price} />
        <ChartCard title="실거래가격지수 vs 매매가격지수" data={view.charts.rtpi} />
        <Card
          title="매매 · 전세 4분면"
          sub="최근 3년, 매달 그 전 3개월 동안의 매매·전세 변동률"
          about={
            <p>
              가로는 매매, 세로는 전세 변동률입니다. 시장은 보통 2사분면(전세만 상승) → 1사분면(동반 상승) → 4사분면(매매만 상승) → 3사분면(동반 하락) → 다시 2사분면으로 돕니다. 전세가 먼저 오르면 실수요가 받쳐 주는 것이고, 매매만 오르면 투자 수요가 앞서 전세가율이 떨어지는 것입니다. 점이 진할수록 최근입니다.
            </p>
          }
        >
          {view.quadrant.length ? (
            <>
              <PathChart points={view.quadrant} xLabel="매매 3개월" yLabel="전세 3개월" animate />
              {q && <p className="sub"><b>{ym(q.date)}</b> {q.q.name}: {q.q.about}</p>}
            </>
          ) : (
            <p className="empty">이 지역은 전세지수가 없습니다.</p>
          )}
        </Card>
        <Card
          title="벌집순환모형"
          sub="최근 3년, 실질 가격(물가 제외) 6개월 변화와 거래량 6개월 변화"
          about={
            <p>
              벌집순환모형(Janssen 등, 1994)은 가격과 거래량의 조합으로 시장을 여섯 국면으로 나눕니다. 보통 1 회복기 → 2 활황기 → 3 침체 진입기 → 4 침체기 → 5 불황기 → 6 회복 진입기 → 다시 1로 돕니다. 가격이 ±0.5% 안이면 보합(회색 띠)으로 봅니다. 거래량은 최근 6개월 거래를 그 전 6개월과 비교하며, 계약일 기준이라 최근 달은 덜 집계돼 거래량이 낮게 나올 수 있습니다. 국면 판정은 참고용입니다.
            </p>
          }
        >
          {view.honeycomb.length ? (
            <>
              <PathChart points={view.honeycomb} xLabel="거래량 6개월" yLabel="실질가격 6개월" guides={flatBand} animate />
              <HoneycombLegend current={h?.phase} />
            </>
          ) : (
            <p className="empty">이 지역은 거래 자료가 없어 그릴 수 없습니다.</p>
          )}
        </Card>
        <ChartCard title="전세가율 · 전월세 전환율" data={view.charts.ratio} />
        <ChartCard title="매매 · 전세 수급지수" data={view.charts.demand} />
        <ChartCard title="거래량 · 미분양" data={view.charts.trade} />
        <ChartCard title="인구 · 연령대 · 세대수" data={view.charts.population} sub="주민등록 인구 (통계청 KOSIS)" />
        <ChartCard title="공급: 인허가 · 미분양" data={view.charts.supply} sub={`${view.region.label.split(' ')[0]} 전체 (시도 자료)`} />
        <ChartCard title="주택구입부담" data={view.charts.afford} sub={`${view.region.label.split(' ')[0]} 전체 (시도 자료, K-HAI 방식 자체 계산)`} />
        <ChartCard title="기술적 분석: 추세" data={view.charts.techMain} />
        <ChartCard title="기술적 분석: 보조지표" data={view.charts.techOsc} />
        <SeasonCard season={view.season} />
      </div>
    </div>
  );
}

/** Whether the viewer asked for less motion (no chart animation then) */
const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const corrColor = (r: number | null) => {
  if (r === null) return 'transparent';
  const a = Math.min(1, Math.abs(r));
  return r >= 0 ? `color-mix(in srgb, var(--series-1) ${Math.round(a * 70)}%, transparent)` : `color-mix(in srgb, var(--series-4) ${Math.round(a * 70)}%, transparent)`;
};

function ComparePanel({ view }: { view: CompareView }) {
  return (
    <div className="stack" style={{ gap: 16 }}>
      <Notices view={view} />
      <section className="card stack" style={{ gap: 10 }} aria-label="지역 비교표">
        <h3 style={{ margin: 0 }}>지역 비교</h3>
        <div className="table-wrap">
          <table className="rank">
            <thead>
              <tr>
                <th>지역</th>
                <th className="num">기준</th>
                <th className="num">1개월</th>
                <th className="num">1년</th>
                <th className="num">3년</th>
                <th className="num">고점 대비</th>
                <th className="num">전세 1년</th>
                <th className="num">전세가율</th>
                <th className="num">거래 1년</th>
                <th className="num">중위가</th>
              </tr>
            </thead>
            <tbody>
              {view.summaries.map((s, i) => (
                <tr key={s.key}>
                  <th scope="row"><span className="dot" style={{ background: COLORS[i % COLORS.length], marginRight: 6 }} />{s.label}</th>
                  <td className="num sub">{ym(s.date)}</td>
                  <td className="num">{pct(s.m1, 2)}</td>
                  <td className="num">{pct(s.y1)}</td>
                  <td className="num">{pct(s.y3)}</td>
                  <td className="num">{pct(s.fromPeak)}</td>
                  <td className="num">{pct(s.jeonseY1)}</td>
                  <td className="num">{s.ratio === null ? '—' : `${s.ratio.toFixed(1)}%`}</td>
                  <td className="num">{pct(s.tradeY1, 0)}</td>
                  <td className="num">{s.median === null ? '—' : `${s.median.toFixed(2)}억`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <div className="ind-grid">
        <ChartCard title="매매가격 (기간 처음 = 100)" data={view.price} />
        <ChartCard title="중위 전세가율" data={view.ratio} />
        <Card
          title="상관계수 (월간 매매 변동률)"
          sub="고른 기간 동안 두 지역의 월간 매매 변동률이 함께 움직인 정도"
          about={<p>1에 가까우면 같이 오르고 같이 내렸고, 0이면 관계가 없었고, 음수면 반대로 움직였습니다. 높게 묶이는 지역끼리는 분산 효과가 작고, 한 지역의 흐름으로 다른 지역을 짐작해 볼 수 있습니다. 같이 움직였다는 것이지 한쪽이 다른 쪽을 움직였다는 뜻은 아닙니다.</p>}
        >
          <div className="table-wrap">
            <table className="rank">
              <thead>
                <tr>
                  <th />
                  {view.regions.map((r) => (
                    <th key={r.key} className="num" style={{ fontSize: 12 }}>{r.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {view.regions.map((r, i) => (
                  <tr key={r.key}>
                    <th scope="row" style={{ fontSize: 12 }}>{r.label}</th>
                    {view.corr[i].map((v, j) => (
                      <td key={j} className="num" style={{ background: i === j ? 'transparent' : corrColor(v) }}>{i === j ? '—' : v === null ? '—' : v.toFixed(2)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}

function CyclePanel({ view, onPick }: { view: CycleView; onPick: (key: string) => void }) {
  const [focus, setFocus] = useState<string | null>(null);
  // Every month any region has, oldest first: the frames of the animation (the last is now)
  const dates = useMemo(() => [...new Set(view.rows.flatMap((r) => r.path.map((p) => p.date)))].sort(), [view.rows]);
  const t = useTimeline(dates.length);
  const at = dates[t.i];
  const bounds = useMemo(() => boundsOf(view.rows.flatMap((r) => r.path)), [view.rows]);
  const frame = view.rows.map((r) => {
    const p = r.path.find((x) => x.date === at);
    return { ...r, x: p?.x ?? null, y: p?.y ?? null, name: p?.label ?? null, phase: p ? Number(p.label.match(/^(\d)/)?.[1]) || null : null, date: p?.date ?? null };
  });
  const rows = frame.filter((r) => r.x !== null && r.y !== null);
  const sel = frame.find((r) => r.key === focus) ?? null;
  const trail = sel ? sel.path.filter((p) => p.date <= (at ?? '')).slice(-24) : [];
  const dots = rows.map((r) => ({ x: r.x!, y: r.y!, key: r.key, label: r.label, date: r.date ?? '', name: r.name ?? '' }));
  const sorted = [...frame].sort((a, b) => (a.phase ?? 9) - (b.phase ?? 9) || (b.y ?? 0) - (a.y ?? 0));
  return (
    <div className="stack" style={{ gap: 16 }}>
      <Notices view={view} />
      <div className="ind-grid">
        <Card
          title="지역별 국면"
          sub={`${view.real ? '실질' : '명목'} 가격 ${view.window}개월 변화 × 거래량 ${view.window}개월 변화. ▶로 최근 5년을 재생하고, 점을 누르면 그 지역의 궤적을 그립니다.`}
          about={<p>오른쪽 위(가격↑ 거래↑)가 1 회복기, 왼쪽 위가 2 활황기, 왼쪽 가운데가 3 침체 진입기, 왼쪽 아래가 4 침체기, 오른쪽 아래가 5 불황기, 오른쪽 가운데가 6 회복 진입기입니다. 재생하면 지역들이 달마다 국면 사이를 움직이는 모습을 볼 수 있습니다. 지역마다 국면이 다르게 돌기 때문에, 먼저 도는 지역의 궤적이 뒤따르는 지역을 짐작하는 데 쓰입니다.</p>}
        >
          <div style={{ width: '100%', height: 360 }}>
            <ResponsiveContainer>
              <ScatterChart margin={{ top: 16, right: 16, bottom: 8, left: 0 }}>
                <CartesianGrid stroke="var(--line-soft)" />
                <XAxis type="number" dataKey="x" domain={bounds.x} allowDataOverflow tick={axis} tickLine={false} axisLine={false} tickFormatter={pctTick} label={{ value: '거래량 변화', position: 'insideBottomRight', offset: -2, fontSize: 11, fill: 'var(--muted)' }} />
                <YAxis type="number" dataKey="y" domain={bounds.y} allowDataOverflow tick={axis} tickLine={false} axisLine={false} width={48} tickFormatter={pctTick} label={{ value: '가격 변화', angle: -90, position: 'insideLeft', fontSize: 11, fill: 'var(--muted)' }} />
                <ZAxis range={[40, 40]} />
                {flatBand}
                <ReferenceLine x={0} stroke="var(--muted)" strokeDasharray="4 4" />
                <ReferenceLine y={0} stroke="var(--muted)" strokeDasharray="4 4" />
                <Tooltip
                  cursor={false}
                  content={({ payload }) => {
                    const p = payload?.[0]?.payload as { label?: string; date: string; x: number; y: number; name: string } | undefined;
                    if (!p) return null;
                    return (
                      <div style={{ ...tipStyle, padding: '8px 10px' }}>
                        <div className="strong">{p.label ?? ''} {ym(p.date)}</div>
                        <div>거래량: {pct(p.x)}</div>
                        <div>가격: {pct(p.y, 2)}</div>
                        <div className="sub">{p.name}</div>
                      </div>
                    );
                  }}
                />
                {sel && trail.length > 0 && <Scatter data={trail.map((p) => ({ ...p, name: p.label }))} fill="var(--series-2)" fillOpacity={0.5} line={{ stroke: 'var(--series-2)', strokeWidth: 1.4 }} isAnimationActive={false} />}
                <Scatter data={dots} fill="var(--series-1)" isAnimationActive={false} onClick={(d: { payload?: { key: string } }) => d.payload && setFocus(d.payload.key)} style={{ cursor: 'pointer' }}>
                  <LabelList dataKey="label" position="top" style={{ fontSize: 11, fill: 'var(--ink-2)' }} />
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          <TimelineControl t={t} dates={dates} label="국면 시점" />
          <HoneycombLegend current={sel?.phase} />
          {sel && (
            <p className="sub">
              <b>{sel.label}</b> {frameLabel(trail[0]?.date)} → {frameLabel(at)} 궤적. {sel.name ? `이때 ${sel.name}.` : '이 달 자료 없음.'} <button type="button" className="linklike" onClick={() => onPick(sel.key)}>이 지역 자세히 보기 ›</button>
            </p>
          )}
        </Card>
        <Card title="국면별 지역" sub={`${frameLabel(at)} 기준. 국면 번호 순, 같은 국면 안에서는 가격 변화가 큰 순`}>
          <div className="table-wrap">
            <table className="rank">
              <thead>
                <tr>
                  <th>지역</th>
                  <th className="l">국면</th>
                  <th className="num">가격</th>
                  <th className="num">거래량</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <tr key={r.key} aria-selected={r.key === focus} onClick={() => setFocus(r.key)} style={{ cursor: 'pointer', background: r.key === focus ? 'var(--surface-2)' : undefined }}>
                    <th scope="row">{r.label}</th>
                    <td className="l">{r.name ? r.name.replace(/\s*\(.*\)$/, '') : '자료 없음'}</td>
                    <td className="num">{pct(r.y, 2)}</td>
                    <td className="num">{pct(r.x, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}

function CorrPanel({ view }: { view: CorrView }) {
  const lags = view.lags.map((l) => ({ ...l, v: l.r }));
  const b = view.best;
  const read = !b
    ? '겹치는 기간이 짧아 상관을 계산하지 못했습니다.'
    : `${view.macro.label} 변화와 ${view.region.label} 매매가격 변화는 ${b.lag === 0 ? '같은 달끼리' : b.lag > 0 ? `${view.macro.label} 변화가 ${b.lag}개월 앞설 때` : `매매가격 변화가 ${-b.lag}개월 앞설 때`} 가장 강하게 ${b.r >= 0 ? '같은 방향으로' : '반대 방향으로'} 움직였습니다 (r = ${b.r.toFixed(2)}, ${b.n}개월).`;
  return (
    <div className="stack" style={{ gap: 16 }}>
      <Notices view={view} />
      <section className="card stack" style={{ gap: 8 }} aria-label="요약">
        <h3 style={{ margin: 0 }}>{view.region.label} × {view.macro.label}</h3>
        <p style={{ margin: 0 }}>{read}</p>
        <p className="sub" style={{ margin: 0 }}>같은 달 상관 {view.now === null ? '—' : view.now.toFixed(2)} · {view.macro.about} · 매매가격은 전년 대비 상승률</p>
      </section>
      <div className="ind-grid">
        <Card
          title="시차별 상관계수"
          sub="오른쪽(+)은 지표가 먼저, 왼쪽(−)은 집값이 먼저 움직인 경우"
          about={
            <p>
              지표를 몇 달씩 앞뒤로 밀어 가며 집값 변화와의 상관계수를 구했습니다. 예를 들어 +12에서 강한 음수면 금리가 오르고 약 1년 뒤 집값 상승률이 떨어지는 일이 많았다는 뜻입니다. 둘 다 1년 변화라 이웃한 달이 겹쳐 실제보다 상관이 높게 나오기 쉽고, 상관은 원인이 아닙니다. 다른 지표와 함께 보는 참고용입니다.
            </p>
          }
        >
          <div style={{ width: '100%', height: 260 }}>
            <ResponsiveContainer>
              <BarChart data={lags} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--line-soft)" vertical={false} />
                <XAxis dataKey="lag" tick={axis} tickLine={false} axisLine={false} interval={5} tickFormatter={(v) => (v > 0 ? `+${v}` : String(v))} />
                <YAxis domain={[-1, 1]} tick={axis} tickLine={false} axisLine={false} width={40} />
                <ReferenceLine y={0} stroke="var(--muted)" />
                <Tooltip contentStyle={tipStyle} labelFormatter={(l) => `시차 ${Number(l) > 0 ? '+' : ''}${l}개월`} formatter={(v, _n, item) => [v === null ? '—' : `${Number(v).toFixed(2)} (${(item.payload as { n: number }).n}개월)`, '상관계수']} />
                <Bar dataKey="v" isAnimationActive={false}>
                  {lags.map((l) => (
                    <Cell key={l.lag} fill={l.lag === b?.lag ? 'var(--series-2)' : (l.r ?? 0) >= 0 ? 'var(--series-1)' : 'var(--series-4)'} fillOpacity={l.lag === b?.lag ? 1 : 0.55} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <ChartCard title="두 변화 겹쳐 보기" data={view.chart} />
      </div>
    </div>
  );
}

const heat = (v: number | null) => (v === null ? 'transparent' : `color-mix(in srgb, var(--series-4) ${Math.round(Math.min(100, Math.max(0, v)) * 0.8)}%, transparent)`);

function BuyersPanel({ view, onPick }: { view: BuyersView; onPick: (key: string) => void }) {
  const bySido = view.rankBy === 'otherSido';
  return (
    <div className="stack" style={{ gap: 16 }}>
      <Notices view={view} />
      <div className="ind-grid">
        <ChartCard
          title="매수자 거주지 · 외지인 비율"
          data={view.residence}
          sub={`${view.region.label} 아파트를 산 사람이 어디 사는지`}
          about={<p>한국부동산원 *매입자거주지별 아파트매매거래*입니다. 외지인(그 시군구 밖에 사는 매수자) 비율이 오르면 투자 수요가 들어오는 것이고, 특히 서울 거주자 비율이 오르는 지방·경기 지역은 갭투자 자금이 몰리는 경우가 많습니다. 반대로 같은 시군구 사람이 대부분이면 실수요 위주입니다.</p>}
        />
        <ChartCard title="매수자 연령대" data={view.age} about={<p>한국부동산원 *매입자연령대별 아파트매매거래*(2019년부터)입니다. 기타는 법인 등 나이가 없는 매수자입니다.</p>} />
        <ChartCard title="면적대별 매매거래" data={view.size} sub="어떤 크기의 아파트가 팔리는지 (전용면적)" />
        <ChartCard title="토지거래허가 처리" data={view.permit} sub="허가구역 안 거래의 허가·불허가 필지 수" />
        <ChartCard title="법인 매수 · 매도" data={view.owner} about={<p>한국부동산원 *거래주체별 아파트매매거래*에서 매수자나 매도자가 법인인 거래의 비율입니다. 법인 매도가 많으면 보유세·규제로 법인이 물량을 내놓는 것입니다.</p>} />
        <Card
          title={bySido ? '시도별 외지인 매수' : '이웃 지역 외지인 매수'}
          sub={`최근 12개월, ${bySido ? '다른 시도 거주자' : '외지인(시군구 밖 거주자)'} 비율 순. 칸은 최근 12개월 달마다의 외지인 비율(진할수록 높음)`}
        >
          <div className="table-wrap">
            <table className="rank">
              <thead>
                <tr>
                  <th className="l">지역</th>
                  <th className="num">외지인</th>
                  <th className="num">다른 시도</th>
                  <th className="num">서울</th>
                  <th className="num">1년 전 대비</th>
                  <th className="num">거래</th>
                  <th className="l">최근 12개월</th>
                </tr>
              </thead>
              <tbody>
                {view.ranking.map((r) => (
                  <tr key={r.key} style={{ background: r.key === view.region.key ? 'var(--surface-2)' : undefined }}>
                    <th scope="row" className="l">
                      <button type="button" className="linklike" style={{ textDecoration: 'none' }} onClick={() => onPick(r.key)}>{r.label}</button>
                    </th>
                    <td className="num">{pct(r.outside, 1, false)}</td>
                    <td className="num">{pct(r.otherSido, 1, false)}</td>
                    <td className="num">{pct(r.seoul, 1, false)}</td>
                    <td className="num">{r.change === null ? '—' : `${r.change > 0 ? '+' : ''}${r.change.toFixed(1)}%p`}</td>
                    <td className="num">{r.deals.toLocaleString('ko-KR')}</td>
                    <td className="l">
                      <span className="inline" style={{ gap: 2, flexWrap: 'nowrap' }} aria-label="최근 12개월 외지인 비율">
                        {r.months.map((m) => (
                          <span key={m.date} title={`${ym(m.date)} ${pct(m.value, 1, false)}`} style={{ width: 10, height: 16, flex: 'none', borderRadius: 2, background: heat(m.value), border: '1px solid var(--line-soft)' }} />
                        ))}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="sub">지역 이름을 누르면 그 지역의 투자자 동향을 봅니다. 기준 {ym(view.ranking[0]?.date)}.</p>
        </Card>
      </div>
    </div>
  );
}

/** One region picker: typed search over every region, plus quick picks */
function RegionPicker({ regions, value, onPick, label, quick }: { regions: RegionOption[]; value?: string; onPick: (key: string) => void; label: string; quick: RegionOption[] }) {
  const [text, setText] = useState('');
  const byLabel = useMemo(() => new Map(regions.map((r) => [r.label, r.key])), [regions]);
  const id = `regions-${label}`;
  return (
    <div className="inline" style={{ gap: 6, flexWrap: 'wrap' }}>
      <label className="inline" style={{ gap: 6 }}>
        <span className="sub">{label}</span>
        <input
          list={id}
          value={text}
          placeholder={value ? (regions.find((r) => r.key === value)?.label ?? '') : '예: 강남구, 분당구, 대구'}
          onChange={(e) => {
            setText(e.target.value);
            const key = byLabel.get(e.target.value);
            if (key) {
              onPick(key);
              setText('');
            }
          }}
          style={{ minWidth: 200 }}
        />
      </label>
      <datalist id={id}>
        {regions.map((r) => (
          <option key={r.key} value={r.label} />
        ))}
      </datalist>
      {quick.map((r) => (
        <button key={r.key} type="button" className="chip-btn" aria-pressed={r.key === value} onClick={() => onPick(r.key)}>
          {r.label}
        </button>
      ))}
    </div>
  );
}

export function RegionAnalysis({ regions, macros, mine }: { regions: RegionOption[]; macros: { key: string; label: string }[]; mine: RegionOption[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const tab = (TABS.find((t) => t.key === sp.get('tab'))?.key ?? 'one') as Tab;
  const years = sp.has('years') ? Number(sp.get('years')) : 10;
  const one = sp.get('r') ?? mine[0]?.key ?? '서울';
  const many = sp.getAll('c').length ? sp.getAll('c') : [one, '서울', '전국'].filter((k, i, a) => a.indexOf(k) === i);
  const macro = sp.get('m') ?? 'base';
  const window = sp.get('w') === '12' ? 12 : 6;
  const real = sp.get('real') !== '0';
  const cy = [3, 5, 10].includes(Number(sp.get('cy'))) ? Number(sp.get('cy')) : 5;
  const ay = [1, 3, 5].includes(Number(sp.get('ay'))) ? Number(sp.get('ay')) : 3;
  const [note, setNote] = useState<string | null>(null);
  const set = (patch: Record<string, string | string[] | null>) => {
    const q = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      q.delete(k);
      if (Array.isArray(v)) v.forEach((x) => q.append(k, x));
      else if (v !== null) q.set(k, v);
    }
    router.replace(`${pathname}?${q.toString()}`, { scroll: false });
  };
  const label = (key: string) => regions.find((r) => r.key === key)?.label ?? key;
  const quick = [...mine, ...regions.filter((r) => ['서울', '경기', '부산', '대구'].includes(r.key))].filter((r, i, a) => a.findIndex((x) => x.key === r.key) === i).slice(0, 6);

  const url = (() => {
    const q = new URLSearchParams({ view: tab, years: String(years) });
    if (tab === 'one') q.append('r', one);
    if (tab === 'compare') many.forEach((k) => q.append('r', k));
    if (tab === 'cycle') {
      q.set('window', String(window));
      q.set('real', real ? '1' : '0');
    }
    if (tab === 'corr') {
      q.append('r', one);
      q.set('macro', macro);
    }
    if (tab === 'buyers') q.append('r', one);
    if (tab === 'complex') {
      q.append('r', one);
      q.set('years', String(cy));
    }
    if (tab === 'fav') return '/api/regions?view=favorites';
    if (tab === 'map') return '/api/regions?view=map';
    if (tab === 'location') return '/api/regions?view=location';
    if (tab === 'apply') {
      q.append('r', one);
      q.set('years', String(ay));
    }
    return `/api/regions?${q.toString()}`;
  })();
  const { data, error, loading } = useView<OneView | CompareView | CycleView | CorrView | BuyersView | ComplexViewData | FavoriteData[] | MapViewData | ApplyViewData | LocationViewData>(url);

  return (
    <div className="stack" style={{ gap: 16 }}>
      <section className="card stack" style={{ gap: 12 }} aria-label="지역 분석 설정">
        <div className="inline spread" style={{ flexWrap: 'wrap', gap: 12 }}>
          <div className="seg" role="tablist" aria-label="화면">
            {TABS.map((t) => (
              <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} aria-pressed={tab === t.key} onClick={() => set({ tab: t.key })}>
                {t.label}
              </button>
            ))}
          </div>
          {tab === 'complex' && (
            <div className="seg" role="group" aria-label="거래 기간">
              {[3, 5, 10].map((y) => (
                <button key={y} type="button" aria-current={cy === y ? 'true' : undefined} onClick={() => set({ cy: String(y) })}>
                  최근 {y}년
                </button>
              ))}
            </div>
          )}
          {tab === 'apply' && (
            <div className="seg" role="group" aria-label="공고 기간">
              {[1, 3, 5].map((y) => (
                <button key={y} type="button" aria-current={ay === y ? 'true' : undefined} onClick={() => set({ ay: String(y) })}>
                  최근 {y}년
                </button>
              ))}
            </div>
          )}
          {!['cycle', 'complex', 'fav', 'map', 'apply', 'location'].includes(tab) && (
            <div className="seg" role="group" aria-label="기간">
              {[5, 10, 20, 0].map((y) => (
                <button key={y} type="button" aria-current={years === y ? 'true' : undefined} onClick={() => set({ years: String(y) })}>
                  {y ? `${y}년` : '전체'}
                </button>
              ))}
            </div>
          )}
        </div>
        {(tab === 'one' || tab === 'corr' || tab === 'complex' || tab === 'buyers' || tab === 'apply' || tab === 'location') && <RegionPicker regions={regions} value={one} label="지역" quick={quick} onPick={(k) => set({ r: k })} />}
        {tab === 'corr' && (
          <label className="inline" style={{ gap: 6, alignSelf: 'flex-start' }}>
            <span className="sub">비교할 지표</span>
            <select value={macro} onChange={(e) => set({ m: e.target.value })} style={{ width: 'auto' }}>
              {macros.map((m) => (
                <option key={m.key} value={m.key}>{m.label}</option>
              ))}
            </select>
          </label>
        )}
        {tab === 'compare' && (
          <div className="stack" style={{ gap: 8 }}>
            <div className="inline" style={{ gap: 6, flexWrap: 'wrap' }}>
              {many.map((k, i) => (
                <span key={k} className="chip-btn" style={{ cursor: 'default' }}>
                  <span className="dot" style={{ background: COLORS[i % COLORS.length] }} />
                  {label(k)}
                  {many.length > 1 && (
                    <button type="button" className="linklike" aria-label={`${label(k)} 빼기`} onClick={() => set({ c: many.filter((x) => x !== k) })}>
                      ×
                    </button>
                  )}
                </span>
              ))}
            </div>
            {many.length < 8 && <RegionPicker regions={regions} label="지역 더하기" quick={quick.filter((r) => !many.includes(r.key))} onPick={(k) => set({ c: [...many.filter((x) => x !== k), k] })} />}
          </div>
        )}
        {tab === 'cycle' && (
          <div className="inline" style={{ gap: 12, flexWrap: 'wrap' }}>
            <div className="seg" role="group" aria-label="비교 기간">
              {[6, 12].map((w) => (
                <button key={w} type="button" aria-current={window === w ? 'true' : undefined} onClick={() => set({ w: String(w) })}>
                  {w === 6 ? '단기 (6개월)' : '장기 (12개월)'}
                </button>
              ))}
            </div>
            <div className="seg" role="group" aria-label="가격 기준">
              <button type="button" aria-current={real ? 'true' : undefined} onClick={() => set({ real: null })}>실질 가격</button>
              <button type="button" aria-current={!real ? 'true' : undefined} onClick={() => set({ real: '0' })}>명목 가격</button>
            </div>
            <span className="sub">전국과 17개 시도</span>
          </div>
        )}
      </section>

      {note && (
        <p className="msg err" role="alert">
          {note} <button type="button" className="linklike" onClick={() => setNote(null)}>닫기</button>
        </p>
      )}
      {error ? (
        <p className="msg err">{error}</p>
      ) : loading || !data ? (
        <p className="empty">{tab === 'apply' ? '불러오는 중… 처음에는 공고마다 경쟁률을 받느라 몇십 초 걸릴 수 있습니다.' : tab === 'map' ? '불러오는 중… 지도는 전국 자료를 한꺼번에 받느라 처음에 10~20초 걸리고, 그 뒤 12시간은 바로 열립니다.' : tab === 'complex' ? '불러오는 중… 처음 여는 시군구는 국토부 실거래가를 달마다 받느라 10~30초 걸립니다. 다음부터는 바로 열립니다.' : '불러오는 중… 처음 여는 지역은 한국부동산원에서 자료를 받느라 몇 초 걸립니다.'}</p>
      ) : tab === 'location' ? (
        <LocationPanel key={one} view={data as LocationViewData} focus={one} onPick={(k) => set({ tab: 'one', r: k })} />
      ) : tab === 'apply' ? (
        <ApplyPanel view={data as ApplyViewData} />
      ) : tab === 'map' ? (
        <RegionMap view={data as MapViewData} onPick={(k) => set({ tab: 'one', r: k })} />
      ) : tab === 'buyers' ? (
        <BuyersPanel view={data as BuyersView} onPick={(k) => set({ r: k })} />
      ) : tab === 'complex' ? (
        <ComplexPanel view={data as ComplexViewData} onError={setNote} />
      ) : tab === 'fav' ? (
        <FavoritesPanel list={data as FavoriteData[]} onOpen={(r) => set({ tab: 'complex', r })} onError={setNote} />
      ) : tab === 'one' ? (
        <OnePanel view={data as OneView} />
      ) : tab === 'compare' ? (
        <ComparePanel view={data as CompareView} />
      ) : tab === 'cycle' ? (
        <CyclePanel view={data as CycleView} onPick={(k) => set({ tab: 'one', r: k })} />
      ) : (
        <CorrPanel view={data as CorrView} />
      )}
    </div>
  );
}
