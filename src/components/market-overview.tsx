'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { frameLabel, TimelineControl, useTimeline } from '@/components/timeline';
import { KEY_HELP } from '@/components/analysis-board';
import { PERIOD_LABEL, PERIODS, squarify, type Technicals, TENORS, TENOR_YEARS, type CurveFrames, type MapSector, type Period, type Rect, type Tenor, type YieldRow } from '@/domain/market-overview';

type Returns = Partial<Record<Period, number | null>>;
interface EtfRow {
  symbol: string;
  label: string;
  last: number | null;
  returns: Returns;
}
interface SectorsView {
  asOf: string | null;
  sectors: EtfRow[];
  benchmark: EtfRow;
  style: { size: string; cells: EtfRow[] }[];
  frames: Record<Period, { dates: string[]; values: Record<string, (number | null)[]> }>;
}
interface MapView {
  asOf: string | null;
  periods: Period[];
  sectors: MapSector[];
}
interface YieldsView {
  rows: YieldRow[];
  curves: CurveFrames;
  sources: { key: string; label: string; source: string }[];
  missing: 'ECOS'[];
  errors: string[];
}
interface ReturnRow {
  symbol: string;
  name: string;
  group: string;
  board: string | null;
  last: number | null;
  date: string | null;
  returns: Returns;
  spark: number[];
}

const TABS = [
  { key: 'sectors', label: '섹터 · 스타일' },
  { key: 'map', label: 'S&P 500 지도' },
  { key: 'rank', label: '기술적 순위' },
  { key: 'yields', label: '국채 금리' },
  { key: 'watch', label: '기간 수익률' },
] as const;
type Tab = (typeof TABS)[number]['key'];

const COLORS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)', 'var(--series-6)', 'var(--series-7)'];
/** Return that paints the strongest color, per period */
const FULL: Record<Period, number> = { '1D': 0.03, '1W': 0.05, '1M': 0.08, '3M': 0.15, '6M': 0.2, YTD: 0.25, '1Y': 0.3, '3Y': 0.6 };

const pct = (v: number | null | undefined, digits = 1) => (v === null || v === undefined ? '—' : `${v > 0 ? '+' : ''}${(v * 100).toFixed(digits)}%`);
const strength = (v: number, p: Period) => Math.min(1, Math.abs(v) / FULL[p]);
/** A tile color: red up and blue down (or the theme's pair), deeper the further it moved */
function heat(v: number | null | undefined, p: Period): string {
  if (v === null || v === undefined) return 'var(--line-soft)';
  const s = strength(v, p);
  return `color-mix(in srgb, var(${v >= 0 ? '--up' : '--down'}) ${Math.round(12 + s * 78)}%, var(--surface))`;
}
const inkOn = (v: number | null | undefined, p: Period) => (v !== null && v !== undefined && strength(v, p) > 0.55 ? '#fff' : 'var(--ink)');

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

function PeriodSeg({ value, onPick, periods = PERIODS }: { value: Period; onPick: (p: Period) => void; periods?: readonly Period[] }) {
  return (
    <div className="seg" role="group" aria-label="기간">
      {periods.map((p) => (
        <button key={p} type="button" aria-current={value === p ? 'true' : undefined} onClick={() => onPick(p)}>
          {PERIOD_LABEL[p]}
        </button>
      ))}
    </div>
  );
}

export function MarketOverview() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const tab = (TABS.some((t) => t.key === sp.get('tab')) ? sp.get('tab') : 'sectors') as Tab;
  const period = (PERIODS.includes(sp.get('p') as Period) ? sp.get('p') : '1M') as Period;
  const set = (next: Record<string, string | null>) => {
    const q = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === null) q.delete(k);
      else q.set(k, v);
    }
    router.replace(`${pathname}?${q.toString()}`, { scroll: false });
  };
  return (
    <div className="stack" style={{ gap: 16 }}>
      <section className="card stack" style={{ gap: 12 }} aria-label="시장 개요 설정">
        <div className="inline spread" style={{ flexWrap: 'wrap', gap: 12 }}>
          <div className="seg" role="tablist" aria-label="화면">
            {TABS.map((t) => (
              <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} aria-pressed={tab === t.key} onClick={() => set({ tab: t.key })}>
                {t.label}
              </button>
            ))}
          </div>
          {(tab === 'sectors' || tab === 'map') && <PeriodSeg value={tab === 'map' && period === '3Y' ? '1Y' : period} periods={tab === 'map' ? PERIODS.filter((p) => p !== '3Y') : PERIODS} onPick={(p) => set({ p })} />}
        </div>
      </section>
      {tab === 'sectors' ? <SectorsTab period={period} /> : tab === 'map' ? <MapTab period={period === '3Y' ? '1Y' : period} /> : tab === 'rank' ? <RankTab /> : tab === 'yields' ? <YieldsTab /> : <WatchTab />}
    </div>
  );
}

// ------------------------------------------------------------------ sectors and styles

function SectorsTab({ period }: { period: Period }) {
  const { data, error } = useView<SectorsView>('/api/markets?view=sectors');
  if (error) return <p className="msg err">{error}</p>;
  if (!data) return <p className="empty">불러오는 중… 처음에는 ETF 21개의 5년치 시세를 받느라 몇 초 걸립니다.</p>;
  // Keyed by period so the replay starts on the latest month again
  return <SectorsBody key={period} data={data} period={period} />;
}

function SectorsBody({ data, period }: { data: SectorsView; period: Period }) {
  const frames = data.frames[period];
  const t = useTimeline(frames.dates.length);
  const latest = t.i >= frames.dates.length - 1;
  const at = (symbol: string, fallback: Returns) => (latest ? (fallback[period] ?? null) : (frames.values[symbol]?.[t.i] ?? null));
  const asOf = latest ? data.asOf : frames.dates[t.i];
  const bars = data.sectors.map((s) => ({ label: s.label, symbol: s.symbol, v: at(s.symbol, s.returns) })).sort((a, b) => (b.v ?? -9) - (a.v ?? -9));
  const bench = at(data.benchmark.symbol, data.benchmark.returns);
  return (
    <div className="stack" style={{ gap: 16 }}>
      <section className="card stack" style={{ gap: 8 }} aria-label="시점 재생">
        <span className="sub">
          {PERIOD_LABEL[period]} 수익률 · {asOf ?? '—'} 종가 기준{latest ? '' : ' (지난 시점 재생 중)'}. 재생을 누르면 지난 3년 동안 달마다 이 기간 수익률이 어떻게 바뀌었는지 섹터와 스타일 판 전체가 함께 움직입니다.
        </span>
        <TimelineControl t={t} dates={frames.dates} label="월말" />
      </section>
      <div className="ind-grid">
        <section className="card indicator" aria-label="섹터 히트맵">
          <div className="stack" style={{ gap: 4 }}>
            <h3>미국 섹터 ({PERIOD_LABEL[period]})</h3>
            <span className="sub">S&P 500 섹터 SPDR ETF 11개. 기준인 S&P 500(SPY)은 {pct(bench)}</span>
          </div>
          <div className="mo-tiles">
            {data.sectors.map((s) => {
              const v = at(s.symbol, s.returns);
              return (
                <div key={s.symbol} className="mo-tile" style={{ background: heat(v, period), color: inkOn(v, period) }} title={`${s.label} (${s.symbol}) ${pct(v, 2)}${bench !== null && v !== null ? ` · S&P 500 대비 ${pct(v - bench, 2)}` : ''}`}>
                  <span className="mo-tile-name">{s.label}</span>
                  <b>{pct(v)}</b>
                  <span className="mo-tile-sym">{s.symbol}</span>
                </div>
              );
            })}
          </div>
        </section>
        <section className="card indicator" aria-label="섹터 순위">
          <div className="stack" style={{ gap: 4 }}>
            <h3>섹터 순위</h3>
            <span className="sub">점선이 S&P 500. 선보다 오른쪽이면 시장보다 잘한 섹터입니다.</span>
          </div>
          <ResponsiveContainer width="100%" height={330}>
            <BarChart data={bars} layout="vertical" margin={{ left: 8, right: 48, top: 4, bottom: 4 }}>
              <CartesianGrid horizontal={false} stroke="var(--line-soft)" />
              <XAxis type="number" domain={[(d: number) => Math.min(0, d * 1.35), (d: number) => Math.max(0, d * 1.35)]} tickFormatter={(v: number) => `${Math.round(v * 1000) / 10}%`} stroke="var(--muted)" fontSize={11} />
              <YAxis type="category" dataKey="label" width={78} stroke="var(--muted)" fontSize={12} interval={0} />
              <Tooltip formatter={(v) => pct(Number(v), 2)} cursor={{ fill: 'var(--line-soft)' }} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)' }} />
              {bench !== null && <ReferenceLine x={bench} stroke="var(--ink-2)" strokeDasharray="4 3" />}
              <Bar dataKey="v" name={`${PERIOD_LABEL[period]} 수익률`} animationDuration={500} isAnimationActive>
                {bars.map((b) => (
                  <Cell key={b.symbol} fill={b.v !== null && b.v < 0 ? 'var(--down)' : 'var(--up)'} />
                ))}
                <LabelList
                  dataKey="v"
                  content={(p) => {
                    const { x = 0, y = 0, width = 0, height = 0, value } = p as { x?: number; y?: number; width?: number; height?: number; value?: number };
                    const v = Number(value);
                    const neg = v < 0;
                    return (
                      <text x={neg ? Math.min(x, x + width) - 4 : Math.max(x, x + width) + 4} y={y + height / 2} dy="0.35em" textAnchor={neg ? 'end' : 'start'} fontSize={11} fill="var(--ink-2)">
                        {pct(v)}
                      </text>
                    );
                  }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </section>
        <section className="card indicator" aria-label="스타일 박스">
          <div className="stack" style={{ gap: 4 }}>
            <h3>스타일 박스 ({PERIOD_LABEL[period]})</h3>
            <span className="sub">러셀 지수 ETF로 본 크기 × 가치·성장. 어느 쪽에 돈이 몰렸는지 한눈에 봅니다.</span>
          </div>
          <table className="mo-style">
            <thead>
              <tr>
                <th />
                {['가치', '혼합', '성장'].map((c) => (
                  <th key={c} scope="col">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.style.map((r) => (
                <tr key={r.size}>
                  <th scope="row">{r.size}</th>
                  {r.cells.map((c) => {
                    const v = at(c.symbol, c.returns);
                    return (
                      <td key={c.symbol} style={{ background: heat(v, period), color: inkOn(v, period) }} title={`${c.label} (${c.symbol}) ${pct(v, 2)}`}>
                        <b>{pct(v)}</b>
                        <span className="mo-tile-sym">{c.symbol}</span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="sub">대형 IWD·IWB·IWF, 중형 IWS·IWR·IWP, 소형 IWN·IWM·IWO. 배당은 빼고 가격만 잰 수익률입니다.</p>
        </section>
      </div>
      <p className="sub">Yahoo Finance 일별 종가. 15분마다 새로 받습니다. 기간 수익률은 그 기간 시작일 이전 마지막 종가에서 잽니다.</p>
    </div>
  );
}

// ------------------------------------------------------------------ S&P 500 map

const MAP_W = 1200;
const MAP_H = 680;
const HEAD = 16;

interface Box extends Rect {
  kind: 'sector' | 'stock';
  key: string;
  label: string;
  sub?: string;
  symbol?: string;
  returns: Returns;
  weight: number;
}

function layoutMap(sectors: MapSector[]): Box[] {
  const out: Box[] = [];
  const sr = squarify(sectors.map((s) => s.weight), { x: 0, y: 0, w: MAP_W, h: MAP_H });
  sectors.forEach((s, si) => {
    const r = sr[si];
    out.push({ ...r, kind: 'sector', key: s.name, label: s.label, returns: s.returns, weight: s.weight });
    const inner = { x: r.x + 1, y: r.y + HEAD, w: Math.max(0, r.w - 2), h: Math.max(0, r.h - HEAD - 1) };
    const ir = squarify(s.industries.map((i) => i.weight), inner);
    s.industries.forEach((ind, ii) => {
      const box = ir[ii];
      const kr = squarify(ind.stocks.map((k) => k.weight), { x: box.x + 0.5, y: box.y + 0.5, w: Math.max(0, box.w - 1), h: Math.max(0, box.h - 1) });
      ind.stocks.forEach((k, ki) => out.push({ ...kr[ki], kind: 'stock', key: k.symbol, label: k.symbol, sub: `${k.name} · ${ind.name}`, symbol: k.symbol, returns: k.returns, weight: k.weight }));
    });
  });
  return out;
}

function MapTab({ period }: { period: Period }) {
  const { data, error } = useView<MapView>('/api/markets?view=map');
  const boxes = useMemo(() => (data ? layoutMap(data.sectors) : []), [data]);
  const [hover, setHover] = useState<Box | null>(null);
  if (error) return <p className="msg err">{error}</p>;
  if (!data) return <p className="empty">불러오는 중… 처음에는 S&P 500 종목 500여 개의 시세를 받느라 10~20초 걸리고, 그 뒤 한 시간은 바로 열립니다.</p>;
  const sorted = [...data.sectors].sort((a, b) => (b.returns[period] ?? -9) - (a.returns[period] ?? -9));
  return (
    <div className="stack" style={{ gap: 16 }}>
      <section className="card indicator" aria-label="S&P 500 지도">
        <div className="inline spread" style={{ gap: 8, flexWrap: 'wrap' }}>
          <div className="stack" style={{ gap: 4 }}>
            <h3>S&P 500 지도 ({PERIOD_LABEL[period]})</h3>
            <span className="sub">상자 크기는 지수 안 비중(시가총액), 색은 {PERIOD_LABEL[period]} 수익률. 섹터 안에서 같은 산업끼리 붙어 있습니다. 종목을 누르면 실시간 시세로 갑니다. {data.asOf} 종가 기준.</span>
          </div>
          <div className="inline mo-legend" aria-label="색 범례">
            {[-1, -0.5, -0.2, 0, 0.2, 0.5, 1].map((k) => (
              <span key={k} style={{ background: heat(k * FULL[period], period), color: inkOn(k * FULL[period], period) }}>{pct(k * FULL[period], 0)}</span>
            ))}
          </div>
        </div>
        <div className="mo-map-wrap">
          <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} className="mo-map" role="img" aria-label="S&P 500 종목 지도">
            {boxes.map((b) =>
              b.kind === 'sector' ? (
                <g key={`s-${b.key}`}>
                  <rect x={b.x} y={b.y} width={b.w} height={b.h} fill="var(--surface-2)" stroke="var(--surface)" strokeWidth={2} />
                  {b.w > 50 && (
                    <text x={b.x + 4} y={b.y + 12} fontSize={11} fontWeight={600} fill="var(--ink-2)">
                      {b.label} {pct(b.returns[period])}
                    </text>
                  )}
                </g>
              ) : (
                <a key={b.key} href={`/market?s=${encodeURIComponent(b.symbol!)}`} onMouseEnter={() => setHover(b)} onMouseLeave={() => setHover((h) => (h === b ? null : h))} onFocus={() => setHover(b)}>
                  <rect x={b.x} y={b.y} width={Math.max(0, b.w)} height={Math.max(0, b.h)} fill={heat(b.returns[period], period)} stroke="var(--surface)" strokeWidth={0.6} className="mo-map-cell">
                    <title>{`${b.symbol} ${b.sub} · ${PERIOD_LABEL[period]} ${pct(b.returns[period], 2)} · 비중 ${b.weight.toFixed(2)}%`}</title>
                  </rect>
                  {b.w > 34 && b.h > 22 && (
                    <text x={b.x + b.w / 2} y={b.y + b.h / 2} textAnchor="middle" fontSize={Math.max(9, Math.min(22, Math.sqrt(b.w * b.h) / 5))} fill={inkOn(b.returns[period], period)} pointerEvents="none">
                      <tspan x={b.x + b.w / 2} dy="-0.15em" fontWeight={700}>{b.label}</tspan>
                      {b.h > 36 && <tspan x={b.x + b.w / 2} dy="1.15em" fontSize="0.78em">{pct(b.returns[period])}</tspan>}
                    </text>
                  )}
                </a>
              ),
            )}
          </svg>
        </div>
        <p className="sub" style={{ minHeight: 20 }}>{hover ? `${hover.symbol} · ${hover.sub} · ${PERIOD_LABEL[period]} ${pct(hover.returns[period], 2)} · 비중 ${hover.weight.toFixed(2)}%` : '종목 위에 올리면 이름과 산업, 수익률을 보여 줍니다.'}</p>
      </section>
      <section className="card indicator" aria-label="섹터별 수익률">
        <div className="stack" style={{ gap: 4 }}>
          <h3>섹터별 ({PERIOD_LABEL[period]})</h3>
          <span className="sub">섹터 안 종목 수익률을 비중으로 가중 평균했습니다. 섹터 ETF와 거의 같지만 같은 시점 같은 종목으로 계산한 값입니다.</span>
        </div>
        <div className="table-wrap">
          <table className="rank">
            <thead>
              <tr>
                <th className="l">섹터</th>
                <th className="num">비중</th>
                {data.periods.map((p) => (
                  <th key={p} className="num" style={p === period ? { color: 'var(--ink)' } : undefined}>{PERIOD_LABEL[p]}</th>
                ))}
                <th className="l">비중 큰 종목</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((s) => (
                <tr key={s.name}>
                  <th scope="row" className="l">{s.label}</th>
                  <td className="num">{s.weight.toFixed(1)}%</td>
                  {data.periods.map((p) => (
                    <td key={p} className={`num ${(s.returns[p] ?? 0) >= 0 ? 'up' : 'down'}`} style={p === period ? { fontWeight: 700 } : undefined}>{pct(s.returns[p])}</td>
                  ))}
                  <td className="l sub">{s.industries.flatMap((i) => i.stocks).sort((a, b) => b.weight - a.weight).slice(0, 4).map((k) => k.symbol).join(' · ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="sub">구성 종목과 비중은 SPDR S&P 500 ETF(SPY) 보유 내역, 섹터·산업 분류는 위키백과 S&P 500 구성 종목 표(GICS), 시세는 Yahoo Finance입니다.</p>
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ yields

const bp = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v > 0 ? '+' : ''}${Math.round(v * 100)}bp`);

function YieldsTab() {
  const { data, error } = useView<YieldsView>('/api/markets?view=yields');
  if (error) return <p className="msg err">{error}</p>;
  if (!data) return <p className="empty">불러오는 중… 처음에는 다섯 나라의 2000년 이후 금리를 받느라 10~20초 걸리고, 그 뒤 12시간은 바로 열립니다.</p>;
  return <YieldsBody data={data} />;
}

function YieldsBody({ data }: { data: YieldsView }) {
  const [mode, setMode] = useState<'level' | '1W' | '1M' | '1Y'>('level');
  const [shown, setShown] = useState<string[]>(['US', 'KR', 'JP', 'DE', 'UK']);
  const t = useTimeline(data.curves.dates.length);
  const { dates, curves } = data.curves;
  const yearAgo = Math.max(0, t.i - 12);
  const curveRows = TENORS.map((tn) => {
    const r: Record<string, number | string | null> = { tenor: tn };
    for (const c of Object.keys(curves)) {
      r[c] = curves[c as keyof typeof curves]?.[t.i]?.[tn] ?? null;
      r[`${c}-ago`] = curves[c as keyof typeof curves]?.[yearAgo]?.[tn] ?? null;
    }
    return r;
  });
  const color = (k: string) => COLORS[data.sources.findIndex((s) => s.key === k) % COLORS.length];
  const label = (k: string) => data.sources.find((s) => s.key === k)?.label ?? k;
  const tenYear = dates.map((d, i) => {
    const r: Record<string, number | string | null> = { date: d };
    for (const c of Object.keys(curves)) {
      const f = curves[c as keyof typeof curves]?.[i];
      r[c] = f?.['10Y'] ?? null;
      r[`${c}-spread`] = f?.['10Y'] !== null && f?.['10Y'] !== undefined && f?.['2Y'] !== null && f?.['2Y'] !== undefined ? Number((f['10Y'] - f['2Y']).toFixed(3)) : null;
    }
    return r;
  });
  const keys = Object.keys(curves).filter((k) => shown.includes(k));
  return (
    <div className="stack" style={{ gap: 16 }}>
      {data.missing.includes('ECOS') && (
        <p className="callout">
          한국 국채 금리는 {KEY_HELP.ECOS.label}가 필요합니다. <a href={KEY_HELP.ECOS.href}>연동 · 설정에서 넣기 ›</a>
        </p>
      )}
      {data.errors.length > 0 && <p className="sub">일부 나라 금리를 새로 받지 못해 저장해 둔 값을 보여 줍니다: {data.errors.join(' · ')}</p>}
      <section className="card indicator" aria-label="국채 금리 표">
        <div className="inline spread" style={{ gap: 8, flexWrap: 'wrap' }}>
          <div className="stack" style={{ gap: 4 }}>
            <h3>나라별 국채 금리</h3>
            <span className="sub">{mode === 'level' ? '만기별 최근 금리(%)' : `${{ '1W': '1주', '1M': '1개월', '1Y': '1년' }[mode]} 동안 움직인 폭(bp, 0.01%p)`}. 빨강은 금리가 오른 것(채권값 하락)입니다.</span>
          </div>
          <div className="seg" role="group" aria-label="보기">
            {(['level', '1W', '1M', '1Y'] as const).map((m) => (
              <button key={m} type="button" aria-current={mode === m ? 'true' : undefined} onClick={() => setMode(m)}>
                {m === 'level' ? '금리' : `${{ '1W': '1주', '1M': '1개월', '1Y': '1년' }[m]} 변화`}
              </button>
            ))}
          </div>
        </div>
        <div className="table-wrap">
          <table className="rank">
            <thead>
              <tr>
                <th className="l">나라</th>
                {TENORS.map((tn) => (
                  <th key={tn} className="num">{tn.replace('Y', '년')}</th>
                ))}
                <th className="num">10년−2년</th>
                <th className="l">기준일</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => {
                const spread = r.level['10Y'] !== null && r.level['10Y'] !== undefined && r.level['2Y'] !== null && r.level['2Y'] !== undefined ? r.level['10Y'] - r.level['2Y'] : null;
                return (
                  <tr key={r.country}>
                    <th scope="row" className="l">
                      <span className="dot" style={{ background: color(r.country), marginRight: 6 }} />
                      {r.label}
                    </th>
                    {TENORS.map((tn) => {
                      if (mode === 'level') return <td key={tn} className="num">{r.level[tn] === null || r.level[tn] === undefined ? '—' : r.level[tn]!.toFixed(2)}</td>;
                      const v = r.change[mode][tn];
                      return (
                        <td key={tn} className="num" style={{ background: v === null || v === undefined ? undefined : heat(v / 100, mode === '1Y' ? '1Y' : mode === '1M' ? '1M' : '1W'), color: inkOn((v ?? 0) / 100, mode === '1Y' ? '1Y' : mode === '1M' ? '1M' : '1W') }}>
                          {bp(v)}
                        </td>
                      );
                    })}
                    <td className={`num ${spread !== null && spread < 0 ? 'down' : ''}`}>{spread === null ? '—' : `${spread > 0 ? '+' : ''}${spread.toFixed(2)}%p`}</td>
                    <td className="l sub">{r.date ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="sub">10년−2년이 음수면 장단기 금리가 뒤집힌 것(역전)으로, 경기 둔화 신호로 많이 봅니다. 영국은 5·10·20년만 냅니다.</p>
      </section>
      <section className="card indicator" aria-label="금리 곡선">
        <div className="inline spread" style={{ gap: 8, flexWrap: 'wrap' }}>
          <div className="stack" style={{ gap: 4 }}>
            <h3>금리 곡선 ({frameLabel(dates[t.i])})</h3>
            <span className="sub">가로는 만기, 세로는 금리. 점선은 1년 전 곡선입니다. 재생하면 2000년부터 달마다 곡선이 어떻게 눕고 서고 뒤집혔는지 봅니다.</span>
          </div>
          <div className="inline" style={{ gap: 6, flexWrap: 'wrap' }}>
            {Object.keys(curves).map((k) => (
              <button key={k} type="button" className="chip-btn" aria-pressed={shown.includes(k)} onClick={() => setShown((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]))}>
                <span className="dot" style={{ background: color(k) }} />
                {label(k)}
              </button>
            ))}
          </div>
        </div>
        <TimelineControl t={t} dates={dates} label="월말" />
        <ResponsiveContainer width="100%" height={340}>
          <LineChart data={curveRows} margin={{ left: 0, right: 16, top: 8, bottom: 4 }}>
            <CartesianGrid stroke="var(--line-soft)" />
            <XAxis dataKey="tenor" tickFormatter={(v: Tenor) => `${TENOR_YEARS[v]}년`} stroke="var(--muted)" fontSize={11} />
            <YAxis domain={['auto', 'auto']} tickFormatter={(v: number) => `${v.toFixed(1)}%`} stroke="var(--muted)" fontSize={11} width={48} />
            <Tooltip formatter={(v, name) => [`${Number(v).toFixed(2)}%`, String(name)]} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)' }} />
            {keys.map((k) => (
              <Line key={`${k}-ago`} dataKey={`${k}-ago`} name={`${label(k)} 1년 전`} stroke={color(k)} strokeOpacity={0.45} strokeDasharray="4 3" dot={false} connectNulls isAnimationActive={false} />
            ))}
            {keys.map((k) => (
              <Line key={k} dataKey={k} name={label(k)} stroke={color(k)} strokeWidth={2.4} dot={{ r: 3 }} connectNulls animationDuration={350} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </section>
      <div className="ind-grid">
        <section className="card indicator" aria-label="10년물 추이">
          <div className="stack" style={{ gap: 4 }}>
            <h3>10년물 금리 추이</h3>
            <span className="sub">세로선이 위 곡선의 시점입니다.</span>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={tenYear} margin={{ left: 0, right: 12, top: 8, bottom: 4 }}>
              <CartesianGrid stroke="var(--line-soft)" />
              <XAxis dataKey="date" tickFormatter={(d: string) => d.slice(0, 4)} minTickGap={40} stroke="var(--muted)" fontSize={11} />
              <YAxis tickFormatter={(v: number) => `${v.toFixed(0)}%`} stroke="var(--muted)" fontSize={11} width={40} />
              <Tooltip labelFormatter={(d) => frameLabel(String(d))} formatter={(v, name) => [`${Number(v).toFixed(2)}%`, String(name)]} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)' }} />
              <ReferenceLine x={dates[t.i]} stroke="var(--ink-2)" />
              {keys.map((k) => (
                <Line key={k} dataKey={k} name={label(k)} stroke={color(k)} dot={false} strokeWidth={1.6} connectNulls isAnimationActive={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </section>
        <section className="card indicator" aria-label="장단기 금리차">
          <div className="stack" style={{ gap: 4 }}>
            <h3>장단기 금리차 (10년 − 2년)</h3>
            <span className="sub">0 아래가 역전 구간입니다.</span>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={tenYear} margin={{ left: 0, right: 12, top: 8, bottom: 4 }}>
              <CartesianGrid stroke="var(--line-soft)" />
              <XAxis dataKey="date" tickFormatter={(d: string) => d.slice(0, 4)} minTickGap={40} stroke="var(--muted)" fontSize={11} />
              <YAxis tickFormatter={(v: number) => `${v.toFixed(1)}`} stroke="var(--muted)" fontSize={11} width={40} />
              <Tooltip labelFormatter={(d) => frameLabel(String(d))} formatter={(v, name) => [`${Number(v).toFixed(2)}%p`, String(name)]} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)' }} />
              <ReferenceLine y={0} stroke="var(--muted)" />
              <ReferenceLine x={dates[t.i]} stroke="var(--ink-2)" />
              {keys.filter((k) => k !== 'UK').map((k) => (
                <Line key={k} dataKey={`${k}-spread`} name={label(k)} stroke={color(k)} dot={false} strokeWidth={1.6} connectNulls isAnimationActive={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </section>
      </div>
      <p className="sub">출처: {data.sources.map((s) => `${s.label} ${s.source}`).join(' · ')}. 독일은 무이표 수익률이라 다른 나라의 액면·시장 수익률과 조금 다릅니다.</p>
    </div>
  );
}

// ------------------------------------------------------------------ period returns

function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const min = Math.min(...values), max = Math.max(...values);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 80},${max === min ? 12 : 22 - ((v - min) / (max - min)) * 20}`).join(' ');
  const up = values.at(-1)! >= values[0];
  return (
    <svg width={80} height={24} viewBox="0 0 80 24" aria-hidden="true">
      <polyline points={pts} fill="none" stroke={up ? 'var(--up)' : 'var(--down)'} strokeWidth={1.4} />
    </svg>
  );
}

const fmtLast = (v: number | null) => (v === null ? '—' : v.toLocaleString('ko-KR', { maximumFractionDigits: v >= 1000 ? 0 : v >= 10 ? 2 : 4 }));

function WatchTab() {
  const { data, error } = useView<{ rows: ReturnRow[] }>('/api/markets?view=watch');
  const [sort, setSort] = useState<Period | null>(null);
  if (error) return <p className="msg err">{error}</p>;
  if (!data) return <p className="empty">불러오는 중…</p>;
  const groups = [...new Set(data.rows.map((r) => r.group))];
  const mine = data.rows.some((r) => r.board);
  return (
    <div className="stack" style={{ gap: 16 }}>
      {!mine && (
        <p className="callout">
          보유 종목이나 관심종목이 없어 시장 지표만 보여 줍니다. <Link href="/market">실시간 시세에서 관심종목 담기 ›</Link>
        </p>
      )}
      <section className="card indicator" aria-label="기간 수익률">
        <div className="stack" style={{ gap: 4 }}>
          <h3>기간 수익률</h3>
          <span className="sub">보유·관심 종목과 주요 지수·환율·원자재를 같은 기간으로 나란히 봅니다. 기간 이름을 누르면 그 기간 순으로 정렬합니다(묶음 안에서).</span>
        </div>
        <div className="table-wrap">
          <table className="rank mo-returns">
            <thead>
              <tr>
                <th className="l">종목</th>
                <th className="num">현재가</th>
                <th className="l">최근 60일</th>
                {PERIODS.map((p) => (
                  <th key={p} className="num">
                    <button type="button" className="linklike" aria-pressed={sort === p} onClick={() => setSort((s) => (s === p ? null : p))} style={{ fontWeight: sort === p ? 700 : undefined }}>
                      {PERIOD_LABEL[p]}{sort === p ? ' ▼' : ''}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            {groups.map((g) => {
              const rows = data.rows.filter((r) => r.group === g);
              if (sort) rows.sort((a, b) => (b.returns[sort] ?? -9) - (a.returns[sort] ?? -9));
              return (
                <tbody key={g}>
                  <tr>
                    <th colSpan={3 + PERIODS.length} className="l sub" style={{ background: 'var(--surface-2)', fontWeight: 600 }}>{g === '보유' ? '보유 종목' : g === '관심' ? '관심종목' : g}</th>
                  </tr>
                  {rows.map((r) => (
                    <tr key={`${g}-${r.symbol}`}>
                      <th scope="row" className="l">
                        {r.board ? <Link href={`/market?s=${encodeURIComponent(r.board)}`}>{r.name}</Link> : r.name}
                        <span className="sub" style={{ display: 'block' }}>{r.symbol}{r.date ? ` · ${r.date.slice(5).replace('-', '.')}` : ''}</span>
                      </th>
                      <td className="num">{fmtLast(r.last)}</td>
                      <td className="l"><Spark values={r.spark} /></td>
                      {PERIODS.map((p) => {
                        const v = r.returns[p];
                        return (
                          <td key={p} className="num" style={{ background: v === null || v === undefined ? undefined : heat(v, p), color: inkOn(v, p) }}>
                            {pct(v)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              );
            })}
          </table>
        </div>
        <p className="sub">Yahoo Finance 일별 종가(15분마다 새로 받음). 국내 종목은 거래소 종가, 가상자산은 원화 기준입니다. 배당은 빼고 가격만 잰 수익률입니다.</p>
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ technical ranking

interface RankRow {
  symbol: string;
  name: string;
  sector: string;
  weight: number;
  last: number | null;
  returns: Returns;
  tech: Technicals;
}

const FILTERS = [
  { key: 'all', label: '전체', test: () => true },
  { key: 'above200', label: '200일선 위', test: (r: RankRow) => (r.tech.ma200 ?? -1) > 0 },
  { key: 'below200', label: '200일선 아래', test: (r: RankRow) => (r.tech.ma200 ?? 1) < 0 },
  { key: 'oversold', label: '과매도 (RSI < 30)', test: (r: RankRow) => r.tech.rsi !== null && r.tech.rsi < 30 },
  { key: 'overbought', label: '과매수 (RSI > 70)', test: (r: RankRow) => r.tech.rsi !== null && r.tech.rsi > 70 },
  { key: 'nearHigh', label: '52주 신고가 근처 (3% 안)', test: (r: RankRow) => (r.tech.fromHigh ?? -1) >= -0.03 },
] as const;

type SortKey = 'weight' | 'rsi' | 'ma50' | 'ma200' | 'fromHigh' | 'vol' | '1M' | '3M' | 'YTD' | '1Y';
const sortValue = (r: RankRow, k: SortKey): number | null => (k === 'weight' ? r.weight : k === 'rsi' || k === 'ma50' || k === 'ma200' || k === 'fromHigh' || k === 'vol' ? r.tech[k] : (r.returns[k] ?? null));

function RankTab() {
  const { data, error } = useView<{ asOf: string | null; rows: RankRow[] }>('/api/markets?view=rank');
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['key']>('all');
  const [sector, setSector] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'weight', desc: true });
  const [limit, setLimit] = useState(50);
  if (error) return <p className="msg err">{error}</p>;
  if (!data) return <p className="empty">불러오는 중… 처음에는 S&P 500 종목 500여 개의 시세를 받느라 10~20초 걸립니다.</p>;
  const f = FILTERS.find((x) => x.key === filter)!;
  const rows = data.rows
    .filter((r) => f.test(r) && (!sector || r.sector === sector))
    .sort((a, b) => {
      const va = sortValue(a, sort.key), vb = sortValue(b, sort.key);
      if (va === null) return 1;
      if (vb === null) return -1;
      return sort.desc ? vb - va : va - vb;
    });
  const sectors = [...new Set(data.rows.map((r) => r.sector))].sort();
  const above = data.rows.filter((r) => (r.tech.ma200 ?? -1) > 0).length;
  const known = data.rows.filter((r) => r.tech.ma200 !== null).length;
  const head = (k: SortKey, label: string) => (
    <th className="num">
      <button type="button" className="linklike" aria-pressed={sort.key === k} onClick={() => setSort((s) => ({ key: k, desc: s.key === k ? !s.desc : true }))} style={{ fontWeight: sort.key === k ? 700 : undefined }}>
        {label}{sort.key === k ? (sort.desc ? ' ▼' : ' ▲') : ''}
      </button>
    </th>
  );
  const rsiColor = (v: number | null) => (v === null ? undefined : v >= 70 ? 'var(--up)' : v <= 30 ? 'var(--down)' : undefined);
  return (
    <section className="card indicator" aria-label="기술적 순위">
      <div className="inline spread" style={{ gap: 8, flexWrap: 'wrap' }}>
        <div className="stack" style={{ gap: 4 }}>
          <h3>S&P 500 기술적 순위</h3>
          <span className="sub">{data.asOf} 종가 기준. 200일 이동평균 위에 있는 종목 {above}/{known}개({known ? Math.round((above / known) * 100) : 0}%) — 시장 폭(breadth)을 가늠하는 숫자입니다. 머리글을 누르면 정렬합니다.</span>
        </div>
        <label className="inline" style={{ gap: 6 }}>
          <span className="sub">섹터</span>
          <select value={sector} onChange={(e) => setSector(e.target.value)} style={{ width: 'auto' }} aria-label="섹터">
            <option value="">전체</option>
            {sectors.map((x) => (
              <option key={x} value={x}>{x}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="inline" style={{ gap: 6, flexWrap: 'wrap' }} role="group" aria-label="조건">
        {FILTERS.map((x) => (
          <button key={x.key} type="button" className="chip-btn" aria-pressed={filter === x.key} onClick={() => { setFilter(x.key); setLimit(50); }}>
            {x.label} <span className="sub">{data.rows.filter((r) => x.test(r) && (!sector || r.sector === sector)).length}</span>
          </button>
        ))}
      </div>
      <div className="table-wrap">
        <table className="rank">
          <thead>
            <tr>
              <th className="l">종목</th>
              <th className="l">섹터</th>
              {head('weight', '지수 비중')}
              <th className="num">종가</th>
              {head('rsi', 'RSI(14)')}
              {head('ma50', '50일선 대비')}
              {head('ma200', '200일선 대비')}
              {head('fromHigh', '52주 고점 대비')}
              {head('vol', '변동성')}
              {head('1M', '1개월')}
              {head('3M', '3개월')}
              {head('YTD', '연초 이후')}
              {head('1Y', '1년')}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((r) => (
              <tr key={r.symbol}>
                <th scope="row" className="l">
                  <Link href={`/stocks?t=${encodeURIComponent(r.symbol)}`}>{r.symbol}</Link>
                  <span className="sub" style={{ display: 'block' }}>{r.name}</span>
                </th>
                <td className="l sub">{r.sector}</td>
                <td className="num">{r.weight.toFixed(2)}%</td>
                <td className="num">{r.last?.toLocaleString('en-US', { maximumFractionDigits: 2 }) ?? '—'}</td>
                <td className="num strong" style={{ color: rsiColor(r.tech.rsi) }}>{r.tech.rsi ?? '—'}</td>
                {(['ma50', 'ma200', 'fromHigh'] as const).map((k) => (
                  <td key={k} className={`num ${(r.tech[k] ?? 0) >= 0 ? 'up' : 'down'}`}>{pct(r.tech[k])}</td>
                ))}
                <td className="num">{r.tech.vol === null ? '—' : `${Math.round(r.tech.vol * 100)}%`}</td>
                {(['1M', '3M', 'YTD', '1Y'] as const).map((p) => (
                  <td key={p} className="num" style={{ background: heat(r.returns[p], p), color: inkOn(r.returns[p], p) }}>{pct(r.returns[p])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > limit && (
        <button type="button" className="btn small" style={{ alignSelf: 'center' }} onClick={() => setLimit((l) => l + 100)}>
          더 보기 ({rows.length - limit}개 남음)
        </button>
      )}
      {!rows.length && <p className="empty">조건에 맞는 종목이 없습니다.</p>}
      <p className="sub">RSI는 14일 와일더 방식(70 위 과매수, 30 아래 과매도로 흔히 봄), 이동평균 대비는 종가가 평균보다 몇 % 위·아래인지, 변동성은 최근 60일 일간 수익률의 연 환산 표준편차입니다. 종목을 누르면 종목 분석으로 갑니다.</p>
    </section>
  );
}
