'use server';

import { revalidatePath } from 'next/cache';
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
    await saveAiSettings(user.id, {
      apiKey: String(form.get('apiKey') ?? ''),
      clearKey: form.get('clearKey') === 'on',
      monthlyLimit: String(form.get('monthlyLimit') ?? ''),
      webSearch: form.get('webSearch') === 'on',
    });
    return 'AI 설정을 저장했습니다';
  });
}
