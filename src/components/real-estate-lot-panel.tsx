'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CartesianGrid, ComposedChart, Line, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from 'recharts';
import { valuationAction } from '@/app/actions';
import { lotViewAction } from '@/app/real-estate-actions';
import { eok, LOT_AREA_LABEL, LOT_USE_LABEL, propertyKindShort, PYEONG, RTMS_SERVICES, RTMS_URL, type LotKind, type PropertyMeta } from '@/domain/real-estate';
import { pct, tone } from '@/lib/format';
import type { LotView } from '@/server/services/real-estate';
import { ActionForm, nowLocal, Submit } from './forms';
import { Connect, ManualNote } from './real-estate-panel';

const axis = { fontSize: 11.5, fill: 'var(--muted)' };
const day = (d: string) => Date.parse(`${d}T00:00:00+09:00`);
const yymm = (t: number) => {
  const d = new Date(t + 9 * 3_600_000);
  return `${String(d.getUTCFullYear()).slice(2)}.${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const sqm = (v: number) => `${v.toLocaleString('ko-KR', { maximumFractionDigits: 1 })}㎡`;

/** Each deal's price per 3.3㎡ and the 동's three-month median, over the period read. */
function PerAreaChart({ view }: { view: LotView }) {
  const { report, meta } = view;
  const deals = report.deals.filter((t) => !t.cancelled && !t.share).map((t) => ({ t: day(t.date), deal: (t.price / t.area) * PYEONG }));
  const dong = report.dong.monthly.map((m) => ({ t: day(`${m.month}-15`), dong: m.perPyeong }));
  if (deals.length + dong.length < 2) return null;
  const ts = [...deals.map((d) => d.t), ...dong.map((d) => d.t)];
  const ys = [...deals.map((d) => d.deal), ...dong.map((d) => d.dong)];
  const [t0, t1] = [Math.min(...ts), Math.max(...ts)];
  // Round ticks: the smallest step that leaves at most five intervals
  const [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  const step = [1e5, 2e5, 5e5, 1e6, 2e6, 5e6, 1e7, 2e7, 5e7, 1e8, 2e8, 5e8, 1e9].find((st) => (y1 - y0) / st <= 4) ?? 1e10;
  const lo = Math.floor(y0 / step) * step, hi = Math.ceil(y1 / step) * step;
  const yTicks = Array.from({ length: Math.round((hi - lo) / step) + 1 }, (_, i) => lo + i * step);
  const yLabel = (v: number) => (v >= 1e8 ? `${Number((v / 1e8).toFixed(2))}억` : `${Math.round(v / 1e4).toLocaleString('ko-KR')}만`);
  const ticks: number[] = [];
  for (let d = new Date(t0 + 9 * 3_600_000); ; ) {
    d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
    const t = d.getTime() - 9 * 3_600_000;
    if (t > t1) break;
    if (d.getUTCMonth() % 3 === 0) ticks.push(t);
  }
  const what = LOT_AREA_LABEL[meta.kind].replace(/ 면적$|면적$/, '');
  return (
    <div className="stack" style={{ gap: 4 }}>
      <div style={{ width: '100%', height: 220 }} className="money">
        <ResponsiveContainer>
          <ComposedChart margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--line-soft)" vertical={false} />
            <XAxis dataKey="t" type="number" domain={[t0, t1]} ticks={ticks} tickFormatter={(v) => yymm(Number(v))} tick={axis} tickLine={false} axisLine={false} allowDuplicatedCategory={false} />
            <YAxis type="number" domain={[lo, hi]} ticks={yTicks} tickFormatter={(v) => yLabel(Number(v))} tick={axis} tickLine={false} axisLine={false} width={64} />
            <Tooltip
              labelFormatter={(l) => yymm(Number(l))}
              formatter={(v, name) => [eok(Number(v)), name === 'dong' ? `${meta.umdNm} 3개월 중앙값` : '거래 3.3㎡당']}
              contentStyle={{ borderRadius: 10, border: '1px solid var(--line)', background: 'var(--surface)', fontSize: 13 }}
            />
            <Line data={dong} dataKey="dong" stroke="var(--muted)" strokeDasharray="5 4" strokeWidth={1.5} dot={false} isAnimationActive={false} />
            <Scatter data={deals} dataKey="deal" fill="var(--ink)" isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="sub">● 거래마다 {what} 3.3㎡당 가격 · ┄ {meta.umdNm} 3개월 중앙값 (해제·지분 거래 제외)</p>
    </div>
  );
}

/**
 * The 실거래가 · 동네 시세 card on a house, land or shop asset. Their deals hide the 지번, so
 * the card shows the 동's deals of the same kind (and use), a price per ㎡, and that times
 * the asset's area as a reference price; deals whose masked 지번 fits the asset's are marked.
 */
export function RealEstateLotPanel({ kind, assetId, holdingId, linked, manual }: { kind: LotKind; assetId: string; holdingId: string; linked: boolean; manual?: PropertyMeta | null }) {
  const router = useRouter();
  const [view, setView] = useState<LotView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [loading, start] = useTransition();

  useEffect(() => {
    if (!linked) return;
    start(async () => {
      const r = await lotViewAction(assetId);
      if ('error' in r) setError(r.error);
      else {
        setError(null);
        setView(r);
      }
    });
  }, [assetId, linked]);

  const short = propertyKindShort(kind);
  if (!linked || editing) {
    return (
      <section className="card" id="real-estate">
        <div className="stack" style={{ gap: 4 }}>
          <h2>{linked ? '위치 바꾸기' : '실거래가 · 동네 시세'}</h2>
          <ManualNote manual={manual} />
          <p className="sub">
            {short} 실거래가는 지번이 가려져 나와 이 자산의 거래를 집어낼 수 없습니다. 위치를 고르면 같은 동의 {short} 거래와 ㎡당 가격을 보여 주고, 면적을 적으면 그 가격으로 참고 시세를 계산합니다.
          </p>
        </div>
        <Connect
          kind={kind}
          assetId={assetId}
          onDone={() => {
            setEditing(false);
            setView(null);
            router.refresh();
          }}
          onCancel={linked ? () => setEditing(false) : undefined}
        />
      </section>
    );
  }

  const meta = view?.meta;
  const r = view?.report;
  const change = r && r.dong.recent && r.dong.yearAgo ? r.dong.recent / r.dong.yearAgo - 1 : null;
  const what = meta ? [meta.umdNm, meta.use ?? short].join(' ') : '';
  const showFloor = kind === 'commercial';
  return (
    <section className="card" id="real-estate" aria-busy={loading}>
      <div className="spread">
        <div className="stack" style={{ gap: 4 }}>
          <h2>실거래가 · 동네 시세</h2>
          {meta && (
            <p className="sub">
              {meta.roadAddress ?? meta.address}
              {meta.use ? ` · ${LOT_USE_LABEL[kind]} ${meta.use}` : ''}
              {meta.area ? ` · ${LOT_AREA_LABEL[kind]} ${sqm(meta.area)}` : ''}
            </p>
          )}
        </div>
        <div className="inline">
          {meta && (
            <a className="btn small" href={`https://m.land.naver.com/search/result/${encodeURIComponent(meta.address)}`} target="_blank" rel="noreferrer">
              네이버 부동산 ↗
            </a>
          )}
          <a className="btn small" href={RTMS_URL} target="_blank" rel="noreferrer">
            국토부 실거래가 ↗
          </a>
          <button type="button" className="btn small" onClick={() => setEditing(true)}>
            위치 바꾸기
          </button>
        </div>
      </div>

      {error && <p className="msg err">{error}</p>}
      {loading && !view && <p className="empty">실거래가를 불러오는 중…</p>}

      {meta && r && (
        <>
          <div className="row">
            <div className="kpi">
              <div className="label">참고 시세</div>
              <div className="value money">{r.reference ? eok(r.reference.price) : '—'}</div>
              <div className="note">{r.reference ? r.reference.basis : meta.area ? `최근 1년 동안 ${what} 거래가 없습니다.` : `${LOT_AREA_LABEL[kind]}을 적으면 계산합니다. 위치 바꾸기에서 넣으세요.`}</div>
            </div>
            <div className="kpi">
              <div className="label">{`${what} 3.3㎡당 (최근 1년)`}</div>
              <div className="value money">{r.perArea !== null ? eok(r.perArea * PYEONG) : '—'}</div>
              <div className="note">{r.perArea !== null ? `㎡당 ${eok(r.perArea)} · 거래 ${r.perAreaDeals}건 중앙값` : '최근 1년 거래 없음'}</div>
            </div>
            <div className="kpi">
              <div className="label">{`${meta.umdNm} 3.3㎡당 (최근 3개월)`}</div>
              <div className="value money">{r.dong.recent ? eok(r.dong.recent) : '—'}</div>
              <div className={`note money ${change !== null ? tone(change) : ''}`}>
                {change !== null ? `1년 전 대비 ${pct(change, 1)}` : '비교할 1년 전 거래가 부족합니다'} · 거래 {r.dong.recentDeals}건
              </div>
            </div>
          </div>

          {r.reference && (
            <ActionForm action={valuationAction} className="inline" confirm={`평가 가치를 ${eok(r.reference.price)}으로 기록할까요? 동네 거래로 계산한 참고 값입니다.`}>
              <input type="hidden" name="holdingId" value={holdingId} />
              <input type="hidden" name="price" value={r.reference.price} />
              <input type="hidden" name="tradeAt" value={nowLocal()} />
              <input type="hidden" name="memo" value={`국토부 실거래가 참고: ${r.reference.basis}`.slice(0, 200)} />
              <Submit className="btn small primary" pendingText="기록 중…">
                참고 시세를 평가 가치로 기록
              </Submit>
              <span className="sub">동네 평균이라 위치·도로·건물 상태에 따라 실제 가격과 차이가 큽니다. 감정가나 공시가격과 함께 보세요.</span>
            </ActionForm>
          )}

          <PerAreaChart view={view} />

          {r.deals.length > 0 ? (
            <>
              <h3>{`${what} 거래 (최근 2년)`}</h3>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">계약일</th>
                      <th scope="col" className="l">지번</th>
                      {!meta.use && <th scope="col" className="l">{LOT_USE_LABEL[kind]}</th>}
                      <th scope="col">{LOT_AREA_LABEL[kind]}</th>
                      {kind === 'house' && <th scope="col">연면적</th>}
                      {showFloor && <th scope="col">층</th>}
                      <th scope="col">거래금액</th>
                      <th scope="col">3.3㎡당</th>
                      {kind !== 'land' && <th scope="col">건축</th>}
                      <th scope="col" className="l">비고</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.deals.slice(0, 30).map((t, i) => (
                      <tr key={`${t.date}:${t.jibun}:${t.price}:${i}`} className={t.cancelled ? 'muted' : t.maybeOwn ? 'strong' : undefined}>
                        <td>{t.date}</td>
                        <td className="l muted">{t.jibun ?? '—'}</td>
                        {!meta.use && <td className="l">{t.use ?? '—'}</td>}
                        <td className="money">{sqm(t.area)}</td>
                        {kind === 'house' && <td className="money muted">{t.floorArea ? sqm(t.floorArea) : '—'}</td>}
                        {showFloor && <td>{t.floor ?? '—'}</td>}
                        <td className="money strong">{t.cancelled ? <s>{eok(t.price)}</s> : eok(t.price)}</td>
                        <td className="money muted">{eok((t.price / t.area) * PYEONG)}</td>
                        {kind !== 'land' && <td className="muted">{t.buildYear ?? '—'}</td>}
                        <td className="l muted">
                          {[t.maybeOwn ? '지번이 맞을 수도' : null, t.cancelled ? '해제' : null, t.share ? '지분' : null, t.dealing === '직거래' ? '직거래' : null, kind !== 'house' ? t.zoning : null].filter(Boolean).join(' · ')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className="empty">최근 2년 동안 {what} 거래가 없습니다.</p>
          )}

          <p className="sub">
            출처: 국토교통부 {RTMS_SERVICES[kind].title} ({view.asOf} 조회). 계약일 기준이며 지번은 가려져 나옵니다. 굵게 표시한 거래는 가려진 지번이 이 자산의 지번({meta.jibun ?? '모름'})과 맞을 수도 있는 거래입니다.
          </p>
        </>
      )}
    </section>
  );
}
