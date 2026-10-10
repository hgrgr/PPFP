'use server';

import qrcode from 'qrcode-generator';
import { revalidatePath } from 'next/cache';
import { currentSessionId, requireUser } from '@/server/auth';
import { UserError } from '@/server/services/portfolios';
import {
  changePassword,
  confirmTotpSetup,
  createInvite,
  deleteInvite,
  disableTotp,
  newRecoveryCodesFor,
  signOutDevice,
  signOutOthers,
  startTotpSetup,
} from '@/server/services/security';

export type SecurityResult = { ok?: string; error?: string; codes?: string[]; setup?: { secret: string; uri: string; qr: string }; invite?: { code: string; expiresAt: string } };

const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === 'string' ? v : '';
};

async function run(fn: () => Promise<SecurityResult>): Promise<SecurityResult> {
  try {
    const r = await fn();
    revalidatePath('/settings');
    return r;
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    console.error('[security]', e);
    return { error: '처리하지 못했습니다. 잠시 후 다시 시도하세요.' };
  }
}

export async function startTotpAction(): Promise<SecurityResult> {
  const user = await requireUser();
  return run(async () => {
    const { secret, uri } = await startTotpSetup(user.id);
    const qr = qrcode(0, 'M');
    qr.addData(uri);
    qr.make();
    return { setup: { secret, uri, qr: qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true }) } };
  });
}

export async function confirmTotpAction(_: SecurityResult, f: FormData): Promise<SecurityResult> {
  const user = await requireUser();
  return run(async () => ({ ok: '2단계 인증을 켰습니다. 아래 복구 코드를 지금 저장하세요.', codes: await confirmTotpSetup(user.id, str(f, 'code')) }));
}

export async function disableTotpAction(_: SecurityResult, f: FormData): Promise<SecurityResult> {
  const user = await requireUser();
  return run(async () => {
    await disableTotp(user.id, str(f, 'password'), str(f, 'code'));
    return { ok: '2단계 인증을 껐습니다.' };
  });
}

export async function renewRecoveryAction(_: SecurityResult, f: FormData): Promise<SecurityResult> {
  const user = await requireUser();
  return run(async () => ({ ok: '복구 코드를 새로 만들었습니다. 예전 코드는 더 쓸 수 없습니다.', codes: await newRecoveryCodesFor(user.id, str(f, 'password'), str(f, 'code')) }));
}

export async function changePasswordAction(_: SecurityResult, f: FormData): Promise<SecurityResult> {
  const user = await requireUser();
  return run(async () => {
    const n = await changePassword(user.id, await currentSessionId(), { current: str(f, 'current'), next: str(f, 'next'), confirm: str(f, 'confirm'), code: str(f, 'code') });
    return { ok: `비밀번호를 바꿨습니다.${n ? ` 다른 기기 ${n}곳은 로그아웃했습니다.` : ''}` };
  });
}

export async function signOutDeviceAction(_: SecurityResult, f: FormData): Promise<SecurityResult> {
  const user = await requireUser();
  return run(async () => {
    await signOutDevice(user.id, await currentSessionId(), str(f, 'id'));
    return { ok: '로그아웃시켰습니다.' };
  });
}

export async function signOutOthersAction(_: SecurityResult, _f: FormData): Promise<SecurityResult> {
  const user = await requireUser();
  return run(async () => {
    const n = await signOutOthers(user.id, await currentSessionId());
    return { ok: n ? `다른 기기 ${n}곳을 로그아웃했습니다.` : '다른 기기가 없습니다.' };
  });
}

export async function createInviteAction(_: SecurityResult, f: FormData): Promise<SecurityResult> {
  const user = await requireUser();
  return run(async () => {
    const { code, expiresAt } = await createInvite(user.id, { email: str(f, 'email'), note: str(f, 'note') });
    return { ok: '초대 코드를 만들었습니다. 이 화면을 벗어나면 다시 볼 수 없습니다.', invite: { code, expiresAt: expiresAt.toISOString() } };
  });
}

export async function deleteInviteAction(_: SecurityResult, f: FormData): Promise<SecurityResult> {
  const user = await requireUser();
  return run(async () => {
    await deleteInvite(user.id, str(f, 'id'));
    return { ok: '초대를 지웠습니다.' };
  });
}
