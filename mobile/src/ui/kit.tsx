import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { InputError } from '~/core/store';

export function Topbar({ title, back = false, right }: { title: string; back?: boolean; right?: ReactNode }) {
  const nav = useNavigate();
  return (
    <header className="topbar">
      {back && (
        <button className="back" aria-label="뒤로" onClick={() => nav(-1)}>
          ‹
        </button>
      )}
      <h1>{title}</h1>
      {right}
    </header>
  );
}

export function Msg({ ok, error, info }: { ok?: string | null; error?: string | null; info?: string | null }) {
  if (error) return <p className="msg err" role="alert">{error}</p>;
  if (ok) return <p className="msg ok" role="status">{ok}</p>;
  if (info) return <p className="msg info">{info}</p>;
  return null;
}

/** Runs an action, keeps its message and whether it is running. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const run = async (fn: () => Promise<string | void>) => {
    setBusy(true);
    setMsg({});
    try {
      const ok = await fn();
      setMsg(ok ? { ok } : {});
      return true;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setMsg({ error: e instanceof InputError || e instanceof Error ? message : '처리하지 못했습니다.' });
      if (!(e instanceof InputError)) console.error(e);
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, msg, setMsg, run };
}

const svg = (d: ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d}
  </svg>
);

export const Icon = {
  home: svg(<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />),
  pie: svg(
    <>
      <path d="M12 3a9 9 0 1 0 9 9h-9z" />
      <path d="M15 3.5A9 9 0 0 1 20.5 9H15z" />
    </>,
  ),
  plus: svg(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v8M8 12h8" />
    </>,
  ),
  more: svg(
    <>
      <circle cx="5" cy="12" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="19" cy="12" r="1.5" />
    </>,
  ),
  bell: svg(<path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0" />),
  refresh: svg(<path d="M20 11a8 8 0 0 0-14.9-3M4 4v4h4M4 13a8 8 0 0 0 14.9 3M20 20v-4h-4" />),
  scale: svg(<path d="M12 3v18M5 7h14M5 7l-3 7a3 3 0 0 0 6 0zM19 7l-3 7a3 3 0 0 0 6 0z" />),
  target: svg(
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1" />
    </>,
  ),
  receipt: svg(<path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h4" />),
  note: svg(<path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5" />),
  book: svg(<path d="M4 5a2 2 0 0 1 2-2h14v16H6a2 2 0 0 0-2 2zM20 19v2H6" />),
  spark: svg(<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />),
  lock: svg(
    <>
      <rect x="4" y="10" width="16" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </>,
  ),
  key: svg(<path d="M15 7a4 4 0 1 1-3.5 6L4 20.5V17h3v-3h3l1.5-1.5A4 4 0 0 1 15 7z" />),
  server: svg(
    <>
      <rect x="3" y="4" width="18" height="7" rx="2" />
      <rect x="3" y="13" width="18" height="7" rx="2" />
      <path d="M7 7.5h.01M7 16.5h.01" />
    </>,
  ),
  file: svg(<path d="M6 3h8l4 4v14H6zM14 3v4h4M9 13h6M9 17h6" />),
  folder: svg(<path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />),
  list: svg(<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />),
  info: svg(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7.5h.01" />
    </>,
  ),
};

export const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)', 'var(--series-6)', 'var(--series-7)', 'var(--series-8)'];

/** A stacked bar with its legend: shares of a whole */
export function Shares({ items }: { items: { label: string; value: number; sub?: string }[] }) {
  const total = items.reduce((s, i) => s + Math.max(0, i.value), 0);
  if (!total) return null;
  const shown = items.filter((i) => i.value > 0);
  return (
    <div className="legend">
      <div className="bar" role="img" aria-label={shown.map((i) => `${i.label} ${((i.value / total) * 100).toFixed(1)}%`).join(', ')}>
        {shown.map((i, k) => (
          <span key={i.label} style={{ width: `${(i.value / total) * 100}%`, background: SERIES[k % SERIES.length] }} />
        ))}
      </div>
      {shown.map((i, k) => (
        <div key={i.label}>
          <span className="dot" style={{ background: SERIES[k % SERIES.length] }} />
          {i.label}
          <span className="v">
            {((i.value / total) * 100).toFixed(1)}% <span className="sub">{i.sub}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

/** A small line of values over time */
export function Spark({ points, label }: { points: number[]; label: string }) {
  if (points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const w = 300;
  const h = 72;
  const d = points.map((v, i) => `${i ? 'L' : 'M'}${((i / (points.length - 1)) * w).toFixed(1)},${(h - 6 - ((v - min) / span) * (h - 12)).toFixed(1)}`).join(' ');
  const upTrend = points[points.length - 1] >= points[0];
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={label}>
      <path d={d} fill="none" stroke={upTrend ? 'var(--up)' : 'var(--down)'} strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
