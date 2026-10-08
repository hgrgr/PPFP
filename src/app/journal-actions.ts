'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/server/auth';
import { deleteJournal, deleteTemplate, saveJournal, saveTemplate, type JournalInput } from '@/server/services/journal';
import { UserError } from '@/server/services/portfolios';

export interface SaveResult {
  id?: string;
  error?: string;
  at: number;
}

async function run(fn: () => Promise<string | void>): Promise<SaveResult> {
  try {
    const id = (await fn()) || undefined;
    for (const p of ['/journal', '/dashboard', '/transactions']) revalidatePath(p, 'layout');
    return { id, at: Date.now() };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message, at: Date.now() };
    console.error('[journal]', e);
    return { error: '저장하지 못했습니다. 잠시 후 다시 시도하세요.', at: Date.now() };
  }
}

export async function saveJournalAction(input: JournalInput): Promise<SaveResult> {
  const user = await requireUser();
  return run(() => saveJournal(user.id, input));
}

export async function deleteJournalAction(id: string): Promise<SaveResult> {
  const user = await requireUser();
  return run(() => deleteJournal(user.id, id));
}

export async function saveTemplateAction(input: { id?: string; name: string; description?: string; fields: unknown; content: unknown }): Promise<SaveResult> {
  const user = await requireUser();
  return run(() => saveTemplate(user.id, input));
}

export async function deleteTemplateAction(id: string): Promise<SaveResult> {
  const user = await requireUser();
  return run(() => deleteTemplate(user.id, id));
}
