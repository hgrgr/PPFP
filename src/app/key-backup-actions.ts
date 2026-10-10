'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/server/auth';
import { kstDate } from '@/server/db';
import { exportKeys, restoreKeys, type RestoreLine } from '@/server/services/key-backup';
import { UserError } from '@/server/services/portfolios';

const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === 'string' ? v : '';
};

export async function exportKeysAction(f: FormData): Promise<{ text: string; filename: string; brokers: number; services: number } | { error: string }> {
  const user = await requireUser();
  try {
    const r = await exportKeys(user.id, { password: str(f, 'password'), passphrase: str(f, 'passphrase'), confirm: str(f, 'confirm'), code: str(f, 'code') });
    return { ...r, filename: `ppfp-keys-${kstDate()}.json` };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    console.error('[key-backup] export', e);
    return { error: '백업 파일을 만들지 못했습니다.' };
  }
}

export async function restoreKeysAction(f: FormData): Promise<{ lines: RestoreLine[] } | { error: string }> {
  const user = await requireUser();
  try {
    const file = f.get('file');
    if (!(file instanceof File) || !file.size) return { error: '백업 파일을 고르세요.' };
    if (file.size > 512 * 1024) return { error: 'PPFP 키 백업 파일이 아닙니다.' };
    const lines = await restoreKeys(user.id, await file.text(), str(f, 'passphrase'), { verify: str(f, 'verify') === 'on', overwrite: str(f, 'overwrite') === 'on' });
    revalidatePath('/', 'layout');
    return { lines };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    console.error('[key-backup] restore', e);
    return { error: '키를 되살리지 못했습니다.' };
  }
}
