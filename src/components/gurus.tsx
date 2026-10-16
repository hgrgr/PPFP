'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { RaceChart } from '@/components/region-map';
import { TimelineControl, useTimeline } from '@/components/timeline';
import type { Change, ChangeKind, CloneQuarter, Common, Consensus, Holding } from '@/domain/gurus';
import type { Metrics } from '@/domain/metrics';
import { MetricsTable } from '@/components/metrics';

interface GuruSummary {
  key: string;
  person: string;
  firm: string;
  style: string;
  sageId: string | null;
  period: string | null;
  filed: string | null;
  aum: number | null;
  count: number;
  top: { name: string; ticker: string | null; weight: number }[];
  turnover: number | null;
  buys: number;
  sells: number;
  metrics: Pick<Metrics, 'total' | 'cagr' | 'vol' | 'maxDrawdown' | 'sharpe' | 'sortino' | 'calmar' | 'beta' | 'alpha' | 'informationRatio' | 'excess' | 'hitRate' | 'periods'> | null;
}
interface GurusView {
  progress: { done: number; total: number; running: boolean; tickers: boolean; metrics: boolean };
  quarter: string | null;
  gurus: GuruSummary[];
  buys: Consensus[];
  sells: Consensus[];
  common: Common[];
  similar: { key: string; score: number; shared: { ticker: string; mine: number; theirs: number }[] }[];
  mine: { count: number; value: number };
}
interface GuruDetail {
  guru: GuruSummary;
  holdings: (Holding & { change: Change | null; sector: string })[];
  sold: Change[];
  sectors: { sector: string; weight: number }[];
  history: { period: string; aum: number; top: { key: string; label: string; weight: number }[] }[];
  clone: { quarters: CloneQuarter[]; stats: { total: number | null; bench: number | null; vol: number | null; sharpe: number | null; quarters: number }; metrics: Metrics | null };
}

const TABS = [
  { key: 'list', label: '거장 목록' },
  { key: 'trades', label: '많이 산 · 판 종목' },
  { key: 'common', label: '공통 보유' },
  { key: 'similar', label: '나와 비슷한 거장' },
] as const;

const pct = (v: number | null | undefined, d = 1) => (v === null || v === undefined ? '—' : `${(v * 100).toFixed(d)}%`);
const signed = (v: number | null | undefined, d = 1) => (v === null || v === undefined ? '—' : `${v > 0 ? '+' : ''}${(v * 100).toFixed(d)}%`);
const usd = (v: number | null | undefined) => {
  if (v === null || v === undefined) return '—';
  const a = Math.abs(v);
  const s = a >= 1e12 ? `${(a / 1e12).toFixed(2)}조` : a >= 1e8 ? `${(a / 1e8).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}억` : a >= 1e4 ? `${Math.round(a / 1e4).toLocaleString('ko-KR')}만` : a.toFixed(0);
  return `${v < 0 ? '−' : ''}$${s}`;
};
const quarterOf = (d: string | null) => (d ? `${d.slice(0, 4)}년 ${Math.ceil(Number(d.slice(5, 7)) / 3)}분기` : '—');
const KIND: Record<ChangeKind, { label: string; color: string }> = {
  new: { label: '신규', color: 'var(--up)' },
  add: { label: '추가', color: 'color-mix(in srgb, var(--up) 70%, var(--surface))' },
  reduce: { label: '축소', color: 'color-mix(in srgb, var(--down) 70%, var(--surface))' },
  sold: { label: '전량 매도', color: 'var(--down)' },
  same: { label: '유지', color: 'var(--line)' },
};
const symbolOf = (x: { ticker: string | null; name: string }) => x.ticker ?? x.name;

function Badge({ kind, change }: { kind: ChangeKind; change?: number | null }) {
  return (
    <span className="badge" style={{ background: KIND[kind].color, color: kind === 'same' ? 'var(--ink-2)' : '#fff' }}>
      {KIND[kind].label}
      {(kind === 'add' || kind === 'reduce') && change !== null && change !== undefined ? ` ${signed(change, 0)}` : ''}
    </span>
  );
}

function useJson<T>(url: string, poll: (d: T) => boolean): { data: T | null; error: string | null } {
  const [state, setState] = useState<{ url: string; data: T | null; error: string | null }>({ url: '', data: null, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    fetch(url, { cache: 'no-store' })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? '불러오지 못했습니다.');
        if (!live) return;
        setState({ url, data: j as T, error: null });
        if (poll(j as T)) setTimeout(() => live && setTick((t) => t + 1), 5000);
      })
      .catch((e) => live && setState({ url, data: null, error: e instanceof Error ? e.message : '불러오지 못했습니다.' }));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, tick]);
  return { data: state.url === url ? state.data : null, error: state.url === url ? state.error : null };
}

export function Gurus() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const g = sp.get('g');
  const tab = TABS.some((t) => t.key === sp.get('tab')) ? sp.get('tab')! : 'list';
  const go = (q: Record<string, string | null>) => {
    const n = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(q)) v === null ? n.delete(k) : n.set(k, v);
    router.push(`${pathname}?${n.toString()}`, { scroll: false });
  };
  const { data, error } = useJson<GurusView>('/api/gurus?view=list', (d) => d.progress.running || d.progress.tickers || d.progress.metrics);
  if (g) return <GuruPage key={g} gkey={g} onBack={() => go({ g: null })} />;
  if (error) return <p className="msg err">{error}</p>;
  if (!data) return <p className="empty">불러오는 중…</p>;
  const name = (k: string) => data.gurus.find((x) => x.key === k)?.person ?? k;
  const pick = (k: string) => go({ g: k });
  return (
    <div className="stack" style={{ gap: 16 }}>
      <section className="card stack" style={{ gap: 12 }} aria-label="거장 포트폴리오 설정">
        <div className="inline spread" style={{ flexWrap: 'wrap', gap: 12 }}>
          <div className="seg" role="tablist" aria-label="화면">
            {TABS.map((t) => (
              <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} aria-pressed={tab === t.key} onClick={() => go({ tab: t.key })}>
                {t.label}
              </button>
            ))}
          </div>
          <span className="sub">{data.quarter ? `${quarterOf(data.quarter)} 보고서 기준 (분기 끝 45일 안에 공개)` : ''}</span>
        </div>
        {data.progress.running && (
          <p className="callout" style={{ margin: 0 }}>
            SEC에서 13F 보고서를 받는 중입니다 ({data.progress.done}/{data.progress.total}). 처음 한 번은 1~2분 걸리고, 받는 대로 화면이 채워집니다.
          </p>
        )}
        {!data.progress.running && !data.progress.tickers && data.progress.metrics && <p className="sub" style={{ margin: 0 }}>거장마다 따라 샀을 때의 샤프·소르티노 등을 계산하는 중입니다. 몇 분 뒤 다시 열면 채워집니다.</p>}
        {!data.progress.running && data.progress.tickers && <p className="sub" style={{ margin: 0 }}>종목 코드(CUSIP)를 티커로 바꾸는 중이라 일부 종목은 이름으로 보입니다. 몇 분 뒤 다시 열면 채워집니다.</p>}
      </section>
      {tab === 'list' ? (
        <GuruList gurus={data.gurus} onPick={pick} />
      ) : tab === 'trades' ? (
        <div className="stack" style={{ gap: 16 }}>
          <TradeTable title="많이 산 종목" about="최근 보고서에서 새로 담거나 늘린 거장 수가 많은 순. 금액은 이번 분기 가격으로 잰 매수 추정액이고, 이름은 금액이 큰 6명까지 보여 줍니다." rows={data.buys} name={name} onPick={pick} />
          <TradeTable title="많이 판 종목" about="전량 매도하거나 줄인 거장 수가 많은 순. 금액은 매도 추정액입니다." rows={data.sells} name={name} onPick={pick} />
        </div>
      ) : tab === 'common' ? (
        <section className="card indicator" aria-label="공통 보유">
          <div className="stack" style={{ gap: 4 }}>
            <h3>공통 보유 종목</h3>
            <span className="sub">이번 분기 보고서를 낸 거장 가운데 가장 많은 사람이 들고 있는 종목. 같은 수면 보유자들의 평균 비중이 큰 순입니다.</span>
          </div>
          <div className="table-wrap">
            <table className="rank">
              <thead>
                <tr>
                  <th className="l">종목</th>
                  <th className="num">보유 거장</th>
                  <th className="num">평균 비중</th>
                  <th className="l">누가 (비중)</th>
                </tr>
              </thead>
              <tbody>
                {data.common.map((c) => (
                  <tr key={c.cusip}>
                    <th scope="row" className="l">
                      {c.ticker ? <Link href={`/market?s=${encodeURIComponent(c.ticker)}`}>{c.ticker}</Link> : '—'}
                      <span className="sub" style={{ display: 'block' }}>{c.name}</span>
                    </th>
                    <td className="num strong">{c.holders.length}명</td>
                    <td className="num">{pct(c.avgWeight)}</td>
                    <td className="l" style={{ whiteSpace: 'normal' }}>
                      {[...c.holders].sort((a, b) => b.weight - a.weight).slice(0, 8).map((h) => (
                        <button key={h.key} type="button" className="chip-btn" style={{ margin: 2, padding: '2px 8px', fontSize: 12 }} onClick={() => pick(h.key)}>
                          {name(h.key)} {pct(h.weight, 0)}
                        </button>
                      ))}
                      {c.holders.length > 8 && <span className="sub"> 외 {c.holders.length - 8}명</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <section className="card indicator" aria-label="나와 비슷한 거장">
          <div className="stack" style={{ gap: 4 }}>
            <h3>나와 비슷한 거장</h3>
            <span className="sub">
              내 미국 주식 {data.mine.count}종목(매수금액 기준 비중)과 거장 포트폴리오가 겹치는 정도. 겹침 = 같은 종목마다 두 비중 중 작은 값을 더한 것(0~100%). 한국 주식·코인은 13F에 없어 빠집니다.
            </span>
          </div>
          {data.similar.length ? (
            <div className="table-wrap">
              <table className="rank">
                <thead>
                  <tr>
                    <th className="l">거장</th>
                    <th className="num">겹침</th>
                    <th className="l">겹치는 종목 (내 비중 / 거장 비중)</th>
                  </tr>
                </thead>
                <tbody>
                  {data.similar.map((s) => (
                    <tr key={s.key}>
                      <th scope="row" className="l">
                        <button type="button" className="linklike" onClick={() => pick(s.key)}>{name(s.key)}</button>
                        <span className="sub" style={{ display: 'block' }}>{data.gurus.find((x) => x.key === s.key)?.firm}</span>
                      </th>
                      <td className="num strong">{pct(s.score)}</td>
                      <td className="l" style={{ whiteSpace: 'normal' }}>{s.shared.map((x) => `${x.ticker} (${pct(x.mine, 0)} / ${pct(x.theirs, 0)})`).join(' · ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="empty">{data.mine.count ? '겹치는 거장이 없습니다.' : '보유 자산에 미국 주식이 없어 비교할 수 없습니다.'}</p>
          )}
        </section>
      )}
      <p className="sub">출처: SEC EDGAR 13F-HR (미국 상장 주식·옵션, 운용자산 1억 달러 이상 기관이 분기마다 제출). 공매도·채권·해외 주식·현금은 보고 대상이 아니라 실제 포트폴리오와 다를 수 있습니다. 티커는 OpenFIGI.</p>
    </div>
  );
}

function GuruList({ gurus, onPick }: { gurus: GuruSummary[]; onPick: (k: string) => void }) {
  const [sort, setSort] = useState<'aum' | 'turnover' | 'count' | 'sharpe' | 'sortino' | 'alpha'>('aum');
  const mv = (g: GuruSummary, k: 'sharpe' | 'sortino' | 'alpha') => g.metrics?.[k] ?? -Infinity;
  const rows = [...gurus].sort((a, b) => (sort === 'aum' ? (b.aum ?? -1) - (a.aum ?? -1) : sort === 'count' ? b.count - a.count : sort === 'turnover' ? (b.turnover ?? -1) - (a.turnover ?? -1) : mv(b, sort) - mv(a, sort)));
  const ratio = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(2));
  return (
    <section className="card indicator" aria-label="거장 목록">
      <div className="inline spread" style={{ gap: 8, flexWrap: 'wrap' }}>
        <div className="stack" style={{ gap: 4 }}>
          <h3>거장 {gurus.length}명</h3>
          <span className="sub">이름을 누르면 보유 종목, 분기별 변화 재생, 따라 샀을 때 추정 수익률을 봅니다.</span>
        </div>
        <div className="seg" role="group" aria-label="정렬">
          {(['aum', 'turnover', 'count', 'sharpe', 'sortino', 'alpha'] as const).map((k) => (
            <button key={k} type="button" aria-current={sort === k ? 'true' : undefined} onClick={() => setSort(k)}>
              {{ aum: '보고 자산 순', turnover: '회전율 순', count: '종목 수 순', sharpe: '샤프 순', sortino: '소르티노 순', alpha: '알파 순' }[k]}
            </button>
          ))}
        </div>
      </div>
      <div className="table-wrap">
        <table className="rank">
          <thead>
            <tr>
              <th className="l">거장</th>
              <th className="num">보고 자산</th>
              <th className="num">종목</th>
              <th className="num">회전율</th>
              <th className="num" title="따라 샀을 때 분기 수익률의 샤프 지수(무위험 3%)" style={{ cursor: 'help' }}>샤프</th>
              <th className="num" title="손실 쪽 변동성만 본 샤프" style={{ cursor: 'help' }}>소르티노</th>
              <th className="num" title="SPY 대비 젠센 알파(연)" style={{ cursor: 'help' }}>알파</th>
              <th className="num" title="따라 산 포트폴리오의 분기 말 기준 최대 낙폭" style={{ cursor: 'help' }}>최대 낙폭</th>
              <th className="num">매수 · 매도</th>
              <th className="l">상위 보유 (비중)</th>
              <th className="l">기준</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((g) => (
              <tr key={g.key}>
                <th scope="row" className="l">
                  <button type="button" className="linklike" onClick={() => onPick(g.key)} style={{ fontWeight: 600 }}>{g.person}</button>
                  {g.sageId && <Link href={`/sages/${g.sageId}`} className="badge" style={{ marginLeft: 6 }}>거장 노트</Link>}
                  <span className="sub" style={{ display: 'block' }}>{g.firm} · {g.style}</span>
                </th>
                <td className="num">{usd(g.aum)}</td>
                <td className="num">{g.count || '—'}</td>
                <td className="num">{pct(g.turnover, 0)}</td>
                <td className={`num ${(g.metrics?.sharpe ?? 0) >= 0 ? '' : 'down'}`}>{ratio(g.metrics?.sharpe)}</td>
                <td className="num">{ratio(g.metrics?.sortino)}</td>
                <td className={`num ${(g.metrics?.alpha ?? 0) >= 0 ? 'up' : 'down'}`}>{g.metrics?.alpha === null || g.metrics?.alpha === undefined ? '—' : signed(g.metrics.alpha)}</td>
                <td className="num down">{g.metrics ? pct(g.metrics.maxDrawdown) : '—'}</td>
                <td className="num">
                  <span className="up">{g.buys}</span> · <span className="down">{g.sells}</span>
                </td>
                <td className="l sub" style={{ whiteSpace: 'normal' }}>{g.top.map((t) => `${symbolOf(t)} ${pct(t.weight, 0)}`).join(' · ') || '—'}</td>
                <td className="l sub">{quarterOf(g.period)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="sub">보고 자산은 13F에 적힌 미국 상장 주식 평가액(옵션 제외). 회전율은 직전 분기와 비교해 비중이 옮겨 간 정도(0%면 그대로, 100%면 전부 교체)입니다. 샤프·소르티노·알파·최대 낙폭은 보고서마다 상위 30종목을 따라 샀을 때의 분기 수익률(최근 8분기, SPY 대비)로 추정한 값이라 분기 수가 적어 참고용입니다. 비어 있으면 아직 계산 중입니다.</p>
    </section>
  );
}

function TradeTable({ title, about, rows, name, onPick }: { title: string; about: string; rows: Consensus[]; name: (k: string) => string; onPick: (k: string) => void }) {
  return (
    <section className="card indicator" aria-label={title}>
      <div className="stack" style={{ gap: 4 }}>
        <h3>{title}</h3>
        <span className="sub">{about}</span>
      </div>
      <div className="table-wrap">
        <table className="rank">
          <thead>
            <tr>
              <th className="l">종목</th>
              <th className="num">거장</th>
              <th className="num">추정 금액</th>
              <th className="l">누가</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.cusip}>
                <th scope="row" className="l">
                  {c.ticker ? <Link href={`/market?s=${encodeURIComponent(c.ticker)}`}>{c.ticker}</Link> : '—'}
                  <span className="sub" style={{ display: 'block' }}>{c.name}</span>
                </th>
                <td className="num strong">{c.gurus.length}명</td>
                <td className={`num ${c.flow >= 0 ? 'up' : 'down'}`}>{usd(c.flow)}</td>
                <td className="l" style={{ whiteSpace: 'normal' }}>
                  {[...c.gurus].sort((a, b) => Math.abs(b.flow) - Math.abs(a.flow)).slice(0, 6).map((x) => (
                    <button key={x.key} type="button" className="chip-btn" style={{ margin: 2, padding: '2px 8px', fontSize: 12 }} onClick={() => onPick(x.key)} title={KIND[x.kind].label}>
                      <span className="dot" style={{ background: KIND[x.kind].color }} />
                      {name(x.key)}
                    </button>
                  ))}
                  {c.gurus.length > 6 && <span className="sub" title={c.gurus.slice(6).map((x) => name(x.key)).join(', ')}> 외 {c.gurus.length - 6}명</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function GuruPage({ gkey, onBack }: { gkey: string; onBack: () => void }) {
  const { data, error } = useJson<GuruDetail>(`/api/gurus?view=guru&g=${encodeURIComponent(gkey)}`, () => false);
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div>
        <button type="button" className="btn small" onClick={onBack}>‹ 거장 목록</button>
      </div>
      {error ? <p className="msg err">{error}</p> : !data ? <p className="empty">불러오는 중… 처음 여는 거장은 지난 8분기 보고서와 종목 시세를 받느라 1~2분 걸릴 수 있습니다. 다음부터는 바로 열립니다.</p> : <GuruBody d={data} />}
    </div>
  );
}

function GuruBody({ d }: { d: GuruDetail }) {
  const t = useTimeline(d.history.length);
  const frame = d.history[t.i];
  const s = d.clone.stats;
  const cloneRows = d.clone.quarters.map((q) => ({ q: quarterOf(q.from), 거장: q.ret, 'S&P 500': q.bench }));
  const max = Math.max(...d.history.flatMap((h) => h.top.map((x) => x.weight)), 0.01);
  return (
    <>
      <section className="card stack" style={{ gap: 12 }} aria-label="거장 요약">
        <div className="inline spread" style={{ gap: 8, flexWrap: 'wrap' }}>
          <div className="stack" style={{ gap: 4 }}>
            <h2 style={{ margin: 0 }}>
              {d.guru.person} <span className="sub" style={{ fontSize: 14 }}>{d.guru.firm}</span>
            </h2>
            <span className="sub">
              {d.guru.style} · {quarterOf(d.guru.period)} 보고서 ({d.guru.filed} 제출)
              {d.guru.sageId && (
                <>
                  {' · '}
                  <Link href={`/sages/${d.guru.sageId}`}>거장 노트 ›</Link>
                </>
              )}
            </span>
          </div>
        </div>
        <div className="gu-kpis">
          <div className="kpi stack" style={{ gap: 2 }}><span className="label">보고 자산</span><span className="value">{usd(d.guru.aum)}</span></div>
          <div className="kpi stack" style={{ gap: 2 }}><span className="label">종목 수</span><span className="value">{d.guru.count}</span></div>
          <div className="kpi stack" style={{ gap: 2 }}><span className="label">회전율</span><span className="value">{pct(d.guru.turnover, 0)}</span></div>
          <div className="kpi stack" style={{ gap: 2 }}><span className="label">따라 샀다면 ({s.quarters}분기)</span><span className={`value ${(s.total ?? 0) >= 0 ? 'up' : 'down'}`}>{signed(s.total)}</span></div>
          <div className="kpi stack" style={{ gap: 2 }}><span className="label">같은 기간 S&P 500</span><span className="value">{signed(s.bench)}</span></div>
          <div className="kpi stack" style={{ gap: 2 }}><span className="label">변동성 · 샤프</span><span className="value">{s.vol === null ? '—' : `${pct(s.vol, 0)} · ${s.sharpe?.toFixed(2) ?? '—'}`}</span></div>
        </div>
      </section>
      <div className="ind-grid">
        <section className="card indicator" aria-label="분기별 보유 변화">
          <div className="stack" style={{ gap: 4 }}>
            <h3>분기별 상위 보유 ({quarterOf(frame?.period ?? null)})</h3>
            <span className="sub">▶를 누르면 지난 {d.history.length}분기 동안 상위 종목과 비중이 어떻게 바뀌었는지 순위가 움직입니다. 보고 자산 {usd(frame?.aum)}.</span>
          </div>
          <TimelineControl t={t} dates={d.history.map((h) => h.period)} label="분기" />
          {frame && <RaceChart items={frame.top.map((x) => ({ key: x.label, label: x.label, value: x.weight }))} color={() => 'var(--series-1)'} fmt={(v) => pct(v)} lo={0} hi={max} onPick={() => {}} />}
        </section>
        <section className="card indicator" aria-label="따라 산 수익률">
          <div className="stack" style={{ gap: 4 }}>
            <h3>따라 샀을 때 분기 수익률</h3>
            <span className="sub">보고서의 상위 30종목을 분기 말 비중대로 사서 다음 분기 말(마지막은 오늘)까지 들고 있었다면. 실제로는 보고서가 45일 늦게 나오므로 그대로 따라 할 수는 없습니다.</span>
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={cloneRows} margin={{ left: 0, right: 12, top: 8, bottom: 4 }}>
              <CartesianGrid vertical={false} stroke="var(--line-soft)" />
              <XAxis dataKey="q" stroke="var(--muted)" fontSize={11} />
              <YAxis tickFormatter={(v: number) => `${Math.round(v * 100)}%`} stroke="var(--muted)" fontSize={11} width={44} />
              <Tooltip formatter={(v) => signed(Number(v))} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)' }} />
              <Legend />
              <Bar dataKey="거장" fill="var(--series-1)" animationDuration={600} />
              <Bar dataKey="S&P 500" fill="var(--series-3)" animationDuration={600} />
            </BarChart>
          </ResponsiveContainer>
        </section>
        {d.clone.metrics && (
          <section className="card indicator" aria-label="거장 평가 지표" style={{ gridColumn: '1 / -1' }}>
            <div className="stack" style={{ gap: 4 }}>
              <h3>평가 지표 (따라 샀을 때)</h3>
              <span className="sub">보고서마다 상위 30종목을 분기 말 비중대로 사서 다음 분기 말까지 들고 있었을 때의 분기 수익률 {d.clone.metrics.periods}개로 계산했습니다(기준: S&P 500 SPY, 달러). 분기 자료라 개수가 적어 추정치입니다.</span>
            </div>
            <MetricsTable compact rows={[{ key: d.guru.key, label: d.guru.person, metrics: d.clone.metrics }]} benchmark="S&P 500" periodName="분기" />
          </section>
        )}
        <section className="card indicator" aria-label="섹터 비중">
          <div className="stack" style={{ gap: 4 }}>
            <h3>섹터 비중</h3>
            <span className="sub">S&P 500 구성 종목은 GICS 섹터로, 나머지는 한데 묶었습니다.</span>
          </div>
          <ResponsiveContainer width="100%" height={Math.max(160, d.sectors.length * 28)}>
            <BarChart data={d.sectors} layout="vertical" margin={{ left: 8, right: 40, top: 4, bottom: 4 }}>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="sector" width={120} stroke="var(--muted)" fontSize={12} interval={0} />
              <Tooltip formatter={(v) => pct(Number(v))} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)' }} />
              <Bar dataKey="weight" name="비중" label={{ position: 'right', formatter: (v: unknown) => pct(Number(v)), fontSize: 11, fill: 'var(--ink-2)' }} animationDuration={600}>
                {d.sectors.map((x, i) => (
                  <Cell key={x.sector} fill={`var(--series-${(i % 7) + 1})`} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </section>
      </div>
      <section className="card indicator" aria-label="보유 종목">
        <div className="stack" style={{ gap: 4 }}>
          <h3>보유 종목 {d.holdings.length}개</h3>
          <span className="sub">직전 분기 대비 주식 수 변화로 신규·추가·축소·유지를 표시합니다(±2% 안은 유지).</span>
        </div>
        <div className="table-wrap">
          <table className="rank">
            <thead>
              <tr>
                <th className="l">종목</th>
                <th className="l">섹터</th>
                <th className="num">비중</th>
                <th className="num">직전 비중</th>
                <th className="num">평가액</th>
                <th className="num">주식 수</th>
                <th className="l">변화</th>
              </tr>
            </thead>
            <tbody>
              {d.holdings.map((h) => (
                <tr key={h.cusip}>
                  <th scope="row" className="l">
                    {h.ticker ? <Link href={`/market?s=${encodeURIComponent(h.ticker)}`}>{h.ticker}</Link> : '—'}
                    <span className="sub" style={{ display: 'block' }}>{h.name}</span>
                  </th>
                  <td className="l sub">{h.sector}</td>
                  <td className="num strong">{pct(h.weight, 2)}</td>
                  <td className="num">{h.change ? pct(h.change.prevWeight, 2) : '—'}</td>
                  <td className="num">{usd(h.value)}</td>
                  <td className="num">{h.shares.toLocaleString('ko-KR')}</td>
                  <td className="l">{h.change ? <Badge kind={h.change.kind} change={h.change.shareChange} /> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {d.sold.length > 0 && (
          <p className="sub">
            전량 매도: {d.sold.map((c) => `${symbolOf(c)} (직전 ${pct(c.prevWeight, 1)})`).join(' · ')}
          </p>
        )}
      </section>
    </>
  );
}
