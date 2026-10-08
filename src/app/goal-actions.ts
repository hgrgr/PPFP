'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/server/auth';
import { deleteGoal, saveGoal } from '@/server/services/goals';
import { UserError } from '@/server/services/portfolios';

export interface GoalResult {
  ok?: string;
  error?: string;
}

export async function saveGoalAction(_prev: GoalResult, form: FormData): Promise<GoalResult> {
  const user = await requireUser();
  const s = (k: string) => String(form.get(k) ?? '');
  try {
    await saveGoal(user.id, {
      id: s('id') || undefined,
      name: s('name'),
      target: s('target'),
      targetDate: s('targetDate'),
      monthly: s('monthly'),
      portfolioId: s('portfolioId'),
      expectedReturn: s('expectedReturn'),
      volatility: s('volatility'),
      realTerms: form.get('realTerms') === 'on',
    });
    revalidatePath('/goals');
    return { ok: '목표를 저장했습니다' };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    console.error('[goals]', e);
    return { error: '저장하지 못했습니다.' };
  }
}

export async function deleteGoalAction(id: string): Promise<GoalResult> {
  const user = await requireUser();
  try {
    await deleteGoal(user.id, id);
    revalidatePath('/goals');
    return { ok: '목표를 지웠습니다' };
  } catch (e) {
    return { error: e instanceof UserError ? e.message : '지우지 못했습니다.' };
  }
}
