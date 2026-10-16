'use client';

import { useState } from 'react';
import { formatMetric, METRIC_GROUPS, METRIC_INFO, type Metrics } from '@/domain/metrics';

type Key = keyof typeof METRIC_INFO;

/** Green-ish (good) or red-ish (bad) for metrics with a direction; neutral otherwise */
function toneOf(key: Key, v: number | null): string {
  if (v === null || !Number.isFinite(v)) return '';
  const better = METRIC_INFO[key].better;
  if (!better) return '';
  if (key === 'sharpe' || key === 'sortino' || key === 'calmar' || key === 'treynor' || key === 'informationRatio') return v > 0 ? 'up' : 'down';
  if (key === 'omega') return v > 1 ? 'up' : 'down';
  if (key === 'upCapture') return v >= 1 ? 'up' : '';
  if (key === 'downCapture') return v <= 1 ? 'up' : 'down';
  if (['total', 'cagr', 'alpha', 'excess'].includes(key)) return v >= 0 ? 'up' : 'down';
  return '';
}

/**
 * One or more portfolios' evaluation metrics in tabs (수익 · 위험 / 위험 대비 성과 / 기준 지수 대비).
 * Each header carries what the metric means in its tooltip and in the legend below.
 */
export function MetricsTable({ rows, benchmark, periodName = '일', compact = false }: { rows: { key: string; label: string; badge?: string; color?: string; metrics: Metrics }[]; benchmark: string; periodName?: string; compact?: boolean }) {
  const [group, setGroup] = useState(METRIC_GROUPS[0].key);
  const g = METRIC_GROUPS.find((x) => x.key === group)!;
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="seg" role="tablist" aria-label="지표 묶음">
        {METRIC_GROUPS.map((x) => (
          <button key={x.key} type="button" role="tab" aria-selected={group === x.key} aria-pressed={group === x.key} onClick={() => setGroup(x.key)}>
            {x.key === 'market' ? `${benchmark} 대비` : x.label}
          </button>
        ))}
      </div>
      <div className="table-wrap">
        <table className="rank">
          <thead>
            <tr>
              {!compact && <th className="l">포트폴리오</th>}
              {g.keys.map((k) => (
                <th key={k} className="num" title={METRIC_INFO[k].about} style={{ cursor: 'help', textDecoration: 'underline dotted' }}>
                  {METRIC_INFO[k].label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                {!compact && (
                  <th scope="row" className="l">
                    {r.color && <span className="dot" style={{ background: r.color, marginRight: 6 }} />}
                    {r.badge && <span className="badge" style={{ marginRight: 6 }}>{r.badge}</span>}
                    {r.label}
                  </th>
                )}
                {g.keys.map((k) => {
                  const v = r.metrics[k] as number | null;
                  return (
                    <td key={k} className={`num ${toneOf(k, v)}`}>
                      {k === 'drawdownLength' && v === null && !r.metrics.recovered ? '회복 중' : formatMetric(k, v, periodName)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details className="sub">
        <summary style={{ cursor: 'pointer' }}>지표 설명</summary>
        <dl className="metric-legend">
          {g.keys.map((k) => (
            <div key={k}>
              <dt>{METRIC_INFO[k].label}</dt>
              <dd>{METRIC_INFO[k].about}</dd>
            </div>
          ))}
        </dl>
        <p style={{ margin: '6px 0 0' }}>무위험 수익률은 연 3%로 봅니다. 기준 지수 대비 지표(베타·알파·포착률 등)는 한국과 미국 시장의 거래 시간 차이를 없애려고 주간 수익률로 계산합니다. 기간이 짧으면(일별 40개 미만 등) 변동성 기반 지표는 비웁니다. 과거 성과이며 앞으로를 보장하지 않습니다.</p>
      </details>
    </div>
  );
}
