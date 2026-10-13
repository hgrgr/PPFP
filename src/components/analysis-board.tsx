'use client';

import { useEffect, useState, useTransition } from 'react';
import { Area, Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { updateAnalysisPrefs } from '@/app/analysis-actions';
import type { AnalysisPrefs, ChartData, Group } from '@/domain/indicators';

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
const KEY_HELP = {
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

function IndicatorCard({ meta, version, regionName }: { meta: IndicatorMeta; version: string; regionName: string }) {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
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

      {groups.map((g) => {
        const list = indicators.filter((m) => m.group === g.key && on(m));
        if (!list.length) return null;
        return (
          <section key={g.key} className="stack" style={{ gap: 12 }} aria-label={g.label}>
            <h2>{g.label}</h2>
            <div className="ind-grid">
              {list.map((m) => (
                <IndicatorCard key={m.id} meta={m} version={version} regionName={m.usesRegion === 'sido' ? sidoName : regionName} />
              ))}
            </div>
          </section>
        );
      })}
      {!shownCount && <p className="empty">켜 둔 지표가 없습니다. 위 *지표 고르기*에서 고르세요.</p>}
    </div>
  );
}
