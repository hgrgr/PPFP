'use client';

import { createReactBlockSpec } from '@blocknote/react';
import { createContext, useContext, useState } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CandleChart, type PriceMark } from '@/components/candle-chart';
import { parseChartData } from '@/domain/journal';

/** What the blocks inside one journal body know about the entry around them. */
export interface JournalBlockContext {
  symbol: string | null;
  currency: string;
  marks: PriceMark[];
}

export const BlockContext = createContext<JournalBlockContext>({ symbol: null, currency: 'KRW', marks: [] });

const COLORS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)', 'var(--series-6)', 'var(--series-7)', 'var(--series-8)'];
const axis = { fontSize: 11.5, fill: 'var(--muted)' };
const tipStyle = { borderRadius: 10, border: '1px solid var(--line)', background: 'var(--surface)', fontSize: 13 };
const KINDS = [
  ['bar', '막대'],
  ['line', '선'],
  ['area', '영역'],
  ['pie', '원형'],
] as const;

export const SAMPLE_CHART = '분기,매출,영업이익\n1Q,120,12\n2Q,150,18\n3Q,140,15\n4Q,180,24';

function ChartView({ kind, data }: { kind: string; data: string }) {
  const { series, rows } = parseChartData(data);
  if (!series.length || !rows.length) return <p className="empty">첫 줄에 항목 이름, 다음 줄부터 값을 넣으면 그래프가 그려집니다.</p>;
  const lines = series.map((s, i) => ({ key: s, color: COLORS[i % COLORS.length] }));
  return (
    <div style={{ width: '100%', height: 240 }}>
      <ResponsiveContainer>
        {kind === 'pie' ? (
          <PieChart>
            <Pie data={rows} dataKey={series[0]} nameKey="label" innerRadius={50} outerRadius={90} stroke="var(--surface)" strokeWidth={2} isAnimationActive={false} label={{ fontSize: 12, fill: 'var(--ink-2)' }}>
              {rows.map((r, i) => (
                <Cell key={String(r.label) + i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip contentStyle={tipStyle} />
          </PieChart>
        ) : kind === 'line' ? (
          <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--line-soft)" vertical={false} />
            <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={false} />
            <YAxis tick={axis} tickLine={false} axisLine={false} width={56} />
            <Tooltip contentStyle={tipStyle} />
            {lines.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
            {lines.map((l) => <Line key={l.key} dataKey={l.key} stroke={l.color} strokeWidth={2} dot={false} isAnimationActive={false} />)}
          </LineChart>
        ) : kind === 'area' ? (
          <AreaChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--line-soft)" vertical={false} />
            <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={false} />
            <YAxis tick={axis} tickLine={false} axisLine={false} width={56} />
            <Tooltip contentStyle={tipStyle} />
            {lines.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
            {lines.map((l) => <Area key={l.key} dataKey={l.key} stroke={l.color} fill={l.color} fillOpacity={0.15} isAnimationActive={false} />)}
          </AreaChart>
        ) : (
          <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--line-soft)" vertical={false} />
            <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={false} />
            <YAxis tick={axis} tickLine={false} axisLine={false} width={56} />
            <Tooltip contentStyle={tipStyle} cursor={{ fill: 'var(--line-soft)' }} />
            {lines.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
            {lines.map((l) => <Bar key={l.key} dataKey={l.key} fill={l.color} radius={[3, 3, 0, 0]} isAnimationActive={false} />)}
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

/** Keys typed in the block's own inputs must not reach the editor (Enter would split the block). */
const keep = { onKeyDown: (e: React.KeyboardEvent) => e.stopPropagation(), onPaste: (e: React.ClipboardEvent) => e.stopPropagation() };

export const ChartBlock = createReactBlockSpec(
  {
    type: 'chart',
    propSchema: {
      kind: { default: 'bar', values: ['bar', 'line', 'area', 'pie'] },
      title: { default: '' },
      data: { default: SAMPLE_CHART },
    },
    content: 'none',
  },
  {
    render: ({ block, editor }) => {
      const [open, setOpen] = useState(false);
      const { kind, title, data } = block.props;
      const set = (props: Partial<typeof block.props>) => editor.updateBlock(block, { props });
      const editable = editor.isEditable;
      return (
        <figure className="jb-chart" contentEditable={false}>
          <div className="spread">
            {editable ? (
              <input className="jb-title" value={title} placeholder="그래프 제목" onChange={(e) => set({ title: e.target.value })} {...keep} />
            ) : (
              title && <figcaption className="strong">{title}</figcaption>
            )}
            {editable && (
              <div className="inline" style={{ gap: 6 }}>
                <div className="seg" role="group" aria-label="그래프 종류">
                  {KINDS.map(([k, label]) => (
                    <button key={k} type="button" aria-pressed={kind === k} onClick={() => set({ kind: k })}>
                      {label}
                    </button>
                  ))}
                </div>
                <button type="button" className="btn small" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
                  {open ? '데이터 닫기' : '데이터 편집'}
                </button>
              </div>
            )}
          </div>
          {open && editable && (
            <label className="field">
              <span className="sub">첫 줄은 항목 이름, 다음 줄부터 값. 쉼표나 탭으로 나눕니다. 엑셀에서 복사해 붙여넣어도 됩니다.</span>
              <textarea value={data} rows={6} spellCheck={false} style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13 }} onChange={(e) => set({ data: e.target.value })} {...keep} />
            </label>
          )}
          <ChartView kind={kind} data={data} />
        </figure>
      );
    },
  },
);

export const StockChartBlock = createReactBlockSpec(
  {
    type: 'stockChart',
    propSchema: {
      /** Empty: the entry's own asset. */
      symbol: { default: '' },
    },
    content: 'none',
  },
  {
    render: ({ block }) => {
      const ctx = useContext(BlockContext);
      const symbol = block.props.symbol || ctx.symbol;
      return (
        <div className="jb-stock" contentEditable={false}>
          {symbol ? (
            <>
              <div className="sub" style={{ marginBottom: 6 }}>
                {symbol} 시세 차트 {ctx.marks.length ? '· 점선은 이 일지의 ' + ctx.marks.map((m) => m.label).join('·') : ''}
              </div>
              <CandleChart symbol={symbol} currency={ctx.currency} prevClose={null} paused marks={block.props.symbol ? [] : ctx.marks} />
            </>
          ) : (
            <p className="empty">상장 종목을 고르면 시세 차트가 여기에 나옵니다.</p>
          )}
        </div>
      );
    },
  },
);
