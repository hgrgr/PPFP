import { redirect } from 'next/navigation';
import { loginAction } from '@/app/actions';
import { ActionForm, Submit } from '@/components/forms';
import { currentUser } from '@/server/auth';

export const metadata = { title: '로그인' };

export default async function LoginPage() {
  if (await currentUser()) redirect('/dashboard');
  return (
    <main className="auth">
      <div className="card">
        <h1>로그인</h1>
        <ActionForm action={loginAction} className="stack">
          <label className="field">
            이메일
            <input type="email" name="email" autoComplete="email" required />
          </label>
          <label className="field">
            비밀번호
            <input type="password" name="password" autoComplete="current-password" required />
          </label>
          <Submit>로그인</Submit>
        </ActionForm>
        <p className="sub">
          계정이 없나요? <a href="/signup" className="strong">가입하기</a>
        </p>
      </div>
    </main>
  );
}
