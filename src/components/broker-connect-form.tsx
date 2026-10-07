'use client';

import { useState } from 'react';
import type { ActionState } from '@/app/actions';
import { BROKER_IDS, BROKERS, type BrokerId } from '@/lib/brokers';
import { ActionForm, Submit } from './forms';

/** Add-a-link form; the fields follow what the chosen broker's API needs. */
export function BrokerConnectForm({ action }: { action: (s: ActionState, f: FormData) => Promise<ActionState> }) {
  const [broker, setBroker] = useState<BrokerId>('KIS');
  const meta = BROKERS[broker];
  return (
    <ActionForm action={action} className="grid" resetOnSuccess>
      <label className="field">
        증권사
        <select name="broker" value={broker} onChange={(e) => setBroker(e.target.value as BrokerId)}>
          {BROKER_IDS.map((id) => (
            <option key={id} value={id}>
              {BROKERS[id].label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        이름 (선택)
        <input name="label" maxLength={40} placeholder={`예: ${meta.label} 연금계좌`} />
      </label>
      <label className="field">
        {meta.keyLabel}
        <input name="appKey" autoComplete="off" required spellCheck={false} />
      </label>
      <label className="field">
        {meta.secretLabel}
        <input name="appSecret" type="password" autoComplete="new-password" required spellCheck={false} />
      </label>
      {meta.needsAccount && (
        <label className="field">
          계좌번호
          <input name="accountNo" required inputMode="numeric" placeholder="12345678-01" pattern="\d{8}-?\d{2}" />
        </label>
      )}
      {meta.paper && (
        <label className="check" style={{ alignSelf: 'end', paddingBottom: 10 }}>
          <input type="checkbox" name="paper" value="1" /> 모의투자 앱키
        </label>
      )}
      <p className="sub full">
        {meta.note}{' '}
        <a href={meta.portal} target="_blank" rel="noreferrer">
          {meta.label} 개발자 포털 ↗
        </a>
      </p>
      <div className="inline full">
        <Submit pendingText="연결 확인 중…">연결 확인 후 저장</Submit>
      </div>
    </ActionForm>
  );
}
