'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from 'recharts';
import { IndicatorChart } from '@/components/analysis-board';
import type { ChartData, Point } from '@/domain/indicators';
import { sma } from '@/domain/region-analysis';
import type { ComplexDetail, ComplexRow, Forecast, Ranked } from '@/domain/complex-analysis';
import { AREA_CLASSES } from '@/domain/complex-analysis';

export interface ComplexViewData {
  region: { key: string; label: string; lawd: string[] };
  years: number;
  rows: ComplexRow[];
  buckets: { label: string; count: number }[];
  dongs: Ranked[];
  complexes: Ranked[];
  leaders: { keys: string[]; names: string[]; rows: Record<string, number | string | null>[] };
  forecast: Forecast;
  favorites: string[];
  deals: number;
}
export interface FavoriteData {
  id: string;
  region: string;
  regionLabel: string;
  lawdCd: string;
  complexKey: string;
  name: string;
  umdNm: string;
  rows: ComplexRow[];
}

const COLORS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)', 'var(--series-6)', 'var(--series-7)'];
const axis = { fontSize: 11.5, fill: 'var(--muted)' };
const tipStyle = { borderRadius: 10, border: '1px solid var(--line)', background: 'var(--surface)', fontSize: 13 };
/** 원 → "12.35억" */
const eok = (won: number | null | undefined) => (won === null || won === undefined ? '—' : `${(won / 1e8).toLocaleString('ko-KR', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}억`);
const man = (won: number) => `${Math.round(won / 1e4).toLocaleString('ko-KR')}만`;
const pct = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;
const ymd = (d: string) => d.replace(/-/g, '.').slice(2);

function Card({ title, sub, children, about, id }: { title: string; sub?: string; children: React.ReactNode; about?: React.ReactNode; id?: string }) {
  return (
    <section className="card indicator" aria-label={title} id={id}>
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

export async function toggleFavorite(region: string, row: Pick<ComplexRow, 'lawdCd' | 'complex' | 'name' | 'umdNm'>, on: boolean) {
  const r = await fetch('/api/regions/favorite', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ region, lawdCd: row.lawdCd, complexKey: row.complex, name: row.name, umdNm: row.umdNm, on }) });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? '저장하지 못했습니다.');
}

function Star({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" className="linklike" aria-pressed={on} aria-label={`${label} ${on ? '관심 단지에서 빼기' : '관심 단지에 넣기'}`} onClick={onClick} style={{ textDecoration: 'none', fontSize: 16, color: on ? 'var(--series-4)' : 'var(--muted)' }}>
      {on ? '★' : '☆'}
    </button>
  );
}

type SortKey = 'perPyeong' | 'recent' | 'fromHigh' | 'deals1y' | 'buildYear';
const AGES = [
  { key: 'all', label: '전체', test: () => true },
  { key: '5', label: '5년 이내', test: (y: number | null, now: number) => !!y && now - y <= 5 },
  { key: '10', label: '10년 이내', test: (y: number | null, now: number) => !!y && now - y <= 10 },
  { key: '20', label: '20년 이내', test: (y: number | null, now: number) => !!y && now - y <= 20 },
  { key: 'old', label: '20년 넘음', test: (y: number | null, now: number) => !!y && now - y > 20 },
];

function ComplexTable({ view, onPick, favs, onStar }: { view: ComplexViewData; onPick: (r: ComplexRow) => void; favs: Set<string>; onStar: (r: ComplexRow) => void }) {
  const [cls, setCls] = useState<string>('all');
  const [age, setAge] = useState('all');
  const [minDeals, setMinDeals] = useState(1);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'perPyeong', desc: true });
  const [limit, setLimit] = useState(50);
  const now = new Date().getFullYear();
  const rows = useMemo(() => {
    const ageTest = AGES.find((a) => a.key === age)!.test;
    const list = view.rows.filter((r) => (cls === 'all' || r.cls === cls) && ageTest(r.buildYear, now) && r.deals1y >= minDeals && (!q || r.name.includes(q) || r.umdNm.includes(q)));
    const v = (r: ComplexRow) => (sort.key === 'buildYear' ? (r.buildYear ?? 0) : r[sort.key]);
    return list.sort((a, b) => (sort.desc ? v(b) - v(a) : v(a) - v(b)));
  }, [view.rows, cls, age, minDeals, q, sort, now]);
  const th = (key: SortKey, label: string) => (
    <th className="num">
      <button type="button" className="linklike" style={{ textDecoration: 'none', fontWeight: sort.key === key ? 700 : 500 }} onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : true }))}>
        {label}
        {sort.key === key ? (sort.desc ? ' ↓' : ' ↑') : ''}
      </button>
    </th>
  );
  return (
    <Card
      title="단지 · 평형별 시세"
      sub={`${view.region.label} 최근 ${view.years}년 실거래 ${view.deals.toLocaleString('ko-KR')}건 · 해제된 거래 제외`}
      about={
        <p>
          단지와 평형(전용면적이 0.5㎡ 안에서 같은 것)마다 최근 3개월 거래의 중앙값을 *최근가*로, 기간 안 가장 높은 거래를 *최고가*로 잡아 최고가 대비 위치를 봅니다. 최근 3개월 거래가 없으면 마지막 거래가 최근가입니다. 평당가는 최근가를 전용면적 3.3㎡당으로 나눈 값이고, 재건축 단지는 작은 평형의 평당가가 높게 나오기 쉽습니다. ☆를 누르면 관심 단지에 넣고, 행을 누르면 그 단지의 거래를 모두 봅니다.
        </p>
      }
    >
      <div className="inline" style={{ gap: 10, flexWrap: 'wrap' }}>
        <div className="seg" role="group" aria-label="면적">
          <button type="button" aria-current={cls === 'all' ? 'true' : undefined} onClick={() => setCls('all')}>전체</button>
          {AREA_CLASSES.map((c) => (
            <button key={c.key} type="button" aria-current={cls === c.key ? 'true' : undefined} onClick={() => setCls(c.key)}>
              {c.label.split(' ')[0]}
            </button>
          ))}
        </div>
        <label className="inline" style={{ gap: 6 }}>
          <span className="sub">준공</span>
          <select value={age} onChange={(e) => setAge(e.target.value)} style={{ width: 'auto' }}>
            {AGES.map((a) => (
              <option key={a.key} value={a.key}>{a.label}</option>
            ))}
          </select>
        </label>
        <label className="inline" style={{ gap: 6 }}>
          <span className="sub">최근 1년 거래</span>
          <select value={minDeals} onChange={(e) => setMinDeals(Number(e.target.value))} style={{ width: 'auto' }}>
            {[0, 1, 3, 10].map((n) => (
              <option key={n} value={n}>{n ? `${n}건 이상` : '상관없음'}</option>
            ))}
          </select>
        </label>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="단지·동 이름" aria-label="단지 찾기" style={{ minWidth: 160 }} />
        <span className="sub">{rows.length.toLocaleString('ko-KR')}개</span>
      </div>
      <div className="table-wrap">
        <table className="rank">
          <thead>
            <tr>
              <th className="l">단지</th>
              <th className="l">평형</th>
              {th('buildYear', '준공')}
              {th('recent', '최근가')}
              <th className="num">최고가</th>
              {th('fromHigh', '최고가 대비')}
              {th('perPyeong', '평당가')}
              {th('deals1y', '거래 1년')}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((r) => (
              <tr key={r.id} onClick={() => onPick(r)} style={{ cursor: 'pointer' }}>
                <th scope="row" className="l" style={{ whiteSpace: 'normal' }}>
                  <span onClick={(e) => e.stopPropagation()}>
                    <Star on={favs.has(`${r.lawdCd}|${r.complex}`)} onClick={() => onStar(r)} label={r.name} />
                  </span>{' '}
                  {r.name} <span className="sub" style={{ display: 'inline' }}>{r.umdNm}</span>
                </th>
                <td className="l">{r.areaLabel}</td>
                <td className="num sub">{r.buildYear ?? '—'}</td>
                <td className="num">{eok(r.recent)}</td>
                <td className="num">
                  {eok(r.high.price)}
                  <span className="sub">{ymd(r.high.date)}</span>
                </td>
                <td className="num" style={{ color: r.fromHigh >= -0.001 ? 'var(--up)' : undefined }}>{r.fromHigh >= -0.001 ? '신고가' : pct(r.fromHigh)}</td>
                <td className="num">{man(r.perPyeong)}</td>
                <td className="num">
                  {r.deals1y}
                  <span className="sub">전체 {r.deals}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > limit && (
        <button type="button" className="btn small" onClick={() => setLimit((l) => l + 100)}>
          100개 더 보기 ({(rows.length - limit).toLocaleString('ko-KR')}개 남음)
        </button>
      )}
    </Card>
  );
}

function DetailCard({ detail, onClose }: { detail: ComplexDetail; onClose: () => void }) {
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  const areas = detail.areas.filter((a) => !hidden.has(a.key));
  const chart: ChartData = {
    lines: detail.areas.map((a, i) => ({ key: `a${a.key}`, label: a.label, color: COLORS[i % COLORS.length] })),
    rows: detail.monthly,
    unit: '억',
    latest: [],
    note: '달마다 그 평형 거래의 중앙값입니다. 거래가 없는 달은 비워 두고 선으로 잇습니다.',
  };
  const recent = [...detail.deals].reverse().slice(0, 15);
  // Trend of the most traded 평형: monthly medians carried over quiet months, with 6- and 12-month averages
  const main = [...detail.areas].sort((a, b) => b.deals - a.deals)[0];
  const trend: ChartData | null = (() => {
    if (!main) return null;
    let lastV: number | null = null;
    const pts: Point[] = [];
    for (const r of detail.monthly) {
      const v = r[`a${main.key}`];
      if (typeof v === 'number') lastV = v;
      if (lastV !== null) pts.push({ date: String(r.date), value: lastV });
    }
    if (pts.length < 13) return null;
    const ma6 = sma(pts, 6), ma12 = sma(pts, 12);
    const rows = pts.map((p) => ({ date: p.date, price: p.value, ma6: ma6.find((x) => x.date === p.date)?.value ?? null, ma12: ma12.find((x) => x.date === p.date)?.value ?? null }));
    const lastOf = (k: 'price' | 'ma6' | 'ma12') => rows.at(-1)?.[k];
    return {
      lines: [
        { key: 'price', label: `${main.label} 월 중앙값`, color: 'var(--ink)' },
        { key: 'ma6', label: '6개월 이동평균', color: COLORS[0] },
        { key: 'ma12', label: '12개월 이동평균', color: COLORS[3] },
      ],
      rows,
      unit: '억',
      latest: (['price', 'ma6', 'ma12'] as const).flatMap((k) => (typeof lastOf(k) === 'number' ? [{ label: k === 'price' ? '최근' : k === 'ma6' ? '6개월 평균' : '12개월 평균', value: `${(lastOf(k) as number).toFixed(2)}억`, date: String(rows.at(-1)!.date).slice(0, 7) }] : [])),
      note: '거래가 없는 달은 직전 값을 이어 씁니다. 가격이 6개월·12개월 평균 위에 있고 6개월 평균이 12개월 평균 위면 오름세, 그 반대면 내림세로 봅니다.',
    };
  })();
  const sizeOf = new Map(detail.areas.map((a) => [a.key, a.label]));
  return (
    <Card title={`${detail.name} 실거래 전체`} sub={`${detail.umdNm}${detail.jibun ? ` ${detail.jibun}` : ''} · ${detail.buildYear ? `${detail.buildYear}년 준공` : '준공 연도 모름'} · 거래 ${detail.deals.length.toLocaleString('ko-KR')}건`} id="complex-detail">
      <div className="inline" style={{ gap: 6, flexWrap: 'wrap' }}>
        {detail.areas.map((a, i) => (
          <button key={a.key} type="button" className="chip-btn" aria-pressed={!hidden.has(a.key)} onClick={() => setHidden((h) => { const n = new Set(h); if (n.has(a.key)) n.delete(a.key); else n.add(a.key); return n; })}>
            <span className="dot" style={{ background: COLORS[i % COLORS.length], opacity: hidden.has(a.key) ? 0.3 : 1 }} />
            {a.label} <span className="sub">{a.deals}건 · 최고 {eok(a.high)}</span>
          </button>
        ))}
        <button type="button" className="btn small" onClick={onClose}>닫기</button>
      </div>
      <div style={{ width: '100%', height: 300 }}>
        <ResponsiveContainer>
          <ScatterChart margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--line-soft)" />
            <XAxis type="number" dataKey="t" domain={['dataMin', 'dataMax']} tick={axis} tickLine={false} axisLine={false} tickFormatter={(v) => new Date(Number(v) * 86_400_000).toISOString().slice(2, 7).replace('-', '.')} />
            <YAxis type="number" dataKey="price" tick={axis} tickLine={false} axisLine={false} width={48} tickFormatter={(v) => `${v}억`} domain={['auto', 'auto']} />
            <ZAxis range={[22, 22]} />
            <Tooltip
              cursor={false}
              content={({ payload }) => {
                const p = payload?.[0]?.payload as ComplexDetail['deals'][number] | undefined;
                if (!p) return null;
                return (
                  <div style={{ ...tipStyle, padding: '8px 10px' }}>
                    <div className="strong">{p.date} · {p.price.toFixed(2)}억</div>
                    <div>{sizeOf.get(p.area)}{p.floor !== null ? ` · ${p.floor}층` : ''}{p.direct ? ' · 직거래' : ''}</div>
                  </div>
                );
              }}
            />
            {areas.map((a) => {
              const i = detail.areas.findIndex((x) => x.key === a.key);
              return <Scatter key={a.key} data={detail.deals.filter((d) => d.area === a.key)} fill={COLORS[i % COLORS.length]} fillOpacity={0.6} isAnimationActive={false} />;
            })}
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <IndicatorChart data={chart} />
      {trend && (
        <div className="stack" style={{ gap: 6 }}>
          <h4 style={{ margin: '8px 0 0' }}>추세 (기술적 분석)</h4>
          <IndicatorChart data={trend} />
          <p className="sub">{trend.note}</p>
        </div>
      )}
      <div className="table-wrap">
        <table className="rank">
          <thead>
            <tr>
              <th className="l">계약일</th>
              <th className="l">평형</th>
              <th className="num">층</th>
              <th className="num">가격</th>
              <th className="l">방식</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((d, i) => (
              <tr key={`${d.date}${i}`}>
                <td className="l">{d.date}</td>
                <td className="l">{sizeOf.get(d.area)}</td>
                <td className="num">{d.floor ?? '—'}</td>
                <td className="num">{d.price.toFixed(2)}억</td>
                <td className="l sub">{d.direct ? '직거래' : '중개'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function ForecastCard({ f }: { f: Forecast }) {
  const label = (ym: string) => `${Number(ym.slice(4))}월`;
  return (
    <Card
      title="이달 거래량 예측"
      sub={`${label(f.ym)} 계약분 중 오늘(${label(f.ym)} ${f.day}일째)까지 신고된 ${f.known.toLocaleString('ko-KR')}건`}
      about={
        <p>
          실거래 신고는 계약 후 30일 안에 하면 되므로 한 달의 거래는 다음 달 말까지 계속 늘어납니다. 그래서 매일 그날까지 신고된 건수를 기록해 두고(스냅샷), 지난달들이 같은 날짜에서 최종 몇 배로 늘었는지를 이번 달에 곱해 최종 건수를 추정합니다. 기록은 이 화면을 처음 연 날부터, 그리고 관심 단지·연결한 부동산이 있는 지역은 매일 아침 자동으로 쌓입니다. 지난달 기록이 다 쌓이기 전에는 예측 대신 쌓인 기록만 보여 줍니다.
        </p>
      }
    >
      <dl className="ind-latest">
        <div>
          <dt>지금까지 신고</dt>
          <dd className="strong">{f.known.toLocaleString('ko-KR')}건</dd>
        </div>
        <div>
          <dt>예상 최종 거래</dt>
          <dd className="strong">{f.estimate === null ? '기록 쌓는 중' : `${f.estimate.toLocaleString('ko-KR')}건`}</dd>
          {f.ratios.length > 0 && <dd className="sub">지난 {f.ratios.length}개월의 증가 배수 중앙값</dd>}
        </div>
      </dl>
      {f.rows.length > 1 ? (
        <div style={{ width: '100%', height: 220 }}>
          <ResponsiveContainer>
            <LineChart data={f.rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="var(--line-soft)" vertical={false} />
              <XAxis dataKey="day" tick={axis} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}일`} minTickGap={20} />
              <YAxis tick={axis} tickLine={false} axisLine={false} width={44} />
              <Tooltip contentStyle={tipStyle} labelFormatter={(l) => `${l}일째`} formatter={(v, n) => [v === null ? '—' : `${Number(v).toLocaleString('ko-KR')}건`, label(String(n).slice(1))]} />
              <Legend formatter={(v) => label(String(v).slice(1))} wrapperStyle={{ fontSize: 12 }} />
              {f.months.map((m, i) => (
                <Line key={m} dataKey={`m${m}`} stroke={COLORS[i % COLORS.length]} strokeWidth={m === f.ym ? 2.4 : 1.4} dot={m === f.ym} connectNulls isAnimationActive={false} />
              ))}
              <ReferenceLine x={f.day} stroke="var(--muted)" strokeDasharray="4 4" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="sub">오늘부터 매일 기록합니다.</p>
      )}
    </Card>
  );
}

export function ComplexPanel({ view, onError }: { view: ComplexViewData; onError: (m: string) => void }) {
  const [favs, setFavs] = useState(new Set(view.favorites));
  const [picked, setPicked] = useState<ComplexRow | null>(null);
  const [detail, setDetail] = useState<ComplexDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const detailRef = useRef<HTMLDivElement>(null);
  useEffect(() => setFavs(new Set(view.favorites)), [view.favorites]);
  useEffect(() => {
    if (!picked) return;
    let live = true;
    setLoading(true);
    const q = new URLSearchParams({ view: 'complex-detail', r: view.region.key, lawd: picked.lawdCd, k: picked.complex, years: String(view.years) });
    fetch(`/api/regions?${q}`, { cache: 'no-store' })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? '불러오지 못했습니다.');
        if (live) {
          setDetail(j as ComplexDetail);
          setTimeout(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
        }
      })
      .catch((e) => live && onError(e instanceof Error ? e.message : '불러오지 못했습니다.'))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [picked, view.region.key, view.years, onError]);
  const star = (r: ComplexRow) => {
    const k = `${r.lawdCd}|${r.complex}`;
    const on = !favs.has(k);
    setFavs((s) => {
      const n = new Set(s);
      if (on) n.add(k);
      else n.delete(k);
      return n;
    });
    toggleFavorite(view.region.key, r, on).catch((e) => onError(e.message));
  };
  const leaders: ChartData = {
    lines: view.leaders.names.map((n, i) => ({ key: `c${i}`, label: n, color: COLORS[i % COLORS.length] })),
    rows: view.leaders.rows,
    unit: '억',
    latest: [],
    note: '최근 1년 전용 80~86㎡(국민평형) 거래의 평당가가 가장 높은 다섯 단지의 달별 84㎡ 거래 중앙값입니다. 거래가 없는 달은 건너뛰어 잇습니다.',
  };
  const newHigh = view.buckets[0]?.count ?? 0;
  const total = view.buckets.reduce((a, b) => a + b.count, 0);
  return (
    <div className="stack" style={{ gap: 16 }}>
      <ComplexTable view={view} onPick={setPicked} favs={favs} onStar={star} />
      <div ref={detailRef}>{loading ? <p className="empty">단지 거래를 불러오는 중…</p> : detail && <DetailCard detail={detail} onClose={() => { setDetail(null); setPicked(null); }} />}</div>
      <div className="ind-grid">
        <Card
          title="최고가 대비 분포"
          sub={`최근 1년 거래가 있는 단지·평형 ${total.toLocaleString('ko-KR')}개 중 신고가 ${newHigh.toLocaleString('ko-KR')}개 (${total ? ((newHigh / total) * 100).toFixed(0) : 0}%)`}
          about={<p>각 단지·평형의 최근가가 고른 기간 안 최고가보다 얼마나 낮은지 나눴습니다. 신고가 비율이 높아지면 시장이 위로 뚫고 있는 것이고, −20% 아래가 많으면 아직 고점 회복이 멀었다는 뜻입니다. 기간을 10년으로 두면 2021년 고점까지 들어갑니다.</p>}
        >
          <div style={{ width: '100%', height: 220 }}>
            <ResponsiveContainer>
              <BarChart data={view.buckets} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--line-soft)" vertical={false} />
                <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={false} />
                <YAxis tick={axis} tickLine={false} axisLine={false} width={40} />
                <Tooltip contentStyle={tipStyle} formatter={(v) => [`${v}개`, '단지·평형']} />
                <Bar dataKey="count" isAnimationActive={false}>
                  {view.buckets.map((b, i) => (
                    <Cell key={b.label} fill={i === 0 ? 'var(--series-4)' : 'var(--series-1)'} fillOpacity={0.35 + i * 0.15} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <ForecastCard f={view.forecast} />
        <Card title="대장 아파트 (84㎡)" sub="최근 1년 국민평형 평당가 상위 다섯 단지">
          {view.leaders.rows.length ? <IndicatorChart data={leaders} /> : <p className="empty">최근 1년 84㎡ 거래가 있는 단지가 없습니다.</p>}
          {leaders.note && <p className="sub">{leaders.note}</p>}
        </Card>
        <Card title="급지: 동별 평당가" sub="최근 1년 거래의 3.3㎡당 중앙값" about={<p>같은 시군구 안에서도 동마다 가격 수준이 다릅니다. 평당가 순서가 그 지역의 급지(입지 서열)를 대략 보여 줍니다. 거래가 적은 동은 몇 건에 좌우되니 건수를 함께 봅니다.</p>}>
          <div style={{ width: '100%', height: Math.max(160, view.dongs.length * 24) }}>
            <ResponsiveContainer>
              <BarChart data={view.dongs.map((d) => ({ ...d, v: Math.round(d.perPyeong / 1e4) }))} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
                <XAxis type="number" tick={axis} tickLine={false} axisLine={false} tickFormatter={(v) => `${Number(v).toLocaleString('ko-KR')}만`} />
                <YAxis type="category" dataKey="name" tick={axis} tickLine={false} axisLine={false} width={72} interval={0} />
                <Tooltip contentStyle={tipStyle} formatter={(v, _n, item) => [`${Number(v).toLocaleString('ko-KR')}만/평 (${(item.payload as Ranked).deals}건)`, '평당가']} />
                <Bar dataKey="v" fill="var(--series-1)" fillOpacity={0.6} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="급지: 단지 평당가 순위" sub="최근 1년 3건 이상 거래된 단지, 3.3㎡당 중앙값 상위 30">
          <div className="table-wrap">
            <table className="rank">
              <thead>
                <tr>
                  <th className="num">#</th>
                  <th className="l">단지</th>
                  <th className="num">준공</th>
                  <th className="num">평당가</th>
                  <th className="num">거래</th>
                </tr>
              </thead>
              <tbody>
                {view.complexes.map((c, i) => (
                  <tr key={c.key}>
                    <td className="num sub">{i + 1}</td>
                    <th scope="row" className="l" style={{ whiteSpace: 'normal' }}>
                      {c.name} <span className="sub" style={{ display: 'inline' }}>{c.umdNm}</span>
                    </th>
                    <td className="num sub">{c.buildYear ?? '—'}</td>
                    <td className="num">{man(c.perPyeong)}</td>
                    <td className="num">{c.deals}</td>
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

export function FavoritesPanel({ list, onOpen, onError }: { list: FavoriteData[]; onOpen: (region: string) => void; onError: (m: string) => void }) {
  const [gone, setGone] = useState<Set<string>>(new Set());
  const shown = list.filter((f) => !gone.has(f.id));
  if (!shown.length) return <p className="empty">관심 단지가 없습니다. *단지 분석*의 표에서 ☆를 누르면 여기에 모입니다.</p>;
  return (
    <div className="ind-grid">
      {shown.map((f) => (
        <section key={f.id} className="card indicator" aria-label={f.name}>
          <div className="inline spread" style={{ gap: 8 }}>
            <div className="stack" style={{ gap: 2 }}>
              <h3>{f.name}</h3>
              <span className="sub">{f.regionLabel} {f.umdNm}</span>
            </div>
            <div className="inline" style={{ gap: 6 }}>
              <button type="button" className="btn small" onClick={() => onOpen(f.region)}>단지 분석에서 보기</button>
              <Star
                on
                label={f.name}
                onClick={() => {
                  setGone((g) => new Set(g).add(f.id));
                  toggleFavorite(f.region, { lawdCd: f.lawdCd, complex: f.complexKey, name: f.name, umdNm: f.umdNm }, false).catch((e) => onError(e.message));
                }}
              />
            </div>
          </div>
          {f.rows.length ? (
            <div className="table-wrap">
              <table className="rank">
                <thead>
                  <tr>
                    <th className="l">평형</th>
                    <th className="num">최근가</th>
                    <th className="num">최고가</th>
                    <th className="num">대비</th>
                    <th className="num">마지막 거래</th>
                    <th className="num">거래 1년</th>
                  </tr>
                </thead>
                <tbody>
                  {f.rows
                    .sort((a, b) => a.area - b.area)
                    .map((r) => (
                      <tr key={r.id}>
                        <td className="l">{r.areaLabel}</td>
                        <td className="num">{eok(r.recent)}</td>
                        <td className="num">
                          {eok(r.high.price)}
                          <span className="sub">{ymd(r.high.date)}</span>
                        </td>
                        <td className="num">{r.fromHigh >= -0.001 ? '신고가' : pct(r.fromHigh)}</td>
                        <td className="num">
                          {eok(r.last.price)}
                          <span className="sub">{ymd(r.last.date)}{r.last.floor !== null ? ` · ${r.last.floor}층` : ''}</span>
                        </td>
                        <td className="num">{r.deals1y}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="empty">최근 10년 거래가 없습니다.</p>
          )}
        </section>
      ))}
    </div>
  );
}
