'use client';

import { useActionState, useCallback, useEffect, useRef, useState, useTransition } from 'react';
import type { ActionState } from '@/app/actions';
import { krw, krwShort, money, pct, qty, signedKrwShort, tone } from '@/lib/format';
import type { Board, BoardRow, CommodityBoard, RankingView, StockDetail } from '@/server/services/market-board';
import { myApartmentsAction } from '@/app/real-estate-actions';
import { eok } from '@/domain/real-estate';
import type { ApartmentSummary } from '@/server/services/real-estate';
import { CandleChart } from './candle-chart';
import { AskAiButton } from './ai/launcher';

type Action = (s: ActionState, f: FormData) => Promise<ActionState>;
type Market = 'KR' | 'US' | 'CRYPTO';
type RankType = 'AMOUNT' | 'VOLUME' | 'GAINERS' | 'LOSERS';

const RANK_LABEL: Record<RankType, string> = { AMOUNT: '거래대금', VOLUME: '거래량', GAINERS: '급상승', LOSERS: '급하락' };
const BROKER_LABEL: Record<string, string> = {
  TOSS: '토스증권', KIS: '한국투자증권', KIWOOM: '키움증권', LS: 'LS증권', DB: 'DB증권', MERITZ: '메리츠증권',
  UPBIT: '업비트', BITHUMB: '빗썸', COINONE: '코인원', KORBIT: '코빗',
};

/** Fetch `url` every `ms` while the tab is visible; refetch at once when it comes back. */
function usePoll<T>(url: string | null, ms: number, paused: boolean) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [at, setAt] = useState<number | null>(null);
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!url) return;
    const id = ++seq.current;
    try {
      const res = await fetch(url, { cache: 'no-store' });
      const json = await res.json();
      if (id !== seq.current) return;
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setData(json as T);
      setError(null);
      setAt(Date.now());
    } catch (e) {
      if (id === seq.current) setError(e instanceof Error ? e.message : '불러오지 못했습니다.');
    }
  }, [url]);
  useEffect(() => {
    setData(null);
    if (!url) return;
    void load();
  }, [url, load]);
  useEffect(() => {
    if (!url || paused) return;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (document.visibilityState === 'visible') await load();
      timer = setTimeout(tick, ms);
    };
    timer = setTimeout(tick, ms);
    const onVisible = () => document.visibilityState === 'visible' && void load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [url, ms, paused, load]);
  return { data, error, at, reload: load };
}

/** CSS class that flashes when a value moves up or down between polls. */
function useFlash(key: string, value: string | null) {
  const prev = useRef<Record<string, string | null>>({});
  const [flash, setFlash] = useState<{ cls: string; n: number } | null>(null);
  useEffect(() => {
    const old = prev.current[key];
    prev.current[key] = value;
    if (old === undefined || old === null || value === null || old === value) return;
    setFlash({ cls: Number(value) > Number(old) ? 'flash-up' : 'flash-down', n: Date.now() });
  }, [key, value]);
  return flash;
}

function Flash({ id, value, children }: { id: string; value: string | null; children: React.ReactNode }) {
  const f = useFlash(id, value);
  return (
    <span key={f?.n} className={f?.cls} style={{ padding: '1px 3px' }}>
      {children}
    </span>
  );
}

function compact(v: string | null | undefined) {
  const n = Number(v);
  if (!v || !Number.isFinite(n)) return '—';
  if (n >= 1e8) return `${(n / 1e8).toFixed(n >= 1e10 ? 0 : 1)}억`;
  if (n >= 1e4) return `${(n / 1e4).toFixed(n >= 1e6 ? 0 : 1)}만`;
  return n.toLocaleString('ko-KR');
}

function amountText(v: string | null, currency: string) {
  if (!v) return '—';
  return currency === 'USD' ? `$${compact(v)}` : `${compact(v)}원`;
}

function Change({ rate, change, currency }: { rate: string | null; change?: string | null; currency?: string }) {
  if (rate === null) return <span className="muted">—</span>;
  return (
    <span className={tone(rate)}>
      {change && currency ? `${Number(change) > 0 ? '+' : ''}${money(change, currency)} ` : ''}
      {pct(rate, 2)}
    </span>
  );
}

function Spark({ points, rate }: { points: number[] | null | undefined; rate: string | null }) {
  if (!points || points.length < 2) return <span className="sub">…</span>;
  const w = 96;
  const h = 28;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${((i / (points.length - 1)) * w).toFixed(1)},${(h - 2 - ((p - min) / span) * (h - 4)).toFixed(1)}`).join(' ');
  const color = rate && Number(rate) < 0 ? 'var(--down)' : rate && Number(rate) > 0 ? 'var(--up)' : 'var(--muted)';
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" style={{ display: 'block', marginLeft: 'auto' }}>
      <path d={d} fill="none" stroke={color} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function IndexStrip({ board }: { board: Board | null }) {
  const items = [
    ...(board?.indices ?? []).map((i) => ({ key: i.code, name: i.label, value: Number(i.price).toLocaleString('ko-KR', { maximumFractionDigits: 2, minimumFractionDigits: 2 }), raw: i.price, rate: i.changeRate, change: i.change })),
    ...(board ? [{ key: 'USDKRW', name: '원/달러', value: Number(board.fx.rate).toLocaleString('ko-KR', { maximumFractionDigits: 2, minimumFractionDigits: 2 }), raw: board.fx.rate, rate: board.fx.changeRate, change: board.fx.change }] : []),
  ];
  if (!board) return <div className="ticker" aria-busy="true"><div className="tick"><span className="name">불러오는 중…</span></div></div>;
  return (
    <div className="ticker" role="list" aria-label="주요 지수와 환율">
      {items.map((i) => (
        <div key={i.key} className="tick" role="listitem">
          <span className="name">{i.name}</span>
          <span className="value money">
            <Flash id={`idx:${i.key}`} value={i.raw}>{i.value}</Flash>
          </span>
          <span className={`chg ${i.rate ? tone(i.rate) : 'muted'}`}>
            {i.change !== null ? `${Number(i.change) > 0 ? '+' : ''}${Number(i.change).toLocaleString('ko-KR', { maximumFractionDigits: 2 })} ` : ''}
            {i.rate !== null ? pct(i.rate, 2) : '전일값 없음'}
          </span>
        </div>
      ))}
    </div>
  );
}

function WatchForm({ action, onAdded }: { action: Action; onAdded: () => void }) {
  const [state, formAction, pending] = useActionState(action, {} as ActionState);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) {
      ref.current?.reset();
      onAdded();
    }
  }, [state, onAdded]);
  return (
    <form ref={ref} action={formAction} className="inline" aria-label="관심종목 추가">
      <input name="symbol" required placeholder="종목코드·티커·코인 (005930, AAPL, KRW-BTC)" pattern="[A-Za-z0-9.\-]{1,20}" autoCapitalize="characters" style={{ width: 280 }} aria-label="종목코드" />
      <button className="btn" type="submit" disabled={pending} aria-busy={pending}>
        {pending ? '찾는 중…' : '관심종목 추가'}
      </button>
      {state.error && <span role="alert" className="msg err" style={{ padding: '6px 10px' }}>{state.error}</span>}
    </form>
  );
}

function BoardTable({
  rows,
  sparks,
  selected,
  onSelect,
  onUnwatch,
}: {
  rows: BoardRow[];
  sparks: Record<string, number[] | null>;
  selected: string | null;
  onSelect: (s: string) => void;
  onUnwatch: (s: string) => void;
}) {
  if (!rows.length) return <p className="empty">보유한 상장 종목이 없고 관심종목도 비어 있습니다. 위에서 관심종목을 추가하세요.</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th scope="col">종목</th>
            <th scope="col">현재가</th>
            <th scope="col">등락률</th>
            <th scope="col">오늘</th>
            <th scope="col">거래량</th>
            <th scope="col">평가금액 · 오늘 손익</th>
            <th scope="col"><span className="sr-only">관심종목</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.symbol}
              className="pick"
              aria-selected={selected === r.symbol}
              tabIndex={0}
              onClick={() => onSelect(r.symbol)}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onSelect(r.symbol))}
            >
              <td>
                <span className="strong">{r.name}</span>
                <span className="sub">
                  {r.symbol}
                  {r.held ? ' · 보유' : ''}
                  {r.stale && r.price ? ' · 지연' : ''}
                </span>
              </td>
              <td className="money strong">
                {r.price ? (
                  <Flash id={`row:${r.symbol}`} value={r.price}>{money(r.price, r.currency)}</Flash>
                ) : (
                  <span className="muted">—</span>
                )}
              </td>
              <td>
                <Change rate={r.changeRate} />
              </td>
              <td>
                <Spark points={sparks[r.symbol]} rate={r.changeRate} />
              </td>
              <td className="muted">{compact(r.volume)}</td>
              <td className="money">
                {r.held ? (
                  <>
                    {r.held.valueKrw ? krwShort(r.held.valueKrw) : krwShort(r.held.costKrw)}
                    <span className={`sub ${r.held.todayKrw ? tone(r.held.todayKrw) : ''}`}>
                      {r.held.todayKrw ? signedKrwShort(r.held.todayKrw) : `${qty(r.held.qty)}주`}
                    </span>
                  </>
                ) : (
                  <span className="muted">—</span>
                )}
              </td>
              <td>
                {r.watched && (
                  <button
                    type="button"
                    className="icon-btn"
                    aria-pressed="true"
                    aria-label={`${r.name} 관심종목에서 빼기`}
                    title="관심종목에서 빼기"
                    onClick={(e) => {
                      e.stopPropagation();
                      onUnwatch(r.symbol);
                    }}
                  >
                    ★
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Rankings({ paused, onSelect }: { paused: boolean; onSelect: (s: string) => void }) {
  const [market, setMarket] = useState<Market>('KR');
  const [type, setType] = useState<RankType>('AMOUNT');
  const { data, error } = usePoll<RankingView>(`/api/market/rankings?market=${market}&type=${type}`, 15_000, paused);
  return (
    <div className="card rank-card">
      <div className="spread">
        <h2>실시간 랭킹</h2>
        <div className="seg" role="group" aria-label="시장">
          {(['KR', 'US', 'CRYPTO'] as Market[]).map((m) => (
            <button key={m} type="button" aria-pressed={market === m} onClick={() => setMarket(m)}>
              {m === 'KR' ? '국내' : m === 'US' ? '미국' : '코인'}
            </button>
          ))}
        </div>
      </div>
      <div className="seg" role="group" aria-label="랭킹 기준" style={{ alignSelf: 'flex-start' }}>
        {(Object.keys(RANK_LABEL) as RankType[]).map((t) => (
          <button key={t} type="button" aria-pressed={type === t} onClick={() => setType(t)}>
            {RANK_LABEL[t]}
          </button>
        ))}
      </div>
      {error && <p className="msg err">{error}</p>}
      {!data ? (
        <p className="empty">불러오는 중…</p>
      ) : !data.rows.length ? (
        <p className="empty">연결된 증권사 중 이 랭킹을 제공하는 곳이 없거나, 아직 집계된 값이 없습니다.</p>
      ) : (
        <div className="table-wrap">
          <table className="rank">
            <thead>
              <tr>
                <th scope="col">순위 · 종목</th>
                <th scope="col">현재가 · 등락률</th>
                <th scope="col">{type === 'VOLUME' ? '거래량' : '거래대금'}</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.symbol} className="pick" tabIndex={0} onClick={() => onSelect(r.symbol)} onKeyDown={(e) => e.key === 'Enter' && onSelect(r.symbol)}>
                  <td>
                    <span className="inline" style={{ flexWrap: 'nowrap', gap: 10 }}>
                      <span className="muted" style={{ width: 18, textAlign: 'right' }}>{r.rank}</span>
                      <span style={{ minWidth: 0 }}>
                        <span className="strong rank-name">{r.name ?? r.symbol}</span>
                        <span className="sub">{r.symbol}</span>
                      </span>
                    </span>
                  </td>
                  <td>
                    <span className="money" style={{ display: 'block' }}>{money(r.price, r.currency)}</span>
                    <span className="sub">
                      <Change rate={r.changeRate} />
                    </span>
                  </td>
                  <td className="muted">{type === 'VOLUME' ? compact(r.volume) : amountText(r.amount, r.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data?.source && <p className="sub">출처: {BROKER_LABEL[data.source] ?? data.source}</p>}
    </div>
  );
}

function Detail({ symbol, paused, onClose, watchAction, unwatchAction, onChanged }: { symbol: string; paused: boolean; onClose: () => void; watchAction: Action; unwatchAction: Action; onChanged: () => void }) {
  const { data: d, error, reload } = usePoll<StockDetail>(`/api/market/stock?symbol=${encodeURIComponent(symbol)}`, 3_000, paused);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const toggleWatch = () =>
    start(async () => {
      const f = new FormData();
      f.set('symbol', symbol);
      const r = await (d?.watched ? unwatchAction : watchAction)({}, f);
      setMsg(r.error ?? null);
      await reload();
      onChanged();
    });
  const q = d?.quote;
  const prev = q?.prevClose ? Number(q.prevClose) : null;
  const maxVol = Math.max(1, ...(d?.orderbook ? [...d.orderbook.asks, ...d.orderbook.bids].map((l) => Number(l.volume)) : [1]));
  return (
    <div className="card" aria-live="polite">
      <div className="spread" style={{ alignItems: 'flex-start' }}>
        <div className="stack" style={{ gap: 4 }}>
          <h2 className="inline">
            {d?.name ?? symbol} <span className="sub">{symbol}</span>
          </h2>
          {q?.price ? (
            <div className="inline" style={{ gap: 10, alignItems: 'baseline' }}>
              <span className="money" style={{ fontSize: 26, fontWeight: 700 }}>
                <Flash id={`detail:${symbol}`} value={q.price}>{money(q.price, q.currency)}</Flash>
              </span>
              <Change rate={q.changeRate} change={q.change} currency={q.currency} />
            </div>
          ) : (
            <span className="muted">{error ?? '시세를 불러오는 중…'}</span>
          )}
        </div>
        <div className="inline">
          <AskAiButton className="btn small" label="AI 리서치" agent="RESEARCH" prompt={`${d?.name ?? symbol}(${symbol})을(를) 리서치해 줘. 사업, 최근 실적과 가이던스, 밸류에이션, 주가 흐름, 리스크와 앞으로의 촉매를 출처와 함께 정리해 줘.`} />
          {d && !d.held && (
            <button type="button" className="btn small" onClick={toggleWatch} disabled={pending} aria-pressed={d.watched}>
              {d.watched ? '★ 관심종목 해제' : '☆ 관심종목'}
            </button>
          )}
          <button type="button" className="btn small" onClick={onClose} aria-label="상세 닫기">
            닫기
          </button>
        </div>
      </div>
      {msg && <p className="msg err">{msg}</p>}
      <div className="row" style={{ alignItems: 'stretch' }}>
        <div className="wide" style={{ minHeight: 240 }}>
          <CandleChart symbol={symbol} currency={d?.currency ?? q?.currency ?? 'KRW'} prevClose={prev} paused={paused} />
        </div>
        <div style={{ flex: '1 1 240px' }}>
          <h3 style={{ margin: '0 0 6px', fontSize: 14 }}>호가</h3>
          {d?.orderbook && (d.orderbook.asks.length || d.orderbook.bids.length) ? (
            <div className="book" role="table" aria-label="호가">
              {[...d.orderbook.asks].reverse().map((l, i) => (
                <BookRow key={`a${i}`} side="ask" level={l} max={maxVol} currency={d.orderbook!.currency} now={q?.price === l.price} />
              ))}
              {d.orderbook.bids.map((l, i) => (
                <BookRow key={`b${i}`} side="bid" level={l} max={maxVol} currency={d.orderbook!.currency} now={q?.price === l.price} />
              ))}
            </div>
          ) : (
            <p className="empty">{d ? '호가를 주는 증권사가 연결되어 있지 않거나 장이 열리지 않았습니다.' : '불러오는 중…'}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function BookRow({ side, level, max, currency, now }: { side: 'ask' | 'bid'; level: { price: string; volume: string }; max: number; currency: string; now: boolean }) {
  const w = `${Math.max(2, (Number(level.volume) / max) * 100)}%`;
  return (
    <>
      <div className="ask vol" role="cell">
        {side === 'ask' && (
          <>
            <span className="bar" style={{ width: w }} />
            {Number(level.volume).toLocaleString('ko-KR')}
          </>
        )}
      </div>
      <div className={`px money ${side === 'ask' ? 'down' : 'up'} ${now ? 'now' : ''}`} role="cell">
        {money(level.price, currency)}
      </div>
      <div className="bid vol" role="cell">
        {side === 'bid' && (
          <>
            <span className="bar" style={{ width: w }} />
            {Number(level.volume).toLocaleString('ko-KR')}
          </>
        )}
      </div>
    </>
  );
}

/** The whole live board: indices, my stocks, rankings, and a detail panel for the selected stock. */
const priceText = (v: string, currency: string) =>
  currency === 'KRW' ? `${Number(v).toLocaleString('ko-KR')}원` : Number(v).toLocaleString('en-US', { maximumFractionDigits: Number(v) >= 100 ? 2 : 4, minimumFractionDigits: 2 });

/** Gold, oil, grains and index futures: KRX 금현물 from 키움, overseas futures from 한국투자증권. */
function Commodities({ paused }: { paused: boolean }) {
  const { data } = usePoll<CommodityBoard>('/api/market/commodities', 15_000, paused);
  const shown = data?.rows.filter((r) => r.price || r.error) ?? [];
  return (
    <div className="card" id="commodities">
      <div className="spread">
        <h2>원자재 · 선물</h2>
        <span className="sub">15초마다 갱신</span>
      </div>
      {!data ? (
        <p className="empty">불러오는 중…</p>
      ) : !data.kiwoom && !data.kis ? (
        <p className="empty">
          금 현물은 키움증권, 해외 선물(금·은·원유·곡물·지수)은 한국투자증권을 <a href="/settings">연동 · 설정</a>에서 연결하면 보입니다.
        </p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th scope="col" className="l">종목</th><th scope="col">현재가</th><th scope="col">전일 대비</th><th scope="col" className="l">계약 · 출처</th></tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id}>
                  <td className="l">
                    <span className="strong">{r.name}</span>
                    <span className="sub">{r.exchange} · {r.unit}</span>
                  </td>
                  {r.price ? (
                    <>
                      <td className="money strong">
                        <Flash id={`c:${r.id}`} value={r.price}>{priceText(r.price, r.currency)}</Flash>
                        {r.krwPerGram && <span className="sub">≈ {Number(r.krwPerGram).toLocaleString('ko-KR')}원/g</span>}
                      </td>
                      <td className="money"><Change rate={r.changeRate} /></td>
                    </>
                  ) : (
                    <td colSpan={2} className="l sub" style={{ whiteSpace: 'normal' }}>{r.error}</td>
                  )}
                  <td className="l">
                    <span>{r.contract}</span>
                    <span className="sub">{[r.expiry && `만기 ${r.expiry.slice(5)}`, r.source && (BROKER_LABEL[r.source] ?? r.source)].filter(Boolean).join(' · ') || '—'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && (data.kiwoom || data.kis) && (
        <p className="sub">
          {!data.kiwoom && '금 현물(KRX)은 키움증권을 연결하면 보입니다. '}
          {!data.kis && '해외 선물은 한국투자증권(실전 계좌)을 연결하면 보입니다. '}
          해외 선물은 거래가 가장 많은 근월물을 날짜로 골라 보여 주며, 증권사 시세 신청 여부에 따라 지연될 수 있습니다. 금(COMEX)의 원/g은 현재 환율로 환산한 값입니다.
        </p>
      )}
    </div>
  );
}

/** Held apartments with their 실거래가 estimate (loaded once; deals change daily at most). */
function RealEstates() {
  const [data, setData] = useState<{ rows: ApartmentSummary[]; unlinked: number } | { error: string } | null>(null);
  useEffect(() => {
    void myApartmentsAction().then(setData);
  }, []);
  if (data && !('error' in data) && !data.rows.length && !data.unlinked) return null;
  return (
    <div className="card" id="my-real-estate">
      <div className="spread">
        <h2>내 부동산</h2>
        <span className="sub">국토교통부 실거래가</span>
      </div>
      {!data ? (
        <p className="empty">불러오는 중…</p>
      ) : 'error' in data ? (
        <p className="msg err">{data.error}</p>
      ) : (
        <>
          {data.rows.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th scope="col" className="l">자산</th><th scope="col">추정 시세</th><th scope="col">같은 면적 최근 거래</th><th scope="col">동 3.3㎡당 1년 변화</th></tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.holdingId}>
                      <td className="l">
                        <a className="strong" href={`/holdings/${r.holdingId}#real-estate`}>{r.name}</a>
                        {r.qty !== '1' && <span className="sub">수량 {r.qty}</span>}
                      </td>
                      {r.error ? (
                        <td colSpan={2} className="l sub" style={{ whiteSpace: 'normal' }}>{r.error}</td>
                      ) : (
                        <>
                          <td className="money strong">{r.estimate ? eok(r.estimate) : '—'}</td>
                          <td className="money">{r.latest ? <>{eok(r.latest.price)} <span className="sub">{r.latest.date}</span></> : '—'}</td>
                          <td className={`money ${r.dongChange !== null ? tone(r.dongChange) : ''}`}>{r.dongChange !== null ? `${r.umdNm} ${pct(r.dongChange, 1)}` : '—'}</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {data.unlinked > 0 && <p className="sub">아파트를 연결하지 않은 부동산 {data.unlinked}개는 빠져 있습니다. 자산 화면에서 아파트를 고르면 실거래가가 나옵니다.</p>}
        </>
      )}
    </div>
  );
}

export function MarketBoard({ initialSymbol, watchAction, unwatchAction }: { initialSymbol: string | null; watchAction: Action; unwatchAction: Action }) {
  const [paused, setPaused] = useState(false);
  const [selected, setSelected] = useState<string | null>(initialSymbol);
  const { data: board, error, at, reload } = usePoll<Board>('/api/market/board', 4_000, paused);
  const symbols = board?.rows.map((r) => r.symbol).join(',') ?? '';
  const { data: sparks } = usePoll<Record<string, number[] | null>>(symbols ? `/api/market/sparks?symbols=${encodeURIComponent(symbols)}` : null, 20_000, paused);

  const select = useCallback((s: string | null) => {
    setSelected(s);
    const u = new URL(window.location.href);
    if (s) u.searchParams.set('s', s);
    else u.searchParams.delete('s');
    window.history.replaceState(null, '', u.toString());
    if (s) requestAnimationFrame(() => document.getElementById('stock-detail')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
  }, []);
  const [, start] = useTransition();
  const unwatch = (symbol: string) =>
    start(async () => {
      const f = new FormData();
      f.set('symbol', symbol);
      await unwatchAction({}, f);
      await reload();
    });

  const today = board?.totals.todayKrw ?? null;
  return (
    <>
      <header className="page-head">
        <div className="stack" style={{ gap: 6 }}>
          <h1>실시간 시세</h1>
          <p className="sub">
            {at ? `마지막 갱신 ${new Date(at).toLocaleTimeString('ko-KR')}` : '불러오는 중…'} · {paused ? '일시정지됨' : '4초마다 자동 갱신'}
            {error ? ` · 오류: ${error}` : ''}
          </p>
        </div>
        <button type="button" className="btn" aria-pressed={paused} onClick={() => setPaused((p) => !p)}>
          {paused ? '자동 갱신 다시 시작' : '자동 갱신 멈춤'}
        </button>
      </header>

      {board && !board.linked && (
        <p className="callout">
          시세를 받으려면 먼저 <a href="/settings">설정</a>에서 증권사 Open API를 연결하세요.
        </p>
      )}

      <IndexStrip board={board} />

      <section className="row" style={{ alignItems: 'flex-start' }}>
        <div className="wide stack" style={{ gap: 16 }}>
          <div className="card">
            <div className="spread">
              <h2>내 종목</h2>
              {board && (
                <div className="inline" style={{ gap: 16 }}>
                  <span className="sub">
                    보유 평가 <span className="strong money" style={{ color: 'var(--ink)' }}>{krw(board.totals.valueKrw)}</span>
                  </span>
                  <span className="sub">
                    오늘 <span className={`strong money ${today ? tone(today) : ''}`}>{today ? signedKrwShort(today) : '—'}</span>
                  </span>
                </div>
              )}
            </div>
            <WatchForm action={watchAction} onAdded={reload} />
            {!board ? <p className="empty">불러오는 중…</p> : <BoardTable rows={board.rows} sparks={sparks ?? {}} selected={selected} onSelect={select} onUnwatch={unwatch} />}
            <p className="sub">보유 종목은 모든 포트폴리오의 수량을 합칩니다. 오늘 손익은 전일 종가 대비이며 해외 종목은 현재 환율로 환산합니다.</p>
          </div>
          {selected && (
            <div id="stock-detail">
              <Detail symbol={selected} paused={paused} onClose={() => select(null)} watchAction={watchAction} unwatchAction={unwatchAction} onChanged={reload} />
            </div>
          )}
          <Commodities paused={paused} />
          <RealEstates />
        </div>
        <Rankings paused={paused} onSelect={select} />
      </section>
    </>
  );
}
