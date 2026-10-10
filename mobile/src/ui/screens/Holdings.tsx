import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Dec } from '@/domain/decimal';
import { TXN_LABEL } from '@/domain/ledger';
import { mergeByAsset } from '~/core/book';
import { db, kstToday } from '~/core/db';
import { addAlert, deleteAssetIfUnused, deleteTxn, recordTxn, updateAsset } from '~/core/store';
import { ASSET_TYPE_LABEL, LISTED_TYPES } from '~/core/types';
import { useBook, useLive } from '../hooks';
import { kstDate, pct, price, qty, shortWon, tone, won } from '../format';
import { Msg, Topbar, useAction } from '../kit';

export function Holdings() {
  const data = useBook();
  const [sp] = useSearchParams();
  const pid = sp.get('p');
  const [q, setQ] = useState('');
  if (!data) return <Topbar title="보유 자산" />;
  const scoped = pid ? data.book.holdings.filter((h) => h.portfolioId === pid) : data.book.holdings;
  const rows = mergeByAsset(scoped).filter((r) => !q || r.asset.name.includes(q) || (r.asset.symbol ?? '').includes(q.toUpperCase()));
  const portfolio = pid ? data.portfolios.find((p) => p.id === pid) : null;
  const total = rows.reduce((s, r) => s.add(r.valueKrw), Dec.ZERO);
  return (
    <>
      <Topbar title={portfolio ? portfolio.name : '보유 자산'} back={!!pid} />
      <div className="page">
        <div className="card">
          <div className="card-head">
            <span className="sub">{rows.length}개 자산</span>
            <span className="strong num">{won(total)}</span>
          </div>
          <input className="input" placeholder="이름이나 종목코드로 찾기" value={q} onChange={(e) => setQ(e.target.value)} aria-label="자산 찾기" />
        </div>
        {rows.length ? (
          <section className="card flush">
            <div className="list">
              {rows.map((r) => (
                <Link key={r.asset.id} to={`/asset/${r.asset.id}`} className="row">
                  <div className="grow">
                    <span className="name">{r.asset.name}</span>
                    <span className="sub">
                      {ASSET_TYPE_LABEL[r.asset.type]} · {qty(r.qty)}
                      {r.asset.symbol ? ` · ${price(r.price, r.asset.currency)}` : ''}
                    </span>
                  </div>
                  <div className="end">
                    <span className="strong">{shortWon(r.valueKrw)}</span>
                    {r.asset.type !== 'LIABILITY' && r.costKrw.isPos() && <span className={`sub ${tone(r.pnlKrw)}`}>{pct(r.pnlKrw.div(r.costKrw).toNumber())}</span>}
                  </div>
                </Link>
              ))}
            </div>
          </section>
        ) : (
          <div className="card empty">
            <p>아직 보유한 자산이 없습니다.</p>
            <Link className="btn primary" to="/record">거래 기록하기</Link>
          </div>
        )}
      </div>
    </>
  );
}

export function AssetDetail() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const data = useBook();
  const alerts = useLive(() => db.alerts.where('assetId').equals(id).toArray(), [id]);
  const journals = useLive(() => db.journals.where('assetId').equals(id).toArray(), [id]);
  const act = useAction();
  const [alertPrice, setAlertPrice] = useState('');
  const [valuation, setValuation] = useState('');
  if (!data) return <Topbar title="자산" back />;
  const asset = data.assets.find((a) => a.id === id);
  if (!asset) return <Topbar title="없는 자산" back />;
  const holds = data.book.holdings.filter((h) => h.asset.id === id);
  const txns = data.txns.filter((t) => t.assetId === id).sort((a, b) => (a.tradeAt < b.tradeAt ? 1 : -1));
  const pname = new Map(data.portfolios.map((p) => [p.id, p.name]));
  const merged = mergeByAsset(holds)[0];
  const listed = LISTED_TYPES.includes(asset.type) && !!asset.symbol;

  return (
    <>
      <Topbar title={asset.name} back />
      <div className="page">
        <section className="card">
          <div className="sub">
            {ASSET_TYPE_LABEL[asset.type]}
            {asset.symbol ? ` · ${asset.symbol}` : ''}
          </div>
          <div className="big">{merged ? won(merged.valueKrw) : '보유 없음'}</div>
          {merged && asset.type !== 'LIABILITY' && merged.costKrw.isPos() && (
            <div className={`num ${tone(merged.pnlKrw)}`}>
              {merged.pnlKrw.isNeg() ? '' : '+'}
              {won(merged.pnlKrw)} ({pct(merged.pnlKrw.div(merged.costKrw).toNumber())})
            </div>
          )}
          <div className="kpis">
            <div className="kpi">
              <span className="sub">현재가</span>
              <span className="v">{price(asset.price ?? holds[0]?.price ?? null, asset.currency)}</span>
            </div>
            <div className="kpi">
              <span className="sub">수량</span>
              <span className="v">{merged ? qty(merged.qty) : '0'}</span>
            </div>
          </div>
          {holds.map((h) => (
            <div key={h.portfolioId} className="sub">
              {pname.get(h.portfolioId)}: {qty(h.qty)} · 평균 {price(h.avgCost, asset.currency)} · Lot {h.lots.length}개 · 가격 출처 {h.priceFrom === 'market' ? asset.priceSource ?? '시세' : h.priceFrom === 'valuation' ? '직접 평가' : '매입가'}
            </div>
          ))}
        </section>

        {!listed && (
          <section className="card">
            <h2>평가 가치 기록</h2>
            <p className="sub">예금·부동산·대출처럼 시세가 없는 자산은 지금 1단위의 가치를 직접 넣습니다. {asset.type === 'LIABILITY' ? '대출은 남은 원금을 넣으세요.' : ''}</p>
            <div className="grid2">
              <input className="input" inputMode="decimal" placeholder="단가" value={valuation} onChange={(e) => setValuation(e.target.value)} aria-label="평가 단가" />
              <button
                className="btn"
                disabled={act.busy || !holds.length}
                onClick={() =>
                  act.run(async () => {
                    for (const h of holds) await recordTxn({ portfolioId: h.portfolioId, type: 'VALUATION', assetId: id, localAt: `${kstToday()}T12:00`, price: valuation });
                    await updateAsset(id, { price: null });
                    setValuation('');
                    return '평가 가치를 기록했습니다.';
                  })
                }
              >
                기록
              </button>
            </div>
          </section>
        )}

        {listed && (
          <section className="card">
            <h2>가격 알림</h2>
            <p className="sub">시세를 새로 받을 때(앱을 열 때와 새로고침) 확인합니다. 서버를 연동하면 서버가 1분마다 봅니다.</p>
            <div className="grid2">
              <input className="input" inputMode="decimal" placeholder={`가격 (${asset.currency === 'USD' ? '달러' : '원'})`} value={alertPrice} onChange={(e) => setAlertPrice(e.target.value)} aria-label="알림 가격" />
              <div className="actions">
                <button className="btn small" disabled={act.busy} onClick={() => act.run(async () => { await addAlert({ assetId: id, direction: 'ABOVE', price: alertPrice }); setAlertPrice(''); return '이상 알림을 만들었습니다.'; })}>이상</button>
                <button className="btn small" disabled={act.busy} onClick={() => act.run(async () => { await addAlert({ assetId: id, direction: 'BELOW', price: alertPrice }); setAlertPrice(''); return '이하 알림을 만들었습니다.'; })}>이하</button>
              </div>
            </div>
            {(alerts ?? []).map((a) => (
              <div key={a.id} className="card-head">
                <span className={a.active ? '' : 'sub'}>
                  {price(a.price, asset.currency)} {a.direction === 'ABOVE' ? '이상' : '이하'} {a.firedAt ? `· ${kstDate(a.firedAt)} 도달` : a.active ? '' : '· 꺼짐'}
                </span>
                <button className="btn small danger" onClick={() => db.alerts.delete(a.id)}>지우기</button>
              </div>
            ))}
          </section>
        )}
        <Msg {...act.msg} />

        <section className="card flush">
          <div className="card-head" style={{ padding: '14px 14px 4px' }}>
            <h2>거래</h2>
            <Link to={`/record?asset=${id}`} className="sub">+ 기록</Link>
          </div>
          <div className="list">
            {txns.map((t) => (
              <div key={t.id} className="row" style={{ cursor: 'default' }}>
                <div className="grow">
                  <span className="name">
                    {TXN_LABEL[t.type]} {t.qty ? qty(t.qty) : ''} {t.price ? `@ ${price(t.price, t.currency)}` : t.amount ? price(t.amount, t.currency) : ''}
                  </span>
                  <span className="sub">
                    {kstDate(t.tradeAt)} · {pname.get(t.portfolioId)}
                    {t.memo ? ` · ${t.memo}` : ''}
                  </span>
                </div>
                <button className="btn small danger" onClick={() => window.confirm('이 거래를 지울까요?') && act.run(async () => { await deleteTxn(t.id); return '지웠습니다.'; })}>지우기</button>
              </div>
            ))}
          </div>
        </section>

        {(journals ?? []).length > 0 && (
          <section className="card">
            <h2>매매일지</h2>
            {(journals ?? []).map((j) => (
              <Link key={j.id} to={`/journals/${j.id}`} className="sub">
                {j.title} · 목표 {price(j.targetPrice, asset.currency)}
              </Link>
            ))}
          </section>
        )}

        {!txns.length && (
          <button className="btn danger" onClick={() => act.run(async () => { await deleteAssetIfUnused(id); nav(-1); })}>
            자산 지우기
          </button>
        )}
      </div>
    </>
  );
}
