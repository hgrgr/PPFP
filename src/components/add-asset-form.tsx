'use client';

import { useState } from 'react';
import type { ActionState } from '@/app/actions';
import { ActionForm, DateTimeField, Submit } from './forms';

const MANUAL_TYPES: [string, string][] = [
  ['REAL_ESTATE', '부동산'],
  ['CASH', '현금·예금 (정기예금 등)'],
  ['BOND', '채권'],
  ['FUND', '펀드'],
  ['ALTERNATIVE', '대안자산 (금·암호화폐 등)'],
  ['LIABILITY', '부채 (대출)'],
  ['KR_STOCK', '국내 주식 (수기 시세)'],
  ['US_STOCK', '해외 주식 (수기 시세)'],
];

export function AddAssetForm({
  action,
  portfolioId,
  tossLinked,
  usdkrw,
}: {
  action: (s: ActionState, f: FormData) => Promise<ActionState>;
  portfolioId: string;
  tossLinked: boolean;
  usdkrw: string;
}) {
  const [kind, setKind] = useState<'listed' | 'manual'>(tossLinked ? 'listed' : 'manual');
  const [type, setType] = useState('REAL_ESTATE');
  const [currency, setCurrency] = useState('KRW');
  const liability = kind === 'manual' && type === 'LIABILITY';
  return (
    <ActionForm action={action} className="grid" resetOnSuccess>
      <input type="hidden" name="portfolioId" value={portfolioId} />
      <input type="hidden" name="kind" value={kind} />
      <div className="seg full" role="group" aria-label="자산 종류" style={{ justifySelf: 'start' }}>
        <button type="button" aria-pressed={kind === 'listed'} onClick={() => setKind('listed')}>
          상장 종목 (토스 시세)
        </button>
        <button type="button" aria-pressed={kind === 'manual'} onClick={() => setKind('manual')}>
          수기 자산
        </button>
      </div>
      {kind === 'listed' ? (
        <>
          {!tossLinked && <p className="msg err full">상장 종목 시세를 받으려면 설정에서 토스증권 API를 먼저 연결하세요.</p>}
          <label className="field">
            종목 코드
            <input name="symbol" required placeholder="005930 또는 AAPL" pattern="[A-Za-z0-9.\-]{1,20}" autoCapitalize="characters" />
          </label>
        </>
      ) : (
        <>
          <label className="field">
            유형
            <select name="type" value={type} onChange={(e) => setType(e.target.value)}>
              {MANUAL_TYPES.map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </label>
          <label className="field">
            이름
            <input name="name" required maxLength={80} placeholder={liability ? '예: 주택담보대출' : '예: 서울 아파트'} />
          </label>
          <label className="field">
            통화
            <select name="currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              <option value="KRW">KRW</option>
              <option value="USD">USD</option>
            </select>
          </label>
        </>
      )}
      <DateTimeField label={liability ? '대출 실행 일시 (KST)' : '매수 일시 (KST)'} />
      <label className="field">
        수량
        <input name="qty" type="number" inputMode="decimal" min="0" step="any" required defaultValue={kind === 'manual' ? '1' : undefined} />
      </label>
      <label className="field">
        {liability ? '대출 잔액' : '단가'}
        <input name="price" type="number" inputMode="decimal" min="0" step="any" required />
      </label>
      <label className="field">
        수수료
        <input name="fee" type="number" inputMode="decimal" min="0" step="any" defaultValue="0" />
      </label>
      <label className="field">
        세금 (취득세 등)
        <input name="tax" type="number" inputMode="decimal" min="0" step="any" defaultValue="0" />
      </label>
      {(kind === 'listed' || currency === 'USD') && (
        <label className="field">
          환율 (해외 종목만, 원/USD)
          <input name="fxRate" type="number" inputMode="decimal" min="0" step="any" defaultValue={usdkrw} />
        </label>
      )}
      <label className="check full">
        <input type="checkbox" name="fromCash" value="1" defaultChecked={kind === 'listed'} />
        {liability ? '대출금을 이 포트폴리오 현금으로 받음' : '이 포트폴리오의 현금으로 결제 (끄면 외부 자금 투입으로 기록)'}
      </label>
      <label className="field full">
        메모
        <input name="memo" maxLength={200} />
      </label>
      <div className="full">
        <Submit>{liability ? '부채 등록' : '매수 기록'}</Submit>
      </div>
    </ActionForm>
  );
}
