'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { refreshDataAction } from '@/app/actions';
import { SHEET_KEYS, SHEETS } from '@/domain/data-format';
import type { ImportReport, Issue } from '@/server/services/data-io';
import { ActionForm, Submit } from './forms';

function Issues({ title, items, tone }: { title: string; items: Issue[]; tone?: 'err' | 'warn' }) {
  if (!items.length) return null;
  return (
    <details className={`import-issues ${tone ?? ''}`} open={tone === 'err' && items.length <= 20}>
      <summary>
        {title} {items.length.toLocaleString('ko-KR')}
      </summary>
      <ul>
        {items.slice(0, 200).map((x, i) => (
          <li key={i}>
            <span className="mono">{x.line}행</span> {x.message}
          </li>
        ))}
        {items.length > 200 && <li className="sub">외 {(items.length - 200).toLocaleString('ko-KR')}건</li>}
      </ul>
    </details>
  );
}

function Report({ report }: { report: ImportReport }) {
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="table-wrap">
        <table className="import-summary">
          <thead>
            <tr>
              <th scope="col">시트</th>
              <th scope="col">줄</th>
              <th scope="col">{report.committed ? '추가함' : '추가할 것'}</th>
              <th scope="col">이미 있음</th>
              <th scope="col">오류</th>
            </tr>
          </thead>
          <tbody>
            {report.sheets.map((s) => (
              <tr key={s.key}>
                <td>
                  <span className="strong">{s.name}</span>
                  {s.source !== s.name && <span className="sub"> · {s.source}</span>}
                </td>
                <td>{s.rows.toLocaleString('ko-KR')}</td>
                <td className="up-strong">{s.added.toLocaleString('ko-KR')}</td>
                <td>{s.skipped.toLocaleString('ko-KR')}</td>
                <td className={s.errors.length ? 'down' : undefined}>{s.errors.length.toLocaleString('ko-KR')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {report.sheets.map((s) =>
        s.errors.length || s.warnings.length || s.skippedLines.length ? (
          <div key={s.key} className="stack" style={{ gap: 4 }}>
            <span className="sub strong">{s.name}</span>
            <Issues title="오류 (가져오지 않음)" items={s.errors} tone="err" />
            <Issues title="알림" items={s.warnings} tone="warn" />
            <Issues title="이미 있어 건너뜀" items={s.skippedLines} />
          </div>
        ) : null,
      )}
      {report.ignored.length > 0 && <p className="sub">알 수 없는 시트는 건너뜁니다: {report.ignored.join(', ')}</p>}
    </div>
  );
}

/** Upload a file, see what it would do, then import. */
export function DataImport() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState('');
  const [busy, setBusy] = useState<'check' | 'commit' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportReport | null>(null);
  const [done, setDone] = useState<ImportReport | null>(null);

  const send = async (commit: boolean) => {
    if (!file) return;
    setBusy(commit ? 'commit' : 'check');
    setError(null);
    const body = new FormData();
    body.set('file', file);
    body.set('kind', kind);
    if (commit) body.set('commit', '1');
    try {
      const res = await fetch('/api/data/import', { method: 'POST', body });
      const json = (await res.json()) as { report?: ImportReport; error?: string };
      if (json.error || !json.report) throw new Error(json.error ?? '가져오지 못했습니다.');
      if (commit) {
        setDone(json.report);
        setPreview(null);
        router.refresh();
      } else setPreview(json.report);
    } catch (e) {
      setError(e instanceof TypeError ? '서버에 보내지 못했습니다. 파일을 다시 고르거나 잠시 후 다시 시도하세요.' : e instanceof Error ? e.message : '가져오지 못했습니다.');
    } finally {
      setBusy(null);
    }
  };

  const toAdd = preview?.sheets.reduce((s, x) => s + x.added, 0) ?? 0;
  const already = preview?.sheets.reduce((s, x) => s + x.skipped, 0) ?? 0;
  return (
    <div className="stack" style={{ gap: 16 }}>
      <section className="card">
        <h2>1. 파일 고르기</h2>
        <p className="sub">
          XLSX는 시트 이름(포트폴리오, 거래 내역, 매매일지, 메모, 독서 노트, 투자 거장, 키워드)으로 데이터를 알아봅니다. CSV는 첫 줄의 열 이름으로 알아보며, 안 되면 종류를 골라
          주세요. 형식은 <a href="/data?tab=format">형식과 샘플</a>에서 볼 수 있습니다.
        </p>
        <div className="inline" style={{ gap: 10 }}>
          <input
            type="file"
            accept=".xlsx,.csv,.tsv,.txt"
            aria-label="가져올 파일"
            // Cleared when the picker opens, so choosing the same (edited) file again fires onChange
            onClick={(e) => {
              e.currentTarget.value = '';
              setFile(null);
              setPreview(null);
            }}
            onChange={async (e) => {
              const picked = e.target.files?.[0] ?? null;
              setPreview(null);
              setDone(null);
              setError(null);
              setFile(null);
              if (!picked) return;
              // Keep a copy: the file on disk may change after it is chosen
              try {
                setFile(new File([await picked.arrayBuffer()], picked.name, { type: picked.type }));
              } catch {
                setError('파일을 읽지 못했습니다. 다시 골라 주세요.');
              }
            }}
            style={{ maxWidth: 360 }}
          />
          <select value={kind} aria-label="CSV의 데이터 종류" onChange={(e) => (setKind(e.target.value), setPreview(null))} style={{ width: 'auto' }}>
            <option value="">CSV 종류: 자동으로 알아보기</option>
            {SHEET_KEYS.map((k) => (
              <option key={k} value={k}>
                CSV 종류: {SHEETS[k].name}
              </option>
            ))}
          </select>
          <button type="button" className="btn primary" disabled={!file || !!busy} onClick={() => send(false)}>
            {busy === 'check' ? '확인 중…' : '확인하기'}
          </button>
        </div>
        {error && <p className="msg err">{error}</p>}
      </section>

      {preview && (
        <section className="card" aria-label="가져오기 미리 보기">
          <h2>2. 확인</h2>
          <p className="sub">아직 아무것도 바뀌지 않았습니다. 오류가 있는 줄과 이미 있는 데이터는 건너뜁니다. 거래 내역은 날짜 순서대로 다시 계산해 보유 종목과 Lot을 만듭니다.</p>
          <Report report={preview} />
          <div className="inline">
            <button type="button" className="btn primary" disabled={(!toAdd && !already) || !!busy} onClick={() => send(true)}>
              {busy === 'commit' ? '가져오는 중…' : toAdd ? `${toAdd.toLocaleString('ko-KR')}건 가져오기` : already ? '연결만 다시 맞추기' : '가져올 것이 없습니다'}
            </button>
            <button type="button" className="btn" disabled={!!busy} onClick={() => setPreview(null)}>
              취소
            </button>
          </div>
        </section>
      )}

      {done && (
        <section className="card" aria-label="가져오기 결과">
          <h2>가져왔습니다</h2>
          <Report report={done} />
          {done.transactions > 0 && (
            <ActionForm action={refreshDataAction} className="stack">
              <p className="sub">과거 날짜의 거래를 가져왔다면 대시보드의 평가액 추이와 수익률이 맞도록 일별 기록을 다시 계산하세요. 종목 수와 기간에 따라 몇 분 걸릴 수 있습니다.</p>
              <div>
                <Submit className="btn" pendingText="계산 중…">
                  일별 기록 다시 계산
                </Submit>
              </div>
            </ActionForm>
          )}
        </section>
      )}
    </div>
  );
}
