'use server';

import { revalidatePath } from 'next/cache';
import type { ActionState } from '@/app/actions';
import { requireUser } from '@/server/auth';
import { UserError } from '@/server/services/portfolios';
import { removeMember, setAllowOverlap, setMember } from '@/server/services/strategy-portfolios';

const s = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === 'string' ? v.trim() : '';
};

async function run(fn: () => Promise<string>): Promise<ActionState> {
  try {
    const ok = await fn();
    revalidatePath('/', 'layout');
    return { ok, at: Date.now() };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message, at: Date.now() };
    console.error('[strategy]', e);
    return { error: '처리하지 못했습니다. 잠시 후 다시 시도하세요.', at: Date.now() };
  }
}

/** Puts a holding into the strategy at the given percent, or changes its percent */
export async function setMemberAction(_: ActionState, f: FormData) {
  const user = await requireUser();
  return run(async () => {
    await setMember(user.id, s(f, 'strategyId'), s(f, 'holdingId'), s(f, 'percent') || '100');
    return '저장했습니다.';
  });
}

export async function removeMemberAction(_: ActionState, f: FormData) {
  const user = await requireUser();
  return run(async () => {
    await removeMember(user.id, s(f, 'strategyId'), s(f, 'holdingId'));
    return '전략에서 뺐습니다. 계좌의 종목은 그대로입니다.';
  });
}

export async function setOverlapAction(_: ActionState, f: FormData) {
  const user = await requireUser();
  return run(async () => {
    const allow = s(f, 'allow') === '1';
    await setAllowOverlap(user.id, s(f, 'strategyId'), allow);
    return allow ? '겹쳐 담기를 허용했습니다.' : '나눠 담기로 바꿨습니다.';
  });
}
