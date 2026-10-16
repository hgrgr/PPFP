'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { FinancialTable } from '@/domain/sec';
import { dcf, ddm, reverseDcf, rim, sensitivity, TRADE_CODE, median, type Fundamentals, type InsiderTrade, type Multiples } from '@/domain/valuation';

interface StockView {
  market: 'US' | 'KR';
  currency: 'USD' | 'KRW';
  ticker: string;
  company: string;
  sector: string | null;
  industry: string | null;
  price: number | null;
  priceDate: string | null;
  fundamentals: Fundamentals;
  multiples: Multiples | null;
  annual: FinancialTable;
  quarterly: FinancialTable;
  prices: { date: string; close: number }[];
  saved: { id: string; method: string; value: number; price: number | null; inputs: Record<string, number>; note: string; createdAt: string }[];
}
interface PeersView {
  basis: string;
  rows: { ticker: string; name: string; self: boolean; multiples: Multiples | null; asOf: string | null }[];
}
interface InsiderView {
  trades: (InsiderTrade & { accession: string; url: string })[];
  months: { month: string; buy: number; sell: number }[];
  filings: number;
}

const TABS = [
  { key: 'fin', label: '재무제표' },
  { key: 'peers', label: '동종 비교' },
  { key: 'insider', label: '내부자 거래' },
  { key: 'value', label: '적정가 계산' },
] as const;
type Tab = (typeof TABS)[number]['key'];

/**
 * The currency of the stock on screen. Set once per render from the view (US stocks in dollars,
 * Korean ones in won) so every number on the page follows it.
 */
let CCY: 'USD' | 'KRW' = 'USD';
const usd = (v: number | null | undefined, d = 1) => {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  const s = a >= 1e12 ? `${(a / 1e12).toFixed(d)}조` : a >= 1e8 ? `${(a / 1e8).toLocaleString('ko-KR', { maximumFractionDigits: d })}억` : a >= 1e4 ? `${Math.round(a / 1e4).toLocaleString('ko-KR')}만` : a.toLocaleString('ko-KR', { maximumFractionDigits: 2 });
  return CCY === 'KRW' ? `${v < 0 ? '−' : ''}${s}원` : `${v < 0 ? '−' : ''}$${s}`;
};
const px = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : CCY === 'KRW' ? `${Math.round(v).toLocaleString('ko-KR')}원` : `$${v.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`);
const pct = (v: number | null | undefined, d = 1) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(d)}%`);
const signed = (v: number | null | undefined, d = 1) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${(v * 100).toFixed(d)}%`);
const x = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${v.toFixed(1)}배`);

function useView<T>(url: string | null, bump = 0): { data: T | null; error: string | null } {
  const [state, setState] = useState<{ key: string | null; data: T | null; error: string | null }>({ key: null, data: null, error: null });
  const key = url ? `${url}#${bump}` : null;
  useEffect(() => {
    if (!url) return;
    let live = true;
    fetch(url, { cache: 'no-store' })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? '불러오지 못했습니다.');
        if (live) setState({ key, data: j as T, error: null });
      })
      .catch((e) => live && setState({ key, data: null, error: e instanceof Error ? e.message : '불러오지 못했습니다.' }));
    return () => {
      live = false;
    };
  }, [url, key]);
  return { data: state.key === key ? state.data : null, error: state.key === key ? state.error : null };
}

export function StockAnalysis({ quick }: { quick: { ticker: string; name: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const t = (sp.get('t') ?? '').toUpperCase();
  const tab = (TABS.some((x) => x.key === sp.get('tab')) ? sp.get('tab') : 'fin') as Tab;
  const [input, setInput] = useState(t);
  const [bump, setBump] = useState(0);
  const go = (q: Record<string, string>) => {
    const n = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(q)) n.set(k, v);
    router.replace(`${pathname}?${n.toString()}`, { scroll: false });
  };
  const { data, error } = useView<StockView>(t ? `/api/stocks?view=stock&t=${encodeURIComponent(t)}` : null, bump);
  if (data) CCY = data.currency;
  const kr = data?.market === 'KR';
  const tabs = TABS.map((x) => (x.key === 'insider' && kr ? { ...x, label: '공시 · 내부자' } : x)).filter((x) => !(x.key === 'peers' && kr));
  return (
    <div className="stack" style={{ gap: 16 }}>
      <section className="card stack" style={{ gap: 12 }} aria-label="종목 고르기">
        <form
          className="inline"
          style={{ gap: 8 }}
          onSubmit={(e) => {
            e.preventDefault();
            if (input.trim()) go({ t: input.trim().toUpperCase() });
          }}
        >
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="티커·종목코드·회사명 (AAPL, 005930, 삼성전자)" aria-label="티커" style={{ maxWidth: 260 }} />
          <button type="submit" className="btn">보기</button>
          {quick.map((q) => (
            <button key={q.ticker} type="button" className="chip-btn" aria-pressed={q.ticker === t} onClick={() => { setInput(q.ticker); go({ t: q.ticker }); }} title={q.name}>
              {q.ticker}
            </button>
          ))}
        </form>
        {t && (
          <div className="seg" role="tablist" aria-label="화면">
            {tabs.map((x) => (
              <button key={x.key} type="button" role="tab" aria-selected={tab === x.key} aria-pressed={tab === x.key} onClick={() => go({ tab: x.key })}>
                {x.label}
              </button>
            ))}
          </div>
        )}
      </section>
      {!t ? (
        <p className="empty">미국 종목은 티커(SEC 공시), 한국 종목은 종목코드 6자리나 회사명(OpenDART 공시)을 넣으세요.</p>
      ) : error ? (
        <p className="msg err">{error}</p>
      ) : !data ? (
        <p className="empty">불러오는 중… 공시 재무 자료를 받느라 처음에는 몇 초(한국 종목은 보고서 열두 개를 받느라 10~20초) 걸립니다.</p>
      ) : (
        <>
          <Header d={data} />
          {tab === 'fin' || (tab === 'peers' && kr) ? <Financials d={data} /> : tab === 'peers' ? <Peers ticker={data.ticker} /> : tab === 'insider' ? (kr ? <KrFilings ticker={data.ticker} /> : <Insider ticker={data.ticker} />) : <Valuation d={data} onSaved={() => setBump((b) => b + 1)} />}
        </>
      )}
    </div>
  );
}

function Header({ d }: { d: StockView }) {
  const m = d.multiples;
  return (
    <section className="card stack" style={{ gap: 12 }} aria-label="종목 요약">
      <div className="inline spread" style={{ gap: 8, flexWrap: 'wrap' }}>
        <div className="stack" style={{ gap: 4 }}>
          <h2 style={{ margin: 0 }}>
            {d.company} <span className="sub" style={{ fontSize: 14 }}>{d.ticker}</span>
          </h2>
          <span className="sub">
            {d.market === 'KR' ? '한국 상장 · OpenDART' : [d.sector, d.industry].filter(Boolean).join(' · ') || 'S&P 500 밖'} · 재무 {d.fundamentals.asOf ?? '—'} 기준 · <Link href={`/market?s=${encodeURIComponent(d.ticker)}`}>실시간 시세 ›</Link>
          </span>
        </div>
        <div className="stack" style={{ gap: 2, alignItems: 'flex-end' }}>
          <b style={{ fontSize: 24 }}>{px(d.price)}</b>
          <span className="sub">{d.priceDate} 종가</span>
        </div>
      </div>
      <div className="gu-kpis">
        {[
          ['시가총액', usd(m?.marketCap)],
          ['PER', x(m?.pe)],
          ['PSR', x(m?.ps)],
          ['PBR', x(m?.pb)],
          ['EV/EBIT', x(m?.evEbit)],
          ['FCF 수익률', pct(m?.fcfYield)],
          ['배당수익률', pct(m?.dividendYield, 2)],
          ['ROE', pct(m?.roe)],
          ['영업이익률', pct(m?.operatingMargin)],
          ['매출 3년 성장', signed(m?.revenueCagr)],
        ].map(([l, v]) => (
          <div key={l} className="kpi stack" style={{ gap: 2 }}>
            <span className="label">{l}</span>
            <span className="value">{v}</span>
          </div>
        ))}
      </div>
      <p className="sub" style={{ margin: 0 }}>최근 4분기 합(분기 자료가 없으면 최근 연도) 기준입니다. 주식 수는 {d.market === 'KR' ? '유통주식수(발행 − 자기주식)' : '희석 가중평균'}, 순이익이 적자면 PER은 비웁니다.</p>
    </section>
  );
}

// ------------------------------------------------------------------ statements

function Financials({ d }: { d: StockView }) {
  // Companies that file only quarterly XBRL (or are new) have no full years yet
  const [period, setPeriod] = useState<'annual' | 'quarterly'>(d.annual.periods.length ? 'annual' : 'quarterly');
  const table = period === 'annual' ? d.annual : d.quarterly;
  const get = (k: string) => table.rows.find((r) => r.key === k);
  const chart = [...table.periods]
    .map((p, i) => ({ label: p.label, 매출: get('revenue')?.values[i] ?? null, 영업이익: get('operatingIncome')?.values[i] ?? null, 순이익: get('netIncome')?.values[i] ?? null, 영업이익률: table.margins.operating[i], 순이익률: table.margins.net[i] }))
    .reverse();
  const perShare = (key: string) => key === 'epsDiluted';
  const shares = (key: string) => key === 'dilutedShares';
  return (
    <div className="stack" style={{ gap: 16 }}>
      <section className="card indicator" aria-label="실적 추이">
        <div className="inline spread" style={{ gap: 8, flexWrap: 'wrap' }}>
          <div className="stack" style={{ gap: 4 }}>
            <h3>실적 추이</h3>
            <span className="sub">막대는 매출·영업이익·순이익, 선은 이익률(오른쪽 축). 회계연도가 달력과 다른 회사는 대부분 걸친 달력 기간에 둡니다.</span>
          </div>
          <div className="seg" role="group" aria-label="기간 단위">
            <button type="button" aria-current={period === 'annual' ? 'true' : undefined} onClick={() => setPeriod('annual')}>연간</button>
            <button type="button" aria-current={period === 'quarterly' ? 'true' : undefined} onClick={() => setPeriod('quarterly')}>분기</button>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart data={chart} margin={{ left: 0, right: 0, top: 8, bottom: 4 }}>
            <CartesianGrid stroke="var(--line-soft)" vertical={false} />
            <XAxis dataKey="label" stroke="var(--muted)" fontSize={11} />
            <YAxis yAxisId="l" tickFormatter={(v: number) => usd(v, 0)} stroke="var(--muted)" fontSize={11} width={70} />
            <YAxis yAxisId="r" orientation="right" tickFormatter={(v: number) => `${v}%`} stroke="var(--muted)" fontSize={11} width={44} />
            <Tooltip formatter={(v, n) => (String(n).endsWith('률') ? `${Number(v).toFixed(1)}%` : usd(Number(v), 2))} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)' }} />
            <Legend />
            <Bar yAxisId="l" dataKey="매출" fill="var(--series-1)" animationDuration={700} />
            <Bar yAxisId="l" dataKey="영업이익" fill="var(--series-2)" animationDuration={700} />
            <Bar yAxisId="l" dataKey="순이익" fill="var(--series-3)" animationDuration={700} />
            <Line yAxisId="r" dataKey="영업이익률" stroke="var(--series-4)" strokeWidth={2} dot={{ r: 2.5 }} animationDuration={700} />
            <Line yAxisId="r" dataKey="순이익률" stroke="var(--series-5)" strokeWidth={2} dot={{ r: 2.5 }} animationDuration={700} />
          </ComposedChart>
        </ResponsiveContainer>
      </section>
      <section className="card indicator" aria-label="재무제표">
        <div className="stack" style={{ gap: 4 }}>
          <h3>재무제표 ({period === 'annual' ? '연간' : '분기'})</h3>
          <span className="sub">{d.market === 'KR' ? 'OpenDART 연결재무제표(없으면 별도). 4분기와 분기 현금흐름은 연간·누적에서 앞 분기를 뺀 값' : 'SEC XBRL 자료'}. 괄호는 1년 전 대비 증감. {table.latestFiling ? `최신 반영 보고서: ${table.latestFiling.form} (${table.latestFiling.filed})` : ''}</span>
        </div>
        <div className="table-wrap">
          <table className="rank">
            <thead>
              <tr>
                <th className="l">항목</th>
                {table.periods.map((p) => (
                  <th key={p.key} className="num">{p.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r) => (
                <tr key={r.key}>
                  <th scope="row" className="l">{r.label}</th>
                  {r.values.map((v, i) => (
                    <td key={i} className="num">
                      {v === null ? '—' : perShare(r.key) ? px(v) : shares(r.key) ? `${(v / 1e6).toLocaleString('ko-KR', { maximumFractionDigits: 0 })}백만` : usd(v)}
                      {r.yoy[i] !== null && <span className={`sub ${r.yoy[i]! >= 0 ? 'up' : 'down'}`} style={{ display: 'block', fontSize: 11 }}>({r.yoy[i]! > 0 ? '+' : ''}{r.yoy[i]}%)</span>}
                    </td>
                  ))}
                </tr>
              ))}
              {(['gross', 'operating', 'net'] as const).map((k) => (
                <tr key={k}>
                  <th scope="row" className="l sub">{{ gross: '매출총이익률', operating: '영업이익률', net: '순이익률' }[k]}</th>
                  {table.margins[k].map((v, i) => (
                    <td key={i} className="num sub">{v === null ? '—' : `${v}%`}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ peers

const PEER_COLS: { key: keyof Multiples; label: string; fmt: (v: number | null) => string; low?: boolean }[] = [
  { key: 'marketCap', label: '시가총액', fmt: (v) => usd(v) },
  { key: 'pe', label: 'PER', fmt: x, low: true },
  { key: 'ps', label: 'PSR', fmt: x, low: true },
  { key: 'pb', label: 'PBR', fmt: x, low: true },
  { key: 'evEbit', label: 'EV/EBIT', fmt: x, low: true },
  { key: 'fcfYield', label: 'FCF 수익률', fmt: (v) => pct(v) },
  { key: 'dividendYield', label: '배당수익률', fmt: (v) => pct(v, 2) },
  { key: 'roe', label: 'ROE', fmt: (v) => pct(v) },
  { key: 'operatingMargin', label: '영업이익률', fmt: (v) => pct(v) },
  { key: 'revenueCagr', label: '매출 3년 성장', fmt: (v) => signed(v) },
];

function Peers({ ticker }: { ticker: string }) {
  const { data, error } = useView<PeersView>(`/api/stocks?view=peers&t=${encodeURIComponent(ticker)}`);
  const [col, setCol] = useState<keyof Multiples>('pe');
  if (error) return <p className="msg err">{error}</p>;
  if (!data) return <p className="empty">불러오는 중… 같은 산업 회사들의 재무 자료를 받느라 10~20초 걸릴 수 있습니다.</p>;
  const c = PEER_COLS.find((p) => p.key === col)!;
  const bars = data.rows.map((r) => ({ ticker: r.ticker, self: r.self, v: (r.multiples?.[col] as number | null) ?? null })).filter((b) => b.v !== null);
  const med = median(data.rows.filter((r) => !r.self).map((r) => (r.multiples?.[col] as number | null) ?? null));
  return (
    <div className="stack" style={{ gap: 16 }}>
      <section className="card indicator" aria-label="동종 비교 표">
        <div className="stack" style={{ gap: 4 }}>
          <h3>동종 비교 ({data.basis})</h3>
          <span className="sub">같은 GICS 산업의 S&P 500 종목 가운데 시가총액이 큰 6곳(같은 산업이 3곳 미만이면 같은 섹터). 머리글을 누르면 아래 그래프로 비교합니다. 맨 아래 줄은 비교 대상의 중앙값입니다.</span>
        </div>
        <div className="table-wrap">
          <table className="rank">
            <thead>
              <tr>
                <th className="l">종목</th>
                {PEER_COLS.map((p) => (
                  <th key={p.key} className="num">
                    <button type="button" className="linklike" aria-pressed={col === p.key} onClick={() => setCol(p.key)} style={{ fontWeight: col === p.key ? 700 : undefined }}>{p.label}</button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.ticker} style={r.self ? { background: 'var(--surface-2)', fontWeight: 600 } : undefined}>
                  <th scope="row" className="l">
                    {r.self ? r.ticker : <Link href={`/stocks?t=${encodeURIComponent(r.ticker)}&tab=peers`}>{r.ticker}</Link>}
                    <span className="sub" style={{ display: 'block', fontWeight: 400 }}>{r.name}</span>
                  </th>
                  {PEER_COLS.map((p) => (
                    <td key={p.key} className="num">{p.fmt((r.multiples?.[p.key] as number | null) ?? null)}</td>
                  ))}
                </tr>
              ))}
              <tr>
                <th scope="row" className="l sub">비교 대상 중앙값</th>
                {PEER_COLS.map((p) => (
                  <td key={p.key} className="num sub">{p.fmt(median(data.rows.filter((r) => !r.self).map((r) => (r.multiples?.[p.key] as number | null) ?? null)))}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </section>
      <section className="card indicator" aria-label="동종 비교 그래프">
        <div className="stack" style={{ gap: 4 }}>
          <h3>{c.label} 비교</h3>
          <span className="sub">진한 막대가 이 종목, 점선이 비교 대상 중앙값({c.fmt(med)}).{c.low ? ' 낮을수록 싸게 평가받는 지표입니다.' : ''}</span>
        </div>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={bars} margin={{ left: 0, right: 12, top: 8, bottom: 4 }}>
            <CartesianGrid stroke="var(--line-soft)" vertical={false} />
            <XAxis dataKey="ticker" stroke="var(--muted)" fontSize={12} />
            <YAxis tickFormatter={(v: number) => c.fmt(v)} stroke="var(--muted)" fontSize={11} width={64} />
            <Tooltip formatter={(v) => c.fmt(Number(v))} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)' }} />
            {med !== null && <ReferenceLine y={med} stroke="var(--ink-2)" strokeDasharray="4 3" />}
            <Bar dataKey="v" name={c.label} animationDuration={500}>
              {bars.map((b) => (
                <Cell key={b.ticker} fill={b.self ? 'var(--series-1)' : 'color-mix(in srgb, var(--series-1) 35%, var(--surface))'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ insiders

function Insider({ ticker }: { ticker: string }) {
  const { data, error } = useView<InsiderView>(`/api/stocks?view=insider&t=${encodeURIComponent(ticker)}`);
  const [all, setAll] = useState(false);
  if (error) return <p className="msg err">{error}</p>;
  if (!data) return <p className="empty">불러오는 중… 처음에는 최근 Form 4 보고서 40건을 받느라 10초쯤 걸립니다.</p>;
  const shown = all ? data.trades : data.trades.filter((t) => t.code === 'P' || t.code === 'S');
  return (
    <div className="stack" style={{ gap: 16 }}>
      <section className="card indicator" aria-label="내부자 순매수">
        <div className="stack" style={{ gap: 4 }}>
          <h3>내부자 장내 매수 · 매도 (월별)</h3>
          <span className="sub">임원·이사·10% 주주가 SEC에 낸 최근 Form 4 {data.filings}건 가운데 장내 매수(P)와 매도(S)의 금액입니다. 보상으로 받은 주식이나 세금 납부용 처분은 빠집니다.</span>
        </div>
        {data.months.length ? (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data.months} stackOffset="sign" margin={{ left: 0, right: 12, top: 8, bottom: 4 }}>
              <CartesianGrid stroke="var(--line-soft)" vertical={false} />
              <XAxis dataKey="month" tickFormatter={(v: string) => v.slice(2).replace('-', '.')} stroke="var(--muted)" fontSize={11} />
              <YAxis tickFormatter={(v: number) => usd(v, 0)} stroke="var(--muted)" fontSize={11} width={70} />
              <Tooltip formatter={(v) => usd(Number(v), 2)} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)' }} />
              <ReferenceLine y={0} stroke="var(--muted)" />
              <Bar dataKey="buy" name="매수" stackId="a" fill="var(--up)" animationDuration={600} />
              <Bar dataKey="sell" name="매도" stackId="a" fill="var(--down)" animationDuration={600} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <p className="empty">최근 보고서에 장내 매수·매도가 없습니다.</p>
        )}
      </section>
      <section className="card indicator" aria-label="내부자 거래">
        <div className="inline spread" style={{ gap: 8, flexWrap: 'wrap' }}>
          <div className="stack" style={{ gap: 4 }}>
            <h3>거래 내역</h3>
            <span className="sub">최근 순. 날짜를 누르면 SEC 원문을 엽니다.</span>
          </div>
          <div className="seg" role="group" aria-label="거래 종류">
            <button type="button" aria-current={!all ? 'true' : undefined} onClick={() => setAll(false)}>장내 매수·매도</button>
            <button type="button" aria-current={all ? 'true' : undefined} onClick={() => setAll(true)}>전체</button>
          </div>
        </div>
        <div className="table-wrap">
          <table className="rank">
            <thead>
              <tr>
                <th className="l">거래일</th>
                <th className="l">이름</th>
                <th className="l">직책</th>
                <th className="l">종류</th>
                <th className="num">주식 수</th>
                <th className="num">가격</th>
                <th className="num">금액</th>
                <th className="num">거래 후 보유</th>
              </tr>
            </thead>
            <tbody>
              {shown.slice(0, 80).map((t, i) => (
                <tr key={`${t.accession}-${i}`}>
                  <td className="l"><a href={t.url} target="_blank" rel="noreferrer">{t.date}</a></td>
                  <td className="l">{t.owner}</td>
                  <td className="l sub">{t.role}</td>
                  <td className={`l ${t.code === 'P' ? 'up' : t.code === 'S' ? 'down' : 'sub'}`}>{TRADE_CODE[t.code] ?? t.code}</td>
                  <td className="num">{(t.sign * t.shares).toLocaleString('ko-KR')}</td>
                  <td className="num">{px(t.price)}</td>
                  <td className="num">{t.price ? usd(t.shares * t.price) : '—'}</td>
                  <td className="num">{t.after?.toLocaleString('ko-KR') ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!shown.length && <p className="empty">해당하는 거래가 없습니다.</p>}
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ fair value

type Method = 'DCF' | 'REVERSE_DCF' | 'DDM' | 'RIM';
const METHOD_LABEL: Record<Method, string> = { DCF: 'DCF (현금흐름 할인)', REVERSE_DCF: '역DCF (주가에 담긴 성장률)', DDM: 'DDM (배당 할인)', RIM: 'RIM (잔여이익)' };
interface Field {
  key: string;
  label: string;
  unit: '%' | '$' | '년' | '주' | '';
  about?: string;
}
const FIELDS: Record<Method, Field[]> = {
  DCF: [
    { key: 'fcf', label: '최근 12개월 잉여현금흐름', unit: '$', about: '영업현금흐름 − 설비투자' },
    { key: 'growth', label: '1단계 성장률 (연)', unit: '%' },
    { key: 'years', label: '1단계 기간', unit: '년' },
    { key: 'terminal', label: '영구 성장률', unit: '%' },
    { key: 'discount', label: '할인율', unit: '%' },
    { key: 'netCash', label: '순현금 (현금 − 차입금)', unit: '$' },
    { key: 'shares', label: '주식 수', unit: '주' },
  ],
  REVERSE_DCF: [
    { key: 'fcf', label: '최근 12개월 잉여현금흐름', unit: '$' },
    { key: 'years', label: '1단계 기간', unit: '년' },
    { key: 'terminal', label: '영구 성장률', unit: '%' },
    { key: 'discount', label: '할인율', unit: '%' },
    { key: 'netCash', label: '순현금', unit: '$' },
    { key: 'shares', label: '주식 수', unit: '주' },
  ],
  DDM: [
    { key: 'dps', label: '주당 배당 (최근 12개월)', unit: '$' },
    { key: 'growth', label: '1단계 배당 성장률', unit: '%' },
    { key: 'years', label: '1단계 기간', unit: '년' },
    { key: 'terminal', label: '영구 성장률', unit: '%' },
    { key: 'discount', label: '요구수익률', unit: '%' },
  ],
  RIM: [
    { key: 'bps', label: '주당 순자산', unit: '$' },
    { key: 'roe', label: 'ROE', unit: '%' },
    { key: 'payout', label: '배당성향', unit: '%' },
    { key: 'discount', label: '요구수익률 (자기자본비용)', unit: '%' },
    { key: 'years', label: '초과이익 지속 기간', unit: '년' },
    { key: 'persistence', label: '이후 초과이익 유지율 (연)', unit: '%' },
  ],
};
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round = (v: number, d = 4) => Number(v.toFixed(d));

function defaults(f: Fundamentals): Record<string, number> {
  const shares = f.shares ?? 0;
  const fcf = (f.operatingCashFlow ?? 0) - Math.abs(f.capex ?? 0);
  const g = f.revenueCagr !== null ? clamp(f.revenueCagr, -0.05, 0.25) : 0.08;
  const div = Math.abs(f.dividends ?? 0);
  return {
    fcf: Math.round(fcf),
    growth: round(g),
    years: 10,
    terminal: 0.025,
    discount: 0.09,
    netCash: Math.round((f.cash ?? 0) - (f.debt ?? 0)),
    shares: Math.round(shares),
    dps: shares ? round(div / shares, 4) : 0,
    bps: shares && f.equity ? round(f.equity / shares, 2) : 0,
    roe: f.netIncome !== null && f.equity ? round(clamp(f.netIncome / f.equity, -0.5, 0.6)) : 0.12,
    payout: f.netIncome && f.netIncome > 0 ? round(clamp(div / f.netIncome, 0, 1)) : 0,
    persistence: 0.6,
  };
}

function Valuation({ d, onSaved }: { d: StockView; onSaved: () => void }) {
  const [method, setMethod] = useState<Method>('DCF');
  const [v, setV] = useState<Record<string, number>>(() => defaults(d.fundamentals));
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const price = d.price;
  const result = useMemo(() => {
    const ddmYears = method === 'DDM' ? Math.min(v.years, 15) : v.years;
    if (method === 'DCF') {
      const r = dcf({ fcf: v.fcf, growth: v.growth, years: v.years, terminal: v.terminal, discount: v.discount, netCash: v.netCash, shares: v.shares });
      return { value: r.perShare, dcf: r };
    }
    if (method === 'REVERSE_DCF') return { value: price ? reverseDcf(price, { fcf: v.fcf, years: v.years, terminal: v.terminal, discount: v.discount, netCash: v.netCash, shares: v.shares }) : null };
    if (method === 'DDM') return { value: ddm({ dps: v.dps, growth: v.growth, years: ddmYears, terminal: v.terminal, discount: v.discount }) };
    return { value: rim({ bps: v.bps, roe: v.roe, payout: v.payout, discount: v.discount, years: v.years, persistence: v.persistence })?.perShare ?? null };
  }, [method, v, price]);
  const grid = method === 'DCF' ? sensitivity({ fcf: v.fcf, growth: v.growth, years: v.years, terminal: v.terminal, discount: v.discount, netCash: v.netCash, shares: v.shares }, [-0.02, -0.01, 0, 0.01, 0.02].map((k) => v.discount + k), [-0.04, -0.02, 0, 0.02, 0.04].map((k) => v.growth + k)) : null;
  const upside = method !== 'REVERSE_DCF' && result.value !== null && price ? result.value / price - 1 : null;
  const set = (k: string, raw: string, unit: Field['unit']) => {
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    setV((o) => ({ ...o, [k]: unit === '%' ? n / 100 : n }));
  };
  const save = async () => {
    setMsg(null);
    if (result.value === null) return;
    const keys = FIELDS[method].map((f) => f.key);
    const r = await fetch('/api/stocks/valuations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ symbol: d.ticker, method, inputs: Object.fromEntries(keys.map((k) => [k, v[k]])), value: result.value, price, note }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) setMsg(j.error ?? '저장하지 못했습니다.');
    else {
      setMsg('저장했습니다.');
      setNote('');
      onSaved();
    }
  };
  const remove = async (id: string) => {
    await fetch(`/api/stocks/valuations?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    onSaved();
  };
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="ind-grid">
        <section className="card indicator" aria-label="평가 입력">
          <div className="stack" style={{ gap: 4 }}>
            <h3>적정가 계산</h3>
            <span className="sub">입력값은 최근 재무로 채워 두었습니다(성장률은 매출 3년 연평균, −5%~25%로 자름). 고치면 바로 다시 계산합니다.</span>
          </div>
          <div className="seg" role="group" aria-label="평가 방법" style={{ flexWrap: 'wrap' }}>
            {(Object.keys(METHOD_LABEL) as Method[]).map((m) => (
              <button key={m} type="button" aria-current={method === m ? 'true' : undefined} onClick={() => setMethod(m)}>{METHOD_LABEL[m]}</button>
            ))}
          </div>
          <div className="va-fields">
            {FIELDS[method].map((f) => (
              <label key={f.key} className="stack" style={{ gap: 4 }}>
                <span className="sub">{f.label}{f.unit && f.unit !== '주' ? ` (${f.unit === '$' ? (CCY === 'KRW' ? '원' : '달러') : f.unit})` : ''}</span>
                <input type="number" step="any" value={f.unit === '%' ? round(v[f.key] * 100, 2) : v[f.key]} onChange={(e) => set(f.key, e.target.value, f.unit)} aria-label={f.label} />
                {f.unit === '$' && <span className="sub" style={{ fontSize: 11 }}>{usd(v[f.key], 2)}{f.about ? ` · ${f.about}` : ''}</span>}
              </label>
            ))}
          </div>
          <button type="button" className="btn small" style={{ alignSelf: 'flex-start' }} onClick={() => setV(defaults(d.fundamentals))}>최근 재무로 되돌리기</button>
        </section>
        <section className="card indicator" aria-label="평가 결과">
          <div className="stack" style={{ gap: 4 }}>
            <h3>{METHOD_LABEL[method]}</h3>
            <span className="sub">{method === 'REVERSE_DCF' ? '지금 주가가 정당하려면 앞으로 몇 년 동안 잉여현금흐름이 해마다 얼마나 늘어야 하는지 거꾸로 풉니다.' : '주당 적정가와 지금 주가의 차이입니다. 입력이 조금만 바뀌어도 크게 달라지니 아래 민감도 표와 함께 보세요.'}</span>
          </div>
          <div className="gu-kpis">
            <div className="kpi stack" style={{ gap: 2 }}>
              <span className="label">{method === 'REVERSE_DCF' ? '주가에 담긴 성장률' : '주당 적정가'}</span>
              <span className="value" style={{ fontSize: 26 }}>{method === 'REVERSE_DCF' ? pct(result.value) : px(result.value)}</span>
            </div>
            <div className="kpi stack" style={{ gap: 2 }}>
              <span className="label">지금 주가</span>
              <span className="value">{px(price)}</span>
            </div>
            {method !== 'REVERSE_DCF' && (
              <div className="kpi stack" style={{ gap: 2 }}>
                <span className="label">상승 여력</span>
                <span className={`value ${(upside ?? 0) >= 0 ? 'up' : 'down'}`}>{signed(upside)}</span>
              </div>
            )}
            {result.dcf && (
              <div className="kpi stack" style={{ gap: 2 }}>
                <span className="label">영구가치 비중</span>
                <span className="value">{pct(result.dcf.terminalShare, 0)}</span>
              </div>
            )}
          </div>
          {result.value === null && <p className="callout">계산할 수 없습니다. {method === 'DDM' ? '배당이 없거나 ' : ''}할인율이 영구 성장률보다 커야 하고, 역DCF는 −50%~100% 안의 성장률로 주가를 설명할 수 있어야 합니다.</p>}
          {result.dcf && (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={result.dcf.flows} margin={{ left: 0, right: 8, top: 8, bottom: 4 }}>
                <CartesianGrid stroke="var(--line-soft)" vertical={false} />
                <XAxis dataKey="year" tickFormatter={(y: number) => `${y}년`} stroke="var(--muted)" fontSize={11} />
                <YAxis tickFormatter={(v: number) => usd(v, 0)} stroke="var(--muted)" fontSize={11} width={64} />
                <Tooltip formatter={(v, n) => [usd(Number(v), 2), String(n)]} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)' }} />
                <Legend />
                <Bar dataKey="fcf" name="예상 잉여현금흐름" fill="color-mix(in srgb, var(--series-1) 40%, var(--surface))" animationDuration={500} />
                <Bar dataKey="pv" name="현재가치" fill="var(--series-1)" animationDuration={500} />
              </BarChart>
            </ResponsiveContainer>
          )}
          {grid && (
            <div className="table-wrap">
              <table className="rank va-grid">
                <thead>
                  <tr>
                    <th className="l sub">할인율 \ 성장률</th>
                    {[-0.04, -0.02, 0, 0.02, 0.04].map((k) => (
                      <th key={k} className="num">{pct(v.growth + k)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {grid.map((row, i) => (
                    <tr key={i}>
                      <th scope="row" className="l">{pct(v.discount + [-0.02, -0.01, 0, 0.01, 0.02][i])}</th>
                      {row.map((val, j) => {
                        const up = val !== null && price ? val / price - 1 : null;
                        return (
                          <td key={j} className="num" style={{ background: up === null ? undefined : `color-mix(in srgb, var(${up >= 0 ? '--up' : '--down'}) ${Math.round(Math.min(1, Math.abs(up)) * 60) + 8}%, var(--surface))`, fontWeight: i === 2 && j === 2 ? 700 : undefined }}>
                            {px(val)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="inline" style={{ gap: 8 }}>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="메모 (선택)" aria-label="메모" maxLength={300} style={{ flex: 1, minWidth: 160 }} />
            <button type="button" className="btn" disabled={result.value === null} onClick={save}>이 평가 저장</button>
          </div>
          {msg && <p className="sub" role="status">{msg}</p>}
        </section>
      </div>
      <section className="card indicator" aria-label="저장한 평가">
        <div className="stack" style={{ gap: 4 }}>
          <h3>저장한 평가 ({d.ticker})</h3>
          <span className="sub">저장할 때의 입력과 결과, 그때 주가가 남습니다. 나중에 지금 주가와 비교해 보세요.</span>
        </div>
        {d.saved.length ? (
          <table className="rank">
            <thead>
              <tr>
                <th className="l">저장일</th>
                <th className="l">방법</th>
                <th className="num">결과</th>
                <th className="num">그때 주가</th>
                <th className="num">지금 주가 대비</th>
                <th className="l">메모</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {d.saved.map((s) => (
                <tr key={s.id}>
                  <td className="l sub">{s.createdAt.slice(0, 10)}</td>
                  <td className="l">{METHOD_LABEL[s.method as Method] ?? s.method}</td>
                  <td className="num strong">{s.method === 'REVERSE_DCF' ? pct(s.value) : px(s.value)}</td>
                  <td className="num">{px(s.price)}</td>
                  <td className="num">{s.method !== 'REVERSE_DCF' && price ? signed(s.value / price - 1) : '—'}</td>
                  <td className="l sub">{s.note}</td>
                  <td className="num">
                    <button type="button" className="linklike" onClick={() => { setMethod(s.method as Method); setV((o) => ({ ...o, ...s.inputs })); }}>불러오기</button>
                    {' · '}
                    <button type="button" className="linklike" onClick={() => window.confirm('이 평가를 지울까요?') && remove(s.id)}>지우기</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="empty">저장한 평가가 없습니다.</p>
        )}
      </section>
      <p className="sub">모델 결과는 입력에 따라 크게 달라지는 참고치이며 투자 권유가 아닙니다.</p>
    </div>
  );
}

// ------------------------------------------------------------------ Korean filings

interface KrFilingsView {
  disclosures: { date: string; title: string; filer: string; url: string }[];
  insiders: { date: string; name: string; role: string; shares: number | null; change: number | null; ratio: number | null; ratioChange: number | null; url: string }[];
}

function KrFilings({ ticker }: { ticker: string }) {
  const { data, error } = useView<KrFilingsView>(`/api/stocks?view=insider&t=${encodeURIComponent(ticker)}`);
  const [kind, setKind] = useState<'all' | 'regular' | 'major'>('all');
  if (error) return <p className="msg err">{error}</p>;
  if (!data) return <p className="empty">불러오는 중…</p>;
  const shown = data.disclosures.filter((d) => kind === 'all' || (kind === 'regular' ? /사업보고서|분기보고서|반기보고서/.test(d.title) : /주요사항|단일판매|유상증자|무상증자|자기주식|합병|분할|최대주주|배당|잠정/.test(d.title)));
  const moves = data.insiders.filter((r) => r.change);
  return (
    <div className="stack" style={{ gap: 16 }}>
      <section className="card indicator" aria-label="임원·주요주주 소유">
        <div className="stack" style={{ gap: 4 }}>
          <h3>임원 · 주요주주 소유 변동</h3>
          <span className="sub">임원과 10% 이상 주주가 금융감독원에 낸 소유보고(최근 100건). 늘었으면 빨강, 줄었으면 파랑입니다. 날짜를 누르면 DART 원문을 엽니다.</span>
        </div>
        {moves.length ? (
          <div className="table-wrap">
            <table className="rank">
              <thead>
                <tr>
                  <th className="l">보고일</th>
                  <th className="l">이름</th>
                  <th className="l">직위 · 관계</th>
                  <th className="num">증감 (주)</th>
                  <th className="num">보유 (주)</th>
                  <th className="num">지분율</th>
                  <th className="num">지분율 증감</th>
                </tr>
              </thead>
              <tbody>
                {moves.map((r, i) => (
                  <tr key={`${r.url}-${i}`}>
                    <td className="l"><a href={r.url} target="_blank" rel="noreferrer">{r.date.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3')}</a></td>
                    <td className="l">{r.name}</td>
                    <td className="l sub">{r.role}</td>
                    <td className={`num ${(r.change ?? 0) >= 0 ? 'up' : 'down'}`}>{r.change === null ? '—' : `${r.change > 0 ? '+' : ''}${r.change.toLocaleString('ko-KR')}`}</td>
                    <td className="num">{r.shares?.toLocaleString('ko-KR') ?? '—'}</td>
                    <td className="num">{r.ratio === null ? '—' : `${r.ratio.toFixed(2)}%`}</td>
                    <td className="num">{r.ratioChange === null ? '—' : `${r.ratioChange > 0 ? '+' : ''}${r.ratioChange.toFixed(2)}%p`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty">최근 소유 변동 보고가 없습니다.</p>
        )}
      </section>
      <section className="card indicator" aria-label="공시 목록">
        <div className="inline spread" style={{ gap: 8, flexWrap: 'wrap' }}>
          <div className="stack" style={{ gap: 4 }}>
            <h3>최근 1년 공시</h3>
            <span className="sub">최근 순 {data.disclosures.length}건. 제목을 누르면 DART 원문을 엽니다.</span>
          </div>
          <div className="seg" role="group" aria-label="공시 종류">
            <button type="button" aria-current={kind === 'all' ? 'true' : undefined} onClick={() => setKind('all')}>전체</button>
            <button type="button" aria-current={kind === 'regular' ? 'true' : undefined} onClick={() => setKind('regular')}>정기보고서</button>
            <button type="button" aria-current={kind === 'major' ? 'true' : undefined} onClick={() => setKind('major')}>주요 공시</button>
          </div>
        </div>
        <div className="table-wrap">
          <table className="rank">
            <thead>
              <tr>
                <th className="l">접수일</th>
                <th className="l">제목</th>
                <th className="l">제출인</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((d, i) => (
                <tr key={`${d.url}-${i}`}>
                  <td className="l sub">{d.date}</td>
                  <td className="l"><a href={d.url} target="_blank" rel="noreferrer">{d.title}</a></td>
                  <td className="l sub">{d.filer}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!shown.length && <p className="empty">해당하는 공시가 없습니다.</p>}
      </section>
    </div>
  );
}
