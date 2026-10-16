'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Area, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { askAi } from '@/components/ai/launcher';
import { BENCHMARKS, KIND_LABEL, KINDS, MARKET_KINDS, PRESETS, type VKind } from '@/domain/virtual';

interface Summary {
  id: string;
  name: string;
  note: string;
  positions: number;
  invested: number;
  value: number;
  since: string | null;
}
interface Detail {
  portfolio: { id: string; name: string; note: string; benchmark: string; benchmarkName: string };
  positions: {
    id: string;
    kind: VKind;
    kindLabel: string;
    symbol: string | null;
    name: string;
    currency: string;
    buyDate: string;
    sellDate: string | null;
    mode: 'AMOUNT' | 'QTY';
    qty: number | null;
    rate: number | null;
    note: string;
    cost: number | null;
    buyPrice: number | null;
    sellPrice: number | null;
    price: number | null;
    value: number | null;
    gain: number | null;
    ret: number | null;
    weight: number | null;
    problem: string | null;
  }[];
  totals: { invested: number; value: number; gain: number; ret: number | null; twr: number | null; maxDrawdown: number | null; bench: number | null };
  byKind: { kind: VKind; label: string; value: number; weight: number }[];
  path: { dates: string[]; value: number[]; invested: number[]; bench: (number | null)[]; twr: number[] };
}

const won = (v: number | null | undefined) => {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  const s = a >= 1e12 ? `${(a / 1e12).toFixed(2)}조` : a >= 1e8 ? `${(a / 1e8).toLocaleString('ko-KR', { maximumFractionDigits: 2 })}억` : a >= 1e4 ? `${Math.round(a / 1e4).toLocaleString('ko-KR')}만` : Math.round(a).toLocaleString('ko-KR');
  return `${v < 0 ? '−' : ''}${s}원`;
};
const pct = (v: number | null | undefined, d = 1) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${(v * 100).toFixed(d)}%`);
const today = () => new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);

async function post(body: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const r = await fetch('/api/virtual', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { ok: r.ok, data: await r.json().catch(() => ({})) };
}

function useJson<T>(url: string, bump: number): { data: T | null; error: string | null } {
  const [state, setState] = useState<{ key: string; data: T | null; error: string | null }>({ key: '', data: null, error: null });
  const key = `${url}#${bump}`;
  useEffect(() => {
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
  // Keep the last data while a refresh loads, so the screen does not flash
  return { data: state.data, error: state.key === key ? state.error : null };
}

export function VirtualPortfolios() {
  const sp = useSearchParams();
  const id = sp.get('id');
  return id ? <DetailScreen id={id} /> : <ListScreen />;
}

function ListScreen() {
  const router = useRouter();
  const [bump, setBump] = useState(0);
  const { data, error } = useJson<{ portfolios: Summary[] }>('/api/virtual', bump);
  const [name, setName] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const create = async () => {
    setMsg(null);
    const r = await post({ action: 'create', name });
    if (!r.ok) return setMsg(String(r.data.error ?? '만들지 못했습니다.'));
    setName('');
    router.push(`/portfolios/virtual?id=${r.data.id}`);
    setBump((b) => b + 1);
  };
  return (
    <div className="stack" style={{ gap: 16 }}>
      <section className="card stack" style={{ gap: 10 }} aria-label="가상 포트폴리오 만들기">
        <div className="stack" style={{ gap: 4 }}>
          <h3>새 가상 포트폴리오</h3>
          <span className="sub">갖고 있지 않은 주식·ETF·채권·원자재·가상자산·부동산·예금을 과거 날짜에 샀다고 치고 지금까지 어떻게 됐을지 봅니다. 실제 보유 자산·거래 내역과는 완전히 따로 저장되고, 대시보드·순자산·세금·배당·성과 분석 어디에도 섞이지 않습니다.</span>
        </div>
        <form className="inline" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); if (name.trim()) create(); }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="이름 (예: 2020년 코로나 저점 매수)" aria-label="가상 포트폴리오 이름" maxLength={60} style={{ maxWidth: 360 }} />
          <button type="submit" className="btn">만들기</button>
        </form>
        {msg && <p className="msg err">{msg}</p>}
      </section>
      {error ? (
        <p className="msg err">{error}</p>
      ) : !data ? (
        <p className="empty">불러오는 중…</p>
      ) : data.portfolios.length ? (
        <section className="card indicator" aria-label="가상 포트폴리오 목록">
          <div className="table-wrap">
            <table className="rank">
              <thead>
                <tr>
                  <th className="l">이름</th>
                  <th className="num">종목</th>
                  <th className="l">처음 매수</th>
                  <th className="num">넣은 돈</th>
                  <th className="num">지금 가치</th>
                  <th className="num">손익</th>
                  <th className="num">수익률</th>
                </tr>
              </thead>
              <tbody>
                {data.portfolios.map((p) => (
                  <tr key={p.id}>
                    <th scope="row" className="l">
                      <span className="badge" style={{ marginRight: 6 }}>가상</span>
                      <a href={`/portfolios/virtual?id=${p.id}`} className="strong">{p.name}</a>
                      {p.note && <span className="sub" style={{ display: 'block' }}>{p.note}</span>}
                    </th>
                    <td className="num">{p.positions}</td>
                    <td className="l sub">{p.since ?? '—'}</td>
                    <td className="num">{won(p.invested)}</td>
                    <td className="num strong">{won(p.value)}</td>
                    <td className={`num ${p.value - p.invested >= 0 ? 'up' : 'down'}`}>{p.positions ? won(p.value - p.invested) : '—'}</td>
                    <td className={`num ${p.value - p.invested >= 0 ? 'up' : 'down'}`}>{p.invested ? pct(p.value / p.invested - 1) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <p className="empty">아직 가상 포트폴리오가 없습니다.</p>
      )}
    </div>
  );
}

function DetailScreen({ id }: { id: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [bump, setBump] = useState(0);
  const { data, error } = useJson<Detail>(`/api/virtual?id=${encodeURIComponent(id)}`, bump);
  const refresh = () => setBump((b) => b + 1);
  if (error && !data) return <p className="msg err">{error} <a href="/portfolios/virtual">목록으로</a></p>;
  if (!data) return <p className="empty">불러오는 중… 처음에는 종목마다 과거 시세를 받느라 몇 초 걸립니다.</p>;
  const t = data.totals;
  const chart = data.path.dates.map((d, i) => ({ date: d, 가치: data.path.value[i], '넣은 돈': data.path.invested[i], [data.portfolio.benchmarkName]: data.path.bench[i] }));
  const remove = async () => {
    if (!window.confirm(`가상 포트폴리오 '${data.portfolio.name}'를 지울까요? 담은 종목도 함께 지워집니다. 실제 자산에는 영향이 없습니다.`)) return;
    await post({ action: 'delete', id });
    router.push(pathname);
  };
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="inline spread" style={{ gap: 8 }}>
        <a className="btn small" href="/portfolios/virtual">‹ 가상 포트폴리오 목록</a>
        <div className="inline" style={{ gap: 8 }}>
          <label className="inline" style={{ gap: 6 }}>
            <span className="sub">비교</span>
            <select value={data.portfolio.benchmark} onChange={async (e) => { await post({ action: 'update', id, benchmark: e.target.value }); refresh(); }} aria-label="비교 지수" style={{ width: 'auto' }}>
              {BENCHMARKS.map((b) => (
                <option key={b.symbol} value={b.symbol}>{b.name}</option>
              ))}
            </select>
          </label>
          {data.positions.length > 0 && (
            <button type="button" className="btn small" onClick={() => askAi({ prompt: aiPrompt(data) })}>
              <span aria-hidden="true">✦</span> AI 평가
            </button>
          )}
          <button type="button" className="btn small" onClick={remove}>지우기</button>
        </div>
      </div>
      <section className="card stack" style={{ gap: 12 }} aria-label="가상 포트폴리오 요약">
        <div className="stack" style={{ gap: 4 }}>
          <h2 style={{ margin: 0 }}>
            <span className="badge" style={{ marginRight: 8, verticalAlign: 'middle' }}>가상</span>
            {data.portfolio.name}
          </h2>
          <span className="sub">실제 보유·거래와 섞이지 않는 연습용 포트폴리오입니다. 금액은 모두 원화로 환산했고, 배당·이자·수수료·세금은 빼고 가격만으로 계산합니다.</span>
        </div>
        <div className="gu-kpis">
          {[
            ['넣은 돈', won(t.invested), ''],
            ['지금 가치', won(t.value), ''],
            ['손익', won(t.gain), t.gain >= 0 ? 'up' : 'down'],
            ['수익률', pct(t.ret), (t.ret ?? 0) >= 0 ? 'up' : 'down'],
            ['시간가중 수익률', pct(t.twr), (t.twr ?? 0) >= 0 ? 'up' : 'down'],
            ['최대 낙폭', pct(t.maxDrawdown), 'down'],
            [`같은 돈을 ${data.portfolio.benchmarkName}에`, pct(t.bench), (t.bench ?? 0) >= 0 ? 'up' : 'down'],
          ].map(([l, v, c]) => (
            <div key={l} className="kpi stack" style={{ gap: 2 }}>
              <span className="label">{l}</span>
              <span className={`value ${c}`}>{v}</span>
            </div>
          ))}
        </div>
      </section>
      {data.positions.length > 0 && (
        <section className="card indicator" aria-label="가치 변화">
          <div className="stack" style={{ gap: 4 }}>
            <h3>가치 변화</h3>
            <span className="sub">계단처럼 오르는 회색 면이 넣은 돈(매수할 때마다 늘어남), 파란 선이 그날의 가치, 점선은 같은 날 같은 금액을 {data.portfolio.benchmarkName}에 넣었을 때입니다.</span>
          </div>
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart data={chart} margin={{ left: 0, right: 12, top: 8, bottom: 4 }}>
              <CartesianGrid stroke="var(--line-soft)" />
              <XAxis dataKey="date" tickFormatter={(v: string) => v.slice(2, 7).replace('-', '.')} minTickGap={40} stroke="var(--muted)" fontSize={11} />
              <YAxis tickFormatter={(v: number) => won(v)} stroke="var(--muted)" fontSize={11} width={72} />
              <Tooltip formatter={(v, n) => [won(Number(v)), String(n)]} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)' }} />
              <Legend />
              <Area dataKey="넣은 돈" type="stepAfter" stroke="var(--muted)" fill="var(--line-soft)" animationDuration={1000} />
              <Line dataKey="가치" stroke="var(--series-1)" strokeWidth={2.2} dot={false} animationDuration={1200} />
              <Line dataKey={data.portfolio.benchmarkName} stroke="var(--series-4)" strokeDasharray="5 4" dot={false} animationDuration={1200} />
            </ComposedChart>
          </ResponsiveContainer>
        </section>
      )}
      <AddPosition id={id} onAdded={refresh} />
      <section className="card indicator" aria-label="담은 종목">
        <div className="stack" style={{ gap: 4 }}>
          <h3>담은 종목 {data.positions.length}개</h3>
          <span className="sub">
            {data.byKind.length ? `자산 종류별: ${data.byKind.map((k) => `${k.label} ${(k.weight * 100).toFixed(0)}%`).join(' · ')}` : '아래 담기에서 종목을 추가하세요.'}
          </span>
        </div>
        {data.positions.length > 0 && (
          <div className="table-wrap">
            <table className="rank">
              <thead>
                <tr>
                  <th className="l">종목</th>
                  <th className="l">매수일 · 매도일</th>
                  <th className="num">매수 금액</th>
                  <th className="num">매수가 → 현재가</th>
                  <th className="num">지금 가치</th>
                  <th className="num">손익</th>
                  <th className="num">수익률</th>
                  <th className="num">비중</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.positions.map((p) => (
                  <PositionRow key={p.id} p={p} onChange={refresh} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/** The AI cannot read paper portfolios (they are kept apart from the real book), so the question carries them */
function aiPrompt(d: Detail): string {
  const t = d.totals;
  const lines = d.positions.map((p) => `- ${p.name} (${p.kindLabel}): ${p.buyDate} 매수${p.sellDate ? `, ${p.sellDate} 매도` : ''}, 넣은 돈 ${won(p.cost)}, 지금 ${won(p.value)} (${pct(p.ret)}), 비중 ${p.weight === null ? '—' : `${(p.weight * 100).toFixed(1)}%`}`);
  return [
    `내 실제 자산이 아닌 '가상 포트폴리오' "${d.portfolio.name}"를 평가해 줘. 실제 보유 자산 도구로 찾지 말고 아래 내용만 보고 판단해.`,
    `합계: 넣은 돈 ${won(t.invested)}, 지금 ${won(t.value)} (${pct(t.ret)}), 시간가중 ${pct(t.twr)}, 최대 낙폭 ${pct(t.maxDrawdown)}, 같은 돈을 ${d.portfolio.benchmarkName}에 넣었다면 ${pct(t.bench)}.`,
    '종목:',
    ...lines,
    '무엇이 잘됐고 무엇이 위험했는지, 분산은 적절했는지, 지금 실제로 따라 한다면 무엇을 바꿀지 알려 줘.',
  ].join('\n');
}

function PositionRow({ p, onChange }: { p: Detail['positions'][number]; onChange: () => void }) {
  const [selling, setSelling] = useState(false);
  const [sellDate, setSellDate] = useState(p.sellDate ?? today());
  const save = async (d: string | null) => {
    const r = await post({ action: 'updatePosition', positionId: p.id, sellDate: d });
    if (!r.ok) window.alert(String(r.data.error ?? '저장하지 못했습니다.'));
    setSelling(false);
    onChange();
  };
  // Prices to the won (amounts elsewhere round to 만/억)
  const price = (v: number | null) => (v === null ? '—' : p.kind === 'REAL_ESTATE' ? v.toFixed(1) : v >= 1e8 ? won(v) : `${v.toLocaleString('ko-KR', { maximumFractionDigits: v < 100 ? 2 : 0 })}원`);
  return (
    <tr>
      <th scope="row" className="l">
        {p.name}
        <span className="sub" style={{ display: 'block' }}>{p.kindLabel}{p.symbol && p.kind !== 'REAL_ESTATE' ? ` · ${p.symbol}` : ''}{p.mode === 'QTY' && p.qty ? ` · ${p.qty.toLocaleString('ko-KR', { maximumFractionDigits: 4 })}주` : ''}{p.rate !== null ? ` · 연 ${(p.rate * 100).toFixed(2)}%` : ''}</span>
        {p.problem && <span className="msg err" style={{ display: 'block', fontSize: 12 }}>{p.problem}</span>}
      </th>
      <td className="l sub">
        {p.buyDate}
        {p.sellDate ? ` → ${p.sellDate} 매도` : ''}
      </td>
      <td className="num">{won(p.cost)}</td>
      <td className="num sub">{p.kind === 'FIXED' || p.kind === 'CASH' ? '—' : `${price(p.buyPrice)} → ${price(p.sellDate ? p.sellPrice : p.price)}`}{p.kind === 'REAL_ESTATE' ? <span style={{ display: 'block', fontSize: 11 }}>가격지수</span> : null}</td>
      <td className="num strong">{won(p.value)}</td>
      <td className={`num ${(p.gain ?? 0) >= 0 ? 'up' : 'down'}`}>{won(p.gain)}</td>
      <td className={`num ${(p.ret ?? 0) >= 0 ? 'up' : 'down'}`}>{pct(p.ret)}</td>
      <td className="num">{p.weight === null ? '—' : `${(p.weight * 100).toFixed(1)}%`}</td>
      <td className="num" style={{ whiteSpace: 'nowrap' }}>
        {selling ? (
          <span className="inline" style={{ gap: 4 }}>
            <input type="date" value={sellDate} max={today()} min={p.buyDate} onChange={(e) => setSellDate(e.target.value)} aria-label="매도일" style={{ width: 150 }} />
            <button type="button" className="btn small" onClick={() => save(sellDate)}>매도</button>
            <button type="button" className="linklike" onClick={() => setSelling(false)}>취소</button>
          </span>
        ) : (
          <>
            {p.sellDate ? <button type="button" className="linklike" onClick={() => save(null)}>매도 취소</button> : <button type="button" className="linklike" onClick={() => setSelling(true)}>매도</button>}
            {' · '}
            <button type="button" className="linklike" onClick={async () => { if (window.confirm(`${p.name}을(를) 뺄까요?`)) { await post({ action: 'deletePosition', positionId: p.id }); onChange(); } }}>빼기</button>
          </>
        )}
      </td>
    </tr>
  );
}

function AddPosition({ id, onAdded }: { id: string; onAdded: () => void }) {
  const [kind, setKind] = useState<VKind>('STOCK');
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<{ name: string; currency: string; symbol: string } | null>(null);
  const [buyDate, setBuyDate] = useState('2020-03-19');
  const [mode, setMode] = useState<'AMOUNT' | 'QTY'>('AMOUNT');
  const [amount, setAmount] = useState('10000000');
  const [qty, setQty] = useState('10');
  const [rate, setRate] = useState('3.5');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const market = MARKET_KINDS.includes(kind);
  const check = async (q: string) => {
    setFound(null);
    if (!q.trim()) return;
    const r = await fetch(`/api/virtual?kind=${kind}&resolve=${encodeURIComponent(q)}`);
    const j = await r.json().catch(() => ({}));
    if (r.ok) setFound(j);
    else setMsg(j.error ?? null);
  };
  const add = async () => {
    setMsg(null);
    setBusy(true);
    const r = await post({
      action: 'add',
      id,
      kind,
      query: market || kind === 'REAL_ESTATE' ? query : undefined,
      buyDate,
      mode: market ? mode : 'AMOUNT',
      amount: !market || mode === 'AMOUNT' ? Number(amount.replace(/,/g, '')) : null,
      qty: market && mode === 'QTY' ? Number(qty) : null,
      rate: kind === 'FIXED' ? Number(rate) / 100 : null,
    });
    setBusy(false);
    if (!r.ok) return setMsg(String(r.data.error ?? '담지 못했습니다.'));
    setQuery('');
    setFound(null);
    onAdded();
  };
  return (
    <section className="card stack" style={{ gap: 12 }} aria-label="종목 담기">
      <div className="stack" style={{ gap: 4 }}>
        <h3>종목 담기</h3>
        <span className="sub">자산 종류를 고르고, 종목과 그때 매수했다고 칠 날짜·금액(또는 수량)을 넣습니다. 매수가는 그날(휴장이면 직전 거래일) 종가로 자동으로 정해집니다.</span>
      </div>
      <div className="seg" role="group" aria-label="자산 종류" style={{ flexWrap: 'wrap' }}>
        {KINDS.map((k) => (
          <button key={k} type="button" aria-current={kind === k ? 'true' : undefined} onClick={() => { setKind(k); setFound(null); setMsg(null); setQuery(''); }}>
            {KIND_LABEL[k]}
          </button>
        ))}
      </div>
      <div className="va-fields">
        {(market || kind === 'REAL_ESTATE') && (
          <label className="stack" style={{ gap: 4 }}>
            <span className="sub">{kind === 'REAL_ESTATE' ? '지역 (예: 서울 강남구, 경기 성남시 분당구)' : '종목 (티커·종목코드·회사명)'}</span>
            <input value={query} onChange={(e) => { setQuery(e.target.value); setFound(null); }} onBlur={() => check(query)} placeholder={kind === 'REAL_ESTATE' ? '서울 강남구' : kind === 'COMMODITY' ? 'GC=F' : kind === 'CRYPTO' ? 'BTC-KRW' : '005930, AAPL, 삼성전자'} aria-label="종목" />
            <span className="sub" style={{ fontSize: 11 }}>{found ? `✓ ${found.name}${found.currency !== 'KRW' ? ` (${found.currency}, 원화로 환산)` : ''}` : kind === 'REAL_ESTATE' ? '한국부동산원 아파트 매매가격지수를 따라갑니다(월간).' : ' '}</span>
          </label>
        )}
        <label className="stack" style={{ gap: 4 }}>
          <span className="sub">매수일</span>
          <input type="date" value={buyDate} min="1990-01-01" max={today()} onChange={(e) => setBuyDate(e.target.value)} aria-label="매수일" />
        </label>
        {market && (
          <label className="stack" style={{ gap: 4 }}>
            <span className="sub">넣는 방식</span>
            <select value={mode} onChange={(e) => setMode(e.target.value as 'AMOUNT' | 'QTY')} aria-label="넣는 방식">
              <option value="AMOUNT">금액(원)</option>
              <option value="QTY">수량</option>
            </select>
          </label>
        )}
        {market && mode === 'QTY' ? (
          <label className="stack" style={{ gap: 4 }}>
            <span className="sub">수량</span>
            <input type="number" step="any" min="0" value={qty} onChange={(e) => setQty(e.target.value)} aria-label="수량" />
          </label>
        ) : (
          <label className="stack" style={{ gap: 4 }}>
            <span className="sub">{kind === 'REAL_ESTATE' ? '매수 가격(원)' : '금액(원)'}</span>
            <input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="금액" />
            <span className="sub" style={{ fontSize: 11 }}>{won(Number(amount.replace(/,/g, '')) || null)}</span>
          </label>
        )}
        {kind === 'FIXED' && (
          <label className="stack" style={{ gap: 4 }}>
            <span className="sub">연 금리(%)</span>
            <input type="number" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} aria-label="연 금리" />
          </label>
        )}
      </div>
      {PRESETS[kind] && (
        <div className="inline" style={{ gap: 6, flexWrap: 'wrap' }}>
          <span className="sub">빠른 선택</span>
          {PRESETS[kind]!.map((p) => (
            <button key={p.symbol} type="button" className="chip-btn" onClick={() => { setQuery(p.symbol); check(p.symbol); }}>{p.name}</button>
          ))}
        </div>
      )}
      <div className="inline" style={{ gap: 8 }}>
        <button type="button" className="btn" disabled={busy} onClick={add}>{busy ? '담는 중…' : '담기'}</button>
        {msg && <span className="msg err">{msg}</span>}
      </div>
    </section>
  );
}
