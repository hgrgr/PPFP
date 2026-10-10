'use server';

import { revalidatePath } from 'next/cache';
import { policyFromForm } from '@/domain/autopilot';
import { currentSessionId, requireUser } from '@/server/auth';
import { approveOrder, dismissOrder, savePolicy, setGlobalHalt, setPolicyHalt, stepUp, stepUpValid } from '@/server/services/autopilot';
import { UserError } from '@/server/services/portfolios';

export interface AutopilotResult {
  ok?: string;
  error?: string;
}

const sessionId = currentSessionId;

const fail = (e: unknown, fallback: string): AutopilotResult => {
  if (e instanceof UserError) return { error: e.message };
  console.error('[autopilot]', e);
  return { error: fallback };
};

export async function stepUpAction(_prev: AutopilotResult, form: FormData): Promise<AutopilotResult> {
  const user = await requireUser();
  const sid = await sessionId();
  if (!sid) return { error: '다시 로그인하세요.' };
  try {
    await stepUp(user.id, sid, String(form.get('password') ?? ''), String(form.get('code') ?? ''));
    return { ok: '확인했습니다. 10분 동안 주문 실행과 단계 변경을 할 수 있습니다.' };
  } catch (e) {
    return fail(e, '확인하지 못했습니다.');
  }
}

export async function savePolicyAction(_prev: AutopilotResult, form: FormData): Promise<AutopilotResult> {
  const user = await requireUser();
  const fields: Record<string, string | string[]> = {};
  for (const key of new Set(form.keys())) {
    const all = form.getAll(key).map(String);
    fields[key] = key === 'allowedTypes' ? all : all[0];
  }
  try {
    await savePolicy(user.id, { id: String(form.get('id') ?? '') || undefined, portfolioId: String(form.get('portfolioId') ?? ''), raw: policyFromForm(fields) }, await stepUpValid(await sessionId()));
    revalidatePath('/autopilot');
    return { ok: '정책을 저장했습니다' };
  } catch (e) {
    return fail(e, '저장하지 못했습니다.');
  }
}

export async function globalHaltAction(on: boolean): Promise<AutopilotResult> {
  const user = await requireUser();
  try {
    await setGlobalHalt(user.id, on, null, await stepUpValid(await sessionId()));
    revalidatePath('/autopilot');
    return { ok: on ? '모든 AI 운용을 멈췄습니다' : '정지를 풀었습니다' };
  } catch (e) {
    return fail(e, '바꾸지 못했습니다.');
  }
}

export async function policyHaltAction(policyId: string, on: boolean): Promise<AutopilotResult> {
  const user = await requireUser();
  try {
    await setPolicyHalt(user.id, policyId, on, null, await stepUpValid(await sessionId()));
    revalidatePath('/autopilot');
    return { ok: on ? '이 정책을 멈췄습니다' : '정지를 풀었습니다' };
  } catch (e) {
    return fail(e, '바꾸지 못했습니다.');
  }
}

export async function approveOrderAction(orderId: string): Promise<AutopilotResult> {
  const user = await requireUser();
  try {
    const msg = await approveOrder(user.id, orderId, await stepUpValid(await sessionId()));
    revalidatePath('/autopilot');
    return { ok: msg };
  } catch (e) {
    return fail(e, '실행하지 못했습니다.');
  }
}

export async function dismissOrderAction(orderId: string): Promise<AutopilotResult> {
  const user = await requireUser();
  try {
    await dismissOrder(user.id, orderId);
    revalidatePath('/autopilot');
    return { ok: '주문을 거절했습니다' };
  } catch (e) {
    return fail(e, '거절하지 못했습니다.');
  }
}
