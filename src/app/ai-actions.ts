'use server';

import { revalidatePath } from 'next/cache';
import { AGENT_ORDER } from '@/domain/ai';
import { PROVIDER_ORDER } from '@/domain/ai-providers';
import { requireUser } from '@/server/auth';
import { deleteConversation, dismissAction, executeAction, saveAiSettings } from '@/server/services/ai/actions';
import { communitySkill, deleteSkill, installCommunitySkill, refreshSkill, saveSkill, updateSkillUse, type CommunitySkill, type SkillInput } from '@/server/services/ai/skills';
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

// ---------------------------------------------------------------- skills

export async function saveSkillAction(id: string | null, input: SkillInput): Promise<AiResult & { id?: string }> {
  const user = await requireUser();
  let saved: string | undefined;
  const r = await run(async () => ((saved = await saveSkill(user.id, id, input)), id ? '스킬을 저장했습니다' : '스킬을 만들었습니다'));
  return { ...r, id: saved };
}

export async function updateSkillUseAction(id: string, input: { enabled?: boolean; agents?: string[] }) {
  const user = await requireUser();
  return run(async () => (await updateSkillUse(user.id, id, input), '저장했습니다'));
}

export async function deleteSkillAction(id: string) {
  const user = await requireUser();
  return run(async () => (await deleteSkill(user.id, id), '스킬을 지웠습니다'));
}

export async function communitySkillAction(id: string): Promise<{ skill?: CommunitySkill; error?: string }> {
  await requireUser();
  try {
    return { skill: await communitySkill(id) };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    console.error('[skills]', e);
    return { error: '스킬을 읽지 못했습니다. 잠시 후 다시 시도하세요.' };
  }
}

export async function installSkillAction(id: string, agents: string[]) {
  const user = await requireUser();
  return run(async () => (await installCommunitySkill(user.id, id, agents), '내 스킬에 추가했습니다'));
}

export async function refreshSkillAction(id: string) {
  const user = await requireUser();
  return run(async () => (await refreshSkill(user.id, id), '원본에서 다시 가져왔습니다'));
}
