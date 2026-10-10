'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/server/auth';
import { pushToUser } from '@/server/push';
import { createAlert, deleteAlert, rearmAlert, savePortfolioTargets } from '@/server/services/alerts';
import { markAllRead } from '@/server/services/notify';
import { checkRealEstateAlerts, createReAlert, deleteReAlert, saveVworldKey, setReAlertActive } from '@/server/services/real-estate-alerts';
import { UserError } from '@/server/services/portfolios';

export interface AlertResult {
  ok?: string;
  error?: string;
}

async function run(fn: () => Promise<string>, paths: string[] = ['/alerts']): Promise<AlertResult> {
  try {
    const ok = await fn();
    for (const p of paths) revalidatePath(p, 'layout');
    return { ok };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    console.error('[alerts]', e);
    return { error: '처리하지 못했습니다. 잠시 후 다시 시도하세요.' };
  }
}

export async function createAlertAction(input: { assetId: string; price: string; direction: string; note: string }) {
  const user = await requireUser();
  return run(() => createAlert(user.id, input).then(() => '알림을 만들었습니다.'));
}

export async function rearmAlertAction(id: string) {
  const user = await requireUser();
  return run(() => rearmAlert(user.id, id).then(() => '알림을 다시 켰습니다.'));
}

export async function deleteAlertAction(id: string) {
  const user = await requireUser();
  return run(() => deleteAlert(user.id, id).then(() => '알림을 지웠습니다.'));
}

export async function markReadAction() {
  const user = await requireUser();
  return run(() => markAllRead(user.id).then(() => '모두 읽음으로 표시했습니다.'));
}

export async function testPushAction() {
  const user = await requireUser();
  return run(async () => {
    const n = await pushToUser(user.id, { title: 'PPFP 테스트 알림', body: '이 기기에서 가격·목표 비중 알림을 받을 수 있습니다.', url: '/alerts', tag: 'test' });
    if (!n) throw new UserError('보낼 기기가 없거나 보내지 못했습니다. 이 기기에서 알림 받기를 다시 켜 보세요.');
    return `${n}대 기기로 보냈습니다.`;
  });
}

export async function savePortfolioTargetsAction(portfolioId: string, input: { targets: Record<string, string>; tolerance: string; alert: boolean }) {
  const user = await requireUser();
  return run(() => savePortfolioTargets(user.id, portfolioId, input).then(() => '목표 비중을 저장했습니다.'), [`/portfolios/${portfolioId}`, '/alerts']);
}

// ── 부동산 알림 ─────────────────────────────────────

export async function createReAlertAction(input: Parameters<typeof createReAlert>[1]) {
  const user = await requireUser();
  return run(() => createReAlert(user.id, input).then(() => '부동산 알림을 만들었습니다. 지금 있는 거래를 기준으로 삼고, 다음 확인부터 새로 생긴 일을 알립니다.'));
}

export async function setReAlertActiveAction(id: string, active: boolean) {
  const user = await requireUser();
  return run(() => setReAlertActive(user.id, id, active).then(() => (active ? '다시 켰습니다. 지금부터 생기는 일을 알립니다.' : '껐습니다.')));
}

export async function deleteReAlertAction(id: string) {
  const user = await requireUser();
  return run(() => deleteReAlert(user.id, id).then(() => '지웠습니다.'));
}

/** Checks this user's rules now instead of waiting for the next round. */
export async function checkReAlertsAction() {
  const user = await requireUser();
  return run(() => checkRealEstateAlerts(user.id).then((n) => (n ? `새 소식 ${n}건을 알림함에 넣었습니다.` : '확인했습니다. 새로 생긴 일은 없습니다.')));
}

export async function saveVworldKeyAction(_prev: AlertResult, form: FormData) {
  const user = await requireUser();
  return run(() => saveVworldKey(user.id, { key: String(form.get('vworldKey') ?? ''), clear: form.get('clearVworld') === 'on' }).then(() => '브이월드 키를 저장했습니다'), ['/settings']);
}
