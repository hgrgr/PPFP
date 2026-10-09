'use server';

import { revalidatePath } from 'next/cache';
import { AGENT_ORDER } from '@/domain/ai';
import { PROVIDER_ORDER } from '@/domain/ai-providers';
import { requireUser } from '@/server/auth';
import { deleteConversation, dismissAction, executeAction, saveAiSettings } from '@/server/services/ai/actions';
import { UserError } from '@/server/services/portfolios';

export interface AiResult {
  ok?: string;
  error?: string;
}

async function run(fn: () => Promise<string>): Promise<AiResult> {
  try {
    const ok = await fn();
    revalidatePath('/', 'layout');
    return { ok };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    console.error('[ai]', e);
    return { error: '처리하지 못했습니다. 잠시 후 다시 시도하세요.' };
  }
}

export async function executeAiAction(id: string) {
  const user = await requireUser();
  return run(() => executeAction(user.id, id));
}

export async function dismissAiAction(id: string) {
  const user = await requireUser();
  return run(async () => (await dismissAction(user.id, id), '제안을 넘겼습니다'));
}

export async function deleteAiConversation(id: string) {
  const user = await requireUser();
  return run(async () => (await deleteConversation(user.id, id), '대화를 지웠습니다'));
}

export async function saveAiSettingsAction(_prev: AiResult, form: FormData): Promise<AiResult> {
  const user = await requireUser();
  return run(async () => {
    const str = (k: string) => String(form.get(k) ?? '');
    await saveAiSettings(user.id, {
      keys: Object.fromEntries(PROVIDER_ORDER.map((p) => [p, { key: str(`key.${p}`), clear: form.get(`clear.${p}`) === 'on' }])),
      // Only when the form has the model table (it always does on 연동 · 설정)
      picks: form.has('picks') ? Object.fromEntries(AGENT_ORDER.map((a) => [a, { provider: str(`provider.${a}`), model: str(`model.${a}`) }])) : undefined,
      monthlyLimit: str('monthlyLimit'),
      webSearch: form.get('webSearch') === 'on',
      briefing: form.get('briefing') === 'on',
      briefingHour: str('briefingHour') || '8',
      briefingWeekdays: form.get('briefingWeekdays') === 'on',
      alertAnalysis: form.get('alertAnalysis') === 'on',
    });
    return 'AI 설정을 저장했습니다';
  });
}
