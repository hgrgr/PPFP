'use server';

import { revalidatePath } from 'next/cache';
import type { PlaceHit } from '@/domain/real-estate';
import { requireUser } from '@/server/auth';
import { UserError } from '@/server/services/portfolios';
import { apartmentOptions, apartmentView, myApartments, saveRealEstateKey, searchApartments, setApartment, type ApartmentOptions, type ApartmentSummary, type ApartmentView } from '@/server/services/real-estate';

async function attempt<T>(tag: string, fn: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    console.error(`[real-estate] ${tag}`, e);
    return { error: '처리하지 못했습니다. 잠시 후 다시 시도하세요.' };
  }
}

export async function searchApartmentsAction(query: string): Promise<{ hits: PlaceHit[] } | { error: string }> {
  const user = await requireUser();
  return attempt('search', async () => ({ hits: await searchApartments(user.id, query) }));
}

export async function apartmentOptionsAction(place: PlaceHit, months = 12): Promise<ApartmentOptions | { error: string }> {
  const user = await requireUser();
  return attempt('options', () => apartmentOptions(user.id, place, months));
}

export async function apartmentViewAction(assetId: string): Promise<ApartmentView | { error: string }> {
  const user = await requireUser();
  return attempt('view', () => apartmentView(user.id, assetId));
}

export async function setApartmentAction(assetId: string, meta: string): Promise<{ ok: true } | { error: string }> {
  const user = await requireUser();
  return attempt('set', async () => {
    await setApartment(user.id, assetId, meta);
    revalidatePath('/', 'layout');
    return { ok: true as const };
  });
}

export async function saveRealEstateKeyAction(_prev: { ok?: string; error?: string }, form: FormData) {
  const user = await requireUser();
  const r = await attempt('key', () => saveRealEstateKey(user.id, { key: String(form.get('molitKey') ?? ''), clear: form.get('clearMolit') === 'on' }));
  if (r && typeof r === 'object' && 'error' in r) return r;
  revalidatePath('/settings');
  return { ok: '실거래가 설정을 저장했습니다' };
}

export async function myApartmentsAction(): Promise<{ rows: ApartmentSummary[]; unlinked: number } | { error: string }> {
  const user = await requireUser();
  return attempt('mine', () => myApartments(user.id));
}
