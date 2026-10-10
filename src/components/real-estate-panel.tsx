'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CartesianGrid, ComposedChart, Line, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from 'recharts';
import { valuationAction } from '@/app/actions';
import { apartmentViewAction, setApartmentAction } from '@/app/real-estate-actions';
import { areaLabel, eok, naverLandUrl, PYEONG, RTMS_URL, type ApartmentMeta } from '@/domain/real-estate';
import { pct, tone } from '@/lib/format';
import type { ApartmentView } from '@/server/services/real-estate';
import { ApartmentPicker } from './apartment-picker';
import { ActionForm, nowLocal, Submit } from './forms';

const axis = { fontSize: 11.5, fill: 'var(--muted)' };
const day = (d: string) => Date.parse(`${d}T00:00:00+09:00`);
const yymm = (t: number) => {
  const d = new Date(t + 9 * 3_600_000);
  return `${String(d.getUTCFullYear()).slice(2)}.${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

/** Pick (or change) the apartment a real estate asset is. */
function Connect({ assetId, onDone, onCancel }: { assetId: string; onDone: () => void; onCancel?: () => void }) {
  const [meta, setMeta] = useState<ApartmentMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="stack">
      <ApartmentPicker onChange={setMeta} />
      {error && <p className="msg err">{error}</p>}
      <div className="inline">
        <button
          type="button"
          className="btn primary"
          disabled={!meta || pending}
          onClick={() =>
            start(async () => {
              const r = await setApartmentAction(assetId, JSON.stringify(meta));
              if ('error' in r) setError(r.error);
              else onDone();
            })
          }
        >
          {pending ? '저장 중…' : '이 아파트로 연결'}
        </button>
        {onCancel && (
          <button type="button" className="btn" onClick={onCancel}>
            취소
          </button>
        )}
      </div>
    </div>
  );
}

function DealChart({ view }: { view: ApartmentView }) {
  const { report, meta } = view;
  const deals = report.sameAreaDeals.filter((t) => !t.cancelled).map((t) => ({ t: day(t.date), price: t.price }));
  // The 동's median price per 3.3㎡, scaled to this apartment's area, as a reference line.
  const dong = meta.area ? report.dong.monthly.map((m) => ({ t: day(`${m.month}-15`), dong: (m.perPyeong / PYEONG) * meta.area! })) : [];
  if (deals.length + dong.length < 2) return null;
  const ts = [...deals.map((d) => d.t), ...dong.map((d) => d.t)];
  const ys = [...deals.map((d) => d.price), ...dong.map((d) => d.dong)];
  const [t0, t1] = [Math.min(...ts), Math.max(...ts)];
  // Round 억 ticks: the smallest step that leaves at most five intervals
  const [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  const step = [1e7, 2e7, 5e7, 1e8, 2e8, 5e8, 1e9, 2e9, 5e9].find((st) => (y1 - y0) / st <= 4) ?? 1e10;
  const lo = Math.floor(y0 / step) * step, hi = Math.ceil(y1 / step) * step;
  const yTicks = Array.from({ length: Math.round((hi - lo) / step) + 1 }, (_, i) => lo + i * step);
  const yLabel = (v: number) => (v >= 1e8 ? `${(v / 1e8).toFixed(step < 1e8 ? 1 : 0)}억` : `${Math.round(v / 1e4).toLocaleString('ko-KR')}만`);
  // A tick at the start of every third month
  const ticks: number[] = [];
  for (let d = new Date(t0 + 9 * 3_600_000); ; ) {
    d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
    const t = d.getTime() - 9 * 3_600_000;
    if (t > t1) break;
    if (d.getUTCMonth() % 3 === 0) ticks.push(t);
  }
  return (
    <div className="stack" style={{ gap: 4 }}>
      <div style={{ width: '100%', height: 240 }} className="money">
        <ResponsiveContainer>
          <ComposedChart margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--line-soft)" vertical={false} />
            <XAxis dataKey="t" type="number" domain={[t0, t1]} ticks={ticks} tickFormatter={(v) => yymm(Number(v))} tick={axis} tickLine={false} axisLine={false} allowDuplicatedCategory={false} />
            <YAxis type="number" domain={[lo, hi]} ticks={yTicks} tickFormatter={(v) => yLabel(Number(v))} tick={axis} tickLine={false} axisLine={false} width={64} />
            <Tooltip
              labelFormatter={(l) => yymm(Number(l))}
              formatter={(v, name) => [eok(Number(v)), name === 'dong' ? `${meta.umdNm} 3개월 중앙값 (이 면적 환산)` : '이 단지 같은 면적 거래']}
              contentStyle={{ borderRadius: 10, border: '1px solid var(--line)', background: 'var(--surface)', fontSize: 13 }}
            />
            <Line data={dong} dataKey="dong" stroke="var(--muted)" strokeDasharray="5 4" strokeWidth={1.5} dot={false} isAnimationActive={false} />
            <Scatter data={deals} dataKey="price" fill="var(--ink)" isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="sub">● 이 단지 같은 면적 거래 · ┄ {meta.umdNm} 전체 3.3㎡당 3개월 중앙값을 이 면적으로 환산</p>
    </div>
  );
}

/**
 * The 실거래가 · 인근 시세 card on a real estate asset: its estimated price from reported deals,
 * the deals themselves, the neighborhood, and a link to 네이버 부동산 for listings.
 */
export function RealEstatePanel({ assetId, holdingId, linked }: { assetId: string; holdingId: string; linked: boolean }) {
  const router = useRouter();
  const [view, setView] = useState<ApartmentView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [loading, start] = useTransition();

  useEffect(() => {
    if (!linked) return;
    start(async () => {
      const r = await apartmentViewAction(assetId);
      if ('error' in r) setError(r.error);
      else {
        setError(null);
        setView(r);
      }
    });
  }, [assetId, linked]);

  const reconnected = () => {
    setEditing(false);
    setView(null);
    router.refresh();
  };

  if (!linked || editing) {
    return (
      <section className="card" id="real-estate">
        <div className="stack" style={{ gap: 4 }}>
          <h2>{linked ? '아파트 바꾸기' : '실거래가 · 인근 시세'}</h2>
          <p className="sub">이 자산이 어느 아파트인지 고르면 국토교통부 실거래가로 추정 시세와 인근 거래를 보여 주고, 네이버 부동산 매물로 바로 갈 수 있습니다.</p>
        </div>
        <Connect assetId={assetId} onDone={reconnected} onCancel={linked ? () => setEditing(false) : undefined} />
      </section>
    );
  }

  const meta = view?.meta;
  const r = view?.report;
  const latest = r?.sameAreaDeals.find((t) => !t.cancelled);
  const showDong = !!r?.sameAreaDeals.some((t) => t.aptDong);
  const change = r && r.dong.recent && r.dong.yearAgo ? r.dong.recent / r.dong.yearAgo - 1 : null;
  return (
    <section className="card" id="real-estate" aria-busy={loading}>
      <div className="spread">
        <div className="stack" style={{ gap: 4 }}>
          <h2>실거래가 · 인근 시세</h2>
          {meta && (
            <p className="sub">
              {meta.aptNm ?? meta.placeName} · {meta.roadAddress ?? meta.address}
              {meta.area ? ` · 전용 ${areaLabel(meta.area)}` : ''}
            </p>
          )}
        </div>
        <div className="inline">
          {meta && (
            <a className="btn small" href={naverLandUrl(meta)} target="_blank" rel="noreferrer">
              네이버 부동산 매물 ↗
            </a>
          )}
          <a className="btn small" href={RTMS_URL} target="_blank" rel="noreferrer">
            국토부 실거래가 ↗
          </a>
          <button type="button" className="btn small" onClick={() => setEditing(true)}>
            아파트 바꾸기
          </button>
        </div>
      </div>

      {error && <p className="msg err">{error}</p>}
      {loading && !view && <p className="empty">실거래가를 불러오는 중…</p>}

      {meta && r && (
        <>
          <div className="row">
            <div className="kpi">
              <div className="label">추정 시세</div>
              <div className="value money">{r.estimate ? eok(r.estimate.price) : '—'}</div>
              <div className="note">{r.estimate ? r.estimate.basis : meta.aptNm ? '최근 1년 동안 이 단지 거래가 없습니다.' : '실거래가 단지를 고르지 않았습니다. 아파트 바꾸기에서 단지를 고르세요.'}</div>
            </div>
            <div className="kpi">
              <div className="label">같은 면적 최근 거래</div>
              <div className="value money">{latest ? eok(latest.price) : '—'}</div>
              <div className="note">{latest ? `${latest.date}${latest.floor !== null ? ` · ${latest.floor}층` : ''}` : '최근 2년 거래 없음'}</div>
            </div>
            <div className="kpi">
              <div className="label">{meta.umdNm} 3.3㎡당 (최근 3개월)</div>
              <div className="value money">{r.dong.recent ? eok(r.dong.recent) : '—'}</div>
              <div className={`note money ${change !== null ? tone(change) : ''}`}>
                {change !== null ? `1년 전 대비 ${pct(change, 1)}` : '비교할 1년 전 거래가 부족합니다'} · 거래 {r.dong.recentDeals}건
              </div>
            </div>
          </div>

          {r.estimate && (
            <ActionForm action={valuationAction} className="inline" confirm={`평가 가치를 ${eok(r.estimate.price)}으로 기록할까요?`}>
              <input type="hidden" name="holdingId" value={holdingId} />
              <input type="hidden" name="price" value={r.estimate.price} />
              <input type="hidden" name="tradeAt" value={nowLocal()} />
              <input type="hidden" name="memo" value={`국토부 실거래가 추정: ${r.estimate.basis}`.slice(0, 200)} />
              <Submit className="btn small primary" pendingText="기록 중…">
                추정 시세를 평가 가치로 기록
              </Submit>
              <span className="sub">1채(수량 1) 기준 금액입니다. 지분이면 수량을 지분율로 기록하세요.</span>
            </ActionForm>
          )}

          <DealChart view={view} />

          {r.sameAreaDeals.length > 0 && (
            <>
              <h3>같은 면적 거래</h3>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th scope="col">계약일</th><th scope="col">층</th>{showDong && <th scope="col">동</th>}<th scope="col">거래금액</th><th scope="col">3.3㎡당</th><th scope="col" className="l">비고</th></tr>
                  </thead>
                  <tbody>
                    {r.sameAreaDeals.slice(0, 15).map((t, i) => (
                      <tr key={`${t.date}:${t.floor}:${i}`} className={t.cancelled ? 'muted' : undefined}>
                        <td>{t.date}</td>
                        <td>{t.floor ?? '—'}</td>
                        {showDong && <td className="muted">{t.aptDong ?? '—'}</td>}
                        <td className="money strong">{t.cancelled ? <s>{eok(t.price)}</s> : eok(t.price)}</td>
                        <td className="money muted">{eok((t.price / t.area) * PYEONG)}</td>
                        <td className="l muted">{[t.cancelled ? '해제' : null, t.dealing === '직거래' ? '직거래' : null].filter(Boolean).join(' · ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {r.areas.length > 0 && (
            <>
              <h3>면적별 (최근 2년)</h3>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th scope="col">전용면적</th><th scope="col">거래</th><th scope="col">최근 거래</th><th scope="col">최고가</th></tr>
                  </thead>
                  <tbody>
                    {r.areas.map((a) => (
                      <tr key={a.area} className={meta.area && Math.abs(a.area - meta.area) < 0.5 ? 'strong' : undefined}>
                        <td>{areaLabel(a.area)}</td>
                        <td>{a.deals}건</td>
                        <td className="money">{eok(a.lastPrice)} <span className="sub">{a.lastDate}</span></td>
                        <td className="money">{eok(a.high)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {r.nearby.length > 0 && (
            <>
              <h3>{meta.umdNm} 단지 (최근 1년)</h3>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th scope="col">단지</th><th scope="col">건축</th><th scope="col">거래</th><th scope="col">최근 거래</th><th scope="col">3.3㎡당 중앙값</th></tr>
                  </thead>
                  <tbody>
                    {r.nearby.map((n) => (
                      <tr key={`${n.aptNm}:${n.buildYear}`} className={n.own ? 'strong' : undefined}>
                        <td className="l">{n.aptNm}{n.own ? ' (이 단지)' : ''}</td>
                        <td className="muted">{n.buildYear ?? '—'}</td>
                        <td>{n.deals}건</td>
                        <td className="money">{eok(n.lastPrice)} <span className="sub">{n.lastDate} · {n.lastArea}㎡</span></td>
                        <td className="money">{eok(n.perPyeong)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <p className="sub">
            출처: 국토교통부 아파트 매매 실거래가 ({view.asOf} 조회). 계약일 기준이며 신고 기한이 30일이라 최근 한 달은 덜 모였을 수 있습니다. 매물은 네이버 부동산에서 확인하세요.
          </p>
        </>
      )}
    </section>
  );
}
