'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Bar, CartesianGrid, Cell, ComposedChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CANDLE_LABEL, CANDLE_UNITS, type CandleUnit } from '@/domain/candles';
import { money } from '@/lib/format';
import type { CandleView } from '@/server/services/market-board';

type Row = CandleView['candles'][number] & { range: [number, number] };

const BROKER_LABEL: Record<string, string> = {
  TOSS: '토스증권', KIS: '한국투자증권', KIWOOM: '키움증권', LS: 'LS증권', DB: 'DB증권', MERITZ: '메리츠증권',
  UPBIT: '업비트', BITHUMB: '빗썸', COINONE: '코인원', KORBIT: '코빗',
};
const MINUTE_UNITS: CandleUnit[] = ['1m', '5m', '15m', '60m', '240m'];
const priceTick = (v: number) => v.toLocaleString('ko-KR', { maximumFractionDigits: 4 });
const pollMs = (u: CandleUnit) => (u === '1m' ? 5_000 : u === '5m' || u === '15m' ? 10_000 : u === '1d' || u === '1w' ? 60_000 : 20_000);

/** KST label for a bar start. */
function label(iso: string, unit: CandleUnit, long = false) {
  const k = new Date(Date.parse(iso) + 9 * 3_600_000).toISOString();
  if (unit === '1w') return long ? `${k.slice(0, 10)} 주` : k.slice(2, 10).replace(/-/g, '.');
  if (unit === '1d') return long ? k.slice(0, 10) : k.slice(5, 10).replace('-', '/');
  // Hourly and 4-hour bars span several days: keep the date on the axis too
  return long || unit === '60m' || unit === '240m' ? `${k.slice(5, 10).replace('-', '/')} ${k.slice(11, 16)}` : k.slice(11, 16);
}

/** One candle drawn inside the [low, high] bar Recharts lays out. */
function CandleShape(props: { x?: number; y?: number; width?: number; height?: number; payload?: Row }) {
  const { x = 0, y = 0, width = 0, height = 0, payload } = props;
  if (!payload) return null;
  const { o, c, h, l } = payload;
  const color = c > o ? 'var(--up)' : c < o ? 'var(--down)' : 'var(--muted)';
  const scale = h > l ? height / (h - l) : 0;
  const yOf = (v: number) => y + (h - v) * scale;
  const top = yOf(Math.max(o, c));
  const bottom = yOf(Math.min(o, c));
  const cx = x + width / 2;
  const body = Math.max(1, Math.min(width * 0.72, 14));
  return (
    <g>
      <line x1={cx} x2={cx} y1={y} y2={y + Math.max(height, 1)} stroke={color} strokeWidth={1} />
      <rect x={cx - body / 2} y={top} width={body} height={Math.max(1, bottom - top)} fill={color} rx={1} />
    </g>
  );
}

function Tip({ active, payload, unit, currency }: { active?: boolean; payload?: { payload?: Row }[]; unit: CandleUnit; currency: string }) {
  const r = active ? payload?.[0]?.payload : undefined;
  if (!r) return null;
  const pct = r.o ? ((r.c - r.o) / r.o) * 100 : 0;
  return (
    <div style={{ borderRadius: 10, border: '1px solid var(--line)', background: 'var(--surface)', padding: '8px 10px', fontSize: 12.5, lineHeight: 1.6, boxShadow: '0 4px 14px rgba(0,0,0,.08)' }}>
      <div className="strong">{label(r.t, unit, true)} (KST)</div>
      <div className="money">
        시 {money(r.o, currency)} · 고 {money(r.h, currency)}
        <br />저 {money(r.l, currency)} · 종 <span className={r.c > r.o ? 'up' : r.c < r.o ? 'down' : ''}>{money(r.c, currency)}</span> ({pct >= 0 ? '+' : ''}
        {pct.toFixed(2)}%)
      </div>
      {r.v !== null && <div className="muted">거래량 {r.v.toLocaleString('ko-KR', { maximumFractionDigits: 4 })}</div>}
    </div>
  );
}

/** Candlesticks with volume underneath; the interval is picked above the chart. */
export function CandleChart({ symbol, currency, prevClose, paused }: { symbol: string; currency: string; prevClose: number | null; paused: boolean }) {
  const [unit, setUnit] = useState<CandleUnit>(() => {
    try {
      const saved = localStorage.getItem('ppfp-candle-unit') as CandleUnit | null;
      return saved && CANDLE_UNITS.includes(saved) ? saved : '5m';
    } catch {
      return '5m';
    }
  });
  const [data, setData] = useState<CandleView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const load = useCallback(async () => {
    const id = ++seq.current;
    try {
      const res = await fetch(`/api/market/candles?symbol=${encodeURIComponent(symbol)}&unit=${unit}`, { cache: 'no-store' });
      const json = await res.json();
      if (id !== seq.current) return;
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setData(json as CandleView);
      setError(null);
    } catch (e) {
      if (id === seq.current) setError(e instanceof Error ? e.message : '차트를 불러오지 못했습니다.');
    }
  }, [symbol, unit]);
  useEffect(() => {
    setData(null);
    void load();
    try {
      localStorage.setItem('ppfp-candle-unit', unit);
    } catch {}
  }, [load, unit]);
  useEffect(() => {
    if (paused) return;
    const t = setInterval(() => document.visibilityState === 'visible' && void load(), pollMs(unit));
    return () => clearInterval(t);
  }, [load, unit, paused]);

  const rows: Row[] = (data?.candles ?? []).map((c) => ({ ...c, range: [c.l, c.h] }));
  const intradayUnit = MINUTE_UNITS.includes(unit);
  // Wide enough for the longest price label: coins run to hundreds of millions of won
  const longest = Math.max(0, ...rows.map((r) => priceTick(r.h).length), prevClose === null ? 0 : priceTick(prevClose).length);
  const axisWidth = Math.max(56, 16 + 7 * (longest + 1));
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="spread">
        <div className="seg" role="group" aria-label="봉 간격">
          {CANDLE_UNITS.map((u) => (
            <button key={u} type="button" aria-pressed={unit === u} onClick={() => setUnit(u)}>
              {CANDLE_LABEL[u]}
            </button>
          ))}
        </div>
        <span className="sub">
          {data?.source ? `출처 ${BROKER_LABEL[data.source] ?? data.source}` : ''}
          {data?.built ? ' · 더 짧은 봉을 묶어 만듦' : ''}
        </span>
      </div>
      {error && <p className="msg err">{error}</p>}
      {rows.length > 1 ? (
        <div className="money" role="img" aria-label={`${symbol} ${CANDLE_LABEL[unit]}봉 차트, ${rows.length}개`}>
          <div style={{ width: '100%', height: 240 }}>
            <ResponsiveContainer>
              <ComposedChart data={rows} syncId={`candles-${symbol}`} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--line-soft)" vertical={false} />
                <XAxis dataKey="t" hide />
                <YAxis domain={['auto', 'auto']} tick={{ fontSize: 11.5, fill: 'var(--muted)' }} tickLine={false} axisLine={false} width={axisWidth} tickFormatter={(v) => priceTick(Number(v))} />
                {intradayUnit && prevClose !== null && (
                  <ReferenceLine y={prevClose} stroke="var(--muted)" strokeDasharray="4 4" ifOverflow="extendDomain" label={{ value: '전일 종가', position: 'insideTopLeft', fontSize: 11, fill: 'var(--muted)' }} />
                )}
                <Tooltip content={<Tip unit={unit} currency={currency} />} cursor={{ fill: 'var(--line-soft)', opacity: 0.6 }} />
                <Bar dataKey="range" shape={<CandleShape />} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div style={{ width: '100%', height: 72 }}>
            <ResponsiveContainer>
              <ComposedChart data={rows} syncId={`candles-${symbol}`} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <XAxis dataKey="t" tickFormatter={(v) => label(String(v), unit)} tick={{ fontSize: 11.5, fill: 'var(--muted)' }} tickLine={false} axisLine={false} minTickGap={48} />
                <YAxis tick={false} tickLine={false} axisLine={false} width={axisWidth} />
                <Tooltip content={() => null} cursor={{ fill: 'var(--line-soft)', opacity: 0.6 }} />
                <Bar dataKey="v" isAnimationActive={false} radius={[2, 2, 0, 0]}>
                  {rows.map((r) => (
                    <Cell key={r.t} fill={r.c > r.o ? 'var(--up)' : r.c < r.o ? 'var(--down)' : 'var(--muted)'} fillOpacity={0.45} />
                  ))}
                </Bar>
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="sub">
            {CANDLE_LABEL[unit]}봉 · 아래 막대는 거래량 · 시각은 한국 시간
          </p>
        </div>
      ) : (
        <p className="empty">{data ? '이 간격의 봉을 주는 연결 기관이 없거나 아직 거래가 없습니다.' : '차트를 불러오는 중…'}</p>
      )}
    </div>
  );
}
