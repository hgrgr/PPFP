'use client';

import { Fragment, useState } from 'react';
import { IndicatorChart } from '@/components/analysis-board';
import type { ChartData } from '@/domain/indicators';
import type { Listing, ListingSummary, Model } from '@/domain/subscriptions';

export interface ApplyViewData {
  region: { key: string; label: string };
  years: number;
  rows: { listing: Listing; models: Model[]; summary: ListingSummary }[];
  charts: { rate: ChartData; price: ChartData };
}

const rate = (v: number | null | undefined) => (v === null || v === undefined ? '—' : v < 1 ? `미달 (${v.toFixed(2)}:1)` : `${v.toLocaleString('ko-KR', { maximumFractionDigits: 1 })}:1`);
const eok = (won: number | null) => (won === null ? '—' : `${(won / 1e8).toLocaleString('ko-KR', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}억`);
const man = (won: number | null) => (won === null ? '—' : `${Math.round(won / 1e4).toLocaleString('ko-KR')}만`);
const md = (d: string | null) => (d ? d.slice(2).replace(/-/g, '.') : '—');

export function ApplyPanel({ view }: { view: ApplyViewData }) {
  const [open, setOpen] = useState<string | null>(null);
  const done = view.rows.filter((r) => r.summary.rate !== null);
  const avg = done.length ? done.reduce((a, r) => a + r.summary.rate!, 0) / done.length : null;
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="ind-grid">
        <section className="card indicator" aria-label="청약 흐름">
          <div className="stack" style={{ gap: 4 }}>
            <h3>{view.region.label} 청약 경쟁률</h3>
            <span className="sub">
              최근 {view.years}년 APT 분양 공고 {view.rows.length}건 · 결과가 나온 {done.length}건의 1순위 경쟁률 평균 {rate(avg)}
            </span>
          </div>
          {view.charts.rate.rows.length ? <IndicatorChart data={view.charts.rate} /> : <p className="empty">이 기간에 분양 공고가 없습니다.</p>}
          <p className="sub">{view.charts.rate.note}</p>
        </section>
        <section className="card indicator" aria-label="분양가 흐름">
          <div className="stack" style={{ gap: 4 }}>
            <h3>{view.region.label} 분양가</h3>
            <span className="sub">공고 달마다의 평균 분양가</span>
          </div>
          {view.charts.price.rows.some((r) => r.pp !== null) ? <IndicatorChart data={view.charts.price} /> : <p className="empty">분양가 자료가 없습니다.</p>}
          <p className="sub">{view.charts.price.note}</p>
        </section>
      </div>
      <section className="card indicator" aria-label="분양 공고">
        <div className="stack" style={{ gap: 4 }}>
          <h3>분양 공고</h3>
          <span className="sub">최근 공고 순. 줄을 누르면 주택형별 분양가·경쟁률·당첨가점을 봅니다. 청약홈(한국부동산원) 자료이며 은행 전산 사정으로 접수 건수가 뒤에 조금 바뀔 수 있습니다.</span>
        </div>
        {view.rows.length ? (
          <div className="table-wrap">
            <table className="rank">
              <thead>
                <tr>
                  <th className="l">공고일</th>
                  <th className="l">단지</th>
                  <th className="num">세대</th>
                  <th className="num">분양가/3.3㎡</th>
                  <th className="num">1순위 경쟁률</th>
                  <th className="num">최고 주택형</th>
                  <th className="num">당첨가점 평균</th>
                  <th className="l">당첨 발표 · 입주</th>
                </tr>
              </thead>
              <tbody>
                {view.rows.map(({ listing: l, models, summary: s }) => (
                  <Fragment key={`${l.id}-${l.pblancNo}`}>
                    <tr onClick={() => setOpen((o) => (o === l.id ? null : l.id))} style={{ cursor: 'pointer' }} aria-expanded={open === l.id}>
                      <td className="l sub">{md(l.announced)}</td>
                      <th scope="row" className="l" style={{ whiteSpace: 'normal' }}>
                        {l.name}
                        <span className="sub" style={{ display: 'block' }}>{l.address}</span>
                        {l.flags.length > 0 && (
                          <span className="inline" style={{ gap: 4, flexWrap: 'wrap', marginTop: 2 }}>
                            {l.flags.map((f) => (
                              <span key={f} className="badge">{f}</span>
                            ))}
                          </span>
                        )}
                      </th>
                      <td className="num">{l.households?.toLocaleString('ko-KR') ?? '—'}</td>
                      <td className="num">{man(s.perPyeong)}</td>
                      <td className="num strong">{models.length ? rate(s.rate) : <span className="sub">접수 전</span>}</td>
                      <td className="num">{s.maxRate ? <>{rate(s.maxRate.rate)}<span className="sub">{s.maxRate.type}</span></> : '—'}</td>
                      <td className="num">{s.score?.avg ? `${s.score.avg.toFixed(1)}점` : '—'}{s.score?.min ? <span className="sub">최저 {s.score.min}점</span> : null}</td>
                      <td className="l sub">{md(l.winners)} · {l.moveIn ?? '—'}</td>
                    </tr>
                    {open === l.id && (
                      <tr>
                        <td colSpan={8} style={{ background: 'var(--surface-2)', whiteSpace: 'normal' }}>
                          <div className="stack" style={{ gap: 8 }}>
                            <span className="sub">
                              접수 {md(l.receiptFrom)} ~ {md(l.receiptTo)} · 시공 {l.builder || '—'}
                              {l.url && (
                                <>
                                  {' · '}
                                  <a href={l.url} target="_blank" rel="noreferrer">분양 정보 ›</a>
                                </>
                              )}
                            </span>
                            {models.length ? (
                              <table className="rank">
                                <thead>
                                  <tr>
                                    <th className="l">주택형</th>
                                    <th className="num">공급면적</th>
                                    <th className="num">일반 · 특별</th>
                                    <th className="num">최고 분양가</th>
                                    <th className="num">1순위 접수</th>
                                    <th className="num">경쟁률</th>
                                    <th className="num">해당지역</th>
                                    <th className="num">당첨가점 (최저~최고, 평균)</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {models.map((m) => (
                                    <tr key={m.model}>
                                      <td className="l">{m.type}</td>
                                      <td className="num">{m.supplyArea ? `${m.supplyArea.toFixed(2)}㎡` : '—'}</td>
                                      <td className="num">{m.general} · {m.special}</td>
                                      <td className="num">{eok(m.topPrice)}</td>
                                      <td className="num">{m.rank1.toLocaleString('ko-KR')}</td>
                                      <td className="num">{rate(m.rate)}</td>
                                      <td className="num">{m.localRate ? (/^[\d.]+$/.test(m.localRate) ? `${m.localRate}:1` : m.localRate) : '—'}</td>
                                      <td className="num">{m.score ? `${m.score.min ?? '—'}~${m.score.max ?? '—'}, ${m.score.avg?.toFixed(1) ?? '—'}` : '—'}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            ) : (
                              <p className="sub">아직 접수 전이라 경쟁률이 없습니다.</p>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty">이 지역에 최근 {view.years}년 APT 분양 공고가 없습니다.</p>
        )}
      </section>
    </div>
  );
}
