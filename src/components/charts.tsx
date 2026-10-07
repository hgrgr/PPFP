'use client';

import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { krw, krwShort, pct, shortDate } from '@/lib/format';

const axis = { fontSize: 11.5, fill: 'var(--muted)' };

export function ValueChart({ data }: { data: { date: string; value: number; invested: number }[] }) {
  if (data.length < 2) return <p className="empty">기간 데이터가 아직 부족합니다. 거래를 기록하면 다음 날부터 추이가 쌓입니다.</p>;
  return (
    <div style={{ width: '100%', height: 260 }} className="money">
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--line-soft)" vertical={false} />
          <XAxis dataKey="date" tickFormatter={(v) => shortDate(String(v))} tick={axis} tickLine={false} axisLine={false} minTickGap={48} />
          <YAxis tickFormatter={(v) => krwShort(Number(v))} tick={axis} tickLine={false} axisLine={false} width={64} domain={['auto', 'auto']} />
          <Tooltip
            formatter={(v, name) => [krw(Number(v)), String(name) === 'value' ? '평가액' : '투자원금']}
            labelFormatter={(l) => String(l)}
            contentStyle={{ borderRadius: 10, border: '1px solid var(--line)', background: 'var(--surface)', fontSize: 13 }}
          />
          <Area type="monotone" dataKey="value" stroke="none" fill="var(--ink)" fillOpacity={0.06} isAnimationActive={false} />
          <Line type="monotone" dataKey="invested" stroke="var(--muted)" strokeDasharray="5 4" strokeWidth={1.5} dot={false} isAnimationActive={false} />
          <Line type="monotone" dataKey="value" stroke="var(--ink)" strokeWidth={2} dot={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

interface DonutSlice {
  key: string;
  label: string;
  sub?: string;
  color: string;
  value: number;
  share: number;
}

function DonutTip({ active, payload }: { active?: boolean; payload?: { payload?: DonutSlice }[] }) {
  const s = active ? payload?.[0]?.payload : undefined;
  if (!s) return null;
  return (
    <div style={{ borderRadius: 10, border: '1px solid var(--line)', background: 'var(--surface)', padding: '8px 10px', fontSize: 13, boxShadow: '0 4px 14px rgba(0,0,0,.08)' }}>
      <div className="inline" style={{ gap: 6, flexWrap: 'nowrap' }}>
        <span className="dot" style={{ background: s.color }} />
        <span className="strong">{s.label}</span>
      </div>
      {s.sub && <div className="sub">{s.sub}</div>}
      <div className="money" style={{ marginTop: 4 }}>
        {pct(s.share, 1, false)} · {krw(s.value)}
      </div>
    </div>
  );
}

export function Donut({ slices, centerLabel, centerValue }: { slices: DonutSlice[]; centerLabel: string; centerValue: string }) {
  if (!slices.length) return <p className="empty">보유 자산이 없습니다.</p>;
  return (
    <div className="inline" style={{ alignItems: 'center', gap: 20 }}>
      <div style={{ position: 'relative', width: 180, height: 180, flex: 'none' }}>
        <ResponsiveContainer>
          <PieChart>
            <Pie data={slices} dataKey="value" nameKey="label" innerRadius={56} outerRadius={84} paddingAngle={0} stroke="var(--surface)" strokeWidth={2} isAnimationActive={false}>
              {slices.map((s) => (
                <Cell key={s.key} fill={s.color} />
              ))}
            </Pie>
            <Tooltip content={<DonutTip />} wrapperStyle={{ zIndex: 2 }} />
          </PieChart>
        </ResponsiveContainer>
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center', pointerEvents: 'none' }}>
          <div>
            <div className="sub">{centerLabel}</div>
            <div className="strong money" style={{ fontSize: 17 }}>{centerValue}</div>
          </div>
        </div>
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, flex: '1 1 180px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 9 }}>
        {slices.map((s) => (
          <li key={s.key} className="inline" style={{ fontSize: 13, flexWrap: 'nowrap', alignItems: 'flex-start' }}>
            <span className="dot" style={{ background: s.color, marginTop: 5 }} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.label}>{s.label}</span>
              {s.sub && <span className="sub" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.sub}>{s.sub}</span>}
            </span>
            <span className="strong">{pct(s.share, 1, false)}</span>
            <span className="muted money" style={{ width: 70, textAlign: 'right' }}>{krwShort(s.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function WeightChart({ keys, points }: { keys: { key: string; label: string; color: string }[]; points: Record<string, number | string>[] }) {
  if (points.length < 2) return <p className="empty">비중 변화를 그리려면 이틀 이상의 스냅샷이 필요합니다.</p>;
  return (
    <div style={{ width: '100%', height: 220 }}>
      <ResponsiveContainer>
        <AreaChart data={points} stackOffset="expand" margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <XAxis dataKey="date" tickFormatter={(v) => shortDate(String(v))} tick={axis} tickLine={false} axisLine={false} minTickGap={48} />
          <YAxis tickFormatter={(v) => `${Math.round(Number(v) * 100)}%`} tick={axis} tickLine={false} axisLine={false} width={40} />
          <Tooltip
            formatter={(v, name) => [pct(Number(v), 1, false), keys.find((k) => k.key === String(name))?.label ?? String(name)]}
            contentStyle={{ borderRadius: 10, border: '1px solid var(--line)', background: 'var(--surface)', fontSize: 13 }}
          />
          {keys.map((k) => (
            <Area key={k.key} type="monotone" dataKey={k.key} stackId="1" stroke="var(--surface)" strokeWidth={1} fill={k.color} fillOpacity={1} isAnimationActive={false} />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
