'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/server/auth';
import { UserError } from '@/server/services/portfolios';
import {
  applyExampleTargets,
  applySuggestions,
  createCustomGroup,
  createGroupFromPreset,
  deleteGroup,
  saveGroup,
  setAssetTraits,
  trackWatchItem,
  type TraitEdit,
} from '@/server/services/traits';

export interface TraitResult {
  ok?: string;
  error?: string;
  id?: string;
}

async function run(fn: () => Promise<string | { ok: string; id?: string }>): Promise<TraitResult> {
  try {
    const r = await fn();
    for (const p of ['/traits', '/dashboard', '/journal']) revalidatePath(p, 'layout');
    return typeof r === 'string' ? { ok: r } : r;
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    console.error('[traits]', e);
    return { error: '저장하지 못했습니다. 잠시 후 다시 시도하세요.' };
  }
}

export async function addPresetGroupAction(key: string, autoTag: boolean) {
  const user = await requireUser();
  return run(async () => ({ ok: '분류를 추가했습니다.', id: await createGroupFromPreset(user.id, key, autoTag) }));
}

export async function addCustomGroupAction(name: string, traits: string) {
  const user = await requireUser();
  return run(async () => ({ ok: '분류를 추가했습니다.', id: await createCustomGroup(user.id, name, traits.split(',')) }));
}

export async function saveGroupAction(groupId: string, input: { name: string; cashTrait: string; base: string; traits: TraitEdit[] }) {
  const user = await requireUser();
  return run(() => saveGroup(user.id, groupId, input).then(() => '저장했습니다.'));
}

export async function deleteGroupAction(groupId: string) {
  const user = await requireUser();
  return run(() => deleteGroup(user.id, groupId).then(() => '분류를 지웠습니다.'));
}

export async function exampleTargetsAction(groupId: string) {
  const user = await requireUser();
  return run(() => applyExampleTargets(user.id, groupId).then(() => '예시 비중을 채웠습니다.'));
}

export async function suggestAction(groupId: string) {
  const user = await requireUser();
  return run(async () => {
    const n = await applySuggestions(user.id, groupId);
    return n ? `${n}개 종목에 추천 성질을 지정했습니다.` : '새로 지정할 종목이 없습니다. (이미 지정했거나 이름만으로는 알 수 없는 종목)';
  });
}

export async function setAssetTraitsAction(assetId: string, groupId: string, traitIds: string[]) {
  const user = await requireUser();
  return run(() => setAssetTraits(user.id, assetId, groupId, traitIds).then(() => '저장했습니다.'));
}

export async function trackWatchAction(symbol: string) {
  const user = await requireUser();
  return run(async () => ({ ok: '성질을 지정할 수 있게 종목을 추가했습니다.', id: await trackWatchItem(user.id, symbol) }));
}
