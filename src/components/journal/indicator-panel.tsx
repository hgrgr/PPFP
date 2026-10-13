'use client';

import { useEffect, useRef, useState } from 'react';
import { IndicatorChart } from '@/components/analysis-board';
import { chartToPng, resolveColor } from '@/components/chart-image';
import { GROUPS, INDICATORS, type ChartData } from '@/domain/indicators';

export interface IndicatorCapture {
  title: string;
  image: Blob;
  /** "10년 금리 (시장) 5.29% (2026-09)", one per latest value */
  latest: string[];
  /** Watch points that hold now, with their numbers */
  watch: string[];
  source: string;
}

interface View {
  data: ChartData | null;
  missing: string[];
  errors: string[];
}

/**
 * The 분석 지표 beside a journal: pick an indicator, read its chart, latest values and what to
 * watch, and put a picture of it with those numbers into the entry.
 */
export function IndicatorPanel({ prefs, onCapture, onClose }: { prefs: { region: string; incomeBase: string; years: number }; onCapture: (c: IndicatorCapture) => Promise<void>; onClose: () => void }) {
  const [id, setId] = useState(INDICATORS[0].id);
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const meta = INDICATORS.find((i) => i.id === id)!;

  useEffect(() => {
    let live = true;
    setView(null);
    setError(null);
    setDone(null);
    const q = new URLSearchParams({ region: prefs.region, income: prefs.incomeBase, years: String(prefs.years) });
    fetch(`/api/analysis/${id}?${q}`, { cache: 'no-store' })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? '불러오지 못했습니다.');
        if (live) setView(j as View);
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : '불러오지 못했습니다.'));
    return () => {
      live = false;
    };
  }, [id, prefs.region, prefs.incomeBase, prefs.years]);

  const d = view?.data;
  const capture = async () => {
    const svg = box.current?.querySelector<SVGSVGElement>('svg.recharts-surface');
    if (!d || !svg) return;
    setBusy(true);
    setDone(null);
    try {
      const card = box.current!;
      // Lines hidden with the legend buttons are left out of the picture and its legend too
      const shown = [...card.querySelectorAll('[aria-label="선 켜고 끄기"] button')].map((b) => b.getAttribute('aria-pressed') !== 'false');
      const image = await chartToPng(svg, {
        title: meta.title,
        legend: d.lines.filter((_, i) => shown[i] ?? true).map((l) => ({ label: l.label, color: resolveColor(l.color, card) })),
        footer: `출처: ${meta.source}`,
        background: getComputedStyle(card).backgroundColor || '#ffffff',
        ink: resolveColor('var(--ink)', card),
        muted: resolveColor('var(--muted)', card),
      });
      await onCapture({
        title: meta.title,
        image,
        latest: d.latest.map((l) => `${l.label} ${l.value} (${l.date})`),
        watch: (d.watch ?? []).filter((w) => w.active).map((w) => (w.detail ? `${w.title} — ${w.detail}` : w.title)),
        source: meta.source,
      });
      setDone('일지에 넣었습니다.');
    } catch (e) {
      setError(e instanceof Error ? e.message : '일지에 넣지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="indicator-panel card" aria-label="분석 지표">
      <div className="spread">
        <span className="strong">분석 지표</span>
        <div className="inline" style={{ gap: 6 }}>
          <a className="sub" href="/analysis" target="_blank" rel="noreferrer">전체 보기 ›</a>
          <button type="button" className="btn small" onClick={onClose} aria-label="분석 지표 닫기">✕</button>
        </div>
      </div>
      <select value={id} onChange={(e) => setId(e.target.value)} aria-label="지표 고르기">
        {GROUPS.map((g) => (
          <optgroup key={g.key} label={g.label}>
            {INDICATORS.filter((i) => i.group === g.key).map((i) => (
              <option key={i.id} value={i.id}>{i.title}</option>
            ))}
          </optgroup>
        ))}
      </select>
      <div ref={box} className="indicator-panel-body">
        {error ? (
          <p className="msg err">{error}</p>
        ) : !view ? (
          <p className="empty">불러오는 중…</p>
        ) : d ? (
          <>
            <dl className="ind-latest">
              {d.latest.map((x) => (
                <div key={x.label}>
                  <dt>{x.label}</dt>
                  <dd className="strong">{x.value}</dd>
                  <dd className="sub">{x.date}</dd>
                </div>
              ))}
            </dl>
            <IndicatorChart data={d} />
            {d.watch && d.watch.some((w) => w.active) && (
              <ul className="sub" style={{ margin: 0, paddingLeft: 18 }}>
                {d.watch.filter((w) => w.active).map((w) => (
                  <li key={w.title}>
                    <span className="strong">{w.title}</span>
                    {w.detail && ` · ${w.detail}`}
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p className="empty">{view.missing.length ? '이 지표는 연동 · 설정에서 인증키를 넣어야 나옵니다.' : '아직 받은 자료가 없습니다.'}</p>
        )}
      </div>
      <div className="spread">
        <span className="sub" role="status">{done}</span>
        <button type="button" className="btn primary small" disabled={!d || busy} onClick={() => void capture()}>
          {busy ? '넣는 중…' : '일지에 넣기'}
        </button>
      </div>
      <p className="sub">그래프 그림과 지금의 최근 값, 해당하는 주목할 점을 커서 위치(없으면 맨 끝)에 넣습니다. 숨긴 선은 그림에서도 빠집니다.</p>
    </aside>
  );
}
