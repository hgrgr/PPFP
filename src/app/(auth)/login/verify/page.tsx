import { redirect } from 'next/navigation';
import { verifyLoginAction } from '@/app/actions';
import { ActionForm, Submit } from '@/components/forms';
import { currentUser, pendingSession } from '@/server/auth';

export const metadata = { title: '2단계 인증' };
export const dynamic = 'force-dynamic';

export default async function VerifyLoginPage() {
  if (await currentUser()) redirect('/dashboard');
  const pending = await pendingSession();
  if (!pending) redirect('/login');
  return (
    <main className="auth">
      <div className="card">
        <h1>2단계 인증</h1>
        <p className="sub">
          <span className="strong">{pending.user.email}</span>의 비밀번호를 확인했습니다. 인증 앱(Google Authenticator, 1Password 등)의 PPFP 항목에 나온 6자리 숫자를 넣으세요.
        </p>
        <ActionForm action={verifyLoginAction} className="stack">
          <label className="field">
            인증 코드
            <input name="code" inputMode="numeric" autoComplete="one-time-code" autoFocus required maxLength={20} placeholder="123456" />
          </label>
          <Submit>확인</Submit>
        </ActionForm>
        <p className="sub">휴대폰을 잃어버렸으면 2단계 인증을 켤 때 받은 복구 코드(예: k7qd-2mxa)를 넣으세요. 복구 코드는 한 번씩만 쓸 수 있습니다. 10분 안에 넣지 않으면 처음부터 다시 로그인합니다.</p>
        <p className="sub">
          <a href="/login" className="strong">다른 계정으로 로그인</a>
        </p>
      </div>
    </main>
  );
}
