'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { exportKeysAction, restoreKeysAction } from '@/app/key-backup-actions';
import type { RestoreLine } from '@/server/services/key-backup';

const RESULT: Record<RestoreLine['result'], string> = { added: '추가', replaced: '바꿈', skipped: '건너뜀', failed: '실패' };

/** Download every key as a passphrase-sealed file, or bring one back into this account. */
export function KeyBackup() {
  const router = useRouter();
  const exportRef = useRef<HTMLFormElement>(null);
  const [exportMsg, setExportMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const [restore, setRestore] = useState<{ lines?: RestoreLine[]; error?: string } | null>(null);
  const [exporting, startExport] = useTransition();
  const [restoring, startRestore] = useTransition();

  return (
    <div className="row" style={{ alignItems: 'flex-start' }}>
      <form
        ref={exportRef}
        className="grid"
        aria-label="키 백업 파일 만들기"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          startExport(async () => {
            const r = await exportKeysAction(f);
            if ('error' in r) return setExportMsg({ error: r.error });
            const url = URL.createObjectURL(new Blob([r.text], { type: 'application/json' }));
            const a = document.createElement('a');
            a.href = url;
            a.download = r.filename;
            a.click();
            URL.revokeObjectURL(url);
            exportRef.current?.reset();
            setExportMsg({ ok: `${r.filename}을(를) 내려받았습니다. 증권사·거래소 ${r.brokers}곳, 서비스 키 ${r.services}개가 들어 있습니다.` });
          });
        }}
      >
        <h3 className="full">백업 파일 만들기</h3>
        <label className="field full">
          로그인 비밀번호
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        <label className="field">
          백업 암호 (12자 이상)
          <input name="passphrase" type="password" autoComplete="new-password" minLength={12} required />
        </label>
        <label className="field">
          백업 암호 확인
          <input name="confirm" type="password" autoComplete="new-password" minLength={12} required />
        </label>
        <p className="sub full">백업 암호는 서버에 저장하지 않습니다. 잊으면 파일을 열 수 없으니 비밀번호 관리자 등에 따로 적어 두세요.</p>
        <div className="full inline">
          <button className="btn primary" disabled={exporting}>{exporting ? '만드는 중…' : '백업 파일 내려받기'}</button>
          {exportMsg?.ok && <span className="msg ok">{exportMsg.ok}</span>}
          {exportMsg?.error && <span className="msg err">{exportMsg.error}</span>}
        </div>
      </form>

      <form
        className="grid"
        aria-label="키 백업 파일에서 되살리기"
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const f = new FormData(form);
          startRestore(async () => {
            const r = await restoreKeysAction(f);
            setRestore(r);
            if ('lines' in r) {
              form.reset();
              router.refresh();
            }
          });
        }}
      >
        <h3 className="full">백업 파일에서 되살리기</h3>
        <label className="field full">
          백업 파일
          <input name="file" type="file" accept=".json,application/json" required />
        </label>
        <label className="field full">
          백업 암호
          <input name="passphrase" type="password" autoComplete="off" required />
        </label>
        <label className="check full">
          <input type="checkbox" name="verify" defaultChecked /> 증권사·거래소 연결을 확인한 뒤 저장 (한국투자증권은 확인할 때 알림톡이 갑니다)
        </label>
        <label className="check full">
          <input type="checkbox" name="overwrite" /> 이미 저장된 서비스 키도 백업의 키로 바꾸기
        </label>
        <div className="full inline">
          <button className="btn primary" disabled={restoring}>{restoring ? '되살리는 중…' : '되살리기'}</button>
          {restore?.error && <span className="msg err">{restore.error}</span>}
        </div>
        {restore?.lines && (
          <ul className="full restore-lines" aria-label="되살린 결과">
            {restore.lines.map((l, i) => (
              <li key={i}>
                <span className={`badge ${l.result === 'failed' ? 'warn' : l.result === 'skipped' ? '' : 'ok'}`}>{RESULT[l.result]}</span> <span className="strong">{l.what}</span>
                {l.note && <span className="sub"> · {l.note}</span>}
              </li>
            ))}
          </ul>
        )}
      </form>
    </div>
  );
}
