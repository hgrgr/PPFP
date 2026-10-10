'use server';

import { revalidatePath } from 'next/cache';
import type { ActionState } from '@/app/actions';
import { requireUser } from '@/server/auth';
import { adoptVersion, createPhilosophy, deletePhilosophy, previewImport, setArchived } from '@/server/services/philosophy';
import { UserError } from '@/server/services/portfolios';
import { LINT_LABEL } from '@/domain/philosophy';

const PATH = '/philosophies';

async function run(fn: () => Promise<unknown>, ok: string, fail: string): Promise<ActionState> {
  try {
    await fn();
    revalidatePath(PATH);
    return { ok, at: Date.now() };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message, at: Date.now() };
    console.error('[philosophy]', e);
    return { error: fail, at: Date.now() };
  }
}

export async function createPhilosophyAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const s = (k: string) => String(form.get(k) ?? '');
  return run(
    () => createPhilosophy(user.id, { name: s('name'), oneLine: s('oneLine'), principles: s('principles'), rules: s('rules'), origin: s('origin') || 'custom' }),
    '철학을 저장하고 버전 1을 채택했습니다',
    '저장하지 못했습니다.',
  );
}

export async function adoptVersionAction(strategyId: string, version: number): Promise<ActionState> {
  const user = await requireUser();
  return run(() => adoptVersion(user.id, strategyId, version), `버전 ${version}을 채택했습니다`, '채택하지 못했습니다.');
}

export async function archivePhilosophyAction(strategyId: string, archived: boolean): Promise<ActionState> {
  const user = await requireUser();
  return run(() => setArchived(user.id, strategyId, archived), archived ? '보관했습니다' : '다시 꺼냈습니다', '바꾸지 못했습니다.');
}

export async function deletePhilosophyAction(strategyId: string): Promise<ActionState> {
  const user = await requireUser();
  return run(() => deletePhilosophy(user.id, strategyId), '철학을 지웠습니다', '지우지 못했습니다.');
}

/** Lint pasted philosophy text without saving it. */
export async function lintPreviewAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireUser();
  const p = previewImport(String(form.get('text') ?? ''));
  if (p.verdict === 'ok') return { ok: p.tooLong ? '위험 문구는 없지만 8,000자를 넘어 잘립니다' : '위험 문구를 찾지 못했습니다', at: Date.now() };
  const lines = p.lint.map((f) => `${f.level === 'block' ? '차단' : f.level === 'caution' ? '주의' : '참고'} · ${LINT_LABEL[f.code] ?? f.code}: “${f.excerpt}”`);
  return p.verdict === 'block' ? { error: lines.join(' / '), at: Date.now() } : { ok: lines.join(' / '), at: Date.now() };
}
