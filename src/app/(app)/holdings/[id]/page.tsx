import { notFound } from 'next/navigation';
import { buyAction, deleteTransactionAction, sellAction, splitAction, valuationAction } from '@/app/actions';
import { ActionForm, DateTimeField, Submit } from '@/components/forms';
import { SellForm } from '@/components/sell-form';
import { Dec } from '@/domain/decimal';
import { TXN_LABEL } from '@/domain/ledger';
import { averageCost, LOT_METHOD_LABEL, type Lot } from '@/domain/lots';
import { kstDateTime, krw, money, pct, qty, tone } from '@/lib/format';
import { requireUser } from '@/server/auth';
import { dec, kstIso, prisma } from '@/server/db';
import { fxRate, getQuotes } from '@/server/market';
import { ASSET_TYPE_LABEL } from '@/server/services/assets';

export const dynamic = 'force-dynamic';

export default async function HoldingPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const h = await prisma.holding.findFirst({
    where: { id, portfolio: { userId: user.id } },
    include: {
      asset: true,
      portfolio: true,
      lots: { orderBy: { acquiredAt: 'asc' } },
      transactions: { orderBy: { tradeAt: 'desc' }, include: { consumptions: true } },
    },
  });
  if (!h) notFound();
  const [quotes, usd] = await Promise.all([getQuotes(user.id, [h.asset]), fxRate(user.id, 'USD')]);
  const quote = quotes.get(h.assetId);
  const fxNow = h.asset.currency === 'KRW' ? Dec.ONE : usd;
  const open = h.lots.filter((l) => dec(l.qtyRemaining).isPos());
  const lots: Lot[] = open.map((l) => ({ id: l.id, acquiredAt: kstIso(l.acquiredAt), qtyRemaining: dec(l.qtyRemaining), unitCost: dec(l.unitCost), fxRate: dec(l.fxRate) }));
  const totalQty = Dec.sum(lots.map((l) => l.qtyRemaining));
  const avg = averageCost(lots);
  const price = quote?.price ?? null;
  const sign = h.asset.type === 'LIABILITY' ? -1 : 1;
  const valueKrw = price ? totalQty.mul(price).mul(fxNow).mul(sign) : null;
  const costKrw = Dec.sum(lots.map((l) => l.qtyRemaining.mul(l.unitCost).mul(l.fxRate))).mul(sign);
  const realized = Dec.sum(h.transactions.flatMap((t) => t.consumptions.map((c) => dec(c.pnlBase))));
  const manual = h.asset.priceSource === 'MANUAL';
  const liability = h.asset.type === 'LIABILITY';

  return (
    <>
      <header className="page-head">
        <div className="stack" style={{ gap: 6 }}>
          <nav className="crumbs">
            <a href="/portfolios">포트폴리오</a> › <a href={`/portfolios/${h.portfolioId}`}>{h.portfolio.name}</a>
          </nav>
          <h1>{h.asset.name}</h1>
          <p className="sub">
            {[h.asset.symbol, h.asset.market, ASSET_TYPE_LABEL[h.asset.type], h.asset.currency, manual ? '수기 시세' : '토스증권 시세'].filter(Boolean).join(' · ')}
          </p>
        </div>
      </header>

      <section className="row">
        <div className="card kpi">
          <div className="label">현재가</div>
          <div className="value">{price ? money(price.toString(), h.asset.currency) : '—'}</div>
          <div className="note">{quote?.asOf ? `${kstDateTime(quote.asOf)} 기준` : '시세 없음'}{quote?.stale ? ' · 지연' : ''}</div>
        </div>
        <div className="card kpi">
          <div className="label">보유 수량 · 평균단가</div>
          <div className="value money">{qty(totalQty.toString())}</div>
          <div className="note">평균 {money(avg.toFixed(4), h.asset.currency)} · Lot {lots.length}개</div>
        </div>
        <div className="card kpi">
          <div className="label">평가액 (원화)</div>
          <div className="value money">{valueKrw ? krw(valueKrw.toString()) : '—'}</div>
          <div className={`note money ${valueKrw ? tone(valueKrw.sub(costKrw).toString()) : ''}`}>
            {valueKrw ? `미실현 ${krw(valueKrw.sub(costKrw).toString())}${costKrw.isZero() ? '' : ` (${pct(valueKrw.sub(costKrw).div(costKrw.abs()).toString())})`}` : ''}
          </div>
        </div>
        <div className="card kpi">
          <div className="label">누적 실현손익 (원화)</div>
          <div className={`value money ${tone(realized.toString())}`}>{krw(realized.toString())}</div>
          <div className="note">환율 효과 포함</div>
        </div>
      </section>

      <section className="card">
        <h2>보유 Lot</h2>
        {open.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th scope="col">취득일시</th><th scope="col">취득 수량</th><th scope="col">잔여 수량</th><th scope="col">단가 (수수료 포함)</th><th scope="col">취득 환율</th><th scope="col">보유 기간</th><th scope="col">평가 손익</th></tr>
              </thead>
              <tbody>
                {open.map((l) => {
                  const rem = dec(l.qtyRemaining);
                  const pnl = price ? rem.mul(price).mul(fxNow).sub(rem.mul(dec(l.unitCost)).mul(dec(l.fxRate))).mul(sign) : null;
                  const days = Math.floor((Date.now() - l.acquiredAt.getTime()) / 86_400_000);
                  return (
                    <tr key={l.id}>
                      <td className="strong">{kstDateTime(l.acquiredAt)}</td>
                      <td>{qty(dec(l.qtyOriginal).toString())}</td>
                      <td className="money">{qty(rem.toString())}</td>
                      <td>{money(dec(l.unitCost).toString(), h.asset.currency)}</td>
                      <td className="muted">{h.asset.currency === 'KRW' ? '—' : dec(l.fxRate).toFixed(2)}</td>
                      <td className="muted">{days >= 365 ? `${Math.floor(days / 365)}년 ${Math.floor((days % 365) / 30)}개월` : `${days}일`}</td>
                      <td className={`money ${tone(pnl?.toString())}`}>{pnl ? krw(pnl.toString()) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty">남은 Lot이 없습니다.</p>
        )}
      </section>

      {!liability && open.length > 0 && (
        <section className="card" id="sell">
          <h2>매도 · Lot 선택</h2>
          <SellForm
            action={sellAction}
            holdingId={h.id}
            currency={h.asset.currency}
            lots={lots.map((l) => ({ id: l.id, acquiredAt: l.acquiredAt, qtyRemaining: l.qtyRemaining.toString(), unitCost: l.unitCost.toString(), fxRate: l.fxRate.toString() }))}
            defaultMethod={h.portfolio.lotMethod}
            price={price?.toString() ?? ''}
            usdkrw={usd.toFixed(2)}
          />
        </section>
      )}

      <section className="row">
        <div className="card">
          <h2>{liability ? '추가 대출' : '추가 매수'}</h2>
          <ActionForm action={buyAction} className="grid" resetOnSuccess>
            <input type="hidden" name="portfolioId" value={h.portfolioId} />
            <input type="hidden" name="assetId" value={h.assetId} />
            <label className="field">
              수량
              <input name="qty" type="number" inputMode="decimal" min="0" step="any" required />
            </label>
            <label className="field">
              단가 ({h.asset.currency})
              <input name="price" type="number" inputMode="decimal" min="0" step="any" defaultValue={price?.toString()} required />
            </label>
            <label className="field">
              수수료
              <input name="fee" type="number" inputMode="decimal" min="0" step="any" defaultValue="0" />
            </label>
            <label className="field">
              세금
              <input name="tax" type="number" inputMode="decimal" min="0" step="any" defaultValue="0" />
            </label>
            {h.asset.currency !== 'KRW' && (
              <label className="field">
                환율 (원/USD)
                <input name="fxRate" type="number" inputMode="decimal" min="0" step="any" defaultValue={usd.toFixed(2)} />
              </label>
            )}
            <DateTimeField />
            <label className="check full">
              <input type="checkbox" name="fromCash" value="1" defaultChecked />
              포트폴리오 현금으로 결제
            </label>
            <div className="full"><Submit>기록</Submit></div>
          </ActionForm>
        </div>

        {manual ? (
          <div className="card">
            <h2>평가 갱신</h2>
            <p className="sub">부동산·채권·대출처럼 시세가 자동으로 들어오지 않는 자산의 현재 가치를 기록합니다. 기록한 날부터 이 값으로 평가됩니다.</p>
            <ActionForm action={valuationAction} className="grid" resetOnSuccess>
              <input type="hidden" name="holdingId" value={h.id} />
              <label className="field">
                {liability ? '단위당 잔액' : '단위당 평가액'} ({h.asset.currency})
                <input name="price" type="number" inputMode="decimal" min="0" step="any" required />
              </label>
              <DateTimeField label="평가 기준일시 (KST)" />
              <label className="field full">
                근거 메모
                <input name="memo" maxLength={200} placeholder="예: 국토부 실거래가 2026-09" />
              </label>
              <div className="full"><Submit>갱신</Submit></div>
            </ActionForm>
          </div>
        ) : (
          <div className="card">
            <h2>분할 · 병합 · 무상증자</h2>
            <p className="sub">모든 Lot의 수량에 비율을 곱하고 단가를 나눕니다. 원가 합계는 그대로입니다. 예: 1주→4주 분할은 4, 10주→1주 병합은 0.1.</p>
            <ActionForm action={splitAction} className="grid" confirm="모든 Lot을 조정합니다. 계속할까요?">
              <input type="hidden" name="holdingId" value={h.id} />
              <label className="field">
                비율 (새 주식 수 / 기존 1주)
                <input name="ratio" type="number" inputMode="decimal" min="0" step="any" required />
              </label>
              <DateTimeField label="기준일시 (KST)" />
              <div className="full"><Submit>적용</Submit></div>
            </ActionForm>
          </div>
        )}
      </section>

      <section className="card">
        <h2>거래 내역</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th scope="col">일시</th><th scope="col">유형</th><th scope="col">수량</th><th scope="col">단가</th><th scope="col">수수료·세금</th><th scope="col">실현손익</th><th scope="col">메모</th><th scope="col"><span className="sr-only">삭제</span></th></tr>
            </thead>
            <tbody>
              {h.transactions.map((t) => {
                const pnl = t.consumptions.length ? Dec.sum(t.consumptions.map((c) => dec(c.pnl))) : null;
                return (
                  <tr key={t.id}>
                    <td>{kstDateTime(t.tradeAt)}</td>
                    <td className="strong">
                      {TXN_LABEL[t.type]}
                      {t.lotMethod && <span className="sub">{LOT_METHOD_LABEL[t.lotMethod]}</span>}
                    </td>
                    <td>{t.qty ? qty(dec(t.qty).toString()) : t.splitRatio ? `×${dec(t.splitRatio).toString()}` : '—'}</td>
                    <td>{t.price ? money(dec(t.price).toString(), t.currency) : t.type === 'DIVIDEND' ? money(dec(t.cashDelta).toString(), t.currency) : '—'}</td>
                    <td className="muted">{money(dec(t.fee).add(dec(t.tax)).toString(), t.currency)}</td>
                    <td className={pnl ? tone(pnl.toString()) : 'muted'}>{pnl ? money(pnl.toString(), t.currency) : '—'}</td>
                    <td className="l muted" style={{ whiteSpace: 'normal', maxWidth: 240 }}>{t.memo}</td>
                    <td>
                      <ActionForm action={deleteTransactionAction} confirm="이 거래를 삭제하고 Lot·현금을 되돌릴까요?">
                        <input type="hidden" name="id" value={t.id} />
                        <Submit className="btn small danger" pendingText="…">삭제</Submit>
                      </ActionForm>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
