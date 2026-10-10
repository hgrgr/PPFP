import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { LIABILITY_KINDS } from '@/domain/net-worth';
import { LOT_METHOD_LABEL, type LotMethod } from '@/domain/lots';
import { TXN_LABEL, type TxnType } from '@/domain/ledger';
import { ensureAsset, recordTxn } from '~/core/store';
import { ASSET_TYPES, ASSET_TYPE_LABEL, LISTED_TYPES, type AssetType } from '~/core/types';
import { useBook } from '../hooks';
import { nowLocal, qty as fmtQty } from '../format';
import { Msg, Topbar, useAction } from '../kit';

const TYPES: TxnType[] = ['BUY', 'SELL', 'DEPOSIT', 'WITHDRAW', 'DIVIDEND', 'INTEREST', 'FEE', 'TAX', 'SPLIT', 'VALUATION'];
const NEEDS_ASSET: TxnType[] = ['BUY', 'SELL', 'SPLIT', 'VALUATION'];
const MAY_ASSET: TxnType[] = ['DIVIDEND', 'INTEREST'];

export function Record() {
  const data = useBook();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const act = useAction();
  const [type, setType] = useState<TxnType>('BUY');
  const [portfolioId, setPortfolioId] = useState('');
  const [assetId, setAssetId] = useState(sp.get('asset') ?? '');
  const [newAsset, setNewAsset] = useState({ type: 'KR_STOCK' as AssetType, symbol: '', name: '', currency: 'KRW' as 'KRW' | 'USD', kind: '' });
  const [f, setF] = useState({ localAt: nowLocal(), qty: '', price: '', amount: '', fee: '', tax: '', fxRate: '', currency: 'KRW' as 'KRW' | 'USD', useCash: true, ratio: '', lotMethod: '' as LotMethod | '', memo: '' });
  const set = (k: keyof typeof f, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    if (data && !portfolioId && data.portfolios[0]) setPortfolioId(data.portfolios.find((p) => !p.archived)?.id ?? '');
  }, [data, portfolioId]);
  useEffect(() => {
    if (data?.fx && !f.fxRate) set('fxRate', data.fx.rate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.fx]);

  const held = useMemo(() => (data ? data.book.holdings.filter((h) => h.portfolioId === portfolioId) : []), [data, portfolioId]);
  if (!data) return <Topbar title="기록" />;
  if (!data.portfolios.length)
    return (
      <>
        <Topbar title="기록" />
        <div className="page">
          <div className="card empty">
            <p>거래를 넣을 포트폴리오를 먼저 만드세요.</p>
            <Link className="btn primary" to="/portfolios">포트폴리오 만들기</Link>
          </div>
        </div>
      </>
    );

  const assetChoices = type === 'SELL' || type === 'SPLIT' ? held.map((h) => h.asset) : data.assets;
  const chosen = data.assets.find((a) => a.id === assetId);
  const currency = chosen?.currency ?? (assetId === '__new' ? (newAsset.type === 'US_STOCK' ? 'USD' : LISTED_TYPES.includes(newAsset.type) ? 'KRW' : newAsset.currency) : f.currency);
  const trade = type === 'BUY' || type === 'SELL';
  const heldQty = held.find((h) => h.asset.id === assetId)?.qty;

  const submit = () =>
    act.run(async () => {
      let id = assetId && assetId !== '__new' ? assetId : null;
      if (assetId === '__new') {
        const a = await ensureAsset({ type: newAsset.type, symbol: newAsset.symbol, name: newAsset.name, currency: newAsset.currency, kind: newAsset.kind || null });
        id = a.id;
      }
      await recordTxn({ portfolioId, type, assetId: id, ...f, currency, lotMethod: f.lotMethod || null });
      setF((x) => ({ ...x, qty: '', price: '', amount: '', fee: '', tax: '', ratio: '', memo: '' }));
      if (id) setAssetId(id);
      return `${TXN_LABEL[type]}를 기록했습니다.`;
    });

  return (
    <>
      <Topbar title="거래 기록" right={<Link to="/txns" className="sub">내역 ›</Link>} />
      <div className="page">
        <section className="card form" aria-label="거래 입력">
          <label className="field">
            포트폴리오
            <select value={portfolioId} onChange={(e) => setPortfolioId(e.target.value)}>
              {data.portfolios.filter((p) => !p.archived).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
          <div className="seg" role="tablist" aria-label="거래 유형">
            {TYPES.map((t) => (
              <button key={t} role="tab" aria-selected={type === t} className={type === t ? 'on' : ''} onClick={() => setType(t)}>
                {TXN_LABEL[t]}
              </button>
            ))}
          </div>

          {(NEEDS_ASSET.includes(type) || MAY_ASSET.includes(type)) && (
            <label className="field">
              자산{MAY_ASSET.includes(type) ? ' (선택)' : ''}
              <select value={assetId} onChange={(e) => setAssetId(e.target.value)}>
                <option value="">{MAY_ASSET.includes(type) ? '없음 (계좌 이자 등)' : '고르세요'}</option>
                {assetChoices.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                    {a.symbol ? ` (${a.symbol})` : ''}
                  </option>
                ))}
                {type === 'BUY' && <option value="__new">+ 새 자산</option>}
              </select>
              {type === 'SELL' && heldQty && <span className="hint">보유 {fmtQty(heldQty)}</span>}
            </label>
          )}

          {assetId === '__new' && type === 'BUY' && (
            <div className="card" style={{ background: 'var(--surface-2)' }}>
              <label className="field">
                자산 유형
                <select value={newAsset.type} onChange={(e) => setNewAsset({ ...newAsset, type: e.target.value as AssetType })}>
                  {ASSET_TYPES.map((t) => (
                    <option key={t} value={t}>{ASSET_TYPE_LABEL[t]}</option>
                  ))}
                </select>
              </label>
              {LISTED_TYPES.includes(newAsset.type) && (
                <label className="field">
                  종목코드
                  <input value={newAsset.symbol} onChange={(e) => setNewAsset({ ...newAsset, symbol: e.target.value })} placeholder={newAsset.type === 'KR_STOCK' ? '005930' : newAsset.type === 'US_STOCK' ? 'AAPL' : 'BTC'} autoCapitalize="characters" />
                  <span className="hint">{newAsset.type === 'CRYPTO' ? '업비트 원화 마켓 이름(BTC, ETH)' : newAsset.type === 'KR_STOCK' ? '6자리 종목코드' : '미국 티커'}</span>
                </label>
              )}
              <label className="field">
                이름
                <input value={newAsset.name} onChange={(e) => setNewAsset({ ...newAsset, name: e.target.value })} placeholder={newAsset.type === 'LIABILITY' ? '주택담보대출' : newAsset.type === 'REAL_ESTATE' ? '래미안 34평형' : '삼성전자'} />
              </label>
              {!LISTED_TYPES.includes(newAsset.type) && (
                <div className="grid2">
                  <label className="field">
                    통화
                    <select value={newAsset.currency} onChange={(e) => setNewAsset({ ...newAsset, currency: e.target.value as 'KRW' | 'USD' })}>
                      <option value="KRW">원</option>
                      <option value="USD">달러</option>
                    </select>
                  </label>
                  {newAsset.type === 'LIABILITY' && (
                    <label className="field">
                      종류
                      <select value={newAsset.kind} onChange={(e) => setNewAsset({ ...newAsset, kind: e.target.value })}>
                        <option value="">기타 부채</option>
                        {Object.entries(LIABILITY_KINDS).map(([k, v]) => (
                          <option key={k} value={k}>{v}</option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
              )}
              {!LISTED_TYPES.includes(newAsset.type) && <p className="sub">시세가 없는 자산은 수량 1, 단가에 지금 가치(대출은 원금)를 넣고, 바뀌면 자산 화면에서 평가 가치를 기록하세요.</p>}
            </div>
          )}

          <label className="field">
            일시 (한국 시간)
            <input type="datetime-local" value={f.localAt} onChange={(e) => set('localAt', e.target.value)} />
          </label>

          {trade && (
            <div className="grid2">
              <label className="field">
                수량
                <input inputMode="decimal" value={f.qty} onChange={(e) => set('qty', e.target.value)} />
              </label>
              <label className="field">
                단가 ({currency === 'USD' ? '달러' : '원'})
                <input inputMode="decimal" value={f.price} onChange={(e) => set('price', e.target.value)} />
              </label>
              <label className="field">
                수수료
                <input inputMode="decimal" value={f.fee} onChange={(e) => set('fee', e.target.value)} placeholder="0" />
              </label>
              <label className="field">
                세금
                <input inputMode="decimal" value={f.tax} onChange={(e) => set('tax', e.target.value)} placeholder="0" />
              </label>
            </div>
          )}
          {type === 'VALUATION' && (
            <label className="field">
              평가 단가 ({currency === 'USD' ? '달러' : '원'})
              <input inputMode="decimal" value={f.price} onChange={(e) => set('price', e.target.value)} />
            </label>
          )}
          {type === 'SPLIT' && (
            <label className="field">
              분할 비율
              <input inputMode="decimal" value={f.ratio} onChange={(e) => set('ratio', e.target.value)} placeholder="2 (1주가 2주로)" />
            </label>
          )}
          {!trade && type !== 'SPLIT' && type !== 'VALUATION' && (
            <div className="grid2">
              <label className="field">
                금액
                <input inputMode="decimal" value={f.amount} onChange={(e) => set('amount', e.target.value)} />
              </label>
              {!chosen && (
                <label className="field">
                  통화
                  <select value={f.currency} onChange={(e) => set('currency', e.target.value)}>
                    <option value="KRW">원</option>
                    <option value="USD">달러</option>
                  </select>
                </label>
              )}
            </div>
          )}
          {currency === 'USD' && type !== 'SPLIT' && (
            <label className="field">
              환율 (1달러당 원)
              <input inputMode="decimal" value={f.fxRate} onChange={(e) => set('fxRate', e.target.value)} />
            </label>
          )}
          {trade && (
            <label className="check">
              <input type="checkbox" checked={f.useCash} onChange={(e) => set('useCash', e.target.checked)} />
              {type === 'BUY' ? '포트폴리오 현금으로 샀음 (끄면 밖에서 들여온 자산)' : '매도 대금을 포트폴리오 현금으로 받음'}
            </label>
          )}
          {type === 'SELL' && (
            <label className="field">
              Lot 방식
              <select value={f.lotMethod} onChange={(e) => set('lotMethod', e.target.value)}>
                <option value="">포트폴리오 기본</option>
                {(Object.keys(LOT_METHOD_LABEL) as LotMethod[]).filter((m) => m !== 'SPECIFIC').map((m) => (
                  <option key={m} value={m}>{LOT_METHOD_LABEL[m]}</option>
                ))}
              </select>
            </label>
          )}
          <label className="field">
            메모
            <input value={f.memo} onChange={(e) => set('memo', e.target.value)} maxLength={500} />
          </label>
          <button className="btn primary block" disabled={act.busy || !portfolioId} onClick={submit}>
            {act.busy ? '기록 중…' : `${TXN_LABEL[type]} 기록`}
          </button>
          <Msg {...act.msg} />
          {act.msg.ok && (
            <button className="btn" onClick={() => nav('/')}>홈으로</button>
          )}
        </section>
      </div>
    </>
  );
}
