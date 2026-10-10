'use server';

import { revalidatePath } from 'next/cache';
import type { ActionState } from '@/app/actions';
import { requireUser } from '@/server/auth';
import { addLoanRate, deleteLoan, saveFinancialProfile, saveLoan } from '@/server/services/net-worth';
import { UserError } from '@/server/services/portfolios';

const fail = (e: unknown, what: string): ActionState => {
  if (e instanceof UserError) return { error: e.message };
  console.error('[net-worth]', e);
  return { error: `${what}하지 못했습니다.` };
};

const done = (ok: string): ActionState => {
  revalidatePath('/net-worth');
  return { ok, at: Date.now() };
};

export async function saveLoanAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const s = (k: string) => String(form.get(k) ?? '');
  try {
    await saveLoan(user.id, {
      id: s('id') || undefined,
      assetId: s('assetId'),
      kind: s('kind'),
      method: s('method'),
      principal: s('principal'),
      rate: s('rate'),
      startDate: s('startDate'),
      maturityDate: s('maturityDate'),
      graceMonths: s('graceMonths'),
      paymentDay: s('paymentDay'),
      rateType: s('rateType'),
      lender: s('lender'),
      payFromId: s('payFromId'),
      collateralId: s('collateralId'),
    });
    return done('대출 조건을 저장했습니다');
  } catch (e) {
    return fail(e, '저장');
  }
}

export async function addLoanRateAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  try {
    await addLoanRate(user.id, String(form.get('loanId') ?? ''), String(form.get('from') ?? ''), String(form.get('rate') ?? ''));
    return done('새 금리를 반영했습니다');
  } catch (e) {
    return fail(e, '저장');
  }
}

export async function deleteLoanAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  try {
    await deleteLoan(user.id, String(form.get('loanId') ?? ''));
    return done('대출 조건을 지웠습니다 (부채 자산과 거래 내역은 그대로입니다)');
  } catch (e) {
    return fail(e, '삭제');
  }
}

export async function saveFinancialProfileAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const s = (k: string) => String(form.get(k) ?? '');
  try {
    await saveFinancialProfile(user.id, {
      annualIncome: s('annualIncome'),
      birthYear: s('birthYear'),
      retireAge: s('retireAge'),
      region: s('region'),
      emergencyMonths: s('emergencyMonths'),
      shareWithAi: form.get('shareWithAi') === 'on',
    });
    return done('재무 프로필을 저장했습니다');
  } catch (e) {
    return fail(e, '저장');
  }
}
