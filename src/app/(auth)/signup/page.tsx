import { redirect } from 'next/navigation';
import { signupAction } from '@/app/actions';
import { ActionForm, Submit } from '@/components/forms';
import { currentUser } from '@/server/auth';
import { prisma } from '@/server/db';
import { signupMode } from '@/server/services/security';

export const metadata = { title: '가입' };
export const dynamic = 'force-dynamic';

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ invite?: string }> }) {
  if (await currentUser()) redirect('/dashboard');
  const { invite } = await searchParams;
  const first = (await prisma.user.count()) === 0;
  const mode = signupMode();
  const closed = !first && mode === 'closed';
  const needsInvite = !first && mode === 'invite';
  return (
    <main className="auth">
      <div className="card">
        <h1>가입</h1>
        {first && <p className="sub">이 서버의 첫 계정입니다. 이후 가입은 서버 설정(SIGNUP_MODE)에 따라 초대 코드가 있어야 하거나 막힙니다.</p>}
        {closed ? (
          <p className="msg err">이 서버는 새 가입을 받지 않습니다. 서버를 운영하는 사람에게 문의하세요.</p>
        ) : (
          <ActionForm action={signupAction} className="stack">
            {needsInvite && (
              <label className="field">
                초대 코드
                <input name="invite" defaultValue={invite ?? ''} autoComplete="off" required maxLength={40} />
                <span className="sub">이 서버의 사용자가 연동 · 설정 → 계정 보안에서 만든 코드입니다.</span>
              </label>
            )}
            <label className="field">
              이름 (선택)
              <input name="name" autoComplete="name" maxLength={40} />
            </label>
            <label className="field">
              이메일
              <input type="email" name="email" autoComplete="email" required />
            </label>
            <label className="field">
              비밀번호 (10자 이상)
              <input type="password" name="password" autoComplete="new-password" minLength={10} required />
            </label>
            <Submit>가입하고 시작하기</Submit>
          </ActionForm>
        )}
        <p className="sub">
          이미 계정이 있나요? <a href="/login" className="strong">로그인</a>
        </p>
      </div>
    </main>
  );
}
