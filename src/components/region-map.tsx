'use client';

import { useEffect, useMemo, useState } from 'react';
import { MAP_METRICS, regionOfShape, shapeValue, TIMELINE_METRICS, type MapMetric, type RegionValues, type TimelineFrames, type TimelineMetric } from '@/domain/region-map';
import { frameLabel, TimelineControl, useTimeline } from '@/components/timeline';
import { LOCATION_METRICS, locationOf, splitJeonnam, type LocationMetric, type LocationRow } from '@/domain/location';
import { RONE_REGIONS, roneRegion, shortSido, SIDO_KEYS, type RoneRegion } from '@/domain/region-analysis';

interface Shape {
  /** 시군구 code */
  c: string;
  n: string;
  /** 시도 name as the boundary file has it */
  s: string;
  /** Rings of [lon × 1000, lat × 1000] */
  r: [number, number][][];
}
interface Shapes {
  about: string;
  features: Shape[];
}
export interface MapViewData {
  values: RegionValues;
  date: string | null;
  at: string;
}

type AnyMetric = MapMetric | `loc:${LocationMetric | 'score'}`;
const ALL_METRICS: { key: AnyMetric; label: string; unit: string; kind: 'change' | 'level' | 'phase'; about: string }[] = [
  ...MAP_METRICS.map((m) => ({ ...m, kind: m.kind as 'change' | 'level' | 'phase' })),
  { key: 'loc:score', label: '입지 종합', unit: '점', kind: 'level', about: '입지 지표 여섯 가지의 전국 백분위 평균 (입지 탭)' },
  ...LOCATION_METRICS.filter((m) => m.key !== 'fiscal').map((m) => ({ key: `loc:${m.key}` as AnyMetric, label: `입지: ${m.label}`, unit: m.key === 'growth' ? '%' : ` ${m.unit}`, kind: (m.key === 'growth' ? 'change' : 'level') as 'change' | 'level', about: m.about })),
];

const PHASE_COLORS = ['var(--series-1)', 'var(--series-3)', 'var(--series-5)', 'var(--series-4)', 'var(--series-6)', 'var(--series-2)'];
const PHASE_NAMES = ['회복기', '활황기', '침체 진입기', '침체기', '불황기', '회복 진입기'];
/** cos(36.5°): squeeze longitude so Korea is drawn in its proportions */
const KX = Math.cos((36.5 * Math.PI) / 180);

const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))] : 0;
};

function useShapes(): Shapes | null {
  const [shapes, setShapes] = useState<Shapes | null>(null);
  useEffect(() => {
    let live = true;
    fetch('/maps/sigungu.json')
      .then((r) => r.json())
      .then((j) => live && setShapes(j as Shapes));
    return () => {
      live = false;
    };
  }, []);
  return shapes;
}

function useLocationRows(on: boolean): Map<string, LocationRow> | null {
  const [rows, setRows] = useState<Map<string, LocationRow> | null>(null);
  useEffect(() => {
    if (!on || rows) return;
    let live = true;
    fetch('/api/regions?view=location', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j: { rows?: LocationRow[] }) => live && setRows(new Map((j.rows ?? []).map((x) => [x.key, x]))))
      .catch(() => live && setRows(new Map()));
    return () => {
      live = false;
    };
  }, [on, rows]);
  return rows;
}

/** A shape's 입지 row: its region's (a 구 falls back to its 시), else by 시도 and name (군 without 부동산원 data) */
function shapeLocation(f: Shape, rows: Map<string, LocationRow>): { row: LocationRow; region: RoneRegion | null } | null {
  const { own, parent } = regionOfShape(f.c);
  for (const r of [own, parent]) {
    const row = r ? locationOf(rows, r.key) : null;
    if (row && r) return { row, region: r };
  }
  const key = `${splitJeonnam(f.s, f.n)}>${f.n}`;
  const row = rows.get(key);
  return row ? { row, region: roneRegion(key) ?? null } : null;
}

function useFrames(on: boolean): { frames: TimelineFrames | null; error: string | null } {
  const [state, setState] = useState<{ frames: TimelineFrames | null; error: string | null }>({ frames: null, error: null });
  useEffect(() => {
    if (!on || state.frames) return;
    let live = true;
    fetch('/api/regions?view=timeline', { cache: 'no-store' })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? '불러오지 못했습니다.');
        if (live) setState({ frames: j as TimelineFrames, error: null });
      })
      .catch((e) => live && setState({ frames: null, error: e instanceof Error ? e.message : '불러오지 못했습니다.' }));
    return () => {
      live = false;
    };
  }, [on, state.frames]);
  return state;
}

/** A shape's value in a time-lapse frame: its own region's, else its 시's */
function shapeFrame(code: string, metric: TimelineMetric, frames: TimelineFrames, i: number): { value: number; region: RoneRegion } | null {
  const { own, parent } = regionOfShape(code);
  for (const r of [own, parent]) {
    const v = r ? frames.values[r.key]?.[metric]?.[i] : null;
    if (r && v !== null && v !== undefined) return { value: v, region: r };
  }
  return null;
}

const ROW = 28;
const RACE_TOP = 15;

/** The regions' order at one frame, rows sliding to their new places as the frame moves */
function RaceChart({ items, color, fmt, lo, hi, onPick }: { items: { key: string; label: string; value: number }[]; color: (v: number) => string; fmt: (v: number) => string; lo: number; hi: number; onPick: (key: string) => void }) {
  const order = [...items].sort((a, b) => b.value - a.value);
  const rank = new Map(order.map((x, i) => [x.key, i]));
  const span = Math.max(Math.abs(lo), Math.abs(hi)) || 1;
  const signed = lo < 0;
  return (
    <div className="race" style={{ height: Math.min(RACE_TOP, items.length) * ROW }} aria-label="순위 변화">
      {[...items].sort((a, b) => a.key.localeCompare(b.key)).map((x) => {
        const r = rank.get(x.key)!;
        const width = signed ? (Math.abs(x.value) / span) * 50 : ((x.value - Math.min(0, lo)) / (hi - Math.min(0, lo) || 1)) * 100;
        return (
          <div key={x.key} className="race-row" style={{ transform: `translateY(${Math.min(r, RACE_TOP) * ROW}px)`, opacity: r < RACE_TOP ? 1 : 0 }}>
            <span className="sub" style={{ textAlign: 'right' }}>{r + 1}</span>
            <button type="button" className="race-bar linklike" style={{ textDecoration: 'none', textAlign: 'left' }} onClick={() => onPick(x.key)} tabIndex={r < RACE_TOP ? 0 : -1}>
              <span style={{ width: `${Math.max(1, Math.min(100, width))}%`, left: signed && x.value < 0 ? `${50 - Math.min(50, width)}%` : signed ? '50%' : 0, background: color(x.value) }} />
              <b>{x.label}</b>
            </button>
            <span className="num" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(x.value)}</span>
          </div>
        );
      })}
    </div>
  );
}

const HEAT_MONTHS = 24;

/**
 * Regions down, months across: each cell the metric's value that month, the newest column the
 * frame being played, so the whole grid slides along with the timeline.
 */
function Heatmap({ frames, metric, i, sido, color, fmt, onPick }: { frames: TimelineFrames; metric: TimelineMetric; i: number; sido: string; color: (v: number) => string; fmt: (v: number) => string; onPick: (key: string) => void }) {
  const keys = sido === 'all' ? SIDO_KEYS : RONE_REGIONS.filter((r) => r.depth === 1 && r.sido === splitJeonnam(sido, '')).map((r) => r.key);
  const regions = keys.filter((k) => frames.values[k]?.[metric]);
  const from = Math.max(0, i - HEAT_MONTHS + 1);
  const cols = frames.dates.slice(from, i + 1).map((d, j) => ({ d, j: from + j }));
  return (
    <section className="card indicator" aria-label="증감 히트맵">
      <div className="stack" style={{ gap: 4 }}>
        <h3>달마다 보기 (히트맵)</h3>
        <span className="sub">{sido === 'all' ? '전국과 시도' : `${shortSido(sido)}의 시군구`}, {frameLabel(cols[0]?.d)} ~ {frameLabel(cols.at(-1)?.d)}. 맨 오른쪽 열이 지도에 칠한 달이고, 재생하면 표 전체가 한 달씩 밀려갑니다.</span>
      </div>
      <div className="table-wrap">
        <table className="heat" style={{ borderCollapse: 'separate', borderSpacing: 2, width: 'auto' }}>
          <thead>
            <tr>
              <th className="l" />
              {cols.map((c) => (
                <th key={c.d} style={{ padding: 0, fontSize: 10, minWidth: 14, textAlign: 'center', border: 0 }}>{c.d.slice(5, 7) === '01' || c.j === from ? c.d.slice(2, 7).replace('-', '.') : ''}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {regions.map((k) => (
              <tr key={k}>
                <th scope="row" className="l" style={{ padding: '0 8px 0 0', border: 0, fontSize: 12, whiteSpace: 'nowrap' }}>
                  <button type="button" className="linklike" style={{ textDecoration: 'none' }} onClick={() => onPick(k)}>{roneRegion(k)?.label.split(' ').slice(-1)[0] ?? k}</button>
                </th>
                {cols.map((c) => {
                  const v = frames.values[k]?.[metric]?.[c.j];
                  return (
                    <td
                      key={c.d}
                      title={`${roneRegion(k)?.label} ${frameLabel(c.d)}: ${v === null || v === undefined ? '—' : fmt(v)}`}
                      className="map-shape"
                      style={{ padding: 0, border: 0, width: 14, height: 15, borderRadius: 3, background: v === null || v === undefined ? 'var(--line-soft)' : color(v), outline: c.j === i ? '2px solid var(--ink)' : undefined, outlineOffset: -1 }}
                    />
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function RegionMap({ view, onPick }: { view: MapViewData; onPick: (key: string) => void }) {
  const shapes = useShapes();
  const [metric, setMetric] = useState<AnyMetric>('y1');
  const [mode, setMode] = useState<'now' | 'time'>('now');
  const timeMode = mode === 'time';
  const { frames, error: framesError } = useFrames(timeMode);
  const t = useTimeline(frames?.dates.length ?? 0);
  const isLoc = metric.startsWith('loc:');
  const locRows = useLocationRows(isLoc);
  useEffect(() => {
    if (timeMode && !(TIMELINE_METRICS as readonly string[]).includes(metric)) setMetric('y1');
  }, [timeMode, metric]);
  const [sido, setSido] = useState('all');
  const [hover, setHover] = useState<{ shape: Shape; x: number; y: number } | null>(null);
  const def = ALL_METRICS.find((m) => m.key === metric)!;
  const sidos = useMemo(() => [...new Set((shapes?.features ?? []).map((f) => f.s))], [shapes]);
  const shown = useMemo(() => (shapes?.features ?? []).filter((f) => sido === 'all' || f.s === sido), [shapes, sido]);

  const box = useMemo(() => {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const f of shown) for (const ring of f.r) for (const [x, y] of ring) {
      x0 = Math.min(x0, x * KX); x1 = Math.max(x1, x * KX); y0 = Math.min(y0, -y); y1 = Math.max(y1, -y);
    }
    return { x0, y0, w: x1 - x0, h: y1 - y0 };
  }, [shown]);
  const paths = useMemo(() => new Map(shown.map((f) => [f.c, f.r.map((ring) => `M${ring.map(([x, y]) => `${(x * KX - box.x0).toFixed(1)},${(-y - box.y0).toFixed(1)}`).join('L')}Z`).join('')])), [shown, box]);

  const vals = useMemo(
    () =>
      new Map(
        shown.map((f) => {
          if (timeMode) return [f.c, frames && (TIMELINE_METRICS as readonly string[]).includes(metric) ? shapeFrame(f.c, metric as TimelineMetric, frames, t.i) : null] as const;
          if (!isLoc) return [f.c, shapeValue(f.c, metric as MapMetric, view.values)] as const;
          const hit = locRows ? shapeLocation(f, locRows) : null;
          const m = metric.slice(4) as LocationMetric | 'score';
          const v = hit ? (m === 'score' ? hit.row.score : hit.row.values[m]) : undefined;
          return [f.c, hit && v !== undefined && v !== null ? { value: v, region: hit.region ?? ({ key: '', label: hit.row.label, lawd: [] } as unknown as RoneRegion) } : null] as const;
        }),
      ),
    [shown, metric, view.values, isLoc, locRows, timeMode, frames, t.i],
  );
  // In a time-lapse the colors keep one scale over every frame, so a change of color is a change
  const numbers = useMemo(() => {
    if (timeMode && frames && (TIMELINE_METRICS as readonly string[]).includes(metric)) {
      const keys = new Set(shown.flatMap((f) => [regionOfShape(f.c).own?.key, regionOfShape(f.c).parent?.key]).filter(Boolean) as string[]);
      return [...keys].flatMap((k) => (frames.values[k]?.[metric as TimelineMetric] ?? []).filter((x): x is number => x !== null));
    }
    return [...vals.values()].flatMap((v) => (v ? [v.value] : []));
  }, [timeMode, frames, metric, shown, vals]);
  const scale = useMemo(() => {
    if (def.kind === 'change') {
      const m = Math.max(1, Math.abs(quantile(numbers, 0.05)), Math.abs(quantile(numbers, 0.95)));
      const top = m > 20 ? Math.ceil(m / 10) * 10 : Math.ceil(m);
      return { lo: -top, hi: top };
    }
    return { lo: Math.floor(quantile(numbers, 0.05)), hi: Math.ceil(quantile(numbers, 0.95)) };
  }, [numbers, def.kind]);
  const color = (v: number | undefined) => {
    if (v === undefined) return 'var(--line-soft)';
    if (def.kind === 'phase') return PHASE_COLORS[v - 1] ?? 'var(--line-soft)';
    if (def.kind === 'change') {
      const t = Math.max(-1, Math.min(1, v / scale.hi));
      return `color-mix(in srgb, var(${t >= 0 ? '--up' : '--down'}) ${Math.round(Math.abs(t) * 85 + 5)}%, var(--surface))`;
    }
    const t = scale.hi > scale.lo ? Math.max(0, Math.min(1, (v - scale.lo) / (scale.hi - scale.lo))) : 0.5;
    return `color-mix(in srgb, var(--series-1) ${Math.round(t * 85 + 8)}%, var(--surface))`;
  };
  const fmt = (v: number) => (def.kind === 'phase' ? `${v} ${PHASE_NAMES[v - 1]}` : `${def.kind === 'change' && v > 0 ? '+' : ''}${v.toFixed(1)}${def.unit}`);
  const ranked = shown
    .flatMap((f) => {
      const v = vals.get(f.c);
      return v ? [{ code: f.c, name: `${f.s.replace(/(특별|광역|특별자치)?(시|도)$/, '')} ${f.n}`, ...v }] : [];
    })
    .filter((x, i, a) => !x.region.key || a.findIndex((y) => y.region.key === x.region.key) === i);
  const top = def.kind === 'phase' ? [] : [...ranked].sort((a, b) => b.value - a.value);

  if (!shapes || (isLoc && !locRows)) return <p className="empty">지도를 불러오는 중…</p>;
  if (timeMode && !frames && !framesError) return <p className="empty">6년치 지도를 준비하는 중… 처음에는 전국 자료를 받느라 20~30초 걸리고, 그 뒤 12시간은 바로 열립니다.</p>;
  const W = 640;
  const H = box.w > 0 ? Math.min(900, (W * box.h) / box.w) : 600;
  const k = box.w > 0 ? Math.min(W / box.w, H / box.h) : 1;
  return (
    <div className="ind-grid">
      <section className="card indicator" aria-label="지역 지도">
        <div className="inline" style={{ gap: 10, flexWrap: 'wrap' }}>
          <div className="seg" role="group" aria-label="지도 지표" style={{ flexWrap: 'wrap' }}>
            {ALL_METRICS.filter((m) => !timeMode || (TIMELINE_METRICS as readonly string[]).includes(m.key)).map((m) => (
              <button key={m.key} type="button" aria-current={metric === m.key ? 'true' : undefined} onClick={() => setMetric(m.key)}>
                {m.label}
              </button>
            ))}
          </div>
          <div className="seg" role="group" aria-label="지도 시점">
            <button type="button" aria-current={!timeMode ? 'true' : undefined} onClick={() => setMode('now')}>최신</button>
            <button type="button" aria-current={timeMode ? 'true' : undefined} onClick={() => setMode('time')}>시간 흐름 ▶</button>
          </div>
          <label className="inline" style={{ gap: 6 }}>
            <span className="sub">시도</span>
            <select value={sido} onChange={(e) => setSido(e.target.value)} style={{ width: 'auto' }} aria-label="시도">
              <option value="all">전국</option>
              {sidos.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
        </div>
        {timeMode && frames && <TimelineControl t={t} dates={frames.dates} label="지도 시점" />}
        {timeMode && framesError && <p className="msg err">{framesError}</p>}
        <span className="sub">{def.about}. {timeMode ? `최근 6년을 달마다 재생합니다(색 기준은 6년 전체에 고정). 지금 ${frameLabel(frames?.dates[t.i])} · 한국부동산원.` : isLoc ? '통계청 KOSIS · 국세청 연간 자료.' : `기준 ${view.date?.slice(0, 7).replace('-', '.') ?? '—'} · 한국부동산원.`} 회색은 자료가 없는 곳(주로 군 지역)입니다. 시군구를 누르면 그 지역을 자세히 봅니다.</span>
        <div style={{ position: 'relative' }} onMouseLeave={() => setHover(null)}>
          <svg viewBox={`0 0 ${(box.w * k).toFixed(0)} ${(box.h * k).toFixed(0)}`} style={{ width: '100%', height: 'auto', maxHeight: 720 }} role="img" aria-label={`${def.label} 지도`}>
            <g transform={`scale(${k})`}>
              {shown.map((f) => {
                const v = vals.get(f.c);
                return (
                  <path
                    key={f.c}
                    className="map-shape"
                    d={paths.get(f.c)}
                    fill={color(v?.value)}
                    stroke="var(--surface)"
                    strokeWidth={0.6 / k}
                    style={{ cursor: v?.region.key ? 'pointer' : 'default' }}
                    onMouseMove={(e) => {
                      const r = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                      setHover({ shape: f, x: e.clientX - r.left, y: e.clientY - r.top });
                    }}
                    onClick={() => v?.region.key && onPick(v.region.key)}
                  />
                );
              })}
            </g>
          </svg>
          {hover && (
            <div style={{ position: 'absolute', left: Math.min(hover.x + 12, 420), top: hover.y + 12, pointerEvents: 'none', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10, padding: '6px 10px', fontSize: 13, boxShadow: '0 2px 8px rgba(0,0,0,.12)' }}>
              <div className="strong">{hover.shape.s} {hover.shape.n}</div>
              {(() => {
                const v = vals.get(hover.shape.c);
                return v ? (
                  <div>
                    {def.label}: {fmt(v.value)}
                    {v.region.lawd.length > 1 && <span className="sub"> ({v.region.label} 값)</span>}
                  </div>
                ) : (
                  <div className="sub">자료 없음</div>
                );
              })()}
            </div>
          )}
        </div>
        <div className="inline" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {def.kind === 'phase' ? (
            PHASE_NAMES.map((n, i) => (
              <span key={n} className="chip-btn" style={{ cursor: 'default' }}>
                <span className="dot" style={{ background: PHASE_COLORS[i] }} />
                {i + 1} {n}
              </span>
            ))
          ) : (
            <>
              <span className="sub">{fmt(scale.lo)}</span>
              <span style={{ width: 180, height: 10, borderRadius: 5, background: def.kind === 'change' ? 'linear-gradient(90deg, var(--down), var(--surface), var(--up))' : 'linear-gradient(90deg, color-mix(in srgb, var(--series-1) 8%, var(--surface)), var(--series-1))', border: '1px solid var(--line-soft)' }} />
              <span className="sub">{fmt(scale.hi)}</span>
            </>
          )}
        </div>
      </section>
      <section className="card indicator" aria-label="지도 순위">
        <div className="stack" style={{ gap: 4 }}>
          <h3>{def.kind === 'phase' ? '국면별 지역 수' : timeMode ? `${def.label} 순위 변화` : `${def.label} 순위`}</h3>
          <span className="sub">{sido === 'all' ? '전국' : sido} · 지도에 칠한 값</span>
        </div>
        {timeMode && def.kind !== 'phase' ? (
          <>
            <RaceChart items={ranked.map((x) => ({ key: x.region.key || x.code, label: x.region.label || x.name, value: x.value }))} color={color} fmt={fmt} lo={scale.lo} hi={scale.hi} onPick={(k) => roneRegion(k) && onPick(k)} />
            <p className="sub">{frameLabel(frames?.dates[t.i])} 기준 상위 {RACE_TOP}곳. 재생하면 순위가 바뀌는 대로 줄이 자리를 옮깁니다.</p>
          </>
        ) : def.kind === 'phase' ? (
          <div className="table-wrap">
            <table className="rank">
              <tbody>
                {PHASE_NAMES.map((n, i) => {
                  const list = ranked.filter((x) => x.value === i + 1);
                  return (
                    <tr key={n}>
                      <th scope="row" className="l">
                        <span className="dot" style={{ background: PHASE_COLORS[i], marginRight: 6 }} />
                        {i + 1} {n}
                      </th>
                      <td className="num">{list.length}</td>
                      <td className="l sub" style={{ whiteSpace: 'normal' }}>{list.slice(0, 12).map((x) => x.region.label.split(' ').slice(1).join(' ') || x.region.label).join(', ')}{list.length > 12 ? ' …' : ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="table-wrap" style={{ maxHeight: 640, overflowY: 'auto' }}>
            <table className="rank">
              <thead>
                <tr>
                  <th className="num">#</th>
                  <th className="l">지역</th>
                  <th className="num">{def.label}</th>
                </tr>
              </thead>
              <tbody>
                {top.map((x, i) => (
                  <tr key={x.region.key || x.code}>
                    <td className="num sub">{i + 1}</td>
                    <th scope="row" className="l">
                      {x.region.key ? (
                        <button type="button" className="linklike" style={{ textDecoration: 'none' }} onClick={() => onPick(x.region.key)}>{x.region.label}</button>
                      ) : (
                        x.name
                      )}
                    </th>
                    <td className="num">
                      <span className="dot" style={{ background: color(x.value), marginRight: 6 }} />
                      {fmt(x.value)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="sub">경계: 통계청 SGIS 행정동 경계(공공누리 제1유형)를 <a href="https://github.com/vuski/admdongkor" target="_blank" rel="noreferrer">vuski/admdongkor</a>(2026-07판, CC BY 4.0)에서 받아 시군구로 합쳤습니다.</p>
      </section>
      {timeMode && frames && (TIMELINE_METRICS as readonly string[]).includes(metric) && (
        <Heatmap frames={frames} metric={metric as TimelineMetric} i={t.i} sido={sido} color={color} fmt={fmt} onPick={(k) => onPick(k)} />
      )}
    </div>
  );
}
