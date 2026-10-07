import { redirect } from 'next/navigation';
import { signupAction } from '@/app/actions';
import { ActionForm, Submit } from '@/components/forms';
import { currentUser } from '@/server/auth';

export const metadata = { title: '가입' };

export default async function SignupPage() {
  if (await currentUser()) redirect('/dashboard');
  return (
    <main className="auth">
      <div className="card">
        <h1>가입</h1>
        <ActionForm action={signupAction} className="stack">
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
        <p className="sub">
          이미 계정이 있나요? <a href="/login" className="strong">로그인</a>
        </p>
      </div>
    </main>
  );
}
