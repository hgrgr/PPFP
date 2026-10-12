'use client';

import { useState } from 'react';
import type { ActionState } from '@/app/actions';
import { isBuildingKind, isLotKind, PROPERTY_KINDS, propertyKindShort, type ApartmentMeta, type LotMeta, type PropertyKind } from '@/domain/real-estate';
import { ApartmentPicker, apartmentName } from './apartment-picker';
import { LotPicker, lotName } from './lot-picker';
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
  portfolios,
  marketLinked,
  usdkrw,
}: {
  action: (s: ActionState, f: FormData) => Promise<ActionState>;
  /** Fixed portfolio, or pick one from `portfolios` */
  portfolioId?: string;
  portfolios?: { id: string; name: string }[];
  marketLinked: boolean;
  usdkrw: string;
}) {
  const [kind, setKind] = useState<'listed' | 'manual'>(marketLinked ? 'listed' : 'manual');
  const [type, setType] = useState('REAL_ESTATE');
  const [currency, setCurrency] = useState('KRW');
  const [name, setName] = useState('');
  const [linked, setLinked] = useState<ApartmentMeta | LotMeta | null>(null);
  const [property, setProperty] = useState<PropertyKind>('apartment');
  /** The name last filled in from a pick, so a new pick replaces it but not a name typed by hand */
  const [autoName, setAutoName] = useState('');
  const liability = kind === 'manual' && type === 'LIABILITY';
  const realEstate = kind === 'manual' && type === 'REAL_ESTATE';
  /** Fill the name from a pick unless the user already wrote one. */
  const picked = (m: ApartmentMeta | LotMeta | null, label: string | null) => {
    if (label && (!name || name === autoName)) {
      setName(label);
      setAutoName(label);
    }
    setLinked(m);
  };
  return (
    <ActionForm action={action} className="grid" resetOnSuccess>
      {portfolioId ? (
        <input type="hidden" name="portfolioId" value={portfolioId} />
      ) : (
        <label className="field full">
          담을 포트폴리오
          <select name="portfolioId" required defaultValue="">
            <option value="" disabled>
              포트폴리오 고르기
            </option>
            {portfolios?.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
      )}
      <input type="hidden" name="kind" value={kind} />
      <div className="seg full" role="group" aria-label="자산 종류" style={{ justifySelf: 'start' }}>
        <button type="button" aria-pressed={kind === 'listed'} onClick={() => setKind('listed')}>
          상장 종목 (증권사 시세)
        </button>
        <button type="button" aria-pressed={kind === 'manual'} onClick={() => setKind('manual')}>
          수기 자산
        </button>
      </div>
      {kind === 'listed' ? (
        <>
          {!marketLinked && <p className="msg err full">상장 종목 시세를 받으려면 설정에서 증권사 API를 먼저 연결하세요.</p>}
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
          {realEstate && (
            <label className="field">
              부동산 종류
              <select
                name="propertyKind"
                value={property}
                onChange={(e) => {
                  setProperty(e.target.value as PropertyKind);
                  setLinked(null);
                }}
              >
                {PROPERTY_KINDS.map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </label>
          )}
          {realEstate && isBuildingKind(property) && <ApartmentPicker key={property} kind={property} onChange={(m) => picked(m, m && apartmentName(m))} />}
          {realEstate && isLotKind(property) && <LotPicker key={property} kind={property} onChange={(m) => picked(m, m && lotName(m))} />}
          {realEstate && linked && <input type="hidden" name="realEstate" value={JSON.stringify(linked)} />}
          {realEstate && property !== 'apartment' && !linked && (
            <>
              <label className="field">
                주소 (선택)
                <input name="propertyAddress" maxLength={120} placeholder="예: 서울 마포구 망원동 123-4" />
              </label>
              <label className="field">
                면적 ㎡ (선택)
                <input name="propertyArea" type="number" inputMode="decimal" min="0" step="any" placeholder="예: 59.8" />
              </label>
              <p className="sub full">
                {property === 'other'
                  ? '기타 부동산은 실거래가와 잇지 않습니다. 시세가 바뀔 때 종목 화면의 평가 갱신으로 기록하세요.'
                  : '위에서 찾아 고르면 실거래가와 이어집니다. 고르지 않으면 적은 주소와 면적만 저장하고, 나중에 자산 화면에서 이을 수 있습니다.'}
              </p>
            </>
          )}
          <label className="field">
            이름
            <input name="name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder={liability ? '예: 주택담보대출' : realEstate && property !== 'apartment' ? `예: 망원동 ${propertyKindShort(property)}` : '예: 서울 아파트'} />
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
