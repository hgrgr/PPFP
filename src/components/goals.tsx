'use client';

import { useActionState, useEffect, useRef, useState, useTransition } from 'react';
import { deleteGoalAction, saveGoalAction, type GoalResult } from '@/app/goal-actions';

export interface GoalFormValues {
  id?: string;
  name: string;
  target: string;
  targetDate: string;
  monthly: string;
  portfolioId: string;
  expectedReturn: string;
  volatility: string;
  realTerms: boolean;
}

/** New goal or edit one. Return and volatility left empty follow the scope's asset mix. */
export function GoalForm({ initial, portfolios, auto, onDone }: { initial?: GoalFormValues; portfolios: { id: string; name: string }[]; auto?: { ret: number; vol: number }; onDone?: () => void }) {
  const [state, action, pending] = useActionState(saveGoalAction, {} as GoalResult);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) {
      if (!initial) ref.current?.reset();
      onDone?.();
    }
  }, [state, initial, onDone]);
  const v = initial;
  return (
    <form ref={ref} action={action} className="grid goal-form">
      {v?.id && <input type="hidden" name="id" value={v.id} />}
      <label className="field">
        이름
        <input name="name" defaultValue={v?.name} placeholder="은퇴 자금, 주택 마련 …" maxLength={40} required />
      </label>
      <label className="field">
        목표 금액 (원, 오늘 가치)
        <input name="target" inputMode="numeric" defaultValue={v?.target} placeholder="500000000" required />
      </label>
      <label className="field">
        목표 날짜
        <input name="targetDate" type="date" defaultValue={v?.targetDate} required />
      </label>
      <label className="field">
        월 적립액 (원)
        <input name="monthly" inputMode="numeric" defaultValue={v?.monthly} placeholder="1000000" />
      </label>
      <label className="field">
        어느 돈으로
        <select name="portfolioId" defaultValue={v?.portfolioId ?? ''}>
          <option value="">순자산 전체</option>
          {portfolios.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        기대수익률 (연 %)
        <input name="expectedReturn" inputMode="decimal" defaultValue={v?.expectedReturn} placeholder={auto ? `자산 구성 기준 ${(auto.ret * 100).toFixed(1)}` : '비우면 자산 구성 기준'} />
      </label>
      <label className="field">
        변동성 (연 %)
        <input name="volatility" inputMode="decimal" defaultValue={v?.volatility} placeholder={auto ? `자산 구성 기준 ${(auto.vol * 100).toFixed(1)}` : '비우면 자산 구성 기준'} />
      </label>
      <label className="check" style={{ alignSelf: 'end' }}>
        <input type="checkbox" name="realTerms" defaultChecked={v ? v.realTerms : true} /> 물가 반영 (연 2.5%)
      </label>
      <div className="full inline">
        <button className="btn primary" type="submit" disabled={pending}>
          {v?.id ? '저장' : '+ 목표 추가'}
        </button>
        {(state.error || state.ok) && <span className={`msg ${state.error ? 'err' : 'ok'}`}>{state.error ?? state.ok}</span>}
      </div>
    </form>
  );
}

export function GoalEdit({ values, portfolios, auto }: { values: GoalFormValues; portfolios: { id: string; name: string }[]; auto: { ret: number; vol: number } }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  return (
    <>
      <span className="inline" style={{ gap: 6 }}>
        <button type="button" className="btn small" aria-expanded={open} onClick={() => setOpen((x) => !x)}>
          {open ? '닫기' : '고치기'}
        </button>
        <button type="button" className="btn small danger" disabled={pending} onClick={() => confirm(`'${values.name}' 목표를 지울까요?`) && start(async () => void (await deleteGoalAction(values.id!)))}>
          지우기
        </button>
      </span>
      {open && (
        <div className="full goal-edit">
          <GoalForm initial={values} portfolios={portfolios} auto={auto} onDone={() => setOpen(false)} />
        </div>
      )}
    </>
  );
}
