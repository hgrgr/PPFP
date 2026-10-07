'use client';

import { useMemo, useState } from 'react';
import type { ActionState } from '@/app/actions';
import { Dec } from '@/domain/decimal';
import { LOT_METHOD_LABEL, LOT_METHODS, planSale, realize, type Lot, type LotMethod } from '@/domain/lots';
import { money, qty as fmtQty, tone } from '@/lib/format';
import { ActionForm, DateTimeField, Submit } from './forms';

export interface LotDTO {
  id: string;
  acquiredAt: string;
  qtyRemaining: string;
  unitCost: string;
  fxRate: string;
}

const safe = (v: string, fallback = Dec.ZERO) => {
  try {
    return v.trim() === '' ? fallback : Dec.of(v);
  } catch {
    return fallback;
  }
};

/**
 * Sell form with a live lot-selection table. The preview runs the same
 * domain functions the server uses, so what you see is what gets recorded.
 */
export function SellForm({
  action,
  holdingId,
  currency,
  lots: lotDtos,
  defaultMethod,
  price: initialPrice,
  usdkrw,
}: {
  action: (s: ActionState, f: FormData) => Promise<ActionState>;
  holdingId: string;
  currency: string;
  lots: LotDTO[];
  defaultMethod: LotMethod;
  price: string;
  usdkrw: string;
}) {
  const lots: Lot[] = useMemo(
    () => lotDtos.map((l) => ({ id: l.id, acquiredAt: l.acquiredAt, qtyRemaining: Dec.of(l.qtyRemaining), unitCost: Dec.of(l.unitCost), fxRate: Dec.of(l.fxRate) })),
    [lotDtos],
  );
  const [method, setMethod] = useState<LotMethod>(defaultMethod);
  const [qty, setQty] = useState('');
  const [price, setPrice] = useState(initialPrice);
  const [fee, setFee] = useState('0');
  const [tax, setTax] = useState('0');
  const [fx, setFx] = useState(usdkrw);
  const [specific, setSpecific] = useState<Record<string, string>>({});
  const [toCash, setToCash] = useState(true);

  const specificTotal = Dec.sum(Object.values(specific).map((v) => safe(v)));
  const effectiveQty = method === 'SPECIFIC' ? specificTotal : safe(qty);
  const plan = effectiveQty.isPos()
    ? planSale(lots, effectiveQty, method, Object.entries(specific).map(([lotId, q]) => ({ lotId, qty: safe(q) })))
    : null;
  const result =
    plan?.ok && safe(price).gte(0)
      ? realize(lots, plan.picks, { price: safe(price), fees: safe(fee).add(safe(tax)), fxRate: currency === 'KRW' ? Dec.ONE : safe(fx, Dec.ONE), at: new Date().toISOString() })
      : null;
  const pieceOf = (id: string) => result?.pieces.find((p) => p.lotId === id);

  return (
    <ActionForm action={action} className="stack">
      <input type="hidden" name="holdingId" value={holdingId} />
      <input type="hidden" name="method" value={method} />
      <input type="hidden" name="qty" value={effectiveQty.toString()} />
      <input type="hidden" name="picks" value={JSON.stringify(Object.entries(specific).filter(([, q]) => safe(q).isPos()).map(([lotId, q]) => ({ lotId, qty: q })))} />
      <input type="hidden" name="toCash" value={toCash ? '1' : '0'} />

      <div className="seg" role="group" aria-label="Lot 선택 방식" style={{ alignSelf: 'flex-start', flexWrap: 'wrap' }}>
        {LOT_METHODS.map((m) => (
          <button key={m} type="button" aria-pressed={method === m} onClick={() => setMethod(m)}>
            {LOT_METHOD_LABEL[m]}
          </button>
        ))}
      </div>

      <div className="grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12, alignItems: 'end' }}>
        <label className="field">
          매도 수량
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={method === 'SPECIFIC' ? effectiveQty.toString() : qty}
            readOnly={method === 'SPECIFIC'}
            onChange={(e) => setQty(e.target.value)}
            required
            aria-describedby="qty-help"
          />
        </label>
        <label className="field">
          단가 ({currency})
          <input name="price" type="number" inputMode="decimal" min="0" step="any" value={price} onChange={(e) => setPrice(e.target.value)} required />
        </label>
        <label className="field">
          수수료
          <input name="fee" type="number" inputMode="decimal" min="0" step="any" value={fee} onChange={(e) => setFee(e.target.value)} />
        </label>
        <label className="field">
          세금
          <input name="tax" type="number" inputMode="decimal" min="0" step="any" value={tax} onChange={(e) => setTax(e.target.value)} />
        </label>
        {currency !== 'KRW' && (
          <label className="field">
            환율 (원/USD)
            <input name="fxRate" type="number" inputMode="decimal" min="0" step="any" value={fx} onChange={(e) => setFx(e.target.value)} />
          </label>
        )}
        <DateTimeField />
      </div>
      <p id="qty-help" className="sub">
        {method === 'SPECIFIC' ? '아래 표에서 Lot마다 팔 수량을 입력하세요.' : `${LOT_METHOD_LABEL[method]} 순서로 Lot을 자동 선택합니다.`}
      </p>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">취득일</th>
              <th scope="col">잔여 수량</th>
              <th scope="col">취득 단가</th>
              <th scope="col">매도 수량</th>
              <th scope="col">실현 손익</th>
            </tr>
          </thead>
          <tbody>
            {lots.map((l) => {
              const piece = pieceOf(l.id);
              return (
                <tr key={l.id} className={piece ? 'picked' : undefined}>
                  <td className="strong">{l.acquiredAt.slice(0, 10)}</td>
                  <td>{fmtQty(l.qtyRemaining.toString())}</td>
                  <td>{money(l.unitCost.toString(), currency)}</td>
                  <td>
                    {method === 'SPECIFIC' ? (
                      <input
                        aria-label={`${l.acquiredAt.slice(0, 10)} Lot에서 팔 수량`}
                        type="number"
                        inputMode="decimal"
                        min="0"
                        max={l.qtyRemaining.toString()}
                        step="any"
                        style={{ width: 110, textAlign: 'right' }}
                        value={specific[l.id] ?? ''}
                        onChange={(e) => setSpecific({ ...specific, [l.id]: e.target.value })}
                      />
                    ) : piece ? (
                      <span className="strong">{fmtQty(piece.qty.toString())}</span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td className={piece ? tone(piece.pnl.toString()) : 'muted'}>{piece ? money(piece.pnl.toString(), currency) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="callout spread">
        <div className="stack" style={{ gap: 2 }}>
          <span className="sub">예상 실현손익 ({LOT_METHOD_LABEL[method]})</span>
          {plan && !plan.ok ? (
            <span className="down">{plan.message}</span>
          ) : result ? (
            <span className={`strong ${tone(result.pnl.toString())}`} style={{ fontSize: 20 }}>
              {money(result.pnl.toString(), currency)}
              {currency !== 'KRW' && <span className="sub">원화 환산 (환차 포함) {money(result.pnlBase.toFixed(0), 'KRW')}</span>}
            </span>
          ) : (
            <span className="muted">수량을 입력하면 계산됩니다.</span>
          )}
        </div>
        <label className="check">
          <input type="checkbox" checked={toCash} onChange={(e) => setToCash(e.target.checked)} />
          매도 대금을 포트폴리오 현금으로 (끄면 외부 출금)
        </label>
      </div>
      <p className="sub">증권사는 자체 기준(보통 평균단가)으로 손익을 계산합니다. 여기서 고른 Lot은 이 앱 장부의 관리용이며, 세무 신고 기준과 다를 수 있습니다.</p>
      <div>
        <Submit>매도 기록</Submit>
      </div>
    </ActionForm>
  );
}
