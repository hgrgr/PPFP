'use client';

import { useMemo, useState } from 'react';
import { LOCATION_METRICS, type LocationMetric, type LocationRow } from '@/domain/location';

export interface LocationViewData {
  rows: LocationRow[];
  years: Partial<Record<LocationMetric, string>>;
  at: string;
}

const fmt = (m: (typeof LOCATION_METRICS)[number], v: number | undefined) =>
  v === undefined ? '—' : `${m.key === 'growth' && v > 0 ? '+' : ''}${v.toLocaleString('ko-KR', { maximumFractionDigits: m.digits, minimumFractionDigits: m.key === 'income' ? 0 : m.digits })}`;
const GRADE_COLORS = ['var(--series-1)', 'var(--series-3)', 'var(--series-5)', 'var(--series-6)', 'var(--muted)'];

type SortKey = 'score' | LocationMetric;

/** A percentile as a small bar behind the number */
function Pct({ p, children }: { p: number | undefined; children: React.ReactNode }) {
  return (
    <span style={{ position: 'relative', display: 'inline-block', minWidth: 64, textAlign: 'right' }}>
      {p !== undefined && <span aria-hidden style={{ position: 'absolute', left: 0, bottom: -3, height: 3, width: `${p}%`, background: 'var(--series-1)', opacity: 0.45, borderRadius: 2 }} />}
      {children}
    </span>
  );
}

export function LocationPanel({ view, onPick, focus }: { view: LocationViewData; onPick: (key: string) => void; focus: string }) {
  const focusRow = view.rows.find((r) => r.key === focus) ?? view.rows.find((r) => r.key === focus.split('>').slice(0, 2).join('>'));
  const sidos = useMemo(() => [...new Set(view.rows.map((r) => r.sido))].sort(), [view.rows]);
  const [sido, setSido] = useState<string>(focusRow?.sido ?? 'all');
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'score', desc: true });
  const rows = useMemo(() => {
    const list = view.rows.filter((r) => sido === 'all' || r.sido === sido);
    const v = (r: LocationRow) => (sort.key === 'score' ? (r.score ?? -1) : (r.values[sort.key] ?? -Infinity));
    return [...list].sort((a, b) => (sort.desc ? v(b) - v(a) : v(a) - v(b)));
  }, [view.rows, sido, sort]);
  const th = (key: SortKey, label: string, sub?: string) => (
    <th className="num">
      <button type="button" className="linklike" style={{ textDecoration: 'none', fontWeight: sort.key === key ? 700 : 500 }} onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : true }))}>
        {label}
        {sort.key === key ? (sort.desc ? ' ↓' : ' ↑') : ''}
      </button>
      {sub && <span className="sub">{sub}</span>}
    </th>
  );
  return (
    <div className="stack" style={{ gap: 16 }}>
      {focusRow && (
        <section className="card indicator" aria-label="입지 요약">
          <div className="inline spread" style={{ gap: 8, flexWrap: 'wrap' }}>
            <div className="stack" style={{ gap: 2 }}>
              <h3>{focusRow.label} 입지</h3>
              <span className="sub">전국 시군구 {view.rows.filter((r) => r.score !== null).length}곳 중 {focusRow.rank ?? '—'}위{focusRow.key !== focus ? ` (구는 시 단위 값을 씁니다)` : ''}</span>
            </div>
            {focusRow.grade && (
              <span className="badge" style={{ background: GRADE_COLORS[focusRow.grade - 1], color: 'var(--surface)' }}>
                {focusRow.grade}급지 · {focusRow.score?.toFixed(0)}점
              </span>
            )}
          </div>
          <dl className="ind-latest">
            {LOCATION_METRICS.map((m) => (
              <div key={m.key}>
                <dt>{m.label}</dt>
                <dd className="strong">
                  {fmt(m, focusRow.values[m.key])}
                  <span className="sub" style={{ display: 'inline', marginLeft: 3 }}>{m.unit}</span>
                </dd>
                <dd className="sub">{'unscored' in m ? '참고' : `상위 ${focusRow.pct[m.key] === undefined ? '—' : `${(100 - focusRow.pct[m.key]!).toFixed(0)}%`}`}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      <section className="card indicator" aria-label="입지 순위">
        <div className="inline spread" style={{ gap: 10, flexWrap: 'wrap' }}>
          <div className="stack" style={{ gap: 2 }}>
            <h3>시군구 입지 순위</h3>
            <span className="sub">지표마다 전국 시군구 안의 백분위를 구해 평균한 점수(0~100)와 급지(상위 20%마다 1~5급지). 숫자 밑 막대가 백분위입니다. 외국인·고령인구는 참고로만 보여 주고 점수에는 넣지 않습니다.</span>
          </div>
          <label className="inline" style={{ gap: 6 }}>
            <span className="sub">시도</span>
            <select value={sido} onChange={(e) => setSido(e.target.value)} style={{ width: 'auto' }} aria-label="입지 시도">
              <option value="all">전국</option>
              {sidos.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="table-wrap">
          <table className="rank">
            <thead>
              <tr>
                <th className="num">#</th>
                <th className="l">지역</th>
                {th('score', '종합')}
                {LOCATION_METRICS.map((m) => th(m.key, m.label, m.unit))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} style={{ background: focusRow?.key === r.key ? 'var(--surface-2)' : undefined }}>
                  <td className="num sub">{r.rank ?? '—'}</td>
                  <th scope="row" className="l">
                    {r.linked ? (
                      <button type="button" className="linklike" style={{ textDecoration: 'none' }} onClick={() => onPick(r.key)}>{r.label}</button>
                    ) : (
                      r.label
                    )}
                    {r.grade && (
                      <span className="badge" style={{ marginLeft: 6, background: GRADE_COLORS[r.grade - 1], color: 'var(--surface)' }}>{r.grade}급</span>
                    )}
                  </th>
                  <td className="num strong">{r.score === null ? '—' : r.score.toFixed(0)}</td>
                  {LOCATION_METRICS.map((m) => (
                    <td key={m.key} className="num">
                      <Pct p={r.pct[m.key]}>{fmt(m, r.values[m.key])}</Pct>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <details>
          <summary className="sub">지표 · 출처 · 읽는 법</summary>
          <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 13, lineHeight: 1.7 }}>
            {LOCATION_METRICS.map((m) => (
              <li key={m.key}>
                <b>{m.label}</b> ({view.years[m.key] ?? '—'}): {m.about}
              </li>
            ))}
          </ul>
          <p style={{ fontSize: 13, lineHeight: 1.6 }}>
            출처: 통계청 KOSIS e-지방지표(사설학원, 의사, 재정자립도, 종사자, 주민등록인구, 등록외국인, 고령인구)와 국세청 국세통계(근로소득 연말정산, 주소지 기준). 이 통계들은 시 단위까지만 나와 성남시 분당구 같은 구는 성남시 값을 씁니다. 지표마다 무게를 똑같이 두었으니 학군이 중요하면 사설학원, 직장이 중요하면 일자리 순으로 정렬해 보세요. 숫자는 해마다 한 번 바뀌며, 입지의 좋고 나쁨을 모두 담지는 못하는 참고 지표입니다.
          </p>
        </details>
      </section>
    </div>
  );
}
