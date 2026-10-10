'use client';

import { useActionState, useEffect, useRef, useState, useTransition } from 'react';
import {
  approveOrderAction,
  dismissOrderAction,
  globalHaltAction,
  policyHaltAction,
  savePolicyAction,
  stepUpAction,
  type AutopilotResult,
} from '@/app/autopilot-actions';
import { DEFAULT_POLICY, TRADABLE_TYPES, TYPE_LABEL } from '@/domain/autopilot';

function Msg({ r }: { r: AutopilotResult }) {
  if (!r.error && !r.ok) return null;
  return <span className={`msg ${r.error ? 'err' : 'ok'}`}>{r.error ?? r.ok}</span>;
}

/** One button that runs a server action and shows its answer next to it. */
function ActionButton({ label, run, className, confirmText }: { label: string; run: () => Promise<AutopilotResult>; className?: string; confirmText?: string }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<AutopilotResult>({});
  return (
    <span className="inline" style={{ gap: 6 }}>
      <button
        type="button"
        className={className ?? 'btn small'}
        disabled={pending}
        onClick={() => {
          if (confirmText && !confirm(confirmText)) return;
          start(async () => setResult(await run()));
        }}
      >
        {label}
      </button>
      <Msg r={result} />
    </span>
  );
}

/** Global kill switch: stopping is one click, resuming needs a fresh password. */
export function KillSwitch({ halted }: { halted: boolean }) {
  return halted ? (
    <ActionButton label="정지 풀기" run={() => globalHaltAction(false)} confirmText="모든 AI 운용 정지를 풀까요?" />
  ) : (
    <ActionButton label="■ 전체 정지" className="btn danger" run={() => globalHaltAction(true)} confirmText="모든 정책의 새 주문을 막고, 승인 대기와 미체결 페이퍼 주문을 닫습니다. 멈출까요?" />
  );
}

export function PolicyHaltButton({ policyId, halted }: { policyId: string; halted: boolean }) {
  return halted ? <ActionButton label="정지 풀기" run={() => policyHaltAction(policyId, false)} /> : <ActionButton label="이 정책 정지" className="btn small danger" run={() => policyHaltAction(policyId, true)} />;
}

export function OrderButtons({ orderId, executable }: { orderId: string; executable: boolean }) {
  return (
    <span className="inline" style={{ gap: 6 }}>
      {executable && <ActionButton label="주문 실행" className="btn small primary" run={() => approveOrderAction(orderId)} />}
      <ActionButton label="거절" run={() => dismissOrderAction(orderId)} />
    </span>
  );
}

/** Password (and two-step code) re-entry for order execution, raising delegation and un-halting (10 minutes). */
export function StepUpForm({ twoStep = false }: { twoStep?: boolean }) {
  const [state, action, pending] = useActionState(stepUpAction, {} as AutopilotResult);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state]);
  return (
    <form ref={ref} action={action} className="inline" style={{ gap: 8, flexWrap: 'wrap' }}>
      <label className="field" style={{ flex: '1 1 200px' }}>
        로그인 비밀번호 다시 확인
        <input name="password" type="password" autoComplete="current-password" required />
      </label>
      {twoStep && (
        <label className="field" style={{ flex: '0 1 140px' }}>
          인증 코드
          <input name="code" inputMode="numeric" autoComplete="one-time-code" required maxLength={20} />
        </label>
      )}
      <button className="btn small" type="submit" disabled={pending} style={{ alignSelf: 'end' }}>
        확인
      </button>
      <Msg r={state} />
    </form>
  );
}

export function PolicyForm({ portfolios }: { portfolios: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(savePolicyAction, {} as AutopilotResult);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state]);
  if (!portfolios.length) return <p className="empty">정책을 붙일 포트폴리오가 없습니다. 포트폴리오마다 정책은 하나입니다.</p>;
  return (
    <form ref={ref} action={action} className="grid goal-form">
      <label className="field">
        이름
        <input name="name" placeholder="국내 대형주 페이퍼" maxLength={40} required />
      </label>
      <label className="field">
        포트폴리오
        <select name="portfolioId" required>
          {portfolios.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        위임 단계
        <select name="level" defaultValue="SUGGEST">
          <option value="SUGGEST">초안만 (실행 버튼 없음)</option>
          <option value="APPROVE">건별 승인 (비밀번호 재확인 필요)</option>
        </select>
      </label>
      <label className="field">
        허용 종목 (쉼표나 띄어쓰기로 구분)
        <input name="allowSymbols" placeholder="005930, 000660" />
      </label>
      <label className="field">
        금지 종목
        <input name="denySymbols" placeholder="비우면 없음" />
      </label>
      <label className="field">
        1회 한도 (원)
        <input name="maxOrder" inputMode="numeric" defaultValue={DEFAULT_POLICY.maxOrder} required />
      </label>
      <label className="field">
        하루 한도 (원)
        <input name="maxDaily" inputMode="numeric" defaultValue={DEFAULT_POLICY.maxDaily} required />
      </label>
      <label className="field">
        하루 건수
        <input name="maxDailyOrders" inputMode="numeric" defaultValue={DEFAULT_POLICY.maxDailyOrders} />
      </label>
      <label className="field">
        일손실 정지 (%)
        <input name="dailyLossStop" inputMode="decimal" defaultValue={DEFAULT_POLICY.dailyLossStop * 100} />
      </label>
      <label className="field">
        지정가 괴리 상한 (%)
        <input name="maxPriceGap" inputMode="decimal" defaultValue={DEFAULT_POLICY.maxPriceGap * 100} />
      </label>
      <label className="field">
        페이퍼 시작 현금 (원)
        <input name="paperCash" inputMode="numeric" defaultValue={DEFAULT_POLICY.paperCash} />
      </label>
      <label className="field">
        슬리피지 (bp)
        <input name="slippageBp" inputMode="numeric" defaultValue={DEFAULT_POLICY.slippageBp} />
      </label>
      <fieldset className="full inline" style={{ gap: 12, border: 0, padding: 0 }}>
        <legend className="sub">거래할 자산 유형</legend>
        {TRADABLE_TYPES.map((t) => (
          <label key={t} className="check">
            <input type="checkbox" name="allowedTypes" value={t} defaultChecked={t === 'KR_STOCK'} /> {TYPE_LABEL[t]}
          </label>
        ))}
      </fieldset>
      <label className="field full">
        운용 목표 (AI가 읽는 설명)
        <textarea name="objective" rows={2} maxLength={500} placeholder="배당 성장주 위주로 천천히 모으기" />
      </label>
      <input type="hidden" name="mode" value="PAPER" />
      <div className="full inline">
        <button className="btn primary" type="submit" disabled={pending}>
          + 페이퍼 정책 만들기
        </button>
        <Msg r={state} />
      </div>
    </form>
  );
}
