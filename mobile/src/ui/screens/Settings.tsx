/** 백업 · 복원, 파일, 시세 연결 · API 키, 서버 연동, 앱 정보 */
import { useState } from 'react';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import { backupPayload, exportCsvs, importCsv, restorePayload, wipeAll, type Payload } from '~/core/archive';
import { checkPassphrase, MIN_PASSPHRASE, openBackup, sealBackup } from '~/core/backup';
import { db, kstToday, setSetting } from '~/core/db';
import { readPicked, saveFile } from '~/core/files';
import { canNotify } from '~/core/notify';
import { pollServer } from '~/core/poll';
import { login, logout, me, webLink, type ServerInfo, type ServerLink } from '~/core/server';
import { planSend, receive, send } from '~/core/sync';
import type { KisKeys } from '~/core/market';
import { useLive, useSetting } from '../hooks';
import { ago, kstDateTime } from '../format';
import { Msg, Topbar, useAction } from '../kit';

export function Backup() {
  const act = useAction();
  const last = useSetting<string | null>('lastBackupAt', null);
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [restorePass, setRestorePass] = useState('');
  const [file, setFile] = useState<File | null>(null);
  return (
    <>
      <Topbar title="백업 · 복원" back />
      <div className="page">
        <section className="card form">
          <h2>백업 파일 만들기</h2>
          <p className="sub">
            포트폴리오·거래·메모·일지·목표·대출·알림과 넣어 둔 API 키까지 한 파일에 담고, 정한 암호로 잠급니다(AES-256). 암호 없이는 열 수 없으니 구글 드라이브에 두어도 됩니다. 암호는 어디에도 저장하지 않으니 잊으면 파일을 열 수 없습니다. 마지막 백업: {ago(last)}
          </p>
          <label className="field">백업 암호 ({MIN_PASSPHRASE}자 이상)<input type="password" autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)} /></label>
          <label className="field">백업 암호 확인<input type="password" autoComplete="new-password" value={pass2} onChange={(e) => setPass2(e.target.value)} /></label>
          <button
            className="btn primary"
            disabled={act.busy}
            onClick={() =>
              act.run(async () => {
                if (pass !== pass2) throw new Error('암호 두 칸이 다릅니다.');
                checkPassphrase(pass);
                const sealed = await sealBackup(await backupPayload(), pass);
                const how = await saveFile(`ppfp-app-backup-${kstToday()}.json`, JSON.stringify(sealed));
                if (how === 'cancelled') return '저장할 곳을 고르지 않아 백업을 저장하지 않았습니다.';
                await setSetting('lastBackupAt', new Date().toISOString());
                setPass('');
                setPass2('');
                return how === 'shared' ? '백업 파일을 넘겼습니다. 드라이브에 저장됐는지 확인하세요.' : '백업 파일을 내려받았습니다.';
              })
            }
          >
            {act.busy ? '잠그는 중…' : '백업 파일 만들어 저장'}
          </button>
        </section>
        <section className="card form">
          <h2>백업에서 되살리기</h2>
          <p className="sub">파일을 고르면 시스템 파일 선택 화면에서 구글 드라이브도 고를 수 있습니다. <span className="strong">지금 이 폰의 데이터는 모두 백업의 것으로 바뀝니다.</span> 서버 연동은 그대로 둡니다.</p>
          <label className="field">백업 파일<input type="file" accept="application/json,.json" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
          <label className="field">백업 암호<input type="password" autoComplete="current-password" value={restorePass} onChange={(e) => setRestorePass(e.target.value)} /></label>
          <button
            className="btn"
            disabled={act.busy || !file}
            onClick={() =>
              window.confirm('이 폰의 데이터를 백업의 것으로 바꿀까요?') &&
              act.run(async () => {
                const { payload, createdAt } = await openBackup<Payload>(await readPicked(file!), restorePass);
                const n = await restorePayload(payload);
                setRestorePass('');
                return `${kstDateTime(createdAt)}에 만든 백업을 되살렸습니다: 거래 ${n.txns}건, 자산 ${n.assets}개, 메모 ${n.notes}개.`;
              })
            }
          >
            되살리기
          </button>
        </section>
        <Msg {...act.msg} />
      </div>
    </>
  );
}

export function Files() {
  const act = useAction();
  return (
    <>
      <Topbar title="파일로 내보내기 · 가져오기" back />
      <div className="page">
        <section className="card">
          <h2>CSV로 내보내기</h2>
          <p className="sub">포트폴리오, 거래 내역, 메모, 매매일지를 PPFP 웹 앱의 가져오기 형식(CSV, 엑셀에서 열림)으로 저장합니다. 잠기지 않은 파일이니 보관은 백업 파일로 하세요.</p>
          <button className="btn" disabled={act.busy} onClick={() => act.run(async () => {
            const files = await exportCsvs();
            for (const f of files) if (f.rows && (await saveFile(f.name, f.text, 'text/csv')) === 'cancelled') return '저장을 취소했습니다.';
            return `${files.filter((f) => f.rows).map((f) => `${f.name} (${f.rows}줄)`).join(', ')}을(를) 저장했습니다.`;
          })}>CSV 저장</button>
        </section>
        <section className="card form">
          <h2>CSV 가져오기</h2>
          <p className="sub">웹 앱에서 내보낸 CSV나 같은 열 이름으로 만든 표를 넣습니다. 이미 있는 거래(같은 거래 ID)는 건너뜁니다. 웹 앱의 가져오기 · 내보내기 › 형식과 샘플에서 열 설명을 볼 수 있습니다.</p>
          <input type="file" accept=".csv,text/csv" aria-label="CSV 파일" onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) act.run(async () => {
              const r = await importCsv(await readPicked(file));
              e.target.value = '';
              return `${r.name}: ${r.added}개를 넣었습니다${r.skipped ? `, ${r.skipped}개는 이미 있어 건너뜀` : ''}${r.problems.length ? `. 읽지 못한 줄 ${r.problems.length}개 (첫 줄: ${r.problems[0].line}행 ${r.problems[0].message})` : ''}.`;
            });
          }} />
        </section>
        <Msg {...act.msg} />
      </div>
    </>
  );
}

export function Keys() {
  const kis = useSetting<KisKeys | null>('kis', null);
  const anthropic = useSetting<string>('anthropicKey', '');
  const act = useAction();
  const [k, setK] = useState({ appKey: '', secret: '', paper: false });
  const [ak, setAk] = useState('');
  return (
    <>
      <Topbar title="시세 연결 · API 키" back />
      <div className="page">
        <section className="card">
          <h2>코인 · 환율</h2>
          <p className="sub">코인은 업비트 공개 시세, 달러 환율은 무료 환율 서비스에서 키 없이 받습니다.</p>
        </section>
        <section className="card form">
          <h2>한국투자증권 (국내·미국 주식 시세)</h2>
          <p className="sub">
            {kis ? `연결됨 · 앱키 ${'•'.repeat(6)}${kis.appKey.slice(-4)}${kis.paper ? ' · 모의투자' : ''}` : '키가 없으면 주식은 직접 넣은 평가 가격으로 계산합니다.'} KIS Developers(apiportal.koreainvestment.com)에서 발급한 앱키와 시크릿을 넣습니다. 시세 조회에만 쓰고 주문은 내지 않습니다. 토큰을 새로 받을 때마다 증권사에서 카카오톡 안내가 오므로, 토큰은 하루 동안 다시 씁니다.
          </p>
          <label className="field">App Key<input value={k.appKey} onChange={(e) => setK({ ...k, appKey: e.target.value })} autoComplete="off" /></label>
          <label className="field">App Secret<input type="password" value={k.secret} onChange={(e) => setK({ ...k, secret: e.target.value })} autoComplete="off" /></label>
          <label className="check"><input type="checkbox" checked={k.paper} onChange={(e) => setK({ ...k, paper: e.target.checked })} />모의투자 키</label>
          <div className="actions">
            <button className="btn primary" disabled={act.busy || !k.appKey || !k.secret} onClick={() => act.run(async () => { await setSetting('kis', { appKey: k.appKey.trim(), secret: k.secret.trim(), paper: k.paper }); await db.settings.delete('kisToken'); setK({ appKey: '', secret: '', paper: false }); return '저장했습니다. 홈에서 시세 새로고침을 누르세요.'; })}>저장</button>
            {kis && <button className="btn danger" onClick={() => act.run(async () => { await db.settings.bulkDelete(['kis', 'kisToken']); return '지웠습니다.'; })}>지우기</button>}
          </div>
        </section>
        <section className="card form">
          <h2>Anthropic (AI 어드바이저)</h2>
          <p className="sub">{anthropic ? `저장됨 · ${'•'.repeat(6)}${anthropic.slice(-4)}` : 'console.anthropic.com에서 만든 API 키를 넣습니다. 사용한 만큼 키 주인에게 요금이 나옵니다.'}</p>
          <label className="field">API 키<input type="password" value={ak} onChange={(e) => setAk(e.target.value)} autoComplete="off" placeholder="sk-ant-…" /></label>
          <div className="actions">
            <button className="btn primary" disabled={act.busy || !ak.startsWith('sk-')} onClick={() => act.run(async () => { await setSetting('anthropicKey', ak.trim()); setAk(''); return '저장했습니다.'; })}>저장</button>
            {anthropic && <button className="btn danger" onClick={() => db.settings.delete('anthropicKey')}>지우기</button>}
          </div>
        </section>
        <p className="sub">키는 이 폰 안의 앱 전용 저장소에만 있고, 백업 파일에는 백업 암호로 잠겨 들어갑니다.</p>
        <Msg {...act.msg} />
      </div>
    </>
  );
}

const FEATURE_LABEL: Record<string, string> = {
  alerts: '1분마다 가격 알림 · 목표 비중 알림',
  'realestate-alerts': '부동산 알림 (실거래·등기·토허제)',
  push: '푸시 알림 (서버가 보낸 알림을 이 앱이 가져와 표시)',
  'ai-briefing': 'AI 아침 브리핑과 알림 분석, 에이전트',
  'broker-sync': '증권사 6곳·코인 거래소 4곳 잔고 가져오기 (업비트 허용 IP 등)',
  backup: '서버 DB 정기 백업, 가족 계정',
  web: '웹 앱 전체 화면',
};

export function Server() {
  const link = useSetting<ServerLink | null>('server', null);
  const lastPoll = useSetting<string | null>('serverPolledAt', null);
  const act = useAction();
  const [info, setInfo] = useState<ServerInfo | null>(null);
  const [f, setF] = useState({ url: '', email: '', password: '', code: '' });
  const [needCode, setNeedCode] = useState(false);
  const [plan, setPlan] = useState<string | null>(null);
  const native = Capacitor.isNativePlatform();
  const counts = useLive(async () => ({ unsent: await db.txns.filter((t) => !t.serverId).count(), total: await db.txns.count() }));

  if (!link)
    return (
      <>
        <Topbar title="서버 연동" back />
        <div className="page">
          <section className="card">
            <h2>서버를 연결하면</h2>
            <p className="sub">이 앱은 서버 없이 동작합니다. PPFP 웹 서버(집 PC나 Oracle 무료 VM + Tailscale)를 연결하면 폰만으로는 못 하는 일이 다시 열립니다.</p>
            <ul className="sub" style={{ margin: 0, paddingLeft: 18 }}>
              {Object.values(FEATURE_LABEL).map((v) => <li key={v}>{v}</li>)}
            </ul>
          </section>
          <section className="card form">
            <h2>로그인</h2>
            <label className="field">서버 주소<input value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://ppfp.tail1234.ts.net" autoCapitalize="none" inputMode="url" />
              <span className="hint">Tailscale을 쓰면 휴대폰의 Tailscale 앱을 먼저 켜 두세요.</span>
            </label>
            <label className="field">이메일<input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoComplete="username" /></label>
            <label className="field">비밀번호<input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="current-password" /></label>
            {needCode && <label className="field">2단계 인증 코드<input inputMode="numeric" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} autoComplete="one-time-code" /></label>}
            <button className="btn primary" disabled={act.busy} onClick={() => act.run(async () => {
              const r = await login(f.url, f.email, f.password, f.code, navigator.userAgent.match(/Android [\d.]+; ([^;)]+)/)?.[1] ?? 'phone');
              if (!r.ok) {
                setNeedCode(true);
                return '2단계 인증 코드를 넣고 다시 누르세요.';
              }
              await setSetting('server', r.link);
              await setSetting('serverNoticeAfter', new Date().toISOString());
              setF({ url: '', email: '', password: '', code: '' });
              setNeedCode(false);
              if (native) await canNotify(true);
              return '연결했습니다.';
            })}>{act.busy ? '연결 중…' : '연결'}</button>
            <Msg {...act.msg} />
          </section>
        </div>
      </>
    );

  return (
    <>
      <Topbar title="서버 연동" back />
      <div className="page">
        <section className="card">
          <div className="card-head">
            <h2>{link.email}</h2>
            <span className="badge ok">연결됨</span>
          </div>
          <p className="sub">{link.url} · {kstDateTime(link.linkedAt)}에 연결 · 알림 확인 {ago(lastPoll)}</p>
          <div className="actions">
            <button className="btn small" disabled={act.busy} onClick={() => act.run(async () => { const i = await me(link); setInfo(i); return `서버가 응답했습니다${i.user.twoStep ? ' (2단계 인증 켜짐)' : ''}.`; })}>연결 확인</button>
            <button className="btn small" disabled={act.busy} onClick={() => act.run(async () => { const n = await pollServer(true); return `서버 알림 ${n}개를 새로 받았습니다.`; })}>알림 지금 받기</button>
          </div>
          {info && <ul className="sub" style={{ margin: 0, paddingLeft: 18 }}>{info.server.features.map((x) => <li key={x}>{FEATURE_LABEL[x] ?? x}</li>)}</ul>}
        </section>
        <section className="card">
          <h2>서버 화면 열기</h2>
          <p className="sub">실시간 알림 설정, 증권사 잔고 가져오기, 부동산 알림, AI 브리핑처럼 서버에서만 되는 일은 웹 앱에서 합니다. 로그인한 채로 열립니다.</p>
          <div className="actions">
            {[['/dashboard', '대시보드'], ['/alerts', '알림 설정'], ['/settings', '연동 · 설정'], ['/ai', 'AI 어드바이저']].map(([path, label]) => (
              <button key={path} className="btn small" disabled={act.busy} onClick={() => act.run(async () => {
                const url = await webLink(link, path);
                if (native) await Browser.open({ url });
                else window.open(url, '_blank', 'noopener');
              })}>{label}</button>
            ))}
          </div>
        </section>
        <section className="card">
          <h2>데이터 맞추기</h2>
          <p className="sub">서버에 아직 없는 이 폰의 거래 {counts?.unsent ?? 0}건 / 전체 {counts?.total ?? 0}건. 보내기와 가져오기 모두 이미 있는 거래는 건너뜁니다.</p>
          <div className="actions">
            <button className="btn small" disabled={act.busy} onClick={() => act.run(async () => {
              const p = await planSend();
              const r = await send(link, false);
              const errs = r.reports.flatMap((s) => s.errors.map((e) => `${s.name} ${e.line}행: ${e.message}`));
              setPlan(`보낼 것: 거래 ${p.txns}건, 메모 ${p.notes}개, 일지 ${p.journals}개. 서버 확인 결과 ${r.reports.map((s) => `${s.name} 추가 ${s.added}·건너뜀 ${s.skipped}`).join(', ')}${errs.length ? `. 문제 ${errs.length}건: ${errs.slice(0, 3).join(' / ')}` : ''}`);
            })}>보내기 미리 보기</button>
            <button className="btn small primary" disabled={act.busy || !plan} onClick={() => act.run(async () => {
              const r = await send(link, true);
              setPlan(null);
              return `서버에 보냈습니다: ${r.reports.map((s) => `${s.name} ${s.added}`).join(', ')}. 거래 ${r.matched}건이 서버 번호와 이어졌습니다.`;
            })}>서버로 보내기</button>
            <button className="btn small" disabled={act.busy} onClick={() => act.run(async () => {
              const r = await receive(link);
              return `서버에서 가져왔습니다: 거래 ${r.txns}건, 자산 ${r.assets}개, 포트폴리오 ${r.portfolios}개, 메모 ${r.notes}개, 일지 ${r.journals}개${r.skipped ? ` (이미 있는 ${r.skipped}건 건너뜀)` : ''}${r.problems ? `, 읽지 못한 줄 ${r.problems}개` : ''}.`;
            })}>서버에서 가져오기</button>
          </div>
          {plan && <Msg info={plan} />}
        </section>
        <Msg {...act.msg} />
        <button className="btn danger" onClick={() => window.confirm('서버 연결을 끊을까요? 이 폰의 데이터는 그대로입니다.') && act.run(async () => { await logout(link); await db.settings.bulkDelete(['server', 'serverNoticeAfter', 'serverPolledAt']); return '연결을 끊었습니다.'; })}>연결 끊기</button>
      </div>
    </>
  );
}

export function About() {
  const act = useAction();
  return (
    <>
      <Topbar title="앱 정보" back />
      <div className="page">
        <section className="card">
          <h2>이 폰에서만 되는 일</h2>
          <ul className="sub" style={{ margin: 0, paddingLeft: 18 }}>
            <li>포트폴리오·거래·Lot 손익(선입선출 등 5가지)·현금, 순자산·대출 상환 일정, 목표 시뮬레이션, 세금·배당 추정</li>
            <li>시세: 업비트 코인, 한국투자증권 국내·미국 주식(내 키), 달러 환율</li>
            <li>가격 알림: 앱을 열거나 새로고침할 때 확인 (휴대폰이 꺼져 있을 때는 확인하지 못함)</li>
            <li>메모, 매매일지, AI 어드바이저(내 Anthropic 키)</li>
            <li>암호로 잠근 백업 파일, 웹 앱과 같은 CSV</li>
          </ul>
        </section>
        <section className="card">
          <h2>서버를 연결해야 되는 일</h2>
          <ul className="sub" style={{ margin: 0, paddingLeft: 18 }}>
            <li>1분마다 감시하는 가격·목표 비중 알림, 부동산 알림, AI 아침 브리핑</li>
            <li>허용 IP가 필요한 거래소 키(업비트 등), 증권사 잔고·거래내역 가져오기</li>
            <li>가족 계정, 서버 DB 정기 백업</li>
          </ul>
        </section>
        <section className="card">
          <h2>데이터 지우기</h2>
          <p className="sub">이 폰의 모든 데이터(키 포함)를 지웁니다. 먼저 백업하세요.</p>
          <button className="btn danger" onClick={() => window.confirm('정말 모두 지울까요? 되돌릴 수 없습니다.') && act.run(async () => { await wipeAll(); return '모두 지웠습니다.'; })}>모두 지우기</button>
          <Msg {...act.msg} />
        </section>
        <p className="sub">PPFP 앱 0.1 · {Capacitor.getPlatform()}</p>
      </div>
    </>
  );
}

