'use server';

import { revalidatePath } from 'next/cache';
import type { ActionState } from '@/app/actions';
import { BENCHMARK_CATALOG, DEFAULT_BENCHMARKS } from '@/domain/benchmark';
import { requireUser } from '@/server/auth';
import { prisma } from '@/server/db';
import { saveEcosKey } from '@/server/services/benchmark-data';
import { UserError } from '@/server/services/portfolios';

async function run(fn: () => Promise<string>, path: string): Promise<ActionState> {
  try {
    const ok = await fn();
    revalidatePath(path);
    return { ok, at: Date.now() };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message, at: Date.now() };
    console.error('[benchmarks]', e);
    return { error: '처리하지 못했습니다. 잠시 후 다시 시도하세요.', at: Date.now() };
  }
}

const known = new Set(BENCHMARK_CATALOG.map((b) => b.key));

/** The benchmarks 성과 분석 compares with: the ticked ones, in catalog order */
export async function saveBenchmarksAction(_: ActionState, f: FormData) {
  const user = await requireUser();
  return run(async () => {
    const keys = f.getAll('b').map(String).filter((k) => known.has(k));
    if (!keys.length) throw new UserError('벤치마크를 하나 이상 고르세요.');
    if (keys.length > 8) throw new UserError('벤치마크는 8개까지 고를 수 있습니다.');
    await prisma.user.update({ where: { id: user.id }, data: { benchmarks: keys } });
    return `벤치마크 ${keys.length}개와 비교합니다.`;
  }, '/performance');
}

export async function removeBenchmarkAction(_: ActionState, f: FormData) {
  const user = await requireUser();
  return run(async () => {
    const key = String(f.get('key') ?? '');
    const current = user.benchmarks.length ? user.benchmarks : DEFAULT_BENCHMARKS;
    const next = current.filter((k) => k !== key && known.has(k));
    if (!next.length) throw new UserError('벤치마크가 하나는 있어야 합니다. 다른 것을 먼저 더하세요.');
    await prisma.user.update({ where: { id: user.id }, data: { benchmarks: next } });
    return '벤치마크를 뺐습니다.';
  }, '/performance');
}

export async function saveEcosKeyAction(_: ActionState, f: FormData) {
  const user = await requireUser();
  return run(() => saveEcosKey(user.id, { key: String(f.get('ecosKey') ?? ''), clear: f.get('clearEcos') === 'on' }).then(() => '한국은행 ECOS 키를 저장했습니다.'), '/settings');
}
