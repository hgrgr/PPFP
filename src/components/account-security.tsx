'use client';

import { useActionState, useState, useTransition } from 'react';
import {
  changePasswordAction,
  confirmTotpAction,
  createInviteAction,
  deleteInviteAction,
  disableTotpAction,
  renewRecoveryAction,
  signOutDeviceAction,
  signOutOthersAction,
  startTotpAction,
  type SecurityResult,
} from '@/app/security-actions';
import { kstDateTime } from '@/lib/format';
import type { DeviceView, InviteView } from '@/server/services/security';

const empty = {} as SecurityResult;

function Msg({ r }: { r: SecurityResult }) {
  if (r.error) return <p role="alert" className="msg err full">{r.error}</p>;
  if (r.ok) return <p role="status" className="msg ok full">{r.ok}</p>;
  return null;
}

/** Codes shown once, with copy and download. */
function RecoveryCodes({ codes }: { codes: string[] }) {
  const text = codes.join('\n');
  return (
    <div className="recovery-codes full">
      <ol>
        {codes.map((c) => (
          <li key={c}>
            <code>{c}</code>
          </li>
        ))}
      </ol>
      <p className="sub">휴대폰을 잃어버렸을 때 인증 코드 대신 하나씩 씁니다. 비밀번호 관리자나 종이에 적어 두세요. 이 화면을 벗어나면 다시 볼 수 없습니다.</p>
      <div className="inline">
        <button type="button" className="btn small" onClick={() => navigator.clipboard?.writeText(text)}>
          복사
        </button>
        <a className="btn small" download="ppfp-recovery-codes.txt" href={`data:text/plain;charset=utf-8,${encodeURIComponent(`PPFP 복구 코드\n${text}\n`)}`}>
          파일로 받기
        </a>
      </div>
    </div>
  );
}

/** Password + code fields for re-checking who is at the keyboard. */
function IdentityFields({ twoStep }: { twoStep: boolean }) {
  return (
    <>
      <label className="field">
        로그인 비밀번호
        <input name="password" type="password" autoComplete="current-password" required />
      </label>
      {twoStep && (
        <label className="field">
          인증 코드
          <input name="code" inputMode="numeric" autoComplete="one-time-code" required maxLength={20} />
        </label>
      )}
    </>
  );
}

export function TwoStep({ enabledAt, recoveryLeft }: { enabledAt: string | null; recoveryLeft: number }) {
  const [setup, setSetup] = useState<SecurityResult['setup'] | null>(null);
  const [startMsg, setStartMsg] = useState<SecurityResult>(empty);
  const [starting, start] = useTransition();
  const [confirmed, confirm, confirming] = useActionState(confirmTotpAction, empty);
  const [renewed, renew, renewing] = useActionState(renewRecoveryAction, empty);
  const [disabled, disable, disabling] = useActionState(disableTotpAction, empty);

  if (confirmed.codes) {
    return (
      <div className="stack">
        <Msg r={confirmed} />
        <RecoveryCodes codes={confirmed.codes} />
      </div>
    );
  }

  if (enabledAt) {
    return (
      <div className="stack">
        <p>
          <span className="badge ok">켜짐</span> {kstDateTime(enabledAt)}부터 · 남은 복구 코드 {recoveryLeft}개
          {recoveryLeft <= 3 && <span className="msg err"> — 얼마 남지 않았습니다. 새로 만드세요.</span>}
        </p>
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <form action={renew} className="grid" aria-label="복구 코드 새로 만들기">
            <h3 className="full">복구 코드 새로 만들기</h3>
            <IdentityFields twoStep />
            <div className="full">
              <button className="btn" disabled={renewing}>{renewing ? '만드는 중…' : '새로 만들기'}</button>
            </div>
            <Msg r={renewed} />
            {renewed.codes && <RecoveryCodes codes={renewed.codes} />}
          </form>
          <form action={disable} className="grid" aria-label="2단계 인증 끄기" onSubmit={(e) => !window.confirm('2단계 인증을 끌까요? 비밀번호만으로 로그인하게 됩니다.') && e.preventDefault()}>
            <h3 className="full">2단계 인증 끄기</h3>
            <IdentityFields twoStep />
            <div className="full">
              <button className="btn danger" disabled={disabling}>{disabling ? '끄는 중…' : '끄기'}</button>
            </div>
            <Msg r={disabled} />
          </form>
        </div>
      </div>
    );
  }

  if (!setup) {
    return (
      <div className="stack">
        <p className="sub">
          <span className="badge">꺼짐</span> 켜면 로그인할 때 비밀번호 다음에 휴대폰 인증 앱(Google Authenticator, Microsoft Authenticator, 1Password 등)의 6자리 숫자를 한 번 더 넣습니다. 키 백업, AI 운용 승인, 비밀번호 변경 때도 같이 묻습니다.
        </p>
        <div className="inline">
          <button
            type="button"
            className="btn primary"
            disabled={starting}
            onClick={() =>
              start(async () => {
                const r = await startTotpAction();
                setStartMsg(r);
                if (r.setup) setSetup(r.setup);
              })
            }
          >
            {starting ? '준비 중…' : '2단계 인증 켜기'}
          </button>
        </div>
        <Msg r={startMsg} />
      </div>
    );
  }

  return (
    <div className="totp-setup">
      <div className="totp-qr" aria-label="인증 앱에 추가할 QR 코드" dangerouslySetInnerHTML={{ __html: setup.qr }} />
      <form action={confirm} className="stack">
        <ol className="steps">
          <li>휴대폰 인증 앱에서 <span className="strong">계정 추가 → QR 코드 스캔</span>으로 왼쪽 코드를 찍습니다. 휴대폰으로 이 화면을 보고 있다면 <a href={setup.uri} className="strong">여기를 눌러</a> 앱에 바로 추가합니다.</li>
          <li>
            찍을 수 없으면 키를 직접 넣습니다(시간 기준, 6자리): <code className="totp-key">{setup.secret.match(/.{1,4}/g)?.join(' ')}</code>
          </li>
          <li>앱에 생긴 PPFP 항목의 6자리 숫자를 넣고 확인을 누릅니다.</li>
        </ol>
        <div className="inline">
          <input name="code" inputMode="numeric" autoComplete="one-time-code" required maxLength={8} placeholder="123456" aria-label="인증 코드" style={{ width: 120 }} />
          <button className="btn primary" disabled={confirming}>{confirming ? '확인 중…' : '확인하고 켜기'}</button>
          <button type="button" className="btn" onClick={() => setSetup(null)}>
            취소
          </button>
        </div>
        <Msg r={confirmed} />
      </form>
    </div>
  );
}

export function PasswordChange({ twoStep }: { twoStep: boolean }) {
  const [r, action, pending] = useActionState(changePasswordAction, empty);
  return (
    <form action={action} className="grid" aria-label="비밀번호 바꾸기" key={r.ok ? 'done' : 'form'}>
      <label className="field">
        지금 비밀번호
        <input name="current" type="password" autoComplete="current-password" required />
      </label>
      {twoStep && (
        <label className="field">
          인증 코드
          <input name="code" inputMode="numeric" autoComplete="one-time-code" required maxLength={20} />
        </label>
      )}
      <label className="field">
        새 비밀번호 (10자 이상)
        <input name="next" type="password" autoComplete="new-password" minLength={10} required />
      </label>
      <label className="field">
        새 비밀번호 확인
        <input name="confirm" type="password" autoComplete="new-password" minLength={10} required />
      </label>
      <p className="sub full">바꾸면 이 기기를 뺀 다른 기기는 모두 로그아웃됩니다.</p>
      <div className="full">
        <button className="btn" disabled={pending}>{pending ? '바꾸는 중…' : '비밀번호 바꾸기'}</button>
      </div>
      <Msg r={r} />
    </form>
  );
}

export function Devices({ devices }: { devices: DeviceView[] }) {
  const [one, signOutOne, pendingOne] = useActionState(signOutDeviceAction, empty);
  const [others, signOutAll, pendingAll] = useActionState(signOutOthersAction, empty);
  return (
    <div className="stack">
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>기기</th>
              <th>주소</th>
              <th>로그인</th>
              <th>마지막 사용</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {devices.map((d) => (
              <tr key={d.id}>
                <td className="strong">
                  {d.label}
                  {d.current && <> <span className="badge ok">이 기기</span></>}
                </td>
                <td className="sub">{d.ip ?? '—'}</td>
                <td className="sub">{kstDateTime(d.createdAt)}</td>
                <td className="sub">{d.lastSeenAt ? kstDateTime(d.lastSeenAt) : '—'}</td>
                <td>
                  {!d.current && (
                    <form action={signOutOne}>
                      <input type="hidden" name="id" value={d.id} />
                      <button className="btn small" disabled={pendingOne}>로그아웃</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {devices.length > 1 && (
        <form action={signOutAll} className="inline" onSubmit={(e) => !window.confirm('이 기기를 뺀 모든 기기에서 로그아웃할까요?') && e.preventDefault()}>
          <button className="btn" disabled={pendingAll}>다른 기기 모두 로그아웃</button>
        </form>
      )}
      <Msg r={one.error || one.ok ? one : others} />
    </div>
  );
}

export function Invites({ invites, mode }: { invites: InviteView[]; mode: string }) {
  const [made, make, making] = useActionState(createInviteAction, empty);
  const [removed, remove] = useActionState(deleteInviteAction, empty);
  const now = Date.now();
  const link = made.invite && typeof window !== 'undefined' ? `${window.location.origin}/signup?invite=${encodeURIComponent(made.invite.code)}` : null;
  return (
    <div className="stack">
      <form action={make} className="grid" aria-label="초대 만들기">
        <label className="field">
          받을 사람 이메일 (선택)
          <input name="email" type="email" autoComplete="off" placeholder="비우면 누구나 한 번" />
        </label>
        <label className="field">
          메모 (선택)
          <input name="note" maxLength={80} placeholder="예: 배우자" />
        </label>
        <div className="full inline">
          <button className="btn" disabled={making || mode !== 'invite'}>{making ? '만드는 중…' : '초대 코드 만들기'}</button>
          {mode !== 'invite' && <span className="sub">지금 서버의 가입 방식이 *초대*가 아니어서 초대 코드가 쓰이지 않습니다.</span>}
        </div>
        <Msg r={made} />
        {made.invite && (
          <div className="full invite-made">
            <p>
              코드 <code>{made.invite.code}</code> · {kstDateTime(made.invite.expiresAt)}까지 한 번 쓸 수 있습니다.
            </p>
            {link && (
              <p className="sub">
                가입 링크: <code>{link}</code>{' '}
                <button type="button" className="btn small" onClick={() => navigator.clipboard?.writeText(link)}>
                  복사
                </button>
              </p>
            )}
          </div>
        )}
      </form>
      {invites.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>받는 사람</th>
                <th>상태</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {invites.map((i) => (
                <tr key={i.id}>
                  <td>
                    {i.email ?? '누구나'}
                    {i.note && <div className="sub">{i.note}</div>}
                  </td>
                  <td className="sub">{i.usedAt ? `가입함 · ${kstDateTime(i.usedAt).slice(5, 10)}` : new Date(i.expiresAt).getTime() < now ? '기한 지남' : `${kstDateTime(i.expiresAt).slice(5, 10)}까지`}</td>
                  <td>
                    {!i.usedAt && (
                      <form action={remove}>
                        <input type="hidden" name="id" value={i.id} />
                        <button className="btn small">지우기</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Msg r={removed} />
    </div>
  );
}
