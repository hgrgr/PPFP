'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { Area, Bar, CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { updateAnalysisPrefs } from '@/app/analysis-actions';
import type { AnalysisPrefs, ChartData, Group, WatchItem } from '@/domain/indicators';

export interface IndicatorMeta {
  id: string;
  group: Group;
  title: string;
  about: string;
  source: string;
  defaultOn: boolean;
  usesRegion?: 'sido' | 'any';
  usesIncome?: boolean;
}

interface View {
  id: string;
  data: ChartData | null;
  missing: ('ECOS' | 'KOSIS' | 'RONE')[];
  errors: string[];
}

const axis = { fontSize: 11.5, fill: 'var(--muted)' };
export const KEY_HELP = {
  ECOS: { label: '한국은행 ECOS 인증키', href: '/settings#ecos' },
  KOSIS: { label: '통계청 KOSIS 인증키', href: '/settings#kosis' },
  RONE: { label: '한국부동산원 R-ONE 인증키', href: '/settings#rone' },
} as const;

function num(v: number, unit: string) {
  const digits = Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 2;
  return `${v.toLocaleString('ko-KR', { maximumFractionDigits: digits })}${unit && !unit.startsWith('%') ? ` ${unit}` : unit}`;
}

/** A card's chart: lines, stacked areas and bars on one or two axes; the legend switches series. */
export function IndicatorChart({ data }: { data: ChartData }) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const shown = data.lines.filter((l) => !hidden.has(l.key));
  const right = shown.some((l) => l.axis === 'right');
  const unitOf = (key: string) => (data.lines.find((l) => l.key === key)?.axis === 'right' ? (data.rightUnit ?? data.unit) : data.unit);
  // Bars start from zero (a bar's length is its value); lines and areas fit their range
  const domainOf = (side: 'l' | 'r'): [number | string, number | string] => {
    const own = shown.filter((l) => (l.axis === 'right' ? 'r' : 'l') === side);
    const values = data.rows.flatMap((r) => own.map((l) => r[l.key])).filter((v): v is number => typeof v === 'number');
    return own.some((l) => l.kind === 'bar') && values.every((v) => v >= 0) ? [0, 'auto'] : ['auto', 'auto'];
  };
  const yearly = data.rows.length > 1 && String(data.rows[1].date).slice(5) === '01-01' && String(data.rows[0].date).slice(5) === '01-01';
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div style={{ width: '100%', height: 260 }}>
        <ResponsiveContainer>
          <ComposedChart data={data.rows} stackOffset="sign" margin={{ top: 8, right: right ? 0 : 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--line-soft)" vertical={false} />
            <XAxis dataKey="date" tickFormatter={(v) => (yearly ? String(v).slice(0, 4) : String(v).slice(2, 7).replace('-', '.'))} tick={axis} tickLine={false} axisLine={false} minTickGap={40} />
            <YAxis yAxisId="l" tick={axis} tickLine={false} axisLine={false} width={48} domain={domainOf('l')} tickFormatter={(v) => Number(v).toLocaleString('ko-KR', { maximumFractionDigits: 2 })} />
            {right && <YAxis yAxisId="r" orientation="right" tick={axis} tickLine={false} axisLine={false} width={48} domain={domainOf('r')} tickFormatter={(v) => Number(v).toLocaleString('ko-KR', { maximumFractionDigits: 2 })} />}
            <Tooltip
              formatter={(v, name) => [v === null || v === undefined ? '—' : num(Number(v), unitOf(String(name))), data.lines.find((l) => l.key === String(name))?.label ?? String(name)]}
              labelFormatter={(l) => (yearly ? `${String(l).slice(0, 4)}년` : String(l).slice(0, 7))}
              contentStyle={{ borderRadius: 10, border: '1px solid var(--line)', background: 'var(--surface)', fontSize: 13 }}
            />
            {(data.bands ?? []).map((b) => (
              <ReferenceArea key={`${b.from}${b.label}`} yAxisId="l" x1={b.from} x2={b.to} fill="var(--danger, #e34948)" fillOpacity={0.08} stroke="none" ifOverflow="extendDomain" />
            ))}
            {(data.refs ?? []).map((r) => (
              <ReferenceLine key={`${r.y}${r.label}`} yAxisId="l" y={r.y} stroke="var(--muted)" strokeDasharray="4 4" label={r.label ? { value: r.label, position: 'insideTopLeft', fontSize: 11, fill: 'var(--muted)' } : undefined} />
            ))}
            {shown.map((l) => {
              const y = l.axis === 'right' ? 'r' : 'l';
              if (l.kind === 'area') return <Area key={l.key} yAxisId={y} type="monotone" dataKey={l.key} stackId={l.stack} stroke={l.color} fill={l.color} fillOpacity={0.35} strokeWidth={1.2} connectNulls isAnimationActive={false} />;
              if (l.kind === 'bar') return <Bar key={l.key} yAxisId={y} dataKey={l.key} fill={l.color} fillOpacity={0.55} isAnimationActive={false} />;
              return <Line key={l.key} yAxisId={y} type="monotone" dataKey={l.key} stroke={l.color} strokeWidth={l.color === 'var(--ink)' ? 2 : 1.6} strokeDasharray={l.dash ? '5 4' : undefined} dot={false} connectNulls isAnimationActive={false} />;
            })}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="inline" style={{ gap: 6, flexWrap: 'wrap' }} aria-label="선 켜고 끄기">
        {data.lines.map((l) => (
          <button
            key={l.key}
            type="button"
            className="chip-btn"
            aria-pressed={!hidden.has(l.key)}
            onClick={() =>
              setHidden((h) => {
                const n = new Set(h);
                if (n.has(l.key)) n.delete(l.key);
                else n.add(l.key);
                return n;
              })
            }
          >
            <span className="dot" style={{ background: l.color, opacity: hidden.has(l.key) ? 0.3 : 1 }} />
            {l.label}
            {l.axis === 'right' && <span className="sub"> (오른쪽 축)</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

/** What to watch on a card: each point with whether it holds now, the numbers, and why it matters */
function WatchList({ items, bands }: { items: WatchItem[]; bands: { label: string }[] }) {
  const on = items.filter((w) => w.active).length;
  const labels = [...new Set(bands.map((b) => b.label))];
  return (
    <div className="watch" aria-label="주목할 점">
      <div className="spread">
        <span className="strong">주목할 점</span>
        <span className="sub">{on ? `${on}개 해당` : '지금 해당 없음'}</span>
      </div>
      <ul>
        {items.map((w) => (
          <li key={w.title} className={w.active ? 'on' : w.active === false ? 'off' : 'na'}>
            <span className="mark" aria-label={w.active ? '해당' : w.active === false ? '해당 없음' : '자료 부족'}>{w.active ? '●' : w.active === false ? '○' : '–'}</span>
            <span className="stack" style={{ gap: 2 }}>
              <span>
                <span className="strong">{w.title}</span>
                {w.detail && <span className="sub"> · {w.detail}</span>}
              </span>
              <span className="sub">{w.note}</span>
            </span>
          </li>
        ))}
      </ul>
      {labels.length > 0 && <p className="sub">그래프의 붉은 음영: {labels.join(', ')} 구간</p>}
    </div>
  );
}

/** Scrolls to a card or section and marks it for a moment, keeping the address in step */
function jump(e: React.MouseEvent<HTMLAnchorElement>, id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  e.preventDefault();
  el.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  history.replaceState(null, '', `#${id}`);
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 1700);
}

/**
 * The board's table of contents: every indicator shown, by group, with how many of its watch
 * points hold now, and a bar that stays at the top to jump between groups and back here.
 */
function IndicatorToc({ groups, states }: { groups: { key: Group; label: string; list: IndicatorMeta[] }[]; states: Record<string, CardState> }) {
  const [current, setCurrent] = useState<string | null>(null);
  useEffect(() => {
    const els = groups.map((g) => document.getElementById(`grp-${g.key}`)).filter((x): x is HTMLElement => !!x);
    const seen = new Map<string, boolean>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const en of entries) seen.set(en.target.id, en.isIntersecting);
        setCurrent(els.find((el) => seen.get(el.id))?.id ?? null);
      },
      { rootMargin: '-60px 0px -55% 0px' },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [groups]);
  const flagged = Object.values(states).filter((s) => s.active.length).length;
  return (
    <>
      <nav className="card ind-toc" id="ind-toc" aria-label="지표 목차">
        <div className="spread">
          <h2>목차</h2>
          <span className="sub">{groups.reduce((t, g) => t + g.list.length, 0)}개 지표 · 지금 주목할 점이 있는 지표 {flagged}개</span>
        </div>
        <div className="ind-toc-groups">
          {groups.map((g) => {
            const hot = g.list.filter((m) => states[m.id]?.active.length).length;
            return (
              <div key={g.key} className="ind-toc-group">
                <a className="strong" href={`#grp-${g.key}`} onClick={(e) => jump(e, `grp-${g.key}`)}>
                  {g.label} <span className="sub">{g.list.length}</span>
                  {hot > 0 && <span className="badge warn">주목 {hot}</span>}
                </a>
                <ol>
                  {g.list.map((m) => {
                    const st = states[m.id];
                    return (
                      <li key={m.id}>
                        <a href={`#ind-${m.id}`} onClick={(e) => jump(e, `ind-${m.id}`)} title={st?.active.length ? `지금 해당: ${st.active.join(' · ')}` : undefined}>
                          {m.title}
                        </a>
                        {st?.active.length ? <span className="ind-toc-hot" aria-label={`주목할 점 ${st.active.length}개`}>● {st.active.length}</span> : st?.missing ? <span className="sub">키 필요</span> : null}
                      </li>
                    );
                  })}
                </ol>
              </div>
            );
          })}
        </div>
        <p className="sub">● 숫자는 지금 해당하는 <i>주목할 점</i> 개수입니다. 이름에 마우스를 올리면 무엇인지 보입니다.</p>
      </nav>
      <nav className="ind-jump" aria-label="지표 그룹으로 이동">
        <a href="#ind-toc" onClick={(e) => jump(e, 'ind-toc')}>목차 ↑</a>
        {groups.map((g) => (
          <a key={g.key} href={`#grp-${g.key}`} aria-current={current === `grp-${g.key}` ? 'true' : undefined} onClick={(e) => jump(e, `grp-${g.key}`)}>
            {g.label}
          </a>
        ))}
      </nav>
    </>
  );
}

/** What the table of contents shows for a card once it has loaded */
interface CardState {
  /** Watch points that hold now */
  active: string[];
  /** Needs a key the user has not put in */
  missing: boolean;
}

function IndicatorCard({ meta, version, regionName, onState }: { meta: IndicatorMeta; version: string; regionName: string; onState: (id: string, s: CardState) => void }) {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (view) onState(meta.id, { active: (view.data?.watch ?? []).filter((w) => w.active).map((w) => w.title), missing: view.missing.length > 0 });
  }, [view, meta.id, onState]);
  useEffect(() => {
    let live = true;
    setError(null);
    fetch(`/api/analysis/${meta.id}?${version}`, { cache: 'no-store' })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? '불러오지 못했습니다.');
        if (live) setView(j as View);
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : '불러오지 못했습니다.'));
    return () => {
      live = false;
    };
  }, [meta.id, version]);
  const d = view?.data;
  return (
    <section className="card indicator" id={`ind-${meta.id}`} aria-label={meta.title}>
      <div className="stack" style={{ gap: 4 }}>
        <h3>{meta.title}</h3>
        {meta.usesRegion && <span className="sub">지역: {regionName}</span>}
      </div>
      {d && d.latest.length > 0 && (
        <dl className="ind-latest">
          {d.latest.map((x) => (
            <div key={x.label}>
              <dt>{x.label}</dt>
              <dd className="strong">{x.value}</dd>
              <dd className="sub">{x.date}</dd>
            </div>
          ))}
        </dl>
      )}
      {error ? (
        <p className="msg err">{error}</p>
      ) : !view ? (
        <p className="empty">불러오는 중…</p>
      ) : d ? (
        <IndicatorChart data={d} />
      ) : view.missing.length ? null : (
        <p className="empty">아직 받은 자료가 없습니다.</p>
      )}
      {view?.missing.map((m) => (
        <p key={m} className="callout">
          이 지표는 {KEY_HELP[m].label}가 필요합니다. <a href={KEY_HELP[m].href}>연동 · 설정에서 넣기 ›</a>
        </p>
      ))}
      {view && view.errors.length > 0 && <p className="sub">일부 자료를 새로 받지 못해 저장해 둔 값을 보여 줍니다: {view.errors.join(' · ')}</p>}
      {d?.note && <p className="sub">{d.note}</p>}
      {d?.watch && d.watch.length > 0 && <WatchList items={d.watch} bands={d.bands ?? []} />}
      <details>
        <summary className="sub">읽는 법 · 출처</summary>
        <p>{meta.about}</p>
        <p className="sub">출처: {meta.source}</p>
      </details>
    </section>
  );
}

export function AnalysisBoard({
  indicators,
  groups,
  prefs: initial,
  regions,
  districts,
  incomeBases,
}: {
  indicators: IndicatorMeta[];
  groups: { key: Group; label: string }[];
  prefs: AnalysisPrefs;
  regions: { code: string; name: string }[];
  districts: { code: string; name: string }[];
  incomeBases: readonly { key: string; label: string }[];
}) {
  const [prefs, setPrefs] = useState(initial);
  const [pending, start] = useTransition();
  const on = (m: IndicatorMeta) => (m.defaultOn ? !prefs.off.includes(m.id) : prefs.on.includes(m.id));
  const save = (patch: Parameters<typeof updateAnalysisPrefs>[0], optimistic: AnalysisPrefs) => {
    setPrefs(optimistic);
    start(async () => setPrefs(await updateAnalysisPrefs(patch)));
  };
  const version = new URLSearchParams({ region: prefs.region, income: prefs.incomeBase, years: String(prefs.years) }).toString();
  const regionName = [...regions, ...districts].find((r) => r.code === prefs.region)?.name ?? prefs.region;
  const sidoName = /^\d{5}$/.test(prefs.region) ? (regions.find((r) => r.code === (prefs.region.slice(0, 2) === '51' ? '42' : prefs.region.slice(0, 2) === '52' ? '45' : prefs.region.slice(0, 2)))?.name ?? '') : regionName;
  const shownCount = indicators.filter(on).length;
  const [states, setStates] = useState<Record<string, CardState>>({});
  const onState = useCallback((id: string, st: CardState) => setStates((m) => ({ ...m, [id]: st })), []);
  const shownGroups = groups.map((g) => ({ ...g, list: indicators.filter((m) => m.group === g.key && on(m)) })).filter((g) => g.list.length);
  return (
    <div className="stack" style={{ gap: 16 }}>
      <section className="card stack" style={{ gap: 12 }} aria-label="지표 설정">
        <div className="inline spread" style={{ flexWrap: 'wrap', gap: 12 }}>
          <div className="seg" role="group" aria-label="기간">
            {[5, 10, 20, 0].map((y) => (
              <button key={y} type="button" aria-current={prefs.years === y ? 'true' : undefined} onClick={() => save({ years: y }, { ...prefs, years: y })}>
                {y ? `${y}년` : '전체'}
              </button>
            ))}
          </div>
          <label className="inline" style={{ gap: 6 }}>
            <span className="sub">지역</span>
            <select value={prefs.region} onChange={(e) => save({ region: e.target.value }, { ...prefs, region: e.target.value })}>
              <optgroup label="시도">
                {regions.map((r) => (
                  <option key={r.code} value={r.code}>{r.name}</option>
                ))}
              </optgroup>
              {districts.length > 0 && (
                <optgroup label="내 부동산이 있는 시군구 (인구)">
                  {districts.map((r) => (
                    <option key={r.code} value={r.code}>{r.name}</option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>
          <label className="inline" style={{ gap: 6 }}>
            <span className="sub">PIR 소득</span>
            <select value={prefs.incomeBase} onChange={(e) => save({ incomeBase: e.target.value }, { ...prefs, incomeBase: e.target.value as AnalysisPrefs['incomeBase'] })}>
              {incomeBases.map((b) => (
                <option key={b.key} value={b.key}>{b.label}</option>
              ))}
            </select>
          </label>
          {pending && <span className="sub">저장 중…</span>}
        </div>
        {/^\d{5}$/.test(prefs.region) && <p className="sub">시군구는 인구 지표에만 쓰고, PIR·공급은 {sidoName} 기준으로 봅니다.</p>}
        <details>
          <summary>
            지표 고르기 <span className="sub">({shownCount}/{indicators.length}개 보는 중)</span>
          </summary>
          <div className="ind-picker">
            {groups.map((g) => (
              <fieldset key={g.key}>
                <legend>{g.label}</legend>
                {indicators
                  .filter((m) => m.group === g.key)
                  .map((m) => (
                    <label key={m.id} className="check">
                      <input type="checkbox" checked={on(m)} onChange={(e) => {
                        const v = e.target.checked;
                        const off = prefs.off.filter((x) => x !== m.id), onL = prefs.on.filter((x) => x !== m.id);
                        if (m.defaultOn && !v) off.push(m.id);
                        if (!m.defaultOn && v) onL.push(m.id);
                        save({ toggle: { id: m.id, on: v } }, { ...prefs, off, on: onL });
                      }} />
                      {m.title}
                    </label>
                  ))}
              </fieldset>
            ))}
          </div>
        </details>
      </section>

      {shownGroups.length > 0 && <IndicatorToc groups={shownGroups} states={states} />}

      {shownGroups.map((g) => (
        <section key={g.key} id={`grp-${g.key}`} className="stack ind-group" style={{ gap: 12 }} aria-label={g.label}>
          <h2>{g.label}</h2>
          <div className="ind-grid">
            {g.list.map((m) => (
              <IndicatorCard key={m.id} meta={m} version={version} regionName={m.usesRegion === 'sido' ? sidoName : regionName} onState={onState} />
            ))}
          </div>
        </section>
      ))}
      {!shownCount && <p className="empty">켜 둔 지표가 없습니다. 위 *지표 고르기*에서 고르세요.</p>}
    </div>
  );
}
