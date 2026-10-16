'use server';

import { revalidatePath } from 'next/cache';
import type { ActionState } from '@/app/actions';
import { INCOME_BASES, RANGE_YEARS, readPrefs, REGIONS, toggled, type AnalysisPrefs } from '@/domain/indicators';
import { requireUser } from '@/server/auth';
import { prisma } from '@/server/db';
import { saveKosisKey, saveRoneKey } from '@/server/services/indicators';
import { saveDartKey } from '@/server/services/dart';
import { saveFredKey } from '@/server/services/fred';
import { UserError } from '@/server/services/portfolios';

export interface PrefsPatch {
  toggle?: { id: string; on: boolean };
  region?: string;
  incomeBase?: string;
  years?: number;
}

/** Saves one change to the 분석 지표 screen (an indicator switched, the region, income basis or period). */
export async function updateAnalysisPrefs(patch: PrefsPatch): Promise<AnalysisPrefs> {
  const user = await requireUser();
  let prefs = readPrefs(user.analysisPrefs);
  if (patch.toggle) prefs = toggled(prefs, patch.toggle.id, patch.toggle.on);
  if (patch.region && (REGIONS.some((r) => r.code === patch.region) || /^\d{5}$/.test(patch.region))) prefs = { ...prefs, region: patch.region };
  if (patch.incomeBase && INCOME_BASES.some((b) => b.key === patch.incomeBase)) prefs = { ...prefs, incomeBase: patch.incomeBase as AnalysisPrefs['incomeBase'] };
  if (patch.years !== undefined && (RANGE_YEARS as readonly number[]).includes(patch.years)) prefs = { ...prefs, years: patch.years };
  await prisma.user.update({ where: { id: user.id }, data: { analysisPrefs: { ...prefs } } });
  return prefs;
}

export async function saveKosisKeyAction(_: ActionState, f: FormData): Promise<ActionState> {
  const user = await requireUser();
  try {
    await saveKosisKey(user.id, { key: String(f.get('kosisKey') ?? ''), clear: f.get('clearKosis') === 'on' });
    revalidatePath('/settings');
    return { ok: '통계청 KOSIS 키를 저장했습니다.', at: Date.now() };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message, at: Date.now() };
    console.error('[analysis]', e);
    return { error: '처리하지 못했습니다. 잠시 후 다시 시도하세요.', at: Date.now() };
  }
}

export async function saveRoneKeyAction(_: ActionState, f: FormData): Promise<ActionState> {
  const user = await requireUser();
  try {
    await saveRoneKey(user.id, { key: String(f.get('roneKey') ?? ''), clear: f.get('clearRone') === 'on' });
    revalidatePath('/settings');
    return { ok: '한국부동산원 R-ONE 키를 저장했습니다.', at: Date.now() };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message, at: Date.now() };
    console.error('[analysis]', e);
    return { error: '처리하지 못했습니다. 잠시 후 다시 시도하세요.', at: Date.now() };
  }
}

export async function saveDartKeyAction(_: ActionState, f: FormData): Promise<ActionState> {
  const user = await requireUser();
  try {
    await saveDartKey(user.id, { key: String(f.get('dartKey') ?? ''), clear: f.get('clearDart') === 'on' });
    revalidatePath('/settings');
    return { ok: 'OpenDART 키를 저장했습니다.', at: Date.now() };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message, at: Date.now() };
    console.error('[dart]', e);
    return { error: '처리하지 못했습니다. 잠시 후 다시 시도하세요.', at: Date.now() };
  }
}

export async function saveFredKeyAction(_: ActionState, f: FormData): Promise<ActionState> {
  const user = await requireUser();
  try {
    await saveFredKey(user.id, { key: String(f.get('fredKey') ?? ''), clear: f.get('clearFred') === 'on' });
    revalidatePath('/settings');
    return { ok: 'FRED 키를 저장했습니다.', at: Date.now() };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message, at: Date.now() };
    console.error('[fred]', e);
    return { error: '처리하지 못했습니다. 잠시 후 다시 시도하세요.', at: Date.now() };
  }
}
