import { useState } from 'react';
import { Link } from 'react-router-dom';
import { LOT_METHOD_LABEL, type LotMethod } from '@/domain/lots';
import { TXN_LABEL } from '@/domain/ledger';
import { addPortfolio, deletePortfolio, deleteTxn, updatePortfolio } from '~/core/store';
import { useBook } from '../hooks';
import { kstDateTime, price, qty, shortWon } from '../format';
import { Msg, Topbar, useAction } from '../kit';

const METHODS = (Object.keys(LOT_METHOD_LABEL) as LotMethod[]).filter((m) => m !== 'SPECIFIC');

export function Portfolios() {
  const data = useBook();
  const act = useAction();
  const [name, setName] = useState('');
  const [method, setMethod] = useState<LotMethod>('FIFO');
  if (!data) return <Topbar title="포트폴리오" back />;
  const views = new Map(data.book.portfolios.map((v) => [v.portfolio.id, v]));
  return (
    <>
      <Topbar title="포트폴리오" back />
      <div className="page">
        <section className="card form">
          <h2>새 포트폴리오</h2>
          <p className="sub">계좌나 목적별로 나눕니다. 예: 미국 주식, 연금저축, 부동산·대출.</p>
          <label className="field">
            이름
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="미국 주식" />
          </label>
          <label className="field">
            매도할 때 기본 Lot 방식
            <select value={method} onChange={(e) => setMethod(e.target.value as LotMethod)}>
              {METHODS.map((m) => (
                <option key={m} value={m}>{LOT_METHOD_LABEL[m]}</option>
              ))}
            </select>
          </label>
          <button className="btn primary" disabled={act.busy} onClick={() => act.run(async () => { await addPortfolio(name, method); setName(''); return '만들었습니다. 아래 기록 탭에서 거래를 넣으세요.'; })}>
            만들기
          </button>
          <Msg {...act.msg} />
        </section>
        {data.portfolios.map((p) => {
          const v = views.get(p.id);
          return (
            <section key={p.id} className="card">
              <div className="card-head">
                <h2>{p.name}</h2>
                <span className="strong">{v ? shortWon(v.valueKrw) : p.archived ? '보관됨' : ''}</span>
              </div>
              <div className="sub">
                {LOT_METHOD_LABEL[p.lotMethod]} · 거래 {data.txns.filter((t) => t.portfolioId === p.id).length}건
              </div>
              <div className="actions">
                <Link className="btn small" to={`/holdings?p=${p.id}`}>보유 자산</Link>
                <button className="btn small" onClick={() => { const n = window.prompt('새 이름', p.name); if (n) act.run(async () => { await updatePortfolio(p.id, { name: n }); return '이름을 바꿨습니다.'; }); }}>이름 바꾸기</button>
                <button className="btn small" onClick={() => act.run(async () => { await updatePortfolio(p.id, { archived: !p.archived }); return p.archived ? '다시 꺼냈습니다.' : '보관했습니다. 합계에서 빠집니다.'; })}>{p.archived ? '보관 해제' : '보관'}</button>
                <button className="btn small danger" onClick={() => window.confirm(`${p.name}과 그 안의 거래를 모두 지울까요?`) && act.run(async () => { await deletePortfolio(p.id); return '지웠습니다.'; })}>지우기</button>
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}

export function Txns() {
  const data = useBook();
  const act = useAction();
  const [limit, setLimit] = useState(60);
  if (!data) return <Topbar title="거래 내역" back />;
  const assets = new Map(data.assets.map((a) => [a.id, a]));
  const pname = new Map(data.portfolios.map((p) => [p.id, p.name]));
  const problems = new Map(data.book.problems.map((p) => [p.txnId, p.message]));
  const list = [...data.txns].sort((a, b) => (a.tradeAt < b.tradeAt ? 1 : -1));
  return (
    <>
      <Topbar title="거래 내역" back />
      <div className="page">
        <Msg {...act.msg} />
        <section className="card flush">
          <div className="list">
            {list.slice(0, limit).map((t) => {
              const a = t.assetId ? assets.get(t.assetId) : null;
              return (
                <div key={t.id} className="row" style={{ cursor: 'default' }}>
                  <div className="grow">
                    <span className="name">
                      {TXN_LABEL[t.type]} {a ? a.name : ''}
                    </span>
                    <span className="sub">
                      {kstDateTime(t.tradeAt)} · {pname.get(t.portfolioId)}
                      {t.qty ? ` · ${qty(t.qty)} @ ${price(t.price, t.currency)}` : t.amount ? ` · ${price(t.amount, t.currency)}` : t.price ? ` · ${price(t.price, t.currency)}` : ''}
                      {t.serverId ? ' · 서버에 있음' : ''}
                    </span>
                    {problems.has(t.id) && <span className="err-text sub">{problems.get(t.id)}</span>}
                  </div>
                  <button className="btn small danger" aria-label="거래 지우기" onClick={() => window.confirm('이 거래를 지울까요?') && act.run(async () => { await deleteTxn(t.id); return '지웠습니다.'; })}>
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        </section>
        {list.length > limit && <button className="btn" onClick={() => setLimit(limit + 100)}>더 보기 ({list.length - limit}건)</button>}
        {!list.length && <div className="card empty">아직 거래가 없습니다.</div>}
      </div>
    </>
  );
}
