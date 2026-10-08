'use server';

import { revalidatePath } from 'next/cache';
import { isKType, type KRef } from '@/domain/knowledge';
import { requireUser } from '@/server/auth';
import {
  addLink,
  addPresetSage,
  createBook,
  createNote,
  createSage,
  deleteBook,
  deleteNote,
  deleteSage,
  deleteTopic,
  ensureTopic,
  removeLink,
  saveBook,
  saveSage,
  saveTopic,
  updateNote,
} from '@/server/services/knowledge';
import { UserError } from '@/server/services/portfolios';

export interface KResult {
  ok?: string;
  error?: string;
  id?: string;
  at?: number;
}

async function run(fn: () => Promise<string | { ok: string; id?: string }>): Promise<KResult> {
  try {
    const r = await fn();
    for (const p of ['/notes', '/books', '/sages', '/topics']) revalidatePath(p, 'layout');
    return { ...(typeof r === 'string' ? { ok: r } : r), at: Date.now() };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message, at: Date.now() };
    console.error('[knowledge]', e);
    return { error: '저장하지 못했습니다. 잠시 후 다시 시도하세요.', at: Date.now() };
  }
}

const ref = (r: KRef): KRef => {
  if (!isKType(r?.type) || typeof r.id !== 'string') throw new UserError('잘못된 항목입니다.');
  return { type: r.type, id: r.id };
};

export async function createNoteAction(body: string, sourceUrl?: string) {
  const user = await requireUser();
  return run(async () => ({ ok: '메모했습니다.', id: await createNote(user.id, body, sourceUrl) }));
}
export async function updateNoteAction(id: string, input: { body?: string; pinned?: boolean }) {
  const user = await requireUser();
  return run(() => updateNote(user.id, id, input).then(() => '저장했습니다.'));
}
export async function deleteNoteAction(id: string) {
  const user = await requireUser();
  return run(() => deleteNote(user.id, id).then(() => '메모를 지웠습니다.'));
}

export async function createBookAction(title: string) {
  const user = await requireUser();
  return run(async () => ({ ok: '책을 추가했습니다.', id: await createBook(user.id, title) }));
}
export async function saveBookAction(id: string, input: Parameters<typeof saveBook>[2]) {
  const user = await requireUser();
  return run(() => saveBook(user.id, id, input).then(() => '저장했습니다.'));
}
export async function deleteBookAction(id: string) {
  const user = await requireUser();
  return run(() => deleteBook(user.id, id).then(() => '책을 지웠습니다.'));
}

export async function addPresetSageAction(key: string) {
  const user = await requireUser();
  return run(async () => ({ ok: '추가했습니다.', id: await addPresetSage(user.id, key) }));
}
export async function createSageAction(name: string) {
  const user = await requireUser();
  return run(async () => ({ ok: '추가했습니다.', id: await createSage(user.id, name) }));
}
export async function saveSageAction(id: string, input: Parameters<typeof saveSage>[2]) {
  const user = await requireUser();
  return run(() => saveSage(user.id, id, input).then(() => '저장했습니다.'));
}
export async function deleteSageAction(id: string) {
  const user = await requireUser();
  return run(() => deleteSage(user.id, id).then(() => '지웠습니다.'));
}

export async function createTopicAction(name: string) {
  const user = await requireUser();
  return run(async () => ({ ok: '키워드를 만들었습니다.', id: await ensureTopic(user.id, name) }));
}
export async function saveTopicAction(id: string, input: { name: string; color: string; description: string }) {
  const user = await requireUser();
  return run(() => saveTopic(user.id, id, input).then(() => '저장했습니다.'));
}
export async function deleteTopicAction(id: string) {
  const user = await requireUser();
  return run(() => deleteTopic(user.id, id).then(() => '키워드를 지웠습니다.'));
}

export async function addLinkAction(x: KRef, y: KRef) {
  const user = await requireUser();
  return run(() => addLink(user.id, ref(x), ref(y)).then(() => '연결했습니다.'));
}
/** Link to a keyword by name, creating it when new. */
export async function addTopicLinkAction(x: KRef, name: string) {
  const user = await requireUser();
  return run(async () => {
    await addLink(user.id, ref(x), { type: 'topic', id: await ensureTopic(user.id, name) });
    return '연결했습니다.';
  });
}
export async function removeLinkAction(x: KRef, y: KRef) {
  const user = await requireUser();
  return run(() => removeLink(user.id, ref(x), ref(y)).then(() => '연결을 풀었습니다.'));
}
