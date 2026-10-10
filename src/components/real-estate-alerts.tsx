'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { checkReAlertsAction, createReAlertAction, deleteReAlertAction, setReAlertActiveAction, type AlertResult } from '@/app/alert-actions';
import { RE_BUYERS, RE_DEALINGS, RE_EVENT_LABEL, RE_EVENTS, RE_SCOPE_LABEL, RE_SCOPES, type ReEvent } from '@/domain/real-estate-alerts';
import { eok } from '@/domain/real-estate';
import { kstDateTime } from '@/lib/format';
import type { ReAlertView } from '@/server/services/real-estate-alerts';

const EVENT_HELP: Record<ReEvent, string> = {
  TRADE: '조건에 맞는 매매가 새로 신고되면',
  REGISTERED: '신고된 매매의 소유권 이전 등기가 끝나면',
  CANCELLED: '신고된 매매가 해제되면',
  ZONE: '이 땅이 토지거래허가구역에 들어가거나 빠지면 (브이월드 키 필요)',
};

function useAct() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<AlertResult>({});
  const act = (fn: () => Promise<AlertResult>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      setMsg(r);
      if (!r.error) {
        after?.();
        router.refresh();
      }
    });
  return { pending, msg, act };
}

function Msg({ msg }: { msg: AlertResult }) {
  if (!msg.error && !msg.ok) return null;
  return <p className={`msg ${msg.error ? 'err' : 'ok'}`} role={msg.error ? 'alert' : 'status'}>{msg.error ?? msg.ok}</p>;
}

export function ReAlertForm({ assets, initialAsset }: { assets: { id: string; name: string }[]; initialAsset?: string }) {
  const { pending, msg, act } = useAct();
  const [assetId, setAssetId] = useState(initialAsset && assets.some((a) => a.id === initialAsset) ? initialAsset : assets[0]?.id ?? '');
  const [events, setEvents] = useState<ReEvent[]>(['TRADE', 'REGISTERED', 'CANCELLED']);
  if (!assets.length) {
    return <p className="empty">아파트를 연결한 부동산 자산이 없습니다. 부동산 자산 화면의 <em>실거래가 · 인근 시세</em>에서 아파트를 먼저 고르세요.</p>;
  }
  return (
    <form
      className="grid"
      aria-label="부동산 알림 만들기"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const s = (k: string) => String(f.get(k) ?? '');
        act(() => createReAlertAction({ assetId, events, scope: s('scope'), minEok: s('minEok'), maxEok: s('maxEok'), newHighOnly: f.get('newHighOnly') === 'on', dealing: s('dealing'), buyer: s('buyer'), note: s('note') }));
      }}
    >
      <label className="field">
        아파트
        <select value={assetId} onChange={(e) => setAssetId(e.target.value)} required>
          {assets.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      </label>
      <label className="field">
        볼 거래
        <select name="scope" defaultValue="AREA">
          {RE_SCOPES.map((s) => (
            <option key={s} value={s}>{RE_SCOPE_LABEL[s]}</option>
          ))}
        </select>
      </label>
      <fieldset className="full re-events">
        <legend>알릴 일</legend>
        {RE_EVENTS.map((ev) => (
          <label key={ev} className="check">
            <input type="checkbox" checked={events.includes(ev)} onChange={(e) => setEvents((xs) => (e.target.checked ? [...xs, ev] : xs.filter((x) => x !== ev)))} />
            <span className="strong">{RE_EVENT_LABEL[ev]}</span> <span className="sub">{EVENT_HELP[ev]}</span>
          </label>
        ))}
      </fieldset>
      <fieldset className="full re-cond" disabled={!events.includes('TRADE')}>
        <legend>새 거래 조건</legend>
        <label className="field">
          최저 가격 (억)
          <input name="minEok" inputMode="decimal" placeholder="예: 28" />
        </label>
        <label className="field">
          최고 가격 (억)
          <input name="maxEok" inputMode="decimal" placeholder="예: 35" />
        </label>
        <label className="field">
          거래 방식
          <select name="dealing" defaultValue="ANY">
            {Object.entries(RE_DEALINGS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </label>
        <label className="field">
          매수자
          <select name="buyer" defaultValue="ANY">
            {Object.entries(RE_BUYERS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </label>
        <label className="check full">
          <input type="checkbox" name="newHighOnly" /> 신고가만 (같은 단지·같은 면적의 지난 2년 거래보다 비쌀 때)
        </label>
      </fieldset>
      <label className="field full">
        메모
        <input name="note" maxLength={200} placeholder="예: 갈아타기 후보" />
      </label>
      <div className="full">
        <button className="btn primary" disabled={pending || !events.length}>{pending ? '만드는 중…' : '부동산 알림 만들기'}</button>
      </div>
      <div className="full"><Msg msg={msg} /></div>
    </form>
  );
}

function conditions(a: ReAlertView): string {
  const bits: string[] = [];
  if (a.events.includes('TRADE')) {
    if (a.minPrice !== null || a.maxPrice !== null) bits.push(`${a.minPrice !== null ? eok(a.minPrice) : ''} ~ ${a.maxPrice !== null ? eok(a.maxPrice) : ''}`.trim());
    if (a.newHighOnly) bits.push('신고가만');
    if (a.dealing !== 'ANY') bits.push(RE_DEALINGS[a.dealing]);
    if (a.buyer !== 'ANY') bits.push(`매수 ${RE_BUYERS[a.buyer]}`);
  }
  return bits.join(' · ') || '조건 없음';
}

export function ReAlertList({ alerts }: { alerts: ReAlertView[] }) {
  const { pending, msg, act } = useAct();
  return (
    <div className="stack">
      <div className="spread">
        <span className="sub">몇 시간마다 확인합니다. 실거래가는 하루 한 번쯤 갱신됩니다.</span>
        <button type="button" className="btn small" disabled={pending || !alerts.some((a) => a.active)} onClick={() => act(() => checkReAlertsAction())}>
          {pending ? '확인 중…' : '지금 확인'}
        </button>
      </div>
      <Msg msg={msg} />
      {alerts.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th scope="col" className="l">아파트</th><th scope="col" className="l">알릴 일</th><th scope="col" className="l">조건</th><th scope="col" className="l">상태</th><th scope="col"><span className="sr-only">작업</span></th></tr>
            </thead>
            <tbody>
              {alerts.map((a) => (
                <tr key={a.id} className={a.active ? undefined : 'muted-row'}>
                  <td className="l">
                    {a.holdingId ? <a className="strong" href={`/holdings/${a.holdingId}#real-estate`}>{a.assetName}</a> : <span className="strong">{a.assetName}</span>}
                    <span className="sub">{RE_SCOPE_LABEL[a.scope]}{a.note ? ` · ${a.note}` : ''}</span>
                  </td>
                  <td className="l" style={{ whiteSpace: 'normal' }}>
                    {a.events.map((e) => (
                      <span key={e} className="badge" style={{ marginRight: 4 }}>{RE_EVENT_LABEL[e]}</span>
                    ))}
                  </td>
                  <td className="l muted" style={{ whiteSpace: 'normal' }}>{conditions(a)}</td>
                  <td className="l" style={{ whiteSpace: 'normal', maxWidth: 280 }}>
                    {!a.active ? (
                      <span className="sub">꺼짐</span>
                    ) : (
                      <span className="sub">
                        {a.checkedAt ? `${kstDateTime(a.checkedAt)} 확인` : '확인 전'}
                        {a.firedAt && ` · 마지막 알림 ${kstDateTime(a.firedAt)}`}
                        {a.events.includes('ZONE') && a.zone !== null && ` · 토지거래허가구역 ${a.zone ? '안' : '밖'}`}
                      </span>
                    )}
                    {a.active && a.lastError && <span className="msg err" style={{ display: 'block', marginTop: 4, padding: '6px 8px' }}>{a.lastError}</span>}
                  </td>
                  <td>
                    <span className="inline" style={{ flexWrap: 'nowrap' }}>
                      <button type="button" className="btn small" disabled={pending} onClick={() => act(() => setReAlertActiveAction(a.id, !a.active))}>
                        {a.active ? '끄기' : '켜기'}
                      </button>
                      <button type="button" className="btn small danger" disabled={pending} onClick={() => confirm('이 부동산 알림을 지울까요?') && act(() => deleteReAlertAction(a.id))}>
                        삭제
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="empty">아직 부동산 알림이 없습니다.</p>
      )}
    </div>
  );
}
